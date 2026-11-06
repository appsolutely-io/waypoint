// @vitest-environment jsdom
// A code block or table being scrolled keeps its element when the chat
// renders again for anything else (a draft, a reply state, a chunk that
// loads): replacing it would drop the keyboard focus and the scroll
// position the user is in the middle of.
import { it, expect, afterEach } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
afterEach(cleanup);

it("a focused code block and a table keep their elements across a re-render", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          {
            id: "a",
            role: "assistant",
            content:
              "```\nconst wide = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |",
            blocks: [],
            createdAt: 1,
            status: "completed",
          },
        ],
      }),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await waitFor(() =>
    expect(document.querySelectorAll("[data-scroll-region]")).toHaveLength(2),
  );
  const [code, table] = [
    ...document.querySelectorAll<HTMLElement>("[data-scroll-region]"),
  ];
  code!.focus();
  expect(document.activeElement).toBe(code);
  await act(async () => {
    await client.setDraft("Something else changes");
  });
  const after = [...document.querySelectorAll("[data-scroll-region]")];
  expect(after[0]).toBe(code);
  expect(after[1]).toBe(table);
  expect(document.activeElement).toBe(code);
  client.dispose();
});
