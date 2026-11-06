// Finds every executable use of an element's `focus` method in source files,
// with the TypeScript parser: member access (called, optionally called,
// extracted, or through call/apply), element access with the key "focus",
// and destructuring of a `focus` binding. Comments and strings are not code.
import ts from "typescript";

export interface SourceFile {
  path: string;
  text: string;
}
/** Where a use sits: its file, enclosing named function, JSX handler and element. */
export interface FocusUse {
  path: string;
  line: number;
  site: string;
}
/** An allowed site, matched exactly, with how many uses it must have. */
export interface FocusAllowance {
  site: string;
  count: number;
  reason: string;
}

const kindOf = (path: string) =>
  path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : /\.(m|c)?js$/.test(path)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

function functionName(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node)) &&
    node.name
  )
    return node.name.getText();
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  )
    return node.parent.name.text;
  return undefined;
}
function jsxElementOf(attribute: ts.JsxAttribute): string {
  const opening = attribute.parent.parent;
  const tag = opening.tagName.getText();
  const role = opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === "role",
  );
  const value =
    role?.initializer && ts.isStringLiteral(role.initializer)
      ? `[role=${role.initializer.text}]`
      : "";
  return `${tag}${value}`;
}
function siteOf(path: string, node: ts.Node): string {
  let fn: string | undefined;
  let handler: string | undefined;
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (!handler && ts.isJsxAttribute(at))
      handler = `${at.name.getText()}@${jsxElementOf(at)}`;
    if (!fn) fn = functionName(at);
  }
  return [path, fn ?? "<module>", handler ?? "-"].join("|");
}
// The literal name of a property or binding key: an identifier, a quoted
// string, a template without substitutions, or a computed key that is one
// of those.
function keyName(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined;
  // A computed key is its expression's literal value, not a variable name.
  if (ts.isComputedPropertyName(name)) return literal(name.expression);
  return ts.isIdentifier(name) ? name.text : literal(name);
}
// A string or template literal, seen through parentheses, `as`,
// `satisfies`, non-null and type assertions.
function literal(node: ts.Node): string | undefined {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    node = node.expression;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}
// Whether an object literal is the target of a destructuring assignment
// (`({ focus } = el)`), directly or nested in another target.
function assignmentTarget(node: ts.Node): boolean {
  let at: ts.Node = node;
  for (;;) {
    const parent = at.parent;
    if (!parent) return false;
    if (
      ts.isBinaryExpression(parent) &&
      parent.left === at &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      return true;
    if (ts.isForOfStatement(parent) || ts.isForInStatement(parent))
      return parent.initializer === at;
    if (ts.isParenthesizedExpression(parent)) {
      at = parent;
      continue;
    }
    if (
      (ts.isPropertyAssignment(parent) && parent.initializer === at) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isSpreadAssignment(parent)
    ) {
      at = ts.isPropertyAssignment(parent) ? parent.parent : parent;
      continue;
    }
    return false;
  }
}
const inType = (node: ts.Node) => {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent)
    if (ts.isTypeNode(at)) return true;
  return false;
};

export function findFocusUses(files: readonly SourceFile[]): FocusUse[] {
  const uses: FocusUse[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      kindOf(file.path),
    );
    const visit = (node: ts.Node) => {
      const isUse =
        (ts.isPropertyAccessExpression(node) &&
          node.name.text === "focus" &&
          !inType(node)) ||
        (ts.isElementAccessExpression(node) &&
          literal(node.argumentExpression) === "focus") ||
        (ts.isBindingElement(node) &&
          ts.isObjectBindingPattern(node.parent) &&
          keyName(node.propertyName ?? node.name) === "focus") ||
        ((ts.isPropertyAssignment(node) ||
          ts.isShorthandPropertyAssignment(node)) &&
          keyName(node.name) === "focus" &&
          assignmentTarget(node.parent));
      if (isUse)
        uses.push({
          path: file.path,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          site: siteOf(file.path, node),
        });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return uses;
}

/** Every reason the file set breaks the rule; empty when it holds. */
export function checkFocusUses(
  files: readonly SourceFile[],
  allowances: readonly FocusAllowance[],
  sentinels: readonly string[],
): string[] {
  const failures: string[] = [];
  if (!files.length) failures.push("no runtime files were found");
  const paths = new Set(files.map((file) => file.path));
  for (const sentinel of sentinels)
    if (!paths.has(sentinel)) failures.push(`missing sentinel ${sentinel}`);
  const counts = new Map<string, FocusUse[]>();
  for (const use of findFocusUses(files))
    counts.set(use.site, [...(counts.get(use.site) ?? []), use]);
  for (const [site, uses] of counts)
    if (!allowances.some((allowance) => allowance.site === site))
      for (const use of uses)
        failures.push(`unguarded focus at ${use.path}:${use.line} (${site})`);
  for (const allowance of allowances) {
    const found = counts.get(allowance.site)?.length ?? 0;
    if (found !== allowance.count)
      failures.push(
        `${allowance.site} has ${found} focus uses, ${allowance.count} allowed`,
      );
  }
  return failures;
}
