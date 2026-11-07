// @vitest-environment jsdom
// A long transcript mounts only the messages in and near view, with
// spacers for the rest, and keeps what the full transcript does: it rests
// pinned at the latest message, Back to latest returns there, the outline
// and a link reach any message, the message holding focus stays mounted,
// and every mounted message says its place among all of them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { english } from "../../src/react/i18n";
import { createWaypointClient } from "../../src/core/client";
import type { TransportEvent } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import {
  OVERSCAN,
  WINDOW_FROM,
  segmentsOf,
  windowRange,
} from "../../src/react/windowing";
import { config } from "../support/client";
import {
  installGeometry,
  installResizeObserver,
  type Geometry,
} from "../support/transcript-geometry";

const parses = vi.hoisted(() => [] as string[]);
vi.mock("react-markdown", async (original) => {
  const actual = await original<typeof import("react-markdown")>();
  const counted = (options: { children?: string }) => {
    parses.push(options.children ?? "");
    return actual.default(options);
  };
  return { ...actual, default: counted, Markdown: counted };
});

describe("the window's rows", () => {
  const sizes = Array.from({ length: 100 }, () => 100);
  it("pinned, counts back from the last row past the box and its overscan", () => {
    expect(windowRange(sizes, { top: 0, height: 300 }, true, 500)).toEqual([
      92, 99,
    ]);
  });
  it("otherwise, takes the rows within the overscan of the box", () => {
    expect(windowRange(sizes, { top: 5000, height: 300 }, false, 500)).toEqual([
      45, 57,
    ]);
  });
  it("puts one spacer for each run of rows not mounted, kept rows in place", () => {
    expect(segmentsOf([10, 20, 30, 40, 50], [3, 4], [1])).toEqual([
      { kind: "gap", from: 0, to: 0, height: 10 },
      { kind: "rows", from: 1, to: 1 },
      { kind: "gap", from: 2, to: 2, height: 30 },
      { kind: "rows", from: 3, to: 4 },
    ]);
  });
});

let geometry: Geometry;
let restoreObserver: () => void;
beforeEach(() => {
  parses.length = 0;
  restoreObserver = installResizeObserver();
  geometry = installGeometry({ clientHeight: 300, defaultHeight: 100 });
});
afterEach(() => {
  cleanup();
  geometry.restore();
  restoreObserver();
  history.replaceState(null, "", location.pathname);
});

const many = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      ({
        id: `m${index + 1}`,
        role: index % 2 ? "assistant" : "user",
        content: `Message ${index + 1}`,
        blocks: [],
        createdAt: index,
        status: "completed",
      }) as Message,
  );
const settle = (ms = 30) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
const mounted = () =>
  [...document.querySelectorAll("article[data-message-id]")].map((row) =>
    row.getAttribute("data-message-id"),
  );

async function chat(count: number) {
  const base = config();
  const client = createWaypointClient({
    ...base,
    conversationId: "a",
    transport: {
      ...base.transport,
      read: async (id) =>
        ({
          protocol: "1.0",
          id,
          title: id,
          messages: many(count),
        }) as Conversation,
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  // Below the threshold every message renders at once, which takes a while.
  await waitFor(() => expect(mounted()).toContain(`m${count}`), {
    timeout: 60_000,
  });
  await waitFor(
    () => expect(document.querySelector(".wp-markdown")).not.toBeNull(),
    { timeout: 60_000 },
  );
  await settle();
  geometry.layout();
  await settle();
  return client;
}

it("below the threshold, every message is mounted, with no spacer", async () => {
  const client = await chat(WINDOW_FROM - 1);
  expect(mounted()).toHaveLength(WINDOW_FROM - 1);
  expect(document.querySelector("[data-transcript-gap]")).toBeNull();
  client.dispose();
}, 120_000);

it("a long transcript mounts the latest messages, pinned at the end, and spaces the rest", async () => {
  const client = await chat(1000);
  const shown = mounted();
  expect(shown.length).toBeLessThan(40);
  expect(shown.at(-1)).toBe("m1000");
  expect(shown).not.toContain("m1");
  // The spacer stands for the rest at their measured heights.
  expect(geometry.box().scrollHeight).toBe(100 * 1000);
  expect(geometry.end()).toBe(0);
  const last = document.querySelector('[data-message-id="m1000"]')!;
  expect(last.getAttribute("aria-posinset")).toBe("1000");
  expect(last.getAttribute("aria-setsize")).toBe("1000");
  expect(screen.queryByText(english["chat.latest"])).toBeNull();
  client.dispose();
});

it("scrolled up, the window follows; Back to latest returns to the end, pinned", async () => {
  const client = await chat(1000);
  geometry.user("wheel", -50_000);
  await settle();
  const middle = mounted();
  expect(middle).not.toContain("m1000");
  expect(middle.length).toBeLessThan(40);
  const top = 100 * 1000 - 300 - 50_000;
  expect(middle).toContain(`m${Math.floor(top / 100) + 1}`);
  await act(async () => {
    screen.getByText(english["chat.latest"]).click();
  });
  await settle();
  geometry.layout();
  await settle();
  expect(mounted().at(-1)).toBe("m1000");
  expect(geometry.end()).toBe(0);
  expect(screen.queryByText(english["chat.latest"])).toBeNull();
  client.dispose();
});

it("the outline reaches a message the window has not mounted, and focuses it", async () => {
  const client = await chat(1000);
  await act(async () => {
    screen.getByRole("button", { name: english["chat.outline"] }).click();
  });
  const link = document.querySelector<HTMLElement>('[data-outline-link="m3"]')!;
  // A pointer press on a link focuses it in Chromium and Firefox.
  link.focus();
  await act(async () => {
    link.click();
  });
  await settle();
  const target = document.querySelector('[data-message-id="m3"]');
  expect(target).not.toBeNull();
  expect(document.activeElement).toBe(target);
  expect(geometry.top()).toBe(200);
  client.dispose();
});

it("the message holding focus stays mounted while the box scrolls away", async () => {
  const client = await chat(1000);
  const focused = document.querySelector<HTMLElement>(
    '[data-message-id="m999"]',
  )!;
  await act(async () => {
    focused.focus();
  });
  await settle();
  expect(document.activeElement).toBe(focused);
  expect(OVERSCAN).toBeGreaterThan(0);
  client.dispose();
});

it("a link to a message's anchor mounts it and shows it", async () => {
  const client = await chat(1000);
  // The anchor the outline links m5 by.
  await act(async () => {
    screen.getByRole("button", { name: english["chat.outline"] }).click();
  });
  const href = document
    .querySelector('[data-outline-link="m5"]')!
    .getAttribute("href")!;
  await act(async () => {
    location.hash = href;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await settle();
  expect(mounted()).toContain("m5");
  expect(geometry.top()).toBe(400);
  client.dispose();
});

it("a message mounted again keeps its parse", async () => {
  const client = await chat(1000);
  const parsed = () => parses.filter((text) => text === "Message 1000").length;
  expect(parsed()).toBe(1);
  geometry.user("wheel", -60_000);
  await settle();
  expect(mounted()).not.toContain("m1000");
  await act(async () => {
    screen.getByText(english["chat.latest"]).click();
  });
  await settle();
  expect(mounted()).toContain("m1000");
  expect(parsed()).toBe(1);
  client.dispose();
});

it("a message that crosses the threshold while scrolled up keeps the message read in place", async () => {
  // Short rows first, then long ones, so the first rows' heights say
  // nothing about where the message read is.
  for (let index = 1; index < WINDOW_FROM; index++)
    geometry.heights.set(`m${index}`, index <= 20 ? 80 : 480);
  const base = config();
  let listener: ((event: TransportEvent) => void) | undefined;
  const client = createWaypointClient({
    ...base,
    conversationId: "a",
    transport: {
      ...base.transport,
      read: async (id) =>
        ({
          protocol: "1.0",
          id,
          title: id,
          messages: many(WINDOW_FROM - 1),
        }) as Conversation,
      subscribe: (_id: string, on: (event: TransportEvent) => void) => {
        listener = on;
        on({ type: "status", status: "open" } as TransportEvent);
        return () => {};
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await waitFor(() => expect(mounted()).toContain(`m${WINDOW_FROM - 1}`), {
    timeout: 60_000,
  });
  await settle();
  geometry.layout();
  await settle();
  expect(document.querySelector("[data-transcript-gap]")).toBeNull();
  // The reader scrolls up to message 60, with 10 px of it above the box.
  const read = () =>
    document.querySelector('[data-message-id="m60"]')?.getBoundingClientRect()
      .top;
  geometry.user("wheel", read()! + 10);
  await settle();
  const before = read();
  expect(before).toBe(-10);
  await act(async () => {
    listener!({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 1,
        type: "message.start",
        messageId: "s1",
        role: "assistant",
      },
    } as TransportEvent);
  });
  await settle();
  geometry.layout();
  await settle();
  // Windowed now, with the message read where it was.
  expect(document.querySelector("[data-transcript-gap]")).not.toBeNull();
  expect(read()).toBe(before);
  client.dispose();
}, 120_000);

// WAI-ARIA 1.2, "feed" (https://www.w3.org/TR/wai-aria-1.2/#feed), with
// the keys of the Authoring Practices' feed pattern
// (https://www.w3.org/WAI/ARIA/apg/patterns/feed/).
const key = (target: Element, init: KeyboardEventInit) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, ...init }),
    );
  });

it("the messages are a feed of focusable articles, each with its place", async () => {
  const client = await chat(3);
  const feed = document.querySelector('[role="feed"]')!;
  const articles = [...feed.querySelectorAll("article[data-message-id]")];
  expect(articles).toHaveLength(3);
  articles.forEach((article, index) => {
    expect(article.getAttribute("tabindex")).toBe("-1");
    expect(article.getAttribute("aria-posinset")).toBe(String(index + 1));
    expect(article.getAttribute("aria-setsize")).toBe("3");
  });
  expect(feed.hasAttribute("aria-busy")).toBe(false);
  client.dispose();
});

it("Page Up moves to the previous message, mounting it first", async () => {
  const client = await chat(1000);
  const first = mounted()[0]!;
  const at = Number(first.slice(1));
  const article = document.querySelector<HTMLElement>(
    `[data-message-id="${first}"]`,
  )!;
  article.focus();
  await key(article, { key: "PageUp" });
  await settle();
  const previous = `m${at - 1}`;
  expect(document.activeElement?.getAttribute("data-message-id")).toBe(
    previous,
  );
  await key(document.activeElement!, { key: "PageDown" });
  await settle();
  expect(document.activeElement?.getAttribute("data-message-id")).toBe(first);
  client.dispose();
});

it("Control+Home and Control+End leave the feed", async () => {
  const client = await chat(3);
  const article = document.querySelector<HTMLElement>(
    '[data-message-id="m2"]',
  )!;
  article.focus();
  await key(article, { key: "Home", ctrlKey: true });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: english["chat.outline"] }),
  );
  article.focus();
  await key(article, { key: "End", ctrlKey: true });
  const feed = document.querySelector('[role="feed"]')!;
  expect(document.activeElement).not.toBe(article);
  expect(feed.contains(document.activeElement)).toBe(false);
  expect(
    feed.compareDocumentPosition(document.activeElement!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  client.dispose();
});

it("Page Down and Page Up reach a message still being sent", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    conversationId: "a",
    transport: {
      ...base.transport,
      read: async (id) =>
        ({ protocol: "1.0", id, title: id, messages: many(2) }) as Conversation,
      // A send that never ends keeps its message pending.
      send: () => new Promise(() => {}),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await waitFor(() => expect(mounted()).toContain("m2"));
  await act(async () => {
    await client.setDraft("First");
    void client.send();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const pending = [
    ...document.querySelectorAll<HTMLElement>('article[data-role="pending"]'),
  ];
  expect(pending).toHaveLength(1);
  const last = document.querySelector<HTMLElement>('[data-message-id="m2"]')!;
  last.focus();
  await key(last, { key: "PageDown" });
  expect(document.activeElement).toBe(pending[0]);
  // Nothing follows the last one.
  await key(pending[0]!, { key: "PageDown" });
  expect(document.activeElement).toBe(pending[0]);
  await key(pending[0]!, { key: "PageUp" });
  await settle();
  expect(document.activeElement).toBe(last);
  client.dispose();
});

it("a field inside a message keeps its own Page Down", async () => {
  const client = await chat(3);
  const article = document.querySelector<HTMLElement>(
    '[data-message-id="m2"]',
  )!;
  const field = document.createElement("textarea");
  article.append(field);
  field.focus();
  await key(field, { key: "PageDown" });
  expect(document.activeElement).toBe(field);
  field.remove();
  client.dispose();
});
