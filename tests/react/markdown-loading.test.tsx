// @vitest-environment jsdom
// While the stock Markdown chunk loads, or after it failed, a message never
// shows its source: comments and reference definitions it hides stay
// hidden, and the outline has no excerpt until the safe parser is ready.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { english } from "../../src/react/i18n";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

// The chunk's availability, controlled per test.
const chunk = {
  hold: undefined as Promise<void> | undefined,
  fail: 0,
  broken: false,
};
const MARKDOWN = "../../src/react/markdown";

afterEach(cleanup);
// The chunk loads once per module instance: each test starts without it.
beforeEach(() => {
  vi.resetModules();
  vi.doMock(MARKDOWN, async (importActual) => {
    await chunk.hold;
    if (chunk.fail > 0) {
      chunk.fail--;
      throw new Error("chunk failed to load");
    }
    const actual =
      await importActual<typeof import("../../src/react/markdown")>();
    // Checked at render time, so a test can mend the renderer mid-way.
    const Actual = actual.default;
    return {
      ...actual,
      default: (props: Parameters<typeof Actual>[0]) => {
        if (chunk.broken) throw new Error("renderer failed");
        return <Actual {...props} />;
      },
    };
  });
});
const marked = [
  "<!-- HIDDEN-COMMENT -->",
  "Visible text",
  "",
  "[ref]: https://example.com/HIDDEN-DEFINITION",
].join("\n");
const reply = (content: string, id = "m-1"): Message =>
  ({
    id,
    role: "assistant",
    content,
    blocks: [],
    createdAt: 1,
    status: "completed",
  }) as Message;
async function chat(messages: Message[]) {
  const { WaypointChat } = await import("../../src/react/index");
  const { createWaypointClient } = await import("../../src/core/client");
  const base = config();
  let shown = messages;
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async (id) =>
        ({ protocol: "1.0", id, title: id, messages: shown }) as Conversation,
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  return {
    client,
    set: async (next: Message[]) => {
      shown = next;
      await act(async () => {
        await client.refresh();
      });
    },
  };
}
const toggle = () =>
  screen.getByRole("button", { name: english["chat.outline"] });
const outlineText = () =>
  document.getElementById(toggle().getAttribute("aria-controls")!)
    ?.textContent ?? "";
// What the messages' bodies show, without the sender each bubble names.
const bodies = () =>
  [...document.querySelectorAll("article")]
    .map((article) => {
      const body = article.cloneNode(true) as HTMLElement;
      body
        .querySelectorAll("[data-sender]")
        .forEach((sender) => sender.remove());
      return body.textContent;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
const liveRegions = () =>
  [...document.querySelectorAll('[role="status"], [aria-live]')]
    .map((element) => element.textContent)
    .join(" ");

describe("the stock renderer while its chunk is not there", () => {
  it("CK-M1 CK-E8 while loading: a loading label, never the source; plain outline labels; then the message and excerpts", async () => {
    let release!: () => void;
    chunk.hold = new Promise<void>((resolve) => (release = resolve));
    await chat([reply(marked)]);
    await waitFor(() =>
      expect(screen.getByText(english["chat.messageLoading"])).toBeTruthy(),
    );
    fireEvent.click(toggle());
    expect(document.body.textContent).not.toMatch(/HIDDEN/);
    expect(outlineText()).toBe("Assistant, message 1");
    expect(liveRegions()).not.toMatch(/HIDDEN/);
    await act(async () => {
      release();
      await chunk.hold;
    });
    await waitFor(() => expect(bodies()).toBe("Visible text"));
    await waitFor(() =>
      expect(outlineText()).toBe("Assistant, message 1: Visible text"),
    );
    expect(document.body.textContent).not.toMatch(/HIDDEN/);
    chunk.hold = undefined;
  });
  // One alert for the transcript with one Retry, and nothing of their own
  // in failed bodies: not even an empty bubble.
  const unavailable = () =>
    [...document.querySelectorAll('[role="alert"]')].filter((alert) =>
      alert.textContent?.includes(english["chat.messagesUnavailable"]),
    );
  const retry = () =>
    within(unavailable()[0] as HTMLElement).getByRole("button", {
      name: english["chat.retry"],
    });
  it("CK-FU14 a message whose only content failed shows no empty bubble; it shows again once it renders", async () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/react/styles.css", "utf8");
    document.head.append(style);
    try {
      chunk.fail = 1;
      const { set } = await chat([reply(marked), reply("Also failed", "m-2")]);
      await waitFor(() => expect(unavailable()).toHaveLength(1));
      const bubbles = () => [
        ...document.querySelectorAll<HTMLElement>(
          'article [data-part="bubble"]',
        ),
      ];
      expect(bubbles()).toHaveLength(2);
      for (const bubble of bubbles())
        expect(getComputedStyle(bubble).display).toBe("none");
      await set([
        reply(marked),
        reply("Also failed", "m-2"),
        reply("New", "m-3"),
      ]);
      // Until the chunk has loaded: a load still pending would take the
      // next test's failure.
      await waitFor(() =>
        expect(bodies()).toBe("Visible text Also failed New"),
      );
      expect(unavailable()).toHaveLength(0);
      for (const bubble of bubbles())
        expect(getComputedStyle(bubble).display).not.toBe("none");
    } finally {
      style.remove();
    }
  });
  it("CK-M2 CK-FU14 a failed chunk: one alert with Retry, nothing in the bodies, never the source; a new body tries again", async () => {
    chunk.fail = 1;
    const { set } = await chat([reply(marked), reply("Also failed", "m-2")]);
    await waitFor(() => expect(unavailable()).toHaveLength(1));
    expect(bodies()).toBe("");
    expect(document.body.textContent).not.toMatch(/HIDDEN/);
    await set([
      reply(marked),
      reply("Also failed", "m-2"),
      reply("Second reply", "m-3"),
    ]);
    await waitFor(() =>
      expect(bodies()).toBe("Visible text Also failed Second reply"),
    );
    expect(unavailable()).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/HIDDEN/);
  });
  it("CK-M3 a failed message body whose text changes asks for the chunk again", async () => {
    chunk.fail = 1;
    const { set } = await chat([reply(marked)]);
    await waitFor(() => expect(unavailable()).toHaveLength(1));
    await set([reply(marked + "\n\nMore")]);
    await waitFor(() => expect(bodies()).toBe("Visible text More"));
    expect(unavailable()).toHaveLength(0);
  });
  it("CK-FU14 Retry asks for the chunk again; a repeated failure keeps the alert; the next Retry recovers", async () => {
    chunk.fail = 2;
    await chat([reply(marked), reply("Also failed", "m-2")]);
    await waitFor(() => expect(unavailable()).toHaveLength(1));
    await act(async () => {
      fireEvent.click(retry());
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(unavailable()).toHaveLength(1);
    expect(bodies()).toBe("");
    await act(async () => {
      fireEvent.click(retry());
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await waitFor(() => expect(bodies()).toBe("Visible text Also failed"));
    expect(unavailable()).toHaveLength(0);
    fireEvent.click(toggle());
    expect(outlineText()).not.toMatch(/HIDDEN/);
    expect(liveRegions()).not.toMatch(/HIDDEN/);
  });
  it("CK-FU14 the messages removed while a Retry is held: no alert and no stale body", async () => {
    chunk.fail = 1;
    const { set } = await chat([reply(marked)]);
    await waitFor(() => expect(unavailable()).toHaveLength(1));
    let release!: () => void;
    chunk.hold = new Promise<void>((resolve) => (release = resolve));
    await act(async () => {
      fireEvent.click(retry());
    });
    await set([]);
    await act(async () => {
      release();
      await chunk.hold;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    chunk.hold = undefined;
    expect(unavailable()).toHaveLength(0);
    expect(bodies()).toBe("");
    expect(document.body.textContent).not.toMatch(/HIDDEN/);
  });
  it("CK-M2-render CK-FU14 a renderer that throws: the one alert, nothing in the body, never the source", async () => {
    chunk.broken = true;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await chat([reply(marked)]);
      await waitFor(() => expect(unavailable()).toHaveLength(1));
      expect(bodies()).toBe("");
      expect(document.body.textContent).not.toMatch(/HIDDEN/);
    } finally {
      chunk.broken = false;
      quiet.mockRestore();
    }
  });
  it("CK-FU14 after a renderer threw, Retry renders the bodies again", async () => {
    chunk.broken = true;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await chat([reply(marked), reply("Also failed", "m-2")]);
      await waitFor(() => expect(unavailable()).toHaveLength(1));
      chunk.broken = false;
      await act(async () => {
        fireEvent.click(retry());
      });
      await waitFor(() => expect(bodies()).toBe("Visible text Also failed"));
      expect(unavailable()).toHaveLength(0);
      expect(document.body.textContent).not.toMatch(/HIDDEN/);
    } finally {
      chunk.broken = false;
      quiet.mockRestore();
    }
  });
});
