import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import pkg from "../../package.json";
it("public entry points are explicit and every peer is optional", () => {
  expect(Object.keys(pkg.exports).sort()).toEqual(
    [
      ".",
      "./react",
      "./hooks",
      "./skin-default",
      "./skin-antd",
      "./testing",
      "./schema.json",
      "./styles.css",
    ].sort(),
  );
  expect(pkg.sideEffects).toEqual(["*.css"]);
  for (const name of Object.keys(pkg.peerDependencies))
    expect(
      pkg.peerDependenciesMeta[name as keyof typeof pkg.peerDependenciesMeta]
        .optional,
    ).toBe(true);
  expect(
    Object.keys(pkg.scripts).filter((name) =>
      ["install", "prepare", "postinstall", "preinstall"].includes(name),
    ),
  ).toEqual([]);
});
it("tokens and responsive rules are scoped to an instance container", () => {
  const css = readFileSync("src/react/styles.css", "utf8");
  expect(css).not.toContain(":root");
  // Layout follows the chat's container, never the viewport: no media query
  // reads a size. Pointer and motion preferences are not layout.
  const media = css.match(/@media[^{]*/g) ?? [];
  expect(
    media.filter((query) => /width|height|aspect-ratio/.test(query)),
  ).toEqual([]);
  expect(media.map((query) => query.trim()).sort()).toEqual([
    "@media (forced-colors: active)",
    "@media (pointer: coarse)",
    "@media (prefers-reduced-motion: reduce)",
  ]);
  expect(css).toContain("@container");
  expect(css).toContain("margin-inline-end");
});
