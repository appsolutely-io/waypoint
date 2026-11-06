// Every automatic focus move in runtime source goes through moveFocus; the
// only other uses of an element's focus method are the explicit in-chat key
// actions and the opt-in testing entry's setup, each named here.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  checkFocusUses,
  type FocusAllowance,
  type SourceFile,
} from "../support/focus-scan";

const ROOT = join(__dirname, "..", "..");
const RUNTIME = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\./;
function runtimeFiles(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (RUNTIME.test(name) && !TEST_FILE.test(name))
        files.push({
          path: relative(ROOT, path).split("\\").join("/"),
          text: readFileSync(path, "utf8"),
        });
    }
  };
  walk(join(ROOT, "src"));
  return files;
}
const SENTINELS = [
  "src/index.ts",
  "src/react/ui.tsx",
  "src/react/focus.ts",
  "src/skin-antd/skin.tsx",
  "src/testing/contracts.tsx",
];
const ALLOWED: FocusAllowance[] = [
  {
    site: "src/react/focus.ts|moveFocus|-",
    count: 1,
    reason: "the one guarded move: it decides, then calls focus",
  },
  {
    site: "src/react/ui.tsx|ChatBody|onKeyDown@section",
    count: 1,
    reason:
      "the composer shortcut, a key pressed inside the chat with deep focus resting there",
  },
  {
    site: "src/react/ui.tsx|ChatBody|onKeyDown@div[role=tablist]",
    count: 1,
    reason:
      "arrow, Home and End between the chat's own tabs, deep target and focus in the tablist",
  },
  {
    site: "src/testing/contracts.tsx|defineFormFillContract|-",
    count: 1,
    reason:
      "explicit setup in the opt-in testing entry's contracts, imported by no runtime module",
  },
];

describe("CK-G1 focus in runtime source", () => {
  it("only moveFocus and the named exceptions use an element's focus method", () => {
    expect(checkFocusUses(runtimeFiles(), ALLOWED, SENTINELS)).toEqual([]);
  });
});

// The checker itself must reject each way around it.
describe("CK-G1 fixtures", () => {
  const clean: SourceFile[] = [
    ...SENTINELS.map((path) => ({ path, text: "export const x = 1;\n" })),
  ];
  const allowFocusOnly: FocusAllowance[] = [
    {
      site: "src/react/focus.ts|moveFocus|-",
      count: 1,
      reason: "fixture",
    },
  ];
  const withGuard: SourceFile[] = clean.map((file) =>
    file.path === "src/react/focus.ts"
      ? {
          path: file.path,
          text: "export function moveFocus(el: HTMLElement) { el.focus(); }\n",
        }
      : file,
  );
  const plus = (text: string, path = "src/react/other.ts"): SourceFile[] => [
    ...withGuard,
    { path, text },
  ];
  it("a clean fixture passes", () => {
    expect(checkFocusUses(withGuard, allowFocusOnly, SENTINELS)).toEqual([]);
  });
  it("an empty file set fails", () => {
    expect(checkFocusUses([], allowFocusOnly, SENTINELS)).not.toEqual([]);
  });
  it("a missing sentinel fails", () => {
    expect(
      checkFocusUses(
        withGuard.filter((file) => file.path !== "src/testing/contracts.tsx"),
        allowFocusOnly,
        SENTINELS,
      ),
    ).toContain("missing sentinel src/testing/contracts.tsx");
  });
  it("a comment-only exception does not satisfy its allowance", () => {
    const commented = clean.map((file) =>
      file.path === "src/react/focus.ts"
        ? {
            path: file.path,
            text: "export function moveFocus() {\n  // first.focus();\n  const s = 'el.focus()';\n}\n",
          }
        : file,
    );
    expect(checkFocusUses(commented, allowFocusOnly, SENTINELS)).toContain(
      "src/react/focus.ts|moveFocus|- has 0 focus uses, 1 allowed",
    );
  });
  it("an extra call in an allowed file fails", () => {
    const extra = withGuard.map((file) =>
      file.path === "src/react/focus.ts"
        ? {
            path: file.path,
            text:
              file.text +
              "export function other(el: HTMLElement) { el.focus(); }\n",
          }
        : file,
    );
    expect(checkFocusUses(extra, allowFocusOnly, SENTINELS)).not.toEqual([]);
  });
  it.each([
    [
      "whitespace before the call",
      "export const f = (el: HTMLElement) => el.focus ();",
    ],
    [
      "an optional call",
      "export const f = (el?: HTMLElement) => el?.focus?.();",
    ],
    ["element access", "export const f = (el: HTMLElement) => el['focus']();"],
    [
      "a template key",
      "export const f = (el: HTMLElement) => (el as never)[`focus`];",
    ],
    [
      "the prototype through call",
      "export const f = (el: HTMLElement) => HTMLElement.prototype.focus.call(el);",
    ],
    [
      "an extracted alias",
      "export const f = (el: HTMLElement) => { const focus = el.focus; focus.call(el); };",
    ],
    [
      "destructuring",
      "export const f = (el: HTMLElement) => { const { focus } = el; focus.apply(el); };",
    ],
    [
      "aliased destructuring",
      "export const f = (el: HTMLElement) => { const { focus: move } = el; move.call(el); };",
    ],
    [
      "a double-quoted destructuring key",
      'export const f = (el: HTMLElement) => { const { "focus": move } = el; move.call(el); };',
    ],
    [
      "a single-quoted destructuring key",
      "export const f = (el: HTMLElement) => { const { 'focus': move } = el; move.call(el); };",
    ],
    [
      "a computed string destructuring key",
      'export const f = (el: HTMLElement) => { const { ["focus"]: move } = el; move.call(el); };',
    ],
    [
      "a computed template destructuring key",
      "export const f = (el: HTMLElement) => { const { [`focus`]: move } = el; move.call(el); };",
    ],
    [
      "a parenthesized computed string key",
      'export const f = (el: HTMLElement) => { const { [("focus")]: move } = el; move.call(el); };',
    ],
    [
      "a parenthesized computed template key",
      "export const f = (el: HTMLElement) => { const { [(`focus`)]: move } = el; move.call(el); };",
    ],
    [
      "a parenthesized key in assignment destructuring",
      'export const f = (el: HTMLElement) => { let move; ({ [("focus")]: move } = el); return move; };',
    ],
    [
      "an `as` key",
      'export const f = (el: HTMLElement) => { const { ["focus" as const]: move } = el; move.call(el); };',
    ],
    [
      "a `satisfies` key",
      'export const f = (el: HTMLElement) => { const { ["focus" satisfies string]: move } = el; move.call(el); };',
    ],
    [
      "a non-null key",
      'export const f = (el: HTMLElement) => { const { ["focus"!]: move } = el; move.call(el); };',
    ],
    [
      "a type-assertion key",
      'export const f = (el: HTMLElement) => { const { [<"focus">"focus"]: move } = el; move.call(el); };',
    ],
    [
      "a parenthesized element access key",
      'export const f = (el: HTMLElement) => el[("focus")]();',
    ],
    [
      "an `as` element access key",
      'export const f = (el: HTMLElement) => el["focus" as "focus"]();',
    ],
    [
      "a destructured parameter",
      "export const f = ({ focus }: HTMLElement) => focus;",
    ],
    [
      "assignment destructuring",
      "export const f = (el: HTMLElement) => { let move; ({ focus: move } = el); return move; };",
    ],
    [
      "quoted assignment destructuring",
      'export const f = (el: HTMLElement) => { let move; ({ "focus": move } = el); return move; };',
    ],
  ])("%s is rejected", (_, text) => {
    expect(checkFocusUses(plus(text), allowFocusOnly, SENTINELS)).not.toEqual(
      [],
    );
  });
  it("an object literal with a focus key, or a focus value bound under another key, is not a use", () => {
    expect(
      checkFocusUses(
        plus(
          'export const a = { focus: 1, "focus": 2 };\nexport const { other: focus } = { other: 1 };',
        ),
        allowFocusOnly,
        SENTINELS,
      ),
    ).toEqual([]);
  });
  it("a computed key held in a variable named focus is not a focus key", () => {
    expect(
      checkFocusUses(
        plus(
          'export const f = (el: HTMLElement) => { const focus = "other"; const { [focus]: move } = el as never; return move; };',
        ),
        allowFocusOnly,
        SENTINELS,
      ),
    ).toEqual([]);
  });
  it("a focus key in a type or an unrelated identifier is not a use", () => {
    expect(
      checkFocusUses(
        plus(
          "type F = HTMLElement['focus'];\nexport const focus = { root: 1 };\nexport const r = focus.root;",
        ),
        allowFocusOnly,
        SENTINELS,
      ),
    ).toEqual([]);
  });
});
