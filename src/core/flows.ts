import type { Flow } from "../protocol/generated";
export async function parseFlow(
  source: string,
  operations: readonly string[],
): Promise<Flow> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw new Error("Invalid flow frontmatter");
  const { loadFrontmatter } = await import("./flow-parser");
  const value = loadFrontmatter(match[1]!);
  return validateFlowDocument(
    typeof value === "object" && value !== null
      ? { ...value, body: match[2] ?? "" }
      : value,
    operations,
  );
}
export function validateFlowDocument(
  value: unknown,
  operations: readonly string[],
): Flow {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid flow");
  const flow = value as Flow;
  if (
    flow.format !== "1.0" ||
    typeof flow.id !== "string" ||
    !flow.id ||
    typeof flow.title !== "string" ||
    !flow.title ||
    !["prompt", "structured"].includes(flow.kind) ||
    !Array.isArray(flow.parameters) ||
    !Array.isArray(flow.tags) ||
    !flow.tags.every((tag) => typeof tag === "string") ||
    typeof flow.body !== "string"
  )
    throw new Error("Invalid flow");
  const names = new Set<string>();
  for (const parameter of flow.parameters) {
    if (
      !parameter ||
      typeof parameter.name !== "string" ||
      !parameter.name ||
      names.has(parameter.name) ||
      !["string", "number", "boolean"].includes(parameter.type) ||
      typeof parameter.required !== "boolean" ||
      typeof parameter.label !== "string" ||
      (parameter.default !== undefined &&
        typeof parameter.default !== parameter.type)
    )
      throw new Error("Invalid flow parameter");
    names.add(parameter.name);
  }
  if (flow.kind === "structured") {
    if (!Array.isArray(flow.steps) || !flow.steps.length)
      throw new Error("Invalid flow steps");
    for (const step of flow.steps) {
      if (
        !step ||
        !operations.includes(step.operation) ||
        typeof step.arguments !== "object" ||
        step.arguments === null ||
        Array.isArray(step.arguments)
      )
        throw new Error("Unknown operation");
      for (const reference of JSON.stringify(step.arguments).matchAll(
        /\{\{([^}]+)\}\}/g,
      ))
        if (!names.has(reference[1]!)) throw new Error("Unknown parameter");
    }
  } else if (flow.steps !== undefined)
    throw new Error("Prompt cannot contain steps");
  return flow;
}
export function bindFlow(
  flow: Flow,
  values: Record<string, unknown>,
): { operation: string; arguments: Record<string, unknown> }[] {
  const resolved: Record<string, unknown> = Object.create(null);
  for (const parameter of flow.parameters) {
    const value = values[parameter.name] ?? parameter.default;
    if (value === undefined && parameter.required)
      throw new Error("Missing parameter");
    if (value !== undefined && typeof value !== parameter.type)
      throw new Error("Invalid parameter type");
    resolved[parameter.name] = value;
  }
  const bind = (value: unknown): unknown => {
    if (typeof value === "string") {
      const reference = /^\{\{([^}]+)\}\}$/.exec(value);
      return reference ? resolved[reference[1]!] : value;
    }
    if (Array.isArray(value)) return value.map(bind);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, bind(val)]),
      );
    return value;
  };
  return (flow.steps ?? []).map((step) => ({
    operation: step.operation,
    arguments: bind(step.arguments) as Record<string, unknown>,
  }));
}
