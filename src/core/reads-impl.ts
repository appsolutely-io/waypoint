import type {
  ManifestEntry,
  ToolCall,
  ReadTemplate,
} from "../protocol/generated";
import type { ReadResult } from "./reads";
import type { ReadPorts, ReplyInput } from "./client";
import type { Frame, Problem } from "../protocol/generated";
// Loaded on first use by the handlers in ./reads, outside the core bundle.
export async function handleToolRead(
  call: ToolCall,
  manifest: readonly ManifestEntry[],
  request: (call: ToolCall) => Promise<unknown>,
): Promise<ReadResult> {
  const entry = manifest.find(
    (entry) =>
      entry.id === call.operation &&
      entry.kind === "read" &&
      entry.method === "GET" &&
      entry.path === call.path,
  );
  if (
    call.method !== "GET" ||
    !entry ||
    !safePath(call.path) ||
    Object.keys(call.query ?? {}).some(
      (key) => !entry.filterable.includes(key) || entry.fields[key] !== "low",
    )
  )
    return { kind: "refused", reason: "invalid-read" };
  const fields = entry.returns.filter((field) => entry.fields[field] === "low");
  const result = await request(call);
  return {
    kind: "result",
    callId: call.id,
    result: Array.isArray(result)
      ? result.map((row) => project(row, fields))
      : project(result, fields),
  };
}
function project(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    fields
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, (value as Record<string, unknown>)[key]]),
  );
}
function safePath(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !/[?#\\]/.test(path) &&
    !decodeURIComponentSafe(path)
      .split("/")
      .some((part) => part === "." || part === "..") &&
    !/%2f|%5c/i.test(path)
  );
}
function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "..";
  }
}
export async function handlePlanningRead(
  call: ReadTemplate,
  template: ReadTemplate,
  request: (call: ReadTemplate) => Promise<{
    rows: Record<string, unknown>;
    versions: Record<string, string>;
  }>,
): Promise<
  | { kind: "refused"; reason: string }
  | {
      kind: "plan.values";
      rows: Record<string, Record<string, unknown>>;
      versions: Record<string, string>;
    }
> {
  if (
    call.method !== "GET" ||
    call.path !== template.path ||
    !safePath(call.path) ||
    JSON.stringify(call.rows) !== JSON.stringify(template.rows) ||
    JSON.stringify(call.fields) !== JSON.stringify(template.fields)
  )
    return { kind: "refused", reason: "invalid-read" };
  const result = await request(template);
  if (
    Object.keys(result.rows).some((row) => !template.rows.includes(row)) ||
    template.rows.some(
      (row) =>
        !result.versions[row] ||
        !Object.prototype.hasOwnProperty.call(result.rows, row),
    )
  )
    return { kind: "refused", reason: "invalid-read" };
  return {
    kind: "plan.values",
    rows: Object.fromEntries(
      template.rows.map((row) => [
        row,
        project(result.rows[row], template.fields),
      ]),
    ),
    versions: Object.fromEntries(
      template.rows.map((row) => [row, result.versions[row]!]),
    ),
  };
}

// Answers a read frame and sends its reply, while `current` holds.
export async function answerRead(
  frame: Extract<Frame, { type: "tool.call" | "planning-read" }>,
  reads: ReadPorts,
  conversationId: string,
  current: () => boolean,
  report: (problem: Problem) => void,
  send: (reply: ReplyInput) => Promise<unknown>,
): Promise<boolean | void> {
  const ask =
    <C, R>(request: (call: C) => Promise<R>) =>
    async (call: C) => {
      if (!current()) throw new Error("stale-read");
      return request(call);
    };
  if (frame.type === "tool.call") {
    const result = await handleToolRead(
      frame.call,
      reads.manifest,
      ask((call: ToolCall) => reads.request(call)),
    );
    if (!current()) return;
    const problem =
      result.kind === "refused"
        ? { code: "invalid-read" as const, id: frame.call.id }
        : undefined;
    if (problem) report(problem);
    await send({
      kind: "tool-result",
      clientReplyId: `${conversationId}:tool:${frame.call.id}`,
      callId: frame.call.id,
      result: result.kind === "result" ? result.result : null,
      ...(problem ? { problem } : {}),
    });
    // Whether the read was answered with its result.
    return !problem;
  }
  const planning = reads.planning;
  const template = await planning?.template(frame.planId, frame.stepId);
  if (!current()) return;
  const result =
    template &&
    planning &&
    (await handlePlanningRead(
      frame.template,
      template,
      ask((call: ReadTemplate) => planning.request(call)),
    ));
  if (!current()) return;
  if (!result || result.kind === "refused")
    return report({ code: "invalid-read", id: frame.stepId });
  await send({
    kind: "plan.values",
    clientReplyId: `${conversationId}:values:${frame.planId}:${frame.stepId}`,
    planId: frame.planId,
    steps: [
      { stepId: frame.stepId, rows: result.rows, versions: result.versions },
    ],
  });
}
