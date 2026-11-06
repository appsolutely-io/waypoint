// @vitest-environment jsdom
// Stop is within reach while a reply is written; stopping keeps its text
// and marks it stopped.
import { it, expect, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Message, Reply } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

async function chat(capabilities: string[], locale?: string) {
  const sent: Reply[] = [];
  let status: Message["status"] = "writing";
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      negotiate: async () => ({ protocol: "1.0", capabilities }),
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
          {
            id: "a",
            role: "assistant",
            content: "The first order shipped",
            blocks: [],
            createdAt: 1,
            status,
          },
        ],
      }),
      send: async (reply) => {
        sent.push(reply);
        status = "stopped";
        return { id: reply.clientReplyId };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} locale={locale} />);
  await waitFor(() =>
    expect(document.querySelector('[data-message-id="a"]')).not.toBeNull(),
  );
  return { client, sent };
}

it("offers Stop while a reply is written; Stop keeps the text and marks it stopped", async () => {
  const { client, sent } = await chat(["reply-stop"]);
  const stop = await screen.findByRole("button", { name: "Stop" });
  await userEvent.click(stop);
  const article = document.querySelector('[data-message-id="a"]')!;
  await waitFor(() =>
    expect(article.querySelector("[data-stopped]")?.textContent).toBe(
      "Stopped",
    ),
  );
  await waitFor(() =>
    expect(article.textContent).toContain("The first order shipped"),
  );
  expect(article.hasAttribute("aria-busy")).toBe(false);
  expect(sent.map((reply) => reply.kind)).toEqual(["stop"]);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(),
  );
  client.dispose();
});

it("says Stop and Stopped in Simplified Chinese", async () => {
  const { client } = await chat(["reply-stop"], "zh-CN");
  await userEvent.click(await screen.findByRole("button", { name: "停止" }));
  await waitFor(() =>
    expect(document.querySelector("[data-stopped]")?.textContent).toBe(
      "已停止",
    ),
  );
  client.dispose();
});

it("offers no Stop when the host cannot stop a reply", async () => {
  const { client } = await chat([]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  client.dispose();
});
