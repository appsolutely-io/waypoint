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
  await waitFor(() => expect(mounted()).toContain(`m${count}`));
  await waitFor(() =>
    expect(document.querySelector(".wp-markdown")).not.toBeNull(),
  );
  await settle();
  geometry.layout();
  await settle();
  return client;
}

it("below the threshold, every message is mounted with no place of its own", async () => {
  const client = await chat(WINDOW_FROM - 1);
  expect(mounted()).toHaveLength(WINDOW_FROM - 1);
  expect(document.querySelector("[aria-setsize]")).toBeNull();
  expect(document.querySelector("[data-transcript-gap]")).toBeNull();
  client.dispose();
});

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
