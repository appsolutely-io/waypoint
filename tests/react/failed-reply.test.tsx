// @vitest-environment jsdom
// A reply the host ends as failed or unavailable says so in the reply row.
import { it, expect, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

const user: Message = {
  id: "u",
  role: "user",
  content: "Hi",
  blocks: [],
  createdAt: 0,
};
async function ended(status: "failed" | "unavailable") {
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
          user,
          {
            id: "a",
            role: "assistant",
            content: "I started reading the orders, and then ",
            blocks: [],
            createdAt: 1,
            status,
          },
        ],
      }),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  const row = document.querySelector('[data-part="replyRow"] [role="status"]')!;
  return { client, row };
}

for (const [status, text] of [
  ["failed", "Reply failed"],
  ["unavailable", "Reply unavailable"],
] as const)
  it(`a reply ended as ${status} is not shown as finished`, async () => {
    const { client, row } = await ended(status);
    await waitFor(() =>
      expect(row.getAttribute("data-reply-state")).toBe(status),
    );
    expect(row.textContent).toBe(text);
    client.dispose();
  });
