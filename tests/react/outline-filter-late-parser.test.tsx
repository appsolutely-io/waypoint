// @vitest-environment jsdom
// The outline's search index is rebuilt when the Markdown parser becomes
// ready after the index was made from raw message text: until the new
// texts are made it says "Searching…", never "No messages match".
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { english } from "../../src/react/i18n";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

// The parser's chunk arrives only when the test lets it.
const gate = vi.hoisted(() => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
});
vi.mock("../../src/react/markdown", async (original) => {
  await gate.opened;
  return original();
});

afterEach(() => cleanup());

const status = () =>
  document.querySelector("nav[data-outline] [role=status]")?.textContent ?? "";
const links = () => document.querySelectorAll("[data-outline-link]").length;

it("rebuilds the index when the parser becomes ready", async () => {
  const messages = ["About **apples**", "About pears", "More **apples**"].map(
    (content, index) =>
      ({
        id: `m${index + 1}`,
        role: index % 2 ? "assistant" : "user",
        content,
        blocks: [],
        createdAt: index,
        status: "completed",
      }) as Message,
  );
  const base = config();
  const client = createWaypointClient({
    ...base,
    conversationId: "a",
    transport: {
      ...base.transport,
      read: async (id) =>
        ({ protocol: "1.0", id, title: id, messages }) as Conversation,
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await act(async () => {
    screen.getByRole("button", { name: english["chat.outline"] }).click();
  });
  await waitFor(() => expect(links()).toBe(3));
  fireEvent.change(
    screen.getByRole("searchbox", { name: english["chat.outlineFilter"] }),
    { target: { value: "apples" } },
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  // Made from the raw text while the parser is not there yet.
  await waitFor(() => expect(status()).toBe("2 messages match"));
  const seen: string[] = [];
  const observer = new MutationObserver(() => seen.push(status()));
  observer.observe(document.querySelector("nav[data-outline]")!, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  await act(async () => {
    gate.open();
  });
  await waitFor(() =>
    expect(document.querySelectorAll(".wp-markdown")).toHaveLength(3),
  );
  await waitFor(() => expect(status()).toBe("2 messages match"));
  observer.disconnect();
  expect(links()).toBe(2);
  expect(seen).not.toContain("No messages match");
  client.dispose();
});
