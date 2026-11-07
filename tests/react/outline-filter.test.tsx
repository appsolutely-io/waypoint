// @vitest-environment jsdom
// The outline lists every message, mounted or not, so it is where a long
// conversation is searched: its filter matches the whole visible text of
// each message, not only the excerpt the outline shows, and keeps each
// message's own position in its label.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createFormatter, english } from "../../src/react/i18n";
import { EXCERPT_GRAPHEMES } from "../../src/react/excerpt";
import { WINDOW_FROM } from "../../src/react/windowing";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";
import { foldForSearch, SearchIndex } from "../../src/react/outline-search";

// Counts how often a message's visible text is projected.
const projected = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/react/markdown", async (original) => {
  const actual = await original<typeof import("../../src/react/markdown")>();
  return {
    ...actual,
    visibleText: (...args: Parameters<typeof actual.visibleText>) => {
      projected.count++;
      return actual.visibleText(...args);
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const long = `${"word ".repeat(EXCERPT_GRAPHEMES)}needle at the end`;
const twelve = Array.from({ length: 12 }, (_, index) =>
  index === 4 ? long : `Message about **apples** ${index + 1}`,
);
const conversation = (contents: readonly string[]) =>
  contents.map(
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

async function chat(
  contents: readonly string[] = twelve,
  beforeOpen?: () => void,
) {
  const messages = conversation(contents);
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
  // A long conversation mounts only a window of its messages.
  const mounted = contents.length > 12 ? 1 : contents.length;
  await waitFor(
    () =>
      expect(
        document.querySelectorAll(".wp-markdown").length,
      ).toBeGreaterThanOrEqual(mounted),
    { timeout: 30_000 },
  );
  beforeOpen?.();
  await act(async () => {
    screen.getByRole("button", { name: english["chat.outline"] }).click();
  });
  await waitFor(
    () =>
      expect(document.querySelectorAll("[data-outline-link]")).toHaveLength(
        contents.length,
      ),
    { timeout: 30_000 },
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

// The filter applies once typing pauses, and says what matched once every
// text is made.
const type = async (value: string) => {
  fireEvent.change(filter(), { target: { value } });
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  await waitFor(() =>
    expect(status()).not.toBe(english["chat.outlineSearching"]),
  );
};

it("filters the outline by each message's whole visible text", async () => {
  const client = await chat();
  await type("NEEDLE");
  expect(links()).toEqual(["m5"]);
  // The label keeps the message's place among all of them.
  expect(
    document.querySelector('[data-outline-link="m5"]')!.textContent,
  ).toContain("message 5");
  expect(status()).toBe("1 message matches");
  await type("apples 1");
  expect(links()).toEqual(["m1", "m10", "m11", "m12"]);
  expect(status()).toBe("4 messages match");
  // Markup is not text: the asterisks around "apples" are not shown.
  await type("**");
  expect(links()).toEqual([]);
  expect(status()).toBe("No messages match");
  await type("");
  expect(links()).toHaveLength(12);
  expect(status()).toBe("");
  client.dispose();
});

it("a filtered result still reaches its message", async () => {
  const client = await chat();
  await type("needle");
  const link = document.querySelector<HTMLElement>('[data-outline-link="m5"]')!;
  link.focus();
  await act(async () => {
    link.click();
  });
  expect(document.activeElement?.getAttribute("data-message-id")).toBe("m5");
  client.dispose();
});

it("the first keystroke at 5,000 messages does a bounded amount of work", async () => {
  const contents = Array.from(
    { length: 5000 },
    (_, index) =>
      `## Message ${index}\n\nSome **markdown** about item ${index}, with [a link](https://example.com/${index}).`,
  );
  const client = await chat(contents);
  projected.count = 0;
  const folds = vi.spyOn(String.prototype, "toLocaleLowerCase");
  fireEvent.change(filter(), { target: { value: "item 4242" } });
  // The keystroke itself projects and folds a bounded number of texts.
  expect(projected.count).toBeLessThanOrEqual(64);
  expect(folds.mock.calls.length).toBeLessThanOrEqual(64);
  folds.mockRestore();
  await waitFor(() => expect(status()).toBe("1 message matches"), {
    timeout: 30_000,
  });
  expect(links()).toEqual(["m4243"]);
  client.dispose();
}, 120_000);

it("says it is searching while the texts are made, with the matches so far", async () => {
  // Idle work runs only when the test lets it.
  const idle: ((deadline: IdleDeadline) => void)[] = [];
  const client = await chat(twelve, () => {
    vi.stubGlobal("requestIdleCallback", (run: (d: IdleDeadline) => void) => {
      idle.push(run);
      return idle.length;
    });
    vi.stubGlobal("cancelIdleCallback", () => {});
  });
  fireEvent.change(filter(), { target: { value: "apples" } });
  await waitFor(() => expect(status()).toBe(english["chat.outlineSearching"]));
  expect(links()).toEqual([]);
  // One idle slice with room for a few texts.
  let budget = 3;
  idle.shift()!({
    didTimeout: false,
    timeRemaining: () => (budget-- > 0 ? 10 : 0),
  });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(status()).toBe(english["chat.outlineSearching"]);
  while (idle.length)
    await act(async () => {
      idle.shift()!({ didTimeout: false, timeRemaining: () => 10 });
    });
  await waitFor(() => expect(status()).toBe("11 messages match"));
  client.dispose();
});

it("matches text whatever its normal form, accents and case", async () => {
  const client = await chat([
    "Caf\u0065\u0301 cr\u00e8me",
    "Die Stra\u00dfe",
    "Plain words",
  ]);
  await type("cafe");
  expect(links()).toEqual(["m1"]);
  await type("CAF\u00c9 CREME");
  expect(links()).toEqual(["m1"]);
  await type("STRASSE");
  expect(links()).toEqual(["m2"]);
  client.dispose();
});

it("folds case in the chat's language", () => {
  expect(foldForSearch("\u0130stanbul", "tr")).toBe(
    foldForSearch("istanbul", "tr"),
  );
  expect(foldForSearch("Stra\u00dfe", "de")).toBe(
    foldForSearch("STRASSE", "de"),
  );
  expect(foldForSearch("Cafe\u0301", "fr")).toBe(
    foldForSearch("caf\u00e9", "fr"),
  );
  // Marks a script needs are kept: a virama is not an accent.
  expect(foldForSearch("\u0915\u094d\u0937", "hi")).not.toBe(
    foldForSearch("\u0915\u0937", "hi"),
  );
  expect(foldForSearch("  a\n\tb  ")).toBe("a b");
});

it("folds width, as a collator's base strength does", () => {
  expect(foldForSearch("\uff21\uff22\uff23 \uff11\uff12", "zh-Hans")).toBe(
    foldForSearch("abc 12", "zh-Hans"),
  );
  // Half-width kana with a voicing mark meet their full-width letter.
  expect(foldForSearch("\uff76\uff9e", "ja")).toBe(
    foldForSearch("\u30ac", "ja"),
  );
  // Han text is kept as it is.
  expect(foldForSearch("\u4f60\u597d", "zh-Hans")).toBe("\u4f60\u597d");
});

it("folds with the root locale when the chat's language tag is not valid", () => {
  expect(foldForSearch("ABC", "zh_CN")).toBe("abc");
});

// The index is rebuilt whenever an input of its texts changes: a message's
// version, the chat's language, or the parser becoming ready. Until it is
// whole again it says "Searching…", never "No messages match".
describe("the search index is rebuilt on every input it depends on", () => {
  const shown = (id: string, content: string) => ({
    id,
    source: content,
    message: content,
  });
  const drain = async () => {
    for (let slice = 0; slice < 20; slice++)
      await new Promise((resolve) => setTimeout(resolve, 0));
  };
  it("a changed policy with the same messages makes the index incomplete", async () => {
    const index = new SearchIndex<string>();
    const messages = [shown("a", "Istanbul"), shown("b", "Strasse")];
    const fold = (lang: string) => (text: string) => foldForSearch(text, lang);
    index.sync("1:a", ["en"], messages, fold("en"));
    index.start();
    await drain();
    expect(index.complete()).toBe(true);
    expect(index.textOf("a", "Istanbul")).toBe("istanbul");
    // Same array, another language: every text is to make again.
    index.sync("1:a", ["tr"], messages, fold("tr"));
    expect(index.complete()).toBe(false);
    index.start();
    await drain();
    expect(index.complete()).toBe(true);
    expect(index.textOf("a", "Istanbul")).toBe("ıstanbul");
    index.stop();
  });
  it("a new owner with the same messages makes the index incomplete", async () => {
    const index = new SearchIndex<string>();
    const messages = [shown("a", "one")];
    index.sync("1:a", [], messages, (text) => text);
    index.start();
    await drain();
    expect(index.complete()).toBe(true);
    index.sync("2:a", [], messages, (text) => text);
    expect(index.complete()).toBe(false);
    index.stop();
  });

  it("the chat's language changing", async () => {
    const messages = conversation(twelve);
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
    const view = render(<WaypointChat client={client} locale="en" />);
    await waitFor(
      () => expect(document.querySelectorAll(".wp-markdown")).toHaveLength(12),
      { timeout: 30_000 },
    );
    await act(async () => {
      screen.getByRole("button", { name: english["chat.outline"] }).click();
    });
    await type("apples");
    expect(status()).toBe("11 messages match");
    const chinese = createFormatter("zh-Hans");
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(status()));
    observer.observe(document.querySelector("nav[data-outline]")!, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    view.rerender(<WaypointChat client={client} locale="zh-Hans" />);
    await waitFor(() =>
      expect(status()).toBe(chinese("chat.outlineMatches", { count: 11 })),
    );
    observer.disconnect();
    expect(links()).toHaveLength(11);
    expect(seen).not.toContain(chinese("chat.outlineMatches", { count: 0 }));
    client.dispose();
  });

  it("a host's excerpt function made anew on each render", async () => {
    const messages = conversation(twelve);
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
    // A replaced renderer: only the host's excerpt names a message's text.
    const Plain = ({ text }: { text: string }) => <p data-plain="">{text}</p>;
    const renderers = { markdown: Plain };
    const host = () => (
      <WaypointChat
        client={client}
        renderers={renderers}
        messageExcerpt={(message) => message.content}
      />
    );
    const view = render(host());
    await waitFor(
      () => expect(document.querySelectorAll("[data-plain]")).toHaveLength(12),
      { timeout: 30_000 },
    );
    await act(async () => {
      screen.getByRole("button", { name: english["chat.outline"] }).click();
    });
    await type("apples");
    expect(status()).toBe("11 messages match");
    view.rerender(host());
    view.rerender(host());
    await waitFor(() => expect(status()).toBe("11 messages match"));
    expect(links()).toHaveLength(11);
    client.dispose();
  });
});
