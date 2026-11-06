// @vitest-environment jsdom
// Supporting detail sits behind a disclosure under the answer.
import { it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointProvider, Widget } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Block } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

it("a details block is closed until opened, and shows its blocks inside", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const block = {
    type: "details",
    id: "how",
    fallback: "How this was worked out",
    body: {
      summary: "How this was worked out",
      blocks: [
        {
          type: "list",
          id: "how-list",
          fallback: "Read the orders",
          body: { items: ["Read the orders", "Compared the totals"] },
        },
      ],
    },
  } as Block;
  render(
    <WaypointProvider client={client}>
      <Widget block={block} disabled={false} onReply={() => {}} />
    </WaypointProvider>,
  );
  const summary = screen.getByText("How this was worked out");
  expect(summary.tagName).toBe("SUMMARY");
  const disclosure = summary.closest("details")!;
  expect(disclosure.open).toBe(false);
  expect(disclosure.querySelector("li")?.textContent).toBe("Read the orders");
  await userEvent.click(summary);
  expect(disclosure.open).toBe(true);
  expect(document.querySelector("[data-fallback]")).toBeNull();
  client.dispose();
});
