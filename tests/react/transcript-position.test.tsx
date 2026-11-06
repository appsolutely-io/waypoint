// @vitest-environment jsdom
// Where the transcript rests (Table T) and where focus goes when a focused
// message, outline link or Back to latest is removed (F6), in a controlled
// box geometry. The real-browser half is tests/browser/transcript.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { createFormatter, english } from "../../src/react/i18n";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";
import { keptOrigins } from "../../src/react/focus";
import {
  installGeometry,
  installResizeObserver,
  type Geometry,
} from "../support/transcript-geometry";

const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
let geometry: Geometry;
let restoreObserver: () => void;
beforeEach(() => {
  restoreObserver = installResizeObserver();
  geometry = installGeometry();
});
afterEach(() => {
  cleanup();
  geometry.restore();
  restoreObserver();
});

const message = (id: string, content = id): Message =>
  ({
    id,
    role: "assistant",
    content,
    blocks: [],
    createdAt: 1,
    status: "completed",
  }) as Message;
const many = (count: number, prefix = "m") =>
  Array.from({ length: count }, (_, index) => message(`${prefix}${index + 1}`));
/** Scroll events and the effects they cause. */
const settle = (ms = 5) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
async function chat(messages: Message[], skin: object = {}) {
  const base = config();
  const shown: Record<string, Message[]> = { a: messages, b: many(2, "b") };
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
          messages: shown[id] ?? [],
        }) as Conversation,
    },
  });
  await client.ready;
  render(<WaypointChat client={client} {...skin} />);
  await waitFor(() => expect(client.getSnapshot().conversation?.id).toBe("a"));
  await settle();
  return {
    client,
    set: async (next: Message[], id = "a") => {
      shown[id] = next;
      await act(async () => {
        await client.refresh();
      });
      geometry.layout();
      await settle();
    },
    switchTo: async (id: string) => {
      await act(async () => {
        await client.switchConversation(id);
      });
      geometry.layout();
      await settle();
    },
  };
}
const latest = () =>
  screen.queryByRole("button", { name: english["chat.latest"] });
const box = () => geometry.box();
const article = (id: string) =>
  box().querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
/** A user scroll, then its scroll event. */
const user = async (
  kind: Parameters<Geometry["user"]>[0],
  delta: number,
  ms = 5,
) => {
  geometry.user(kind, delta);
  await settle(ms);
};
/** Unpinned, far from the end: 10 rows of 100 in a 300 box, at the top. */
async function unpinnedAtTop(skin: object) {
  const view = await chat(many(10), skin);
  await user("wheel", -1000);
  await settle(200);
  expect(geometry.top()).toBe(0);
  expect(latest()).not.toBeNull();
  return view;
}

describe.each(skins)("transcript position (%s)", (_, skin) => {
  it("CK-T1 at the end and pinned on the first render, after a switch, and from empty to non-empty", async () => {
    const { set, switchTo } = await chat(many(10), skin);
    expect(geometry.end()).toBe(0);
    expect(latest()).toBeNull();
    await user("wheel", -300);
    expect(latest()).not.toBeNull();
    await switchTo("b");
    await set(many(8, "b"), "b");
    expect(geometry.end()).toBe(0);
    expect(latest()).toBeNull();
    await set([], "b");
    await set(many(6, "c"), "b");
    expect(geometry.end()).toBe(0);
    expect(latest()).toBeNull();
  });
  it("CK-T2 pinned: every size change returns to the end, a browser clamp included", async () => {
    const { set } = await chat(many(5), skin);
    expect(geometry.end()).toBe(0);
    // A message arrives.
    await set(many(6));
    expect(geometry.end()).toBe(0);
    // The newest grows.
    geometry.heights.set("m6", 400);
    geometry.layout();
    await settle();
    expect(geometry.end()).toBe(0);
    // A delayed image in an earlier message.
    geometry.heights.set("m1", 250);
    geometry.layout();
    await settle();
    expect(geometry.end()).toBe(0);
    // The box is resized.
    geometry.clientHeight = 200;
    geometry.layout();
    await settle();
    expect(geometry.end()).toBe(0);
    // Shortened and replaced; then a shrink the browser clamps, and a grow.
    await set([message("m1"), message("x1")]);
    expect(geometry.end()).toBe(0);
    geometry.heights.set("m1", 100);
    geometry.layout();
    await settle(20);
    geometry.heights.set("x1", 600);
    geometry.layout();
    await settle();
    expect(geometry.end()).toBe(0);
    expect(latest()).toBeNull();
  });
  it("CK-T2 a browser clamp whose scroll event comes frames after the shrink, with a wheel token live, stays pinned", async () => {
    await chat(many(10), skin);
    // A downward wheel at the end scrolls nothing.
    await user("wheel", 50);
    // The newest shrinks; the clamp's scroll event arrives before any size
    // observer has reported it.
    geometry.heights.set("m10", 10);
    expect(geometry.end()).toBe(0);
    await settle();
    expect(latest()).toBeNull();
    geometry.heights.set("m10", 500);
    geometry.layout();
    await settle();
    expect(geometry.end()).toBe(0);
    expect(latest()).toBeNull();
  });
  it("CK-T2 a scroll with no user input (a host script) changes no pin", async () => {
    await chat(many(10), skin);
    geometry.scrollTo(300);
    await settle();
    expect(latest()).toBeNull();
    geometry.heights.set("m10", 150);
    geometry.layout();
    await settle();
    expect(geometry.end()).toBe(0);
  });
  it("CK-T3 a scrollbar drag that pauses before it moves is still the user's scroll", async () => {
    await chat(many(10), skin);
    expect(latest()).toBeNull();
    // The pointer goes down on the scrollbar and rests there.
    box().dispatchEvent(new Event("pointerdown"));
    await settle(200);
    // Content changes while the pointer is held.
    geometry.heights.set("m10", 150);
    geometry.layout();
    await settle(200);
    expect(geometry.end()).toBe(0);
    // Then the drag moves up, and the pointer is released.
    geometry.scrollTo(geometry.top() - 100);
    await settle();
    document.dispatchEvent(new Event("pointerup"));
    await settle();
    expect(latest()).not.toBeNull();
  });
  it.each(["wheel", "key", "drag"] as const)(
    "CK-T3 an upward %s scroll inside 24 px unpins",
    async (kind) => {
      await chat(many(10), skin);
      expect(latest()).toBeNull();
      await user(kind, -10);
      expect(latest()).not.toBeNull();
    },
  );
  it.each([
    [23, true],
    [24, true],
    [25, false],
  ])(
    "CK-T4 a downward user scroll ending %s px from the end pins: %s",
    async (distance, pins) => {
      await unpinnedAtTop(skin);
      await user("wheel", 700 - distance);
      expect(geometry.end()).toBe(distance);
      expect(latest() === null).toBe(pins);
    },
  );
  it("CK-T4 momentum reaching the end more than 150 ms after the last touchmove pins", async () => {
    await unpinnedAtTop(skin);
    geometry.user("touch", 300);
    await settle(100);
    geometry.scrollTo(500);
    await settle(100);
    geometry.scrollTo(700);
    await settle();
    expect(geometry.end()).toBe(0);
    expect(latest()).toBeNull();
  });
  it("CK-T4 a delta reconciled between touchend and the final momentum scroll still pins", async () => {
    await unpinnedAtTop(skin);
    geometry.user("touch", 300);
    await settle(50);
    geometry.scrollTo(500);
    await settle(50);
    // The newest grows between frames of the momentum.
    geometry.heights.set("m10", 200);
    geometry.layout();
    await settle(50);
    geometry.scrollTo(800);
    await settle();
    expect(geometry.end()).toBe(0);
    expect(latest()).toBeNull();
  });
  it("CK-T5 unpinned: the anchor keeps its offset when content above it grows", async () => {
    await unpinnedAtTop(skin);
    await user("wheel", 250);
    await settle(200);
    // m3 is the first message whose bottom is below the box top, 50 px up.
    const offset = () =>
      article("m3").getBoundingClientRect().top -
      box().getBoundingClientRect().top;
    expect(offset()).toBe(-50);
    geometry.heights.set("m1", 400);
    geometry.layout();
    await settle();
    expect(offset()).toBe(-50);
    expect(latest()).not.toBeNull();
  });
  const offsetOf = (id: string) =>
    article(id).getBoundingClientRect().top - box().getBoundingClientRect().top;
  it("CK-T5 a removed anchor hands on to the next remaining message", async () => {
    const { set } = await unpinnedAtTop(skin);
    await user("wheel", 300);
    await settle(200);
    expect(offsetOf("m4")).toBe(0);
    // Removing m1 too shifts everything up unless the anchor is kept.
    await set(many(10).filter((each) => !["m1", "m4"].includes(each.id)));
    expect(offsetOf("m5")).toBe(0);
    expect(latest()).not.toBeNull();
  });
  it("CK-T5 a removed anchor with nothing after it hands on to the previous message", async () => {
    geometry.heights.set("m7", 1000);
    const { set } = await chat(many(20), skin);
    await user("wheel", -10000);
    await settle(200);
    await user("wheel", 1600);
    await settle(200);
    expect(offsetOf("m8")).toBe(0);
    await set(many(7));
    expect(offsetOf("m7")).toBe(0);
    expect(latest()).not.toBeNull();
  });
  it("CK-T5 the chat's own anchoring scroll during a live gesture is not a user scroll", async () => {
    await unpinnedAtTop(skin);
    await user("wheel", 670);
    expect(geometry.end()).toBe(30);
    // Within the wheel gesture: content grows above the anchor while the
    // box grows, so keeping the anchor scrolls down to 10 px from the end.
    geometry.heights.set("m1", 200);
    geometry.clientHeight = 320;
    geometry.layout();
    await settle();
    expect(geometry.end()).toBe(10);
    expect(latest()).not.toBeNull();
  });
  it("CK-T5 a geometry change that leaves the end within 24 px stays unpinned", async () => {
    await unpinnedAtTop(skin);
    await user("wheel", 670);
    await settle(200);
    expect(geometry.end()).toBe(30);
    geometry.clientHeight = 320;
    geometry.layout();
    await settle();
    expect(geometry.end()).toBeLessThanOrEqual(24);
    expect(latest()).not.toBeNull();
  });
  it("CK-T6 a conversation that becomes empty is pinned, with no Back to latest", async () => {
    const { set } = await unpinnedAtTop(skin);
    await set([]);
    expect(latest()).toBeNull();
    await set(many(10));
    expect(geometry.end()).toBe(0);
    expect(latest()).toBeNull();
  });
  it("CK-T7 Back to latest is shown exactly while unpinned", async () => {
    await chat(many(10), skin);
    expect(latest()).toBeNull();
    await user("wheel", -100);
    expect(latest()).not.toBeNull();
    await user("wheel", 100);
    expect(latest()).toBeNull();
  });
  it.each(["pointer", "Enter", "Space"])(
    "CK-T8 Back to latest by %s: at the end, pinned, focus on the transcript box",
    async (how) => {
      await unpinnedAtTop(skin);
      const button = latest()!;
      button.focus();
      // Focus reaches the box while the button is still there.
      let buttonThen: boolean | undefined;
      box().addEventListener("focus", () => (buttonThen = button.isConnected), {
        once: true,
      });
      if (how === "pointer") fireEvent.click(button);
      else {
        // A native button turns Enter and Space into a click.
        fireEvent.keyDown(button, { key: how === "Enter" ? "Enter" : " " });
        fireEvent.click(button);
      }
      await settle();
      expect(geometry.end()).toBe(0);
      expect(latest()).toBeNull();
      expect(document.activeElement).toBe(box());
      expect(buttonThen).toBe(true);
      expect(box().getAttribute("aria-label")).toBe(english["chat.transcript"]);
      expect(geometry.end()).toBe(0);
    },
  );
  const openOutline = () => {
    const toggle = screen.getByRole("button", {
      name: english["chat.outline"],
    });
    if (toggle.getAttribute("aria-expanded") !== "true")
      fireEvent.click(toggle);
  };
  const link = (id: string) =>
    document.querySelector<HTMLAnchorElement>(`[data-outline-link="${id}"]`)!;
  it.each([
    ["downward", 23, true],
    ["downward", 24, true],
    ["downward", 25, false],
    ["upward", 23, true],
    ["upward", 24, true],
    ["upward", 25, false],
  ] as const)(
    "CK-T9 an outline link moving %s and ending %s px from the end pins: %s",
    async (direction, distance, pins) => {
      const rows = many(5);
      // m4's top at the box top leaves m4 and m5 below it: 300 + distance.
      geometry.heights.set("m5", 200 + distance);
      const { set } = await chat(rows, skin);
      await set(rows);
      if (direction === "downward") {
        await user("wheel", -10000);
        await settle(200);
      }
      openOutline();
      // A pointer press on a link focuses it in Chromium and Firefox.
      link("m4").focus();
      fireEvent.click(link("m4"));
      await settle();
      expect(
        article("m4").getBoundingClientRect().top -
          box().getBoundingClientRect().top,
      ).toBe(0);
      expect(geometry.end()).toBe(distance);
      expect(latest() === null).toBe(pins);
      expect(document.activeElement).toBe(article("m4"));
    },
  );
  it("CK-T9 a long newest message shown from its top stays unpinned and does not jump on the next delta", async () => {
    geometry.heights.set("m3", 900);
    await chat(many(3), skin);
    openOutline();
    fireEvent.click(link("m3"));
    await settle();
    expect(latest()).not.toBeNull();
    geometry.heights.set("m3", 1200);
    geometry.layout();
    await settle();
    expect(
      article("m3").getBoundingClientRect().top -
        box().getBoundingClientRect().top,
    ).toBe(0);
    expect(latest()).not.toBeNull();
  });
  it("CK-T9 a target removed before activation does nothing", async () => {
    await chat(many(10), skin);
    openOutline();
    const target = article("m2");
    const parent = target.parentNode!;
    const next = target.nextSibling;
    target.remove();
    await settle();
    link("m2").focus();
    const before = geometry.top();
    try {
      fireEvent.click(link("m2"));
      await settle();
      expect(geometry.top()).toBe(before);
      expect(latest()).toBeNull();
      expect(document.activeElement).toBe(link("m2"));
    } finally {
      parent.insertBefore(target, next);
    }
  });
  it("CK-G-lifetime one-shot moves keep no origins behind them", async () => {
    await chat(many(10), skin);
    openOutline();
    for (let i = 0; i < 20; i++) {
      const id = `m${(i % 9) + 1}`;
      link(id).focus();
      fireEvent.click(link(id));
      await settle();
    }
    const button = latest();
    if (button) {
      button.focus();
      fireEvent.click(button);
      await settle();
    }
    expect(keptOrigins(document)).toBe(0);
  });
  it("CK-T10 every scroll the chat starts is instant", async () => {
    const { set } = await chat(many(10), skin);
    await user("wheel", -500);
    await set(many(11));
    openOutline();
    fireEvent.click(link("m2"));
    await settle();
    fireEvent.click(latest() ?? link("m9"));
    await settle();
    expect(geometry.behaviors.length).toBeGreaterThan(0);
    expect(new Set(geometry.behaviors)).toEqual(new Set(["instant"]));
  });
});

describe.each(skins)(
  "the new-reply count on Back to latest (%s)",
  (_, skin) => {
    const latestButton = () =>
      document.querySelector<HTMLElement>("[data-back-to-latest] button");
    const latestName = () => latestButton()?.textContent;
    it("CK-FU13 counts distinct new replies while unpinned; deltas, status and the user's messages add nothing; repin resets", async () => {
      const { set } = await chat(many(10), skin);
      await user("wheel", -300);
      expect(latestName()).toBe(english["chat.latest"]);
      await set([...many(10), message("n1", "partial")]);
      expect(latestName()).toBe("Back to latest, 1 new reply");
      await set([
        ...many(10),
        { ...message("n1", "partial and more"), status: "writing" } as Message,
      ]);
      await set([...many(10), message("n1", "done")]);
      expect(latestName()).toBe("Back to latest, 1 new reply");
      await set([
        ...many(10),
        message("n1", "done"),
        { ...message("u1", "mine"), role: "user" } as Message,
        message("n2"),
      ]);
      expect(latestName()).toBe("Back to latest, 2 new replies");
      // Said once, by the arrival announcements: the button is no live region.
      expect(
        latestButton()!.closest('[aria-live], [role="status"], [role="alert"]'),
      ).toBeNull();
      fireEvent.click(latestButton()!);
      await settle();
      expect(latestButton()).toBeNull();
      await user("wheel", -300);
      expect(latestName()).toBe(english["chat.latest"]);
    });
    it("CK-FU13 a conversation switch resets the count", async () => {
      const { set, switchTo } = await chat(many(10), skin);
      await user("wheel", -300);
      await set([...many(10), message("n1")]);
      expect(latestName()).toBe("Back to latest, 1 new reply");
      await switchTo("b");
      await set(many(10, "b"), "b");
      await user("wheel", -300);
      expect(latestName()).toBe(english["chat.latest"]);
    });
  },
);

describe.each(skins)("focus after a removal (%s)", (_, skin) => {
  it("CK-F6 a removed focused message hands focus to the next, else the previous, else the box", async () => {
    const { set } = await chat(many(3), skin);
    article("m2").focus();
    await set([message("m1"), message("m3")]);
    expect(document.activeElement).toBe(article("m3"));
    await set([message("m1")]);
    expect(document.activeElement).toBe(article("m1"));
    await set([]);
    expect(document.activeElement).toBe(box());
  });
  it("CK-F6-client a focused message gone because another client is shown hands focus to nothing of that client", async () => {
    const ready = async (messages: Message[]) => {
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
      return client;
    };
    const first = await ready(many(3));
    const next = await ready([message("m1"), message("m3")]);
    const view = render(<WaypointChat client={first} {...skin} />);
    await waitFor(() => expect(article("m2")).not.toBeNull());
    article("m2").focus();
    view.rerender(<WaypointChat client={next} {...skin} />);
    await settle(20);
    expect(document.activeElement).not.toBe(article("m3"));
    expect(document.activeElement).not.toBe(article("m1"));
  });
  it("CK-F6-shadow focus in a shadow tree inside a removed message hands focus to the next", async () => {
    const { set } = await chat(many(3), skin);
    const host = document.createElement("span");
    article("m2").querySelector('[data-part="bubble"]')!.append(host);
    const input = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(input);
    input.focus();
    await set([message("m1"), message("m3")]);
    expect(document.activeElement).toBe(article("m3"));
  });
  it("CK-FU1 the removal handoff looks up the remaining messages once, however long the history", async () => {
    // Forty messages are enough: a lookup per remembered id would make
    // twenty here, far over the bound.
    const { set } = await chat(many(40), skin);
    article("m20").focus();
    const real = Element.prototype.querySelectorAll;
    let lookups = 0;
    const spy = vi
      .spyOn(Element.prototype, "querySelectorAll")
      .mockImplementation(function (this: Element, selector: string) {
        if (selector === "[data-message-id]") lookups++;
        return real.call(this, selector);
      });
    try {
      await set(many(40).filter((each) => each.id !== "m20"));
    } finally {
      spy.mockRestore();
    }
    expect(document.activeElement).toBe(article("m21"));
    expect(lookups).toBeLessThan(5);
  });
  it("CK-F6 a removed focused outline link hands focus to the next link, else the previous", async () => {
    const { set } = await chat(many(3), skin);
    fireEvent.click(
      screen.getByRole("button", { name: english["chat.outline"] }),
    );
    const link = (id: string) =>
      document.querySelector<HTMLElement>(`[data-outline-link="${id}"]`);
    link("m2")!.focus();
    await set([message("m1"), message("m3")]);
    expect(document.activeElement).toBe(link("m3"));
    await set([message("m1")]);
    expect(document.activeElement).toBe(link("m1"));
  });
  it("CK-F6 Back to latest hidden while focused hands focus to the box", async () => {
    await chat(many(10), skin);
    await user("wheel", -200);
    latest()!.focus();
    await user("wheel", 200);
    expect(latest()).toBeNull();
    expect(document.activeElement).toBe(box());
  });
  it.each(["a message", "an outline link", "the composer"])(
    "CK-F3 a host switch with focus on %s moves nothing into the other conversation",
    async (where) => {
      const { switchTo } = await chat(many(3), skin);
      fireEvent.click(
        screen.getByRole("button", { name: english["chat.outline"] }),
      );
      const composer = screen.getByRole("textbox");
      const target =
        where === "a message"
          ? article("m2")
          : where === "an outline link"
            ? document.querySelector<HTMLElement>('[data-outline-link="m2"]')!
            : composer;
      target.focus();
      await switchTo("b");
      expect(
        document.activeElement === document.body ||
          document.activeElement === composer,
      ).toBe(true);
      if (where === "the composer")
        expect(document.activeElement).toBe(composer);
    },
  );
});

describe("CK-FU13 the count's plural forms", () => {
  it("in English and Simplified Chinese", () => {
    const en = createFormatter("en");
    const zh = createFormatter("zh-CN");
    expect(en("chat.latestNew", { count: 1 })).toBe(
      "Back to latest, 1 new reply",
    );
    expect(en("chat.latestNew", { count: 3 })).toBe(
      "Back to latest, 3 new replies",
    );
    expect(zh("chat.latestNew", { count: 3 })).toBe("回到最新消息，3 条新回复");
  });
});
