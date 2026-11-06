// @vitest-environment jsdom
// The narrow conversation list (Table N): below 40rem of container width
// the rail moves behind a toggle into a drawer whose focus is guarded like
// the chat's other drawers; a choice there returns focus to the toggle at
// once and, once the switch's own read loads, to the composer.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { english } from "../../src/react/i18n";
import { keptOrigins } from "../../src/react/focus";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation } from "../../src/protocol/generated";
import { config } from "../support/client";
import {
  installResizeObserver,
  notifyResize,
} from "../support/transcript-geometry";

let restore: () => void;
beforeEach(() => {
  restore = installResizeObserver();
});
afterEach(() => {
  cleanup();
  restore();
  document.body.innerHTML = "";
});
const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
const conversation = (id: string): Conversation =>
  ({ protocol: "1.0", id, title: id, messages: [] }) as Conversation;
let width = 300;
// The chat root measures `width` px; the layout pass is the observer.
const measure = async (next: number) => {
  width = next;
  await act(async () => {
    notifyResize();
  });
};
async function chat(
  skin: object,
  read: (id: string) => Promise<Conversation> = async (id) => conversation(id),
  conversations: {
    id: string;
    title: string;
    parentConversationId?: string;
  }[] = [
    { id: "conversation-a", title: "First" },
    { id: "conversation-b", title: "Second" },
  ],
) {
  const base = config();
  const client = createWaypointClient({
    ...base,
    conversationId: "conversation-a",
    transport: { ...base.transport, read },
  });
  render(
    <WaypointChat client={client} {...skin} conversations={conversations} />,
  );
  await act(async () => {
    await client.ready;
  });
  const root = document.querySelector<HTMLElement>(".waypoint")!;
  Object.defineProperty(root, "getBoundingClientRect", {
    configurable: true,
    value: () => DOMRect.fromRect({ width, height: 600 }),
  });
  return client;
}
const toggle = () =>
  screen.queryByRole("button", { name: english["chat.rail"] });
const pageRail = () =>
  document.querySelector('nav[aria-label="' + english["chat.rail"] + '"]');
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const composer = () => screen.getByRole("textbox", { name: "Message" });

describe.each(skins)("the narrow conversation list (%s)", (_, skin) => {
  it("CK-N1 narrow: a toggle and no rail in the page; wide: the rail and no toggle", async () => {
    const client = await chat(skin);
    await measure(300);
    expect(toggle()).not.toBeNull();
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
    expect(toggle()!.getAttribute("aria-controls")).toBeTruthy();
    expect(pageRail()).toBeNull();
    await measure(1000);
    expect(toggle()).toBeNull();
    expect(pageRail()).not.toBeNull();
    client.dispose();
  });
  it("CK-N3 the toggle opens the drawer with focus inside it", async () => {
    const client = await chat(skin);
    await measure(300);
    toggle()!.focus();
    fireEvent.click(toggle()!);
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    client.dispose();
  });
  it("CK-N4 a choice returns focus to the toggle at once, then the loaded switch moves it to the composer", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const client = await chat(skin, async (id) => {
      if (id === "conversation-b") await held;
      return conversation(id);
    });
    await measure(300);
    toggle()!.focus();
    fireEvent.click(toggle()!);
    await waitFor(() => expect(dialog()).not.toBeNull());
    const second = within(dialog()!).getByRole("button", { name: "Second" });
    second.focus();
    fireEvent.click(second);
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(toggle());
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.activeElement).toBe(composer());
    client.dispose();
  });
  it("CK-N4 a choice whose read fails leaves focus on the toggle", async () => {
    const client = await chat(skin, async (id) => {
      if (id === "conversation-b") throw new Error("offline");
      return conversation(id);
    });
    await measure(300);
    toggle()!.focus();
    fireEvent.click(toggle()!);
    await waitFor(() => expect(dialog()).not.toBeNull());
    const second = within(dialog()!).getByRole("button", { name: "Second" });
    second.focus();
    fireEvent.click(second);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.activeElement).toBe(toggle());
    client.dispose();
  });
  it("CK-N6 a host switch while the drawer is open closes it and moves no focus into the new conversation", async () => {
    const client = await chat(skin);
    await measure(300);
    toggle()!.focus();
    fireEvent.click(toggle()!);
    await waitFor(() => expect(dialog()).not.toBeNull());
    await act(async () => {
      await client.switchConversation("conversation-b");
    });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).not.toBe(composer());
    client.dispose();
  });
  it("CK-N7 the current conversation is marked in the drawer and the page rail", async () => {
    const client = await chat(skin);
    await measure(300);
    fireEvent.click(toggle()!);
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(
      within(dialog()!)
        .getByRole("button", { name: "First" })
        .getAttribute("aria-current"),
    ).toBe("page");
    client.dispose();
  });
  it("CK-N2 crossing to wide with focus in the drawer moves it to the same conversation in the page rail", async () => {
    const client = await chat(skin);
    await measure(300);
    toggle()!.focus();
    fireEvent.click(toggle()!);
    await waitFor(() => expect(dialog()).not.toBeNull());
    within(dialog()!).getByRole("button", { name: "Second" }).focus();
    await measure(1000);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(
      within(pageRail() as HTMLElement).getByRole("button", { name: "Second" }),
    );
    client.dispose();
  });
  it.each([
    ["the dialog itself, where opening put it", () => dialog()!],
    [
      "its Close control",
      () =>
        within(dialog()!).getByRole("button", { name: english["chat.close"] }),
    ],
  ])(
    "CK-N2 crossing to wide with focus on %s moves it to the page rail's navigation",
    async (_, target) => {
      const client = await chat(skin);
      await measure(300);
      toggle()!.focus();
      fireEvent.click(toggle()!);
      await waitFor(() => expect(dialog()).not.toBeNull());
      target().focus();
      expect(document.activeElement).toBe(target());
      await measure(1000);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(pageRail());
      client.dispose();
    },
  );
  it("CK-N4 choices from the drawer keep no focus origin behind", async () => {
    const client = await chat(skin);
    await measure(300);
    const before = keptOrigins(document);
    for (const name of ["Second", "First"]) {
      toggle()!.focus();
      fireEvent.click(toggle()!);
      await waitFor(() => expect(dialog()).not.toBeNull());
      const choice = within(dialog()!).getByRole("button", { name });
      choice.focus();
      fireEvent.click(choice);
      await waitFor(() => expect(dialog()).toBeNull());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    expect(keptOrigins(document)).toBe(before);
    client.dispose();
  });
  it("A11Y the composer shortcut does nothing while the drawer is open", async () => {
    const client = await chat(skin);
    await measure(300);
    toggle()!.focus();
    fireEvent.click(toggle()!);
    await waitFor(() => expect(dialog()).not.toBeNull());
    const inside = document.activeElement as HTMLElement;
    expect(dialog()!.contains(inside)).toBe(true);
    fireEvent.keyDown(inside, { key: "/" });
    expect(document.activeElement).toBe(inside);
    client.dispose();
  });
});

// Controls outside the open drawer, each of which must lie in an inert subtree.
const reachableOutside = () => {
  const own = dialog()!;
  return [
    ...document.body.querySelectorAll<HTMLElement>(
      "button, textarea, input, select, a[href], summary, [tabindex]",
    ),
  ].filter(
    (element) =>
      // The drawer's own ancestors are not outside it.
      !own.contains(element) &&
      !element.contains(own) &&
      !element.closest("[inert]"),
  );
};
describe.each(skins)(
  "the chat's drawer keeps the page behind it out of reach (%s)",
  (_, skin) => {
    it("A11Y while open nothing outside is reachable; on close all of it is, and focus is back on the toggle", async () => {
      const client = await chat(skin);
      await measure(300);
      toggle()!.focus();
      fireEvent.click(toggle()!);
      await waitFor(() => expect(dialog()).not.toBeNull());
      expect(reachableOutside()).toEqual([]);
      expect(dialog()!.closest("[inert]")).toBeNull();
      fireEvent.click(
        within(dialog()!).getByRole("button", { name: english["chat.close"] }),
      );
      await waitFor(() => expect(dialog()).toBeNull());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(document.querySelector("[inert]")).toBeNull();
      expect(document.activeElement).toBe(toggle());
      client.dispose();
    });
    it("A11Y Tab out to the browser's own controls and back leaves the way back to the toggle intact", async () => {
      const client = await chat(skin);
      await measure(300);
      toggle()!.focus();
      fireEvent.click(toggle()!);
      await waitFor(() => expect(dialog()).not.toBeNull());
      const inside = within(dialog()!).getByRole("button", { name: "Second" });
      inside.focus();
      // Past the last control of a modal, focus leaves the page for a moment.
      inside.blur();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      inside.focus();
      fireEvent.click(
        within(dialog()!).getByRole("button", { name: english["chat.close"] }),
      );
      await waitFor(() => expect(dialog()).toBeNull());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(document.activeElement).toBe(toggle());
      client.dispose();
    });
  },
);
