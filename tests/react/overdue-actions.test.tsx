// @vitest-environment jsdom
// An overdue reply offers to keep waiting or to retry.
import { it, expect, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
afterEach(cleanup);

async function overdue(locale?: string) {
  let reads = 0;
  const base = config();
  const client = createWaypointClient({
    ...base,
    // Asked long ago: the reply is overdue as soon as it is read.
    platform: {
      ...base.platform,
      clock: { ...base.platform.clock, now: () => 100_000 },
    },
    transport: {
      ...base.transport,
      read: async () => {
        reads++;
        return {
          protocol: "1.0",
          id: "conversation-a",
          title: "Chat",
          messages: [
            { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
          ],
        };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} locale={locale} />);
  const row = document.querySelector('[data-part="replyRow"] [role="status"]')!;
  await waitFor(() =>
    expect(row.getAttribute("data-reply-state")).toBe("overdue"),
  );
  return { client, row, reads: () => reads };
}

it("Keep waiting puts the row back to writing", async () => {
  const { client, row } = await overdue();
  await userEvent.click(
    await screen.findByRole("button", { name: "Keep waiting" }),
  );
  await waitFor(() =>
    expect(row.getAttribute("data-reply-state")).toBe("writing"),
  );
  expect(screen.queryByRole("button", { name: "Keep waiting" })).toBeNull();
  // Focus is not lost with the button.
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Message" }),
  );
  client.dispose();
});

it("Retry reads the conversation again", async () => {
  const { client, row, reads } = await overdue();
  const before = reads();
  await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(reads()).toBe(before + 1));
  await waitFor(() =>
    expect(row.getAttribute("data-reply-state")).toBe("writing"),
  );
  client.dispose();
});

it("names both actions in Simplified Chinese", async () => {
  const { client } = await overdue("zh-CN");
  expect(await screen.findByRole("button", { name: "继续等待" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  client.dispose();
});
