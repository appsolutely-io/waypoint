// @vitest-environment jsdom
// A reply the host ends as failed or unavailable says so in the reply, with
// Retry in the reply row.
import { it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
async function ended(
  status: "failed" | "unavailable",
  versions?: { regenerate: () => Promise<void> },
) {
  let reads = 0;
  const base = config();
  const client = createWaypointClient({
    ...base,
    ...(versions && {
      versions: { ...versions, edit: async () => {}, select: async () => {} },
    }),
    transport: {
      ...base.transport,
      read: async () => {
        reads++;
        return {
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
        };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  const row = document.querySelector('[data-part="replyRow"] [role="status"]')!;
  return { client, row, reads: () => reads };
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
    // Shown in the reply itself; the message region announces it, so the
    // row's live region stays empty.
    expect(
      document.querySelector('article[data-message-id="a"] [data-reply-ended]')
        ?.textContent,
    ).toBe(text);
    expect(row.textContent).toBe("");
    client.dispose();
  });

for (const status of ["failed", "unavailable"] as const)
  it(`a reply ended as ${status} offers Retry, which reads it again`, async () => {
    const { client, reads } = await ended(status);
    const retry = await screen.findByRole("button", { name: "Retry" });
    const before = reads();
    await userEvent.click(retry);
    await waitFor(() => expect(reads()).toBe(before + 1));
    client.dispose();
  });

it("Retry on a failed reply asks for it again when the host can regenerate", async () => {
  const regenerate = vi.fn(async () => {});
  const { client } = await ended("failed", { regenerate });
  await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
  expect(regenerate).toHaveBeenCalledWith(
    expect.objectContaining({ messageId: "a" }),
  );
  client.dispose();
});

it("names Retry in Simplified Chinese", async () => {
  const { client } = await ended("failed");
  cleanup();
  render(<WaypointChat client={client} locale="zh-CN" />);
  expect(await screen.findByRole("button", { name: "重试" })).toBeTruthy();
  client.dispose();
});
