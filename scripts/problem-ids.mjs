import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";
const generated = resolve("src/protocol/generated.ts");
const omitted = new Set(["conformance", "host", "testing"]);
function sources(directory = resolve("src")) {
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
function collect(program, files) {
  const checker = program.getTypeChecker();
  const definition = program
    .getSourceFile(generated)
    .statements.find(
      (node) => ts.isInterfaceDeclaration(node) && node.name.text === "Problem",
    );
  const problemType = checker.getTypeAtLocation(definition);
  const ids = new Set();
  const problem = (type) =>
    !!type &&
    !(
      type.flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)
    ) &&
    checker.isTypeAssignableTo(checker.getNonNullableType(type), problemType);
  const literal = (node) => {
    const type = checker.getTypeAtLocation(node);
    return type.isStringLiteral() ? type.value : undefined;
  };
  const add = (node) => {
    const id = literal(node);
    if (id !== undefined) ids.add(id);
  };
  const problemId = (node) =>
    ((ts.isPropertyAccessExpression(node) && node.name.text === "id") ||
      (ts.isElementAccessExpression(node) &&
        literal(node.argumentExpression) === "id")) &&
    problem(checker.getTypeAtLocation(node.expression));
  const propertyName = (name) =>
    ts.isIdentifier(name) || ts.isStringLiteral(name)
      ? name.text
      : ts.isComputedPropertyName(name)
        ? literal(name.expression)
        : undefined;
  const hasProblemId = (node) =>
    problemId(node) ||
    !!ts.forEachChild(node, (child) => hasProblemId(child) || undefined);
  const array = (node) => {
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
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = node.properties.filter(
        (property) =>
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
  for (const file of files) visit(program.getSourceFile(file));
  return ids;
}
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
  types: [],
};
function undocumented(ids, sentence) {
  const spans = new Set(
    [...sentence.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
  );
  return [...ids].filter((id) => !spans.has(id)).sort();
}
export { sources, collect, options, undocumented };

export function checkProblemIds(documentation = "docs/reply-protocol.md") {
  const files = sources();
  assert(files.some((file) => file.includes("/react/")));
  assert(files.some((file) => file.includes("/hooks/")));
  const program = ts.createProgram(files, options);
  const ids = collect(program, files);
  const sentence = readFileSync(documentation, "utf8")
    .split("\n")
    .find((line) => line.startsWith("Host problem ids MUST NOT"));
  if (!sentence || !ids.size || undocumented(ids, sentence).length)
    throw new Error("Reserved problem id documentation is incomplete");
  const span = (value) =>
    String.fromCharCode(96) + value + String.fromCharCode(96);
  for (const id of ids)
    assert(undocumented(ids, sentence.replace(span(id), "")).includes(id));
  assert.equal(
    undocumented(new Set([...ids, "undocumented-fixed-id"]), sentence).length,
    1,
  );
  const card = ts.createSourceFile(
    "card.ts",
    readFileSync("src/react/block-reply.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const prefixes = [];
  const visit = (node) => {
    if (ts.isTemplateExpression(node) && node.head.text.startsWith("card"))
      prefixes.push(node.head.text);
    ts.forEachChild(node, visit);
  };
  visit(card);
  assert.deepEqual(prefixes.sort(), ["card:", "card~"]);
  for (const prefix of prefixes) assert(sentence.includes(span(prefix)));
  return { files: files.length, ids: ids.size };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--documentation"))
      throw new Error("Invalid arguments");
    const result = checkProblemIds(args[1]);
    console.log(
      "Problem id inventory: " +
        result.ids +
        " fixed ids in " +
        result.files +
        " source files; documentation and mutations passed",
    );
  } catch {
    console.error(
      "Problem id inventory failed: check the reserved documentation and fixed Problem ids",
    );
    process.exitCode = 1;
  }
}
