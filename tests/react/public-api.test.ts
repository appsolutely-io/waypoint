import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as react from "../../src/react/index";
it("keeps context and part internals out of the public React entry", () => {
  expect(react).not.toHaveProperty("context");
  expect(react).not.toHaveProperty("Part");
  const report = readFileSync("etc/react.api.md", "utf8");
  expect(report).not.toMatch(
    /export (?:interface ContextValue|function (?:context|Part)\()/,
  );
  expect(react).toHaveProperty("WaypointProvider");
  expect(react).toHaveProperty("FormFillPopup");
});
it("keeps the React module's own helpers out of the testing entry's types", () => {
  // The testing entry re-exports the public entries' types; the module the
  // lazy chunks share also exports helpers that are in no public entry.
  const report = readFileSync("etc/testing.api.md", "utf8");
  for (const name of [
    "ActionButton",
    "clientOf",
    "context",
    "LoadFailure",
    "Part",
    "problemAction",
    "useColorScheme",
    "useRefresh",
    "HOST_KEYS",
    "OVERLAY_KEYS",
  ])
    expect(report).not.toMatch(
      new RegExp(`export (?:function|const) ${name}\\b`),
    );
  expect(report).not.toMatch(/export interface ContextValue\b/);
  expect(report).toMatch(/export function WaypointChat\(/);
  expect(report).toMatch(/export function FormFillPopup\(/);
});
