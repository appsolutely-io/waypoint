// @vitest-environment jsdom
// A long transcript mounts only the messages in and near view, with
// spacers for the rest, and keeps what the full transcript does: it rests
// pinned at the latest message, Back to latest returns there, the outline
// and a link reach any message, the message holding focus stays mounted,
// and every mounted message says its place among all of them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
// Chunk loading has its own tests; these cases exercise the real renderer's layout.
import "../../src/react/markdown";
import { useTranscriptPosition } from "../../src/react/transcript";
import { act, cleanup, render, screen } from "@testing-library/react";
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

type TestClient = ReturnType<typeof createWaypointClient>;
const clients = new Set<TestClient>();
const idle = new Map<number, IdleRequestCallback>();
let geometry: Geometry;
let restoreObserver: () => void;
beforeEach(() => {
  parses.length = 0;
  vi.useFakeTimers({
    toFake: [
      "performance",
      "setTimeout",
      "clearTimeout",
      ...(typeof requestAnimationFrame === "function"
        ? (["requestAnimationFrame", "cancelAnimationFrame"] as const)
        : []),
    ],
  });
  let nextIdle = 0;
  // Outline navigation does not consume the filter's idle search index.
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idle.set(++nextIdle, callback);
    return nextIdle;
  });
  vi.stubGlobal("cancelIdleCallback", (handle: number) => idle.delete(handle));
  restoreObserver = installResizeObserver();
  geometry = installGeometry({ clientHeight: 300, defaultHeight: 100 });
});
afterEach(() => {
  try {
    cleanup();
    for (const client of clients) client.dispose();
  } finally {
    clients.clear();
    idle.clear();
    vi.clearAllTimers();
    geometry.restore();
    restoreObserver();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    history.replaceState(null, "", location.pathname);
  }
});

it("the controlled layout follows nested rows, spacers and live changes", () => {
  const host = document.createElement("div");
  host.innerHTML = `<div class="wp-transcript"><section><article data-message-id="a"></article><div data-transcript-gap style="block-size:17px"></div></section><article data-message-id="b"><div><article data-message-id="c"></article></div></article></div>`;
  document.body.append(host);
  geometry.clientHeight = 30;
  geometry.heights.set("a", 40);
  geometry.heights.set("b", 60);
  geometry.heights.set("c", 80);
  const first = host.querySelector<HTMLElement>('[data-message-id="a"]')!;
  const second = host.querySelector<HTMLElement>('[data-message-id="b"]')!;
  const nested = host.querySelector<HTMLElement>('[data-message-id="c"]')!;
  const spacer = host.querySelector<HTMLElement>("[data-transcript-gap]")!;
  try {
    expect(second.getBoundingClientRect().top).toBe(57);
    expect(nested.getBoundingClientRect().top).toBe(117);
    expect(geometry.box().scrollHeight).toBe(197);
    geometry.scrollTo(25);
    expect(second.getBoundingClientRect().top).toBe(32);
    first.remove();
    spacer.style.blockSize = "23px";
    geometry.heights.set("b", 70);
    expect(second.getBoundingClientRect().top).toBe(-2);
    expect(nested.getBoundingClientRect().top).toBe(68);
    expect(geometry.box().scrollHeight).toBe(173);
    second.remove();
    expect(geometry.box().scrollTop).toBe(0);
    expect(geometry.box().scrollHeight).toBe(30);
  } finally {
    host.remove();
  }
});

describe("controlled layout membership", () => {
  it("shares height and position reads across an unchanged layout", () => {
    const count = 100;
    render(
      <div className="wp-transcript">
        {Array.from({ length: count }, (_, index) => (
          <article key={index} data-message-id={String(index)} />
        ))}
      </div>,
    );
    const box = geometry.box();
    const reads = vi.spyOn(geometry.heights, "get");
    try {
      for (let pass = 0; pass < 2; pass++)
        [...box.children].forEach((row, index) => {
          expect(Math.abs(row.getBoundingClientRect().top - index * 100)).toBe(
            0,
          );
          expect(row.getBoundingClientRect().height).toBe(100);
        });
      expect(reads.mock.calls.length).toBeLessThanOrEqual(count * 2);
    } finally {
      reads.mockRestore();
    }
  });

  function PinnedLayout() {
    const box = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    useTranscriptPosition(box, content, "layout", 2, null);
    return (
      <div className="wp-transcript" ref={box}>
        <div ref={content}>
          <article data-message-id="a" />
          <div data-transcript-gap="" style={{ blockSize: 17 }} />
          <article data-message-id="b" />
        </div>
      </div>
    );
  }

  it("the product reads changed row and spacer heights before mutation delivery", () => {
    geometry.clientHeight = 30;
    render(<PinnedLayout />);
    const box = geometry.box();
    expect(box.scrollTop).toBe(187);
    geometry.heights.set("a", 40);
    geometry.layout();
    expect(box.scrollTop).toBe(127);
    const spacer = box.querySelector<HTMLElement>("[data-transcript-gap]")!;
    spacer.style.blockSize = "23px";
    geometry.layout();
    expect(box.scrollTop).toBe(133);
    expect(box.scrollHeight).toBe(163);
  });

  it("the product reads a changed viewport against cached row heights", () => {
    geometry.clientHeight = 30;
    render(<PinnedLayout />);
    const box = geometry.box();
    expect(box.scrollTop).toBe(187);
    geometry.clientHeight = 50;
    geometry.layout();
    expect(box.clientHeight).toBe(50);
    expect(box.scrollTop).toBe(167);
    geometry.clientHeight = 300;
    geometry.layout();
    expect(box.scrollTop).toBe(0);
    expect(box.scrollHeight).toBe(300);
  });

  it.each([false, true])(
    "reuses unchanged rows, including empty: %s",
    (populated) => {
      render(<div className="wp-transcript">{populated && <article />}</div>);
      const box = geometry.box();
      const query = vi.spyOn(box, "querySelectorAll");
      const walk = vi.spyOn(document, "createTreeWalker");
      try {
        const first = box.scrollHeight;
        expect(box.scrollHeight).toBe(first);
        expect(query.mock.calls.length + walk.mock.calls.length).toBe(1);
      } finally {
        query.mockRestore();
        walk.mockRestore();
      }
    },
  );

  it("reads synchronous insertion, reordering and selector changes", () => {
    render(
      <div className="wp-transcript">
        <article data-message-id="a" />
        <article data-message-id="b" />
      </div>,
    );
    const box = geometry.box();
    const first = box.children[0] as HTMLElement;
    const second = box.children[1] as HTMLElement;
    expect(second.getBoundingClientRect().top).toBe(100);
    box.prepend(second);
    expect(first.getBoundingClientRect().top).toBe(100);
    first.remove();
    const section = document.createElement("section");
    const spacer = document.createElement("div");
    spacer.style.blockSize = "17px";
    section.append(spacer);
    box.prepend(section);
    expect(second.getBoundingClientRect().top).toBeCloseTo(0);
    spacer.setAttribute("data-transcript-gap", "");
    expect(second.getBoundingClientRect().top).toBe(17);
    spacer.removeAttribute("data-transcript-gap");
    expect(second.getBoundingClientRect().top).toBeCloseTo(0);
    section.setAttribute("title", "irrelevant");
    section.append(document.createTextNode("not a row"));
    expect(second.getBoundingClientRect().top).toBeCloseTo(0);
  });

  it("refreshes after mutation delivery and then reuses the new rows", async () => {
    render(<div className="wp-transcript" />);
    const box = geometry.box();
    geometry.clientHeight = 10;
    const query = vi.spyOn(box, "querySelectorAll");
    const walk = vi.spyOn(document, "createTreeWalker");
    try {
      expect(box.scrollHeight).toBe(10);
      box.append(document.createElement("article"));
      await Promise.resolve();
      expect(box.scrollHeight).toBe(100);
      expect(box.scrollHeight).toBe(100);
      expect(query.mock.calls.length + walk.mock.calls.length).toBe(2);
      box.append(document.createElement("article"));
      expect(box.scrollHeight).toBe(200);
      await Promise.resolve();
      expect(box.scrollHeight).toBe(200);
    } finally {
      query.mockRestore();
      walk.mockRestore();
    }
  });

  it("keeps detached, reinserted and replacement boxes independent", () => {
    const { container } = render(
      <section>
        <div className="wp-transcript">
          <article />
          <article />
        </div>
        <div className="wp-transcript">
          <article />
        </div>
      </section>,
    );
    geometry.clientHeight = 10;
    const host = container.firstElementChild!;
    const first = host.children[0] as HTMLElement;
    const second = host.children[1] as HTMLElement;
    expect(first.scrollHeight).toBe(200);
    expect(second.scrollHeight).toBe(100);
    first.remove();
    first.append(document.createElement("article"));
    expect(first.scrollHeight).toBe(300);
    expect(second.scrollHeight).toBe(100);
    host.prepend(first);
    const replacement = document.createElement("div");
    replacement.className = first.className;
    replacement.append(document.createElement("article"));
    first.replaceWith(replacement);
    expect(replacement.scrollHeight).toBe(100);
    expect(first.scrollHeight).toBe(300);
  });

  it("reads current heights, keys and bounds without DOM membership changes", () => {
    render(
      <div className="wp-transcript">
        <article data-message-id="a" />
        <article data-message-id="b" />
      </div>,
    );
    const box = geometry.box();
    const first = box.children[0] as HTMLElement;
    const second = box.children[1] as HTMLElement;
    geometry.clientHeight = 10;
    expect(box.scrollHeight).toBe(200);
    geometry.heights.set("a", 40);
    expect(second.getBoundingClientRect().top).toBe(40);
    geometry.heights.delete("a");
    expect(second.getBoundingClientRect().top).toBe(100);
    geometry.heights.set("b", 30);
    geometry.heights.clear();
    expect(box.scrollHeight).toBe(200);
    geometry.heights.set("renamed", 20);
    first.setAttribute("data-message-id", "renamed");
    expect(second.getBoundingClientRect().top).toBe(20);
    geometry.scrollTo(100);
    geometry.clientHeight = 115;
    expect(box.scrollTop).toBe(5);
    expect(second.getBoundingClientRect().top).toBe(15);
  });

  it("does not resume observing or overwrite a newer installation after restore", async () => {
    render(
      <div className="wp-transcript">
        <article />
      </div>,
    );
    const box = geometry.box();
    geometry.clientHeight = 10;
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    let replacement: Geometry | undefined;
    try {
      expect(box.scrollHeight).toBe(100);
      box.append(document.createElement("article"));
      geometry.restore();
      await Promise.resolve();
      const calls = observe.mock.calls.length;
      expect(geometry.end()).toBe(190);
      expect(observe.mock.calls.length).toBe(calls);
      replacement = installGeometry({ clientHeight: 25 });
      geometry.restore();
      expect(box.clientHeight).toBe(25);
    } finally {
      replacement?.restore();
      observe.mockRestore();
    }
  });
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
const deliverScrollTask = () =>
  act(() => {
    vi.advanceTimersByTime(0);
  });
const readWindowFrame = () =>
  act(() => {
    vi.advanceTimersToNextFrame();
  });
const measureLayout = () => act(() => geometry.layout());
const mounted = () =>
  [...document.querySelectorAll("article[data-message-id]")].map((row) =>
    row.getAttribute("data-message-id"),
  );

async function renderChat(client: TestClient) {
  clients.add(client);
  await client.ready;
  render(<WaypointChat client={client} />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

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
  await renderChat(client);
  expect(mounted()).toContain(`m${count}`);
  expect(document.querySelector(".wp-markdown")).not.toBeNull();
  deliverScrollTask();
  readWindowFrame();
  measureLayout();
  deliverScrollTask();
  readWindowFrame();
  return client;
}

it("a scroll changes the window only after its task and frame are delivered", async () => {
  const client = await chat(1000);
  const before = mounted();
  geometry.user("wheel", -50_000);
  expect(mounted()).toEqual(before);
  deliverScrollTask();
  expect(mounted()).toEqual(before);
  readWindowFrame();
  expect(mounted()).toContain("m498");
  expect(mounted()).not.toContain("m1000");
  client.dispose();
});

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
  const top = 100 * 1000 - 300 - 50_000;
  deliverScrollTask();
  readWindowFrame();
  expect(mounted()).toContain(`m${Math.floor(top / 100) + 1}`);
  const middle = mounted();
  expect(middle).not.toContain("m1000");
  expect(middle.length).toBeLessThan(40);
  expect(middle).toContain(`m${Math.floor(top / 100) + 1}`);
  act(() => {
    screen.getByText(english["chat.latest"]).click();
  });
  deliverScrollTask();
  readWindowFrame();
  measureLayout();
  deliverScrollTask();
  readWindowFrame();
  expect(mounted().at(-1)).toBe("m1000");
  expect(geometry.end()).toBe(0);
  expect(screen.queryByText(english["chat.latest"])).toBeNull();
  client.dispose();
});

it("the outline reaches a message the window has not mounted, and focuses it", async () => {
  const client = await chat(WINDOW_FROM);
  expect(document.querySelector('[data-message-id="m3"]')).toBeNull();
  expect(document.querySelector("[data-transcript-gap]")).not.toBeNull();
  act(() => {
    screen.getByRole("button", { name: english["chat.outline"] }).click();
  });
  const link = document.querySelector<HTMLElement>('[data-outline-link="m3"]')!;
  // A pointer press on a link focuses it in Chromium and Firefox.
  link.focus();
  act(() => {
    link.click();
  });
  deliverScrollTask();
  readWindowFrame();
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
  act(() => {
    focused.focus();
  });
  deliverScrollTask();
  readWindowFrame();
  expect(document.activeElement).toBe(focused);
  expect(OVERSCAN).toBeGreaterThan(0);
  client.dispose();
});

it("a link to a message's anchor mounts it and shows it", async () => {
  const client = await chat(WINDOW_FROM);
  expect(document.querySelector('[data-message-id="m5"]')).toBeNull();
  expect(document.querySelector("[data-transcript-gap]")).not.toBeNull();
  // The anchor the outline links m5 by.
  act(() => {
    screen.getByRole("button", { name: english["chat.outline"] }).click();
  });
  const href = document
    .querySelector('[data-outline-link="m5"]')!
    .getAttribute("href")!;
  act(() => {
    location.hash = href;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  deliverScrollTask();
  readWindowFrame();
  expect(mounted()).toContain("m5");
  expect(geometry.top()).toBe(400);
  client.dispose();
});

it("a message mounted again keeps its parse", async () => {
  const client = await chat(1000);
  const parsed = () => parses.filter((text) => text === "Message 1000").length;
  expect(parsed()).toBe(1);
  geometry.user("wheel", -60_000);
  deliverScrollTask();
  readWindowFrame();
  expect(mounted()).not.toContain("m1000");
  expect(mounted()).toContain("m398");
  act(() => {
    screen.getByText(english["chat.latest"]).click();
  });
  deliverScrollTask();
  readWindowFrame();
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
  await renderChat(client);
  expect(mounted()).toContain(`m${WINDOW_FROM - 1}`);
  deliverScrollTask();
  readWindowFrame();
  measureLayout();
  deliverScrollTask();
  readWindowFrame();
  expect(document.querySelector("[data-transcript-gap]")).toBeNull();
  // The reader scrolls up to message 60, with 10 px of it above the box.
  const read = () =>
    document.querySelector('[data-message-id="m60"]')?.getBoundingClientRect()
      .top;
  geometry.user("wheel", read()! + 10);
  deliverScrollTask();
  readWindowFrame();
  const before = read();
  expect(before).toBe(-10);
  act(() => {
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
  deliverScrollTask();
  readWindowFrame();
  measureLayout();
  deliverScrollTask();
  readWindowFrame();
  // Windowed now, with the message read where it was.
  expect(document.querySelector("[data-transcript-gap]")).not.toBeNull();
  expect(read()).toBe(before);
  client.dispose();
}, 120_000);

// WAI-ARIA 1.2, "feed" (https://www.w3.org/TR/wai-aria-1.2/#feed), with
// the keys of the Authoring Practices' feed pattern
// (https://www.w3.org/WAI/ARIA/apg/patterns/feed/).
const key = (target: Element, init: KeyboardEventInit) =>
  act(() => {
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
  key(article, { key: "PageUp" });
  deliverScrollTask();
  readWindowFrame();
  const previous = `m${at - 1}`;
  expect(document.activeElement?.getAttribute("data-message-id")).toBe(
    previous,
  );
  key(document.activeElement!, { key: "PageDown" });
  deliverScrollTask();
  readWindowFrame();
  expect(document.activeElement?.getAttribute("data-message-id")).toBe(first);
  client.dispose();
});

it("Control+Home and Control+End leave the feed", async () => {
  const client = await chat(3);
  const article = document.querySelector<HTMLElement>(
    '[data-message-id="m2"]',
  )!;
  article.focus();
  key(article, { key: "Home", ctrlKey: true });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: english["chat.outline"] }),
  );
  article.focus();
  key(article, { key: "End", ctrlKey: true });
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
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const client = createWaypointClient({
    ...base,
    conversationId: "a",
    transport: {
      ...base.transport,
      read: async (id) =>
        ({ protocol: "1.0", id, title: id, messages: many(2) }) as Conversation,
      // A send that never ends keeps its message pending.
      send: () => {
        started();
        return new Promise(() => {});
      },
    },
  });
  await renderChat(client);
  expect(mounted()).toContain("m2");
  await act(async () => {
    await client.setDraft("First");
    void client.send();
    await sending;
  });
  const pending = [
    ...document.querySelectorAll<HTMLElement>('article[data-role="pending"]'),
  ];
  expect(pending).toHaveLength(1);
  const last = document.querySelector<HTMLElement>('[data-message-id="m2"]')!;
  last.focus();
  key(last, { key: "PageDown" });
  expect(document.activeElement).toBe(pending[0]);
  // Nothing follows the last one.
  key(pending[0]!, { key: "PageDown" });
  expect(document.activeElement).toBe(pending[0]);
  key(pending[0]!, { key: "PageUp" });
  deliverScrollTask();
  readWindowFrame();
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
  key(field, { key: "PageDown" });
  expect(document.activeElement).toBe(field);
  field.remove();
  client.dispose();
});
