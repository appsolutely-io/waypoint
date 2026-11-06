// @vitest-environment jsdom
import { it, expect } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { isSafeUrl } from "../../src/react/urls";
import { WaypointProvider, Widget, PlanDiagram } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
import type { Block, PlanRecord } from "../../src/protocol/generated";
it("shares a strict URL policy across links with explicit host schemes", () => {
  for (const url of [
    "/\\evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "data:text/html,test",
    " /\\evil.example",
    "/a\\b",
  ])
    expect(isSafeUrl(url)).toBe(false);
  for (const url of [
    "https://example.test",
    "http://example.test",
    "mailto:help@example.test",
    "#step",
    "/",
    "/items/a",
  ])
    expect(isSafeUrl(url)).toBe(true);
  expect(isSafeUrl("example:record", ["example"])).toBe(true);
  expect(isSafeUrl("example:record")).toBe(false);
});
it("route widgets and plan view links refuse unsafe destinations", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  try {
    for (const url of [
      "/\\evil.example",
      "//evil.example",
      "javascript:alert(1)",
    ]) {
      const record = structuredClone(samples.PlanRecord) as PlanRecord;
      if (record.plan.kind === "immediate") record.plan.steps[0]!.view = url;
      const block = {
        id: "route-a",
        type: "route-link",
        fallback: "Unavailable",
        body: { route: url },
      } as Block;
      const view = render(
        <WaypointProvider client={client}>
          <Widget block={block} disabled={false} onReply={() => {}} />
          <PlanDiagram record={record} />
        </WaypointProvider>,
      );
      // The plan's steps render from their own chunk: once they are there.
      await waitFor(() =>
        expect(
          view.container.querySelector('[data-part="stepRow"]'),
        ).not.toBeNull(),
      );
      expect(view.container.querySelector("a")).toBeNull();
      cleanup();
    }
  } finally {
    client.dispose();
  }
});
