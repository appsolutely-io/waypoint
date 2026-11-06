import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
it("documents every extension point, deferred seam and version/size contract", () => {
  const readme = readFileSync("README.md", "utf8");
  expect(readme).toContain("## Extending waypoint");
  for (const text of [
    "createWaypointClient",
    "StoragePort",
    "PlatformPorts",
    "beforeSend",
    "ComposerContribution",
    "FlowSource",
    "AttachmentPort",
    "subscribe",
    "getSnapshot",
    "useConversation",
    "useComposer",
    "usePlan",
    "useFlows",
    "transport",
    "stepUp",
    "slots",
    "parts",
    "primitives",
    "widgets",
    "renderers.markdown",
    "problemText",
    "format",
    "locale",
    "dir",
    "features",
    "shortcuts",
    "layout",
    "colorScheme",
    "theme",
    "wrapper",
    "seam exists, not implemented",
    "command/mention",
    "/element",
    "React Native",
    "0.x minor",
    "@deprecated",
    "development-mode warning",
    "protocol version",
    "package version",
    "initial core",
    "parser chunk",
  ])
    expect(readme, text).toContain(text);
});
it("documents the refusal of relative link references", () => {
  const readme = readFileSync("README.md", "utf8");
  expect(readme).toContain("Relative links (`docs/page`, `?q=1`) are refused");
  expect(readme).toContain("only absolute same-origin paths");
});
it("documents reconfirmation after a page reload", () => {
  const readme = readFileSync("README.md", "utf8");
  expect(readme).toContain(
    "A resume after a page reload always asks for confirmation again",
  );
  expect(readme).toContain("confirmations are never persisted");
});
