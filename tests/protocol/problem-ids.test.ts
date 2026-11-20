import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import ts from "typescript";

const generated = resolve("src/protocol/generated.ts");
const omitted = new Set(["conformance", "host", "testing"]);
function sources(directory = resolve("src")): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = resolve(directory, entry.name);
    if (directory === resolve("src") && omitted.has(entry.name)) return [];
    return entry.isDirectory()
      ? sources(name)
      : /\.tsx?$/.test(name)
        ? [name]
        : [];
  });
}
function collect(program: ts.Program, files: readonly string[]): Set<string> {
  const checker = program.getTypeChecker();
  const definition = program
    .getSourceFile(generated)!
    .statements.find(
      (node): node is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(node) && node.name.text === "Problem",
    )!;
  const problemType = checker.getTypeAtLocation(definition);
  const ids = new Set<string>();
  const problem = (type: ts.Type | undefined): boolean =>
    !!type &&
    !(
      type.flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)
    ) &&
    checker.isTypeAssignableTo(checker.getNonNullableType(type), problemType);
  const literal = (node: ts.Node): string | undefined => {
    const type = checker.getTypeAtLocation(node);
    return type.isStringLiteral() ? type.value : undefined;
  };
  const add = (node: ts.Node) => {
    const id = literal(node);
    if (id !== undefined) ids.add(id);
  };
  const problemId = (node: ts.Node): boolean =>
    ((ts.isPropertyAccessExpression(node) && node.name.text === "id") ||
      (ts.isElementAccessExpression(node) &&
        literal(node.argumentExpression) === "id")) &&
    problem(checker.getTypeAtLocation(node.expression));
  const propertyName = (name: ts.PropertyName): string | undefined =>
    ts.isIdentifier(name) || ts.isStringLiteral(name)
      ? name.text
      : ts.isComputedPropertyName(name)
        ? literal(name.expression)
        : undefined;
  const hasProblemId = (node: ts.Node): boolean =>
    problemId(node) ||
    !!ts.forEachChild(node, (child) => hasProblemId(child) || undefined);
  const array = (
    node: ts.Expression,
  ): ts.ArrayLiteralExpression | undefined => {
    if (ts.isArrayLiteralExpression(node)) return node;
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      )
        return declaration.initializer;
    }
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = node.properties.filter(
        (
          property,
        ): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
          (ts.isPropertyAssignment(property) ||
            ts.isShorthandPropertyAssignment(property)) &&
          propertyName(property.name) === "id",
      );
      if (
        properties.some(
          (property) =>
            literal(
              ts.isPropertyAssignment(property)
                ? property.initializer
                : property.name,
            ) !== undefined,
        ) &&
        (problem(checker.getContextualType(node)) ||
          problem(checker.getTypeAtLocation(node)))
      ) {
        for (const property of properties)
          add(
            ts.isPropertyAssignment(property)
              ? property.initializer
              : property.name,
          );
      }
    }
    if (ts.isCallExpression(node)) {
      let symbol = node.arguments[1]
        ? checker.getSymbolAtLocation(node.expression)
        : undefined;
      if (symbol && symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      if (
        symbol &&
        ["asProblem", "readProblem"].includes(symbol.name) &&
        node.arguments[1]
      ) {
        const signature = checker.getResolvedSignature(node);
        if (signature && problem(checker.getReturnTypeOfSignature(signature)))
          add(node.arguments[1]);
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "includes" &&
        array(node.expression.expression) &&
        node.arguments.some(hasProblemId)
      ) {
        for (const entry of array(node.expression.expression)?.elements ?? [])
          add(entry);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      if (literal(node.right) !== undefined && problemId(node.left))
        add(node.right);
      if (literal(node.left) !== undefined && problemId(node.right))
        add(node.left);
    }
    ts.forEachChild(node, visit);
  };
  for (const file of files) visit(program.getSourceFile(file)!);
  return ids;
}
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
  types: [],
};
function undocumented(ids: Set<string>, sentence: string): string[] {
  const spans = new Set(
    [...sentence.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
  );
  return [...ids].filter((id) => !spans.has(id)).sort();
}

it("reserved problem id documentation covers every client fixed id", () => {
  const files = sources();
  expect(files.some((file) => file.includes("/react/"))).toBe(true);
  expect(files.some((file) => file.includes("/hooks/"))).toBe(true);
  const program = ts.createProgram(files, options);
  const ids = collect(program, files);
  const sentence = readFileSync("docs/reply-protocol.md", "utf8")
    .split("\n")
    .find((line) => line.startsWith("Host problem ids MUST NOT"))!;
  expect(ids.size).toBeGreaterThan(0);
  expect(undocumented(ids, sentence)).toEqual([]);
  const first = [...ids][0]!;
  expect(undocumented(ids, sentence.replace(`\`${first}\``, ""))).toContain(
    first,
  );
  expect(
    undocumented(new Set([...ids, "undocumented-fixed-id"]), sentence),
  ).toEqual(["undocumented-fixed-id"]);
  const card = ts.createSourceFile(
    "card.ts",
    readFileSync("src/react/block-reply.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const prefixes: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node) && node.head.text.startsWith("card"))
      prefixes.push(node.head.text);
    ts.forEachChild(node, visit);
  };
  visit(card);
  expect(prefixes.sort()).toEqual(["card:", "card~"]);
  for (const prefix of prefixes) expect(sentence).toContain(`\`${prefix}\``);
});

it("the problem id collector uses Problem types for spreads and excludes action ids", () => {
  const file = resolve("src/hooks/problem-id-fixture.ts");
  const helper = resolve("src/react/problem-id-helper.ts");
  const text = `import type { Problem } from ${JSON.stringify(generated)};
    import { fixedId, importedProblem, asProblem as normalize } from ${JSON.stringify(helper)};
    const base: Problem = { code: "refused", id: "base-id" };
    const spread: Problem = { ...base, id: "spread-id" };
    const imported: Problem = { ...base, id: fixedId };
    report(importedProblem());
    normalize(null, "imported-normalizer-id");
    const constant = { code: "refused", id: "constant-id" } as const satisfies Problem;
    const action = { id: "action-id", label: "Action" };
    declare function report(problem: Problem): void;
    report({ code: "refused", id: "report-id" });
    const another = { id: "other-action-id" };
    declare function asProblem(error: unknown, id: string): Problem;
    asProblem(null, "normalizer-id");
    if (base.id === "selector-id") report(spread);
    ["member-id"].includes(base.id);
  `;
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  const fixtures = new Map([
    [file, text],
    [
      helper,
      `import type { Problem } from ${JSON.stringify(generated)};
      export const fixedId = "imported-id";
      export function importedProblem(): Problem {
        return { code: "refused", id: "helper-id" };
      }
      export function asProblem(error: unknown, id: string): Problem {
        return { code: "refused", id };
      }
    `,
    ],
  ]);
  host.readFile = (name) => fixtures.get(name) ?? read(name);
  host.fileExists = (name) => fixtures.has(name) || exists(name);
  const program = ts.createProgram([file, helper, generated], options, host);
  expect(collect(program, [file, helper])).toEqual(
    new Set([
      "base-id",
      "spread-id",
      "imported-id",
      "helper-id",
      "imported-normalizer-id",
      "constant-id",
      "report-id",
      "normalizer-id",
      "selector-id",
      "member-id",
    ]),
  );
});
