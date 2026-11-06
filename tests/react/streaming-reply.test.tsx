// @vitest-environment jsdom
// A reply streaming in says so: visibly in its bubble, as busy to assistive
// technology, and once in the polite reply row.
import { it, expect, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { english } from "../../src/react/i18n";
import { createWaypointClient } from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

async function chat(last: Partial<Message>) {
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
          { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
          {
            id: "a",
            role: "assistant",
            content: "Working through the list",
            blocks: [],
            createdAt: 1,
            ...last,
          } as Message,
        ],
      }),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await waitFor(() =>
    expect(document.querySelector('[data-message-id="a"]')).not.toBeNull(),
  );
  return client;
}

it("a reply being written is busy, marked in its bubble and said in the reply row", async () => {
  const client = await chat({ status: "writing" });
  const article = document.querySelector('[data-message-id="a"]')!;
  expect(article.getAttribute("aria-busy")).toBe("true");
  const marker = article.querySelector("[data-writing]")!;
  expect(marker.textContent).toBe(english["reply.writing"]);
  const row = document.querySelector('[data-part="replyRow"] [role="status"]')!;
  await waitFor(() => expect(row.textContent).toBe(english["reply.writing"]));
  client.dispose();
});

it("a finished reply is not busy and carries no marker", async () => {
  const client = await chat({ status: "completed" });
  const article = document.querySelector('[data-message-id="a"]')!;
  expect(article.hasAttribute("aria-busy")).toBe(false);
  expect(article.querySelector("[data-writing]")).toBeNull();
  client.dispose();
});
