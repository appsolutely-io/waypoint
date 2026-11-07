// @vitest-environment jsdom
// The outline lists every message, mounted or not, so it is where a long
// conversation is searched: its filter matches the whole visible text of
// each message, not only the excerpt the outline shows, and keeps each
// message's own position in its label.
import { afterEach, expect, it } from "vitest";
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
import { EXCERPT_GRAPHEMES } from "../../src/react/excerpt";
import { WINDOW_FROM } from "../../src/react/windowing";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

afterEach(cleanup);

const long = `${"word ".repeat(EXCERPT_GRAPHEMES)}needle at the end`;
const messages = Array.from(
  { length: 12 },
  (_, index) =>
    ({
      id: `m${index + 1}`,
      role: index % 2 ? "assistant" : "user",
      content: index === 4 ? long : `Message about **apples** ${index + 1}`,
      blocks: [],
      createdAt: index,
      status: "completed",
    }) as Message,
);

async function chat() {
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
  await waitFor(() =>
    expect(document.querySelectorAll(".wp-markdown")).toHaveLength(12),
  );
  await act(async () => {
    screen.getByRole("button", { name: english["chat.outline"] }).click();
  });
  await waitFor(() =>
    expect(document.querySelectorAll("[data-outline-link]")).toHaveLength(12),
  );
  return client;
}
const links = () =>
  [...document.querySelectorAll("[data-outline-link]")].map((link) =>
    link.getAttribute("data-outline-link"),
  );
const filter = () =>
  screen.getByRole("searchbox", { name: english["chat.outlineFilter"] });
const status = () =>
  document.querySelector("nav[data-outline] [role=status]")?.textContent ?? "";

it("the transcript windows only from about 500 messages", () => {
  expect(WINDOW_FROM).toBe(500);
});

it("filters the outline by each message's whole visible text", async () => {
  const client = await chat();
  fireEvent.change(filter(), { target: { value: "NEEDLE" } });
  expect(links()).toEqual(["m5"]);
  // The label keeps the message's place among all of them.
  expect(
    document.querySelector('[data-outline-link="m5"]')!.textContent,
  ).toContain("message 5");
  expect(status()).toBe("1 message matches");
  fireEvent.change(filter(), { target: { value: "apples 1" } });
  expect(links()).toEqual(["m1", "m10", "m11", "m12"]);
  expect(status()).toBe("4 messages match");
  // Markup is not text: the asterisks around "apples" are not shown.
  fireEvent.change(filter(), { target: { value: "**" } });
  expect(links()).toEqual([]);
  expect(status()).toBe("No messages match");
  fireEvent.change(filter(), { target: { value: "" } });
  expect(links()).toHaveLength(12);
  expect(status()).toBe("");
  client.dispose();
});

it("a filtered result still reaches its message", async () => {
  const client = await chat();
  fireEvent.change(filter(), { target: { value: "needle" } });
  const link = document.querySelector<HTMLElement>('[data-outline-link="m5"]')!;
  link.focus();
  await act(async () => {
    link.click();
  });
  expect(document.activeElement?.getAttribute("data-message-id")).toBe("m5");
  client.dispose();
});
