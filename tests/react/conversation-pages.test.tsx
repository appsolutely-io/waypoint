// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createWaypointClient,
  type ConversationPageInput,
} from "../../src/core/client";
import { WaypointChat } from "../../src/react/index";
import type {
  ConversationPage,
  Message,
  OutlineMessage,
} from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);
const messages: Message[] = [
  {
    id: "old",
    role: "user",
    content: "Earlier shipping question",
    blocks: [],
    createdAt: 1,
  },
  {
    id: "middle",
    role: "assistant",
    content: "Earlier shipping answer",
    blocks: [],
    createdAt: 2,
  },
  {
    id: "latest",
    role: "assistant",
    content: "Latest reply",
    blocks: [],
    createdAt: 3,
  },
];
const outline: OutlineMessage[] = messages.map((message) => ({
  id: message.id,
  role: message.role,
  text: message.content,
  revision: "1",
}));
async function show() {
  const cfg = config();
  const readPage = vi.fn(
    async (
      _id: string,
      input: ConversationPageInput,
    ): Promise<ConversationPage> => ({
      conversation: {
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: input.cursor ? messages.slice(0, 2) : messages.slice(2),
      },
      snapshotId: "snapshot",
      outline,
      olderCursor: input.cursor ? null : "older",
      heldClientMessageIds: [],
    }),
  );
  cfg.transport.readPage = readPage;
  const client = createWaypointClient(cfg);
  await client.ready;
  const rendered = render(<WaypointChat client={client} />);
  await screen.findByText("Latest reply");
  return { client, readPage, ...rendered };
}
it("an unloaded outline target loads before navigation and receives focus", async () => {
  const { client, readPage, container } = await show();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Message outline" }));
    const target = await screen.findByRole("link", {
      name: /message 1: Earlier shipping question/,
    });
    expect(container.querySelector('[data-message-id="old"]')).toBeNull();
    target.focus();
    fireEvent.click(target);
    await waitFor(() =>
      expect(container.querySelector('[data-message-id="old"]')).not.toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-message-id")).toBe(
        "old",
      ),
    );
    expect(readPage).toHaveBeenCalledTimes(2);
  } finally {
    client.dispose();
  }
});
it("paged feed positions use the complete outline", async () => {
  const { client, container } = await show();
  try {
    const row = container.querySelector('[data-message-id="latest"]');
    expect(row?.getAttribute("aria-posinset")).toBe("3");
    expect(row?.getAttribute("aria-setsize")).toBe("3");
  } finally {
    client.dispose();
  }
});
it("scrolling older requests one page and keeps an explicit loading control", async () => {
  const { client, readPage } = await show();
  try {
    const control = screen.getByRole("button", { name: "Load older messages" });
    expect(control).not.toBeNull();
    await act(async () => {
      fireEvent.scroll(screen.getByRole("region", { name: "Messages" }));
    });
    expect(readPage).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Earlier shipping question")).not.toBeNull();
  } finally {
    client.dispose();
  }
});
it("the outline can filter unloaded host text without loading message bodies", async () => {
  const { client, readPage } = await show();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Message outline" }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Filter messages" }),
      { target: { value: "shipping" } },
    );
    await screen.findByRole("link", {
      name: /message 1: Earlier shipping question/,
    });
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /message 3/ })).toBeNull(),
    );
    expect(readPage).toHaveBeenCalledOnce();
  } finally {
    client.dispose();
  }
});

it("Page Up loads the preceding unloaded outline message", async () => {
  const { client, container, readPage } = await show();
  try {
    const latest = container.querySelector<HTMLElement>(
      '[data-message-id="latest"]',
    )!;
    latest.focus();
    fireEvent.keyDown(latest, { key: "PageUp" });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-message-id")).toBe(
        "middle",
      ),
    );
    expect(readPage).toHaveBeenCalledTimes(2);
  } finally {
    client.dispose();
  }
});
