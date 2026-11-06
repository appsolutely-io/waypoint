// @vitest-environment jsdom
// What the chat's message live region and reply row say (Table A). Each
// emission is observed on the one region element, whose identity must stay
// the same; a DOM test does not prove what a screen reader speaks.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  configure,
  render,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { english } from "../../src/react/i18n";
import { ANNOUNCEMENT_BATCH_MS } from "../../src/react/announcements";
import {
  createWaypointClient,
  type TransportEvent,
} from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

afterEach(cleanup);
// Each batch waits a second before it is said.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });
const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
const reply = (
  id: string,
  content = `Reply ${id}`,
  // null: a message without a status (a default would hide that case).
  status: string | null = "completed",
  role: Message["role"] = "assistant",
): Message =>
  ({
    id,
    role,
    content,
    blocks: [],
    createdAt: 100,
    ...(status === null ? {} : { status }),
  }) as Message;
const user = (id: string) => reply(id, `Question ${id}`, null, "user");
const quiet = () =>
  act(async () => {
    await new Promise((resolve) =>
      setTimeout(resolve, ANNOUNCEMENT_BATCH_MS + 300),
    );
  });

type Listener = (event: TransportEvent) => void;
async function chat(
  initial: Message[],
  {
    skin = {},
    hold = false,
    extra = {},
  }: { skin?: object; hold?: boolean; extra?: object } = {},
) {
  const base = config();
  const shown: Record<string, Message[]> = { a: initial, b: [reply("b1")] };
  const status: Record<string, string | undefined> = {};
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined = hold
    ? new Promise<void>((resolve) => (release = resolve))
    : undefined;
  let listener: Listener | undefined;
  let sequence = 0;
  const client = createWaypointClient({
    ...base,
    conversationId: "a",
    transport: {
      ...base.transport,
      read: async (id) => {
        await gate;
        return {
          protocol: "1.0",
          id,
          title: id,
          messages: structuredClone(shown[id] ?? []),
          ...(status[id] ? { replyStatus: status[id] } : {}),
        } as Conversation;
      },
      subscribe: (_id: string, on: Listener) => {
        listener = on;
        on({ type: "status", status: "open" } as TransportEvent);
        return () => {};
      },
    },
  });
  void client.ready;
  const view = render(<WaypointChat client={client} {...skin} {...extra} />);
  const region = () =>
    view.container.querySelector<HTMLElement>("[data-announcements]")!;
  const emissions: string[] = [];
  let observed: HTMLElement | undefined;
  const observe = () => {
    observed = region();
    new MutationObserver(() => {
      const text = observed!.textContent ?? "";
      if (text) emissions.push(text);
    }).observe(observed, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  };
  observe();
  return {
    client,
    emissions,
    region,
    sameRegion: () => region() === observed,
    release: async () => {
      gate = undefined;
      await act(async () => {
        release?.();
        await client.ready;
      });
    },
    set: async (id: string, messages: Message[], replyStatus?: string) => {
      shown[id] = messages;
      status[id] = replyStatus;
      await act(async () => {
        await client.refresh();
      });
    },
    switchTo: async (id: string) => {
      await act(async () => {
        await client.switchConversation(id);
      });
    },
    hold: () => {
      gate = new Promise<void>((resolve) => (release = resolve));
    },
    frame: async (frame: object) => {
      await act(async () => {
        listener?.({
          type: "frame",
          frame: { protocol: "1.0", sequence: ++sequence, ...frame },
        } as TransportEvent);
        await Promise.resolve();
      });
    },
    status: async (value: string) => {
      await act(async () => {
        listener?.({ type: "status", status: value } as TransportEvent);
        await Promise.resolve();
      });
    },
    remount: () => {
      view.rerender(<></>);
      view.rerender(<WaypointChat client={client} {...skin} {...extra} />);
      emissions.length = 0;
      observe();
    },
  };
}
const loaded = async (h: Awaited<ReturnType<typeof chat>>, id = "a") =>
  waitFor(() => expect(h.client.getSnapshot().conversation?.id).toBe(id));

describe.each(skins)("announcements (%s)", (_, skin) => {
  it("CK-A1 the reply row is its own polite status and says each new state", async () => {
    const h = await chat([user("u1")], { skin });
    await loaded(h);
    const row = () =>
      document.querySelector('[data-part="replyRow"] [role="status"]')!;
    const element = row();
    await waitFor(() =>
      expect(element.textContent).toBe(english["reply.writing"]),
    );
    await h.set("a", [user("u1")], "failed");
    expect(row()).toBe(element);
    expect(element.textContent).toBe(english["reply.failed"]);
    await h.set("a", [user("u1")], "unavailable");
    expect(element.textContent).toBe(english["reply.unavailable"]);
    await h.set("a", [user("u1"), reply("r1")]);
    expect(row()).toBe(element);
    expect(element.textContent).toBe("");
  });

  it("CK-A2 history is silent: a held first read, a held switch read, and A to B to A; a refresh that adds a reply is announced", async () => {
    const h = await chat([reply("old1"), reply("old2")], { skin, hold: true });
    await h.release();
    await loaded(h);
    await quiet();
    expect(h.emissions).toEqual([]);
    await h.set("a", [reply("old1"), reply("old2"), reply("new1", "Fresh")]);
    await waitFor(() => expect(h.emissions).toEqual(["New reply: ⁨Fresh⁩"]));
    h.hold();
    const switching = h.switchTo("b");
    await h.release();
    await switching;
    await loaded(h, "b");
    await h.switchTo("a");
    await loaded(h, "a");
    await quiet();
    expect(h.emissions).toHaveLength(1);
    expect(h.sameRegion()).toBe(true);
  });

  it("CK-A2 after a remount the baseline is set again", async () => {
    const h = await chat([reply("old1")], { skin });
    await loaded(h);
    await h.set("a", [reply("old1"), reply("new1")]);
    h.remount();
    await quiet();
    expect(h.emissions).toEqual([]);
  });

  it.each([
    ["a host that sets status", true],
    ["a host that does not", false],
  ])(
    "CK-A3 CK-A5 a streamed reply from %s is announced once",
    async (_, sets) => {
      const h = await chat([user("u1")], { skin });
      await loaded(h);
      await h.frame({
        type: "message.start",
        messageId: "s1",
        role: "assistant",
      });
      await h.frame({ type: "text.delta", messageId: "s1", text: "Streamed" });
      // The server's version after the end.
      await act(async () => {
        await h.set("a", [
          user("u1"),
          reply("s1", "Streamed answer", sets ? "completed" : null),
        ]);
      });
      await h.frame({
        type: "message.end",
        messageId: "s1",
        status: "completed",
      });
      await waitFor(() => expect(h.emissions.length).toBeGreaterThan(0));
      await quiet();
      // The end frame's own status completes it, whatever the read says;
      // said once.
      expect(h.emissions).toEqual(["New reply: ⁨Streamed answer⁩"]);
    },
  );

  it("CK-A3 a reply that arrived in one batch and completes later is announced again as completed", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [reply("p1", "", null)]);
    await waitFor(() => expect(h.emissions).toEqual(["New reply"]));
    await h.set("a", [reply("p1", "Done now")]);
    await waitFor(() =>
      expect(h.emissions).toEqual(["New reply", "New reply: ⁨Done now⁩"]),
    );
  });

  it("CK-A5 a failed reply", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [reply("f1", "", "failed")]);
    await waitFor(() =>
      expect(h.emissions).toEqual([english["chat.arrivalFailed"]]),
    );
  });

  it("CK-A6 one read adding 100 completed replies is one emission", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    const many = Array.from({ length: 100 }, (_, i) =>
      reply(`r${i}`, `Answer ${i}`),
    );
    await h.set("a", many);
    await waitFor(() =>
      expect(h.emissions).toEqual(["100 new replies. Latest: ⁨Answer 99⁩"]),
    );
    await quiet();
    expect(h.emissions).toHaveLength(1);
  });

  it("CK-A7 mixed outcomes, all failed, plain placeholders and a burst", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [reply("x1"), reply("x2", "", "failed")]);
    await waitFor(() =>
      expect(h.emissions.at(-1)).toBe(
        "2 new replies; 1 could not be completed.",
      ),
    );
    await h.set("a", [
      reply("x1"),
      reply("x2", "", "failed"),
      reply("y1", "", "failed"),
      reply("y2", "", "unavailable"),
    ]);
    await waitFor(() =>
      expect(h.emissions.at(-1)).toBe("2 replies could not be completed."),
    );
    // Two placeholders without status; the latest fills before emission.
    const before = [
      reply("x1"),
      reply("x2", "", "failed"),
      reply("y1", "", "failed"),
      reply("y2", "", "unavailable"),
    ];
    await h.set("a", [...before, reply("z1", "", null)]);
    await h.set("a", [...before, reply("z1", "", null), reply("z2", "", null)]);
    await h.set("a", [
      ...before,
      reply("z1", "", null),
      reply("z2", "Filled", null),
    ]);
    await waitFor(() => expect(h.emissions.at(-1)).toBe("2 new replies"));
    const count = h.emissions.length;
    // A rapid burst of frames inside one batch.
    for (let i = 0; i < 10; i++)
      await h.set("a", [
        ...before,
        reply("z1", "", null),
        reply("z2", "Filled", null),
        ...Array.from({ length: i + 1 }, (_, j) => reply(`burst${j}`)),
      ]);
    await waitFor(() => expect(h.emissions.length).toBe(count + 1));
    await quiet();
    expect(h.emissions.length).toBe(count + 1);
    expect(h.emissions.at(-1)).toMatch(/^10 new replies\. Latest: /);
  });

  it("CK-A8 a held batch dropped by a switch", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [reply("d1")]);
    await h.switchTo("b");
    await loaded(h, "b");
    await quiet();
    expect(h.emissions).toEqual([]);
  });

  it("CK-A8 the latest entry removed before emission leaves the count and excerpt right", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [
      reply("k1", "First"),
      reply("k2", "Second"),
      reply("k3", "Third"),
    ]);
    await h.set("a", [reply("k1", "First"), reply("k2", "Second")]);
    await waitFor(() =>
      expect(h.emissions).toEqual(["2 new replies. Latest: ⁨Second⁩"]),
    );
  });

  it("CK-A6 latest means newest in the transcript, not first to complete", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [
      reply("q1", "Earlier", "writing"),
      reply("q2", "Newest"),
    ]);
    await h.set("a", [reply("q1", "Earlier"), reply("q2", "Newest")]);
    await waitFor(() =>
      expect(h.emissions).toEqual([
        "2 new replies. Latest: \u2068Newest\u2069",
      ]),
    );
  });
  it("CK-A8 a replaced message speaks its current text", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [reply("c1", "Old text")]);
    await h.set("a", [reply("c1", "Current text")]);
    await waitFor(() =>
      expect(h.emissions).toEqual(["New reply: ⁨Current text⁩"]),
    );
  });

  it("CK-A8 an arrival announced, completed, then back to no status before emission says nothing; a later completion once", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [reply("v1", "", null)]);
    await waitFor(() => expect(h.emissions).toEqual(["New reply"]));
    await h.set("a", [reply("v1", "Done")]);
    await h.set("a", [reply("v1", "", null)]);
    await quiet();
    expect(h.emissions).toEqual(["New reply"]);
    await h.set("a", [reply("v1", "Done again")]);
    await waitFor(() =>
      expect(h.emissions).toEqual(["New reply", "New reply: ⁨Done again⁩"]),
    );
    await quiet();
    expect(h.emissions).toHaveLength(2);
  });

  it("CK-A8 a pending completed id that turns writing before emission is dropped", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [reply("w1", "Done")]);
    await h.set("a", [reply("w1", "Still going", "writing")]);
    await quiet();
    expect(h.emissions).toEqual([]);
  });

  it("CK-A8 removing an ineligible entry from a mixed batch recomputes count and wording", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [
      reply("m1", "One"),
      reply("m2", "", "failed"),
      reply("m3", "Three"),
    ]);
    await h.set("a", [
      reply("m1", "One"),
      reply("m2", "", "writing"),
      reply("m3", "Three"),
    ]);
    await waitFor(() =>
      expect(h.emissions).toEqual(["2 new replies. Latest: ⁨Three⁩"]),
    );
  });

  describe("between the batch and its delivery frame", () => {
    // Holds the announcer's next frame until the test releases it.
    const holdFrames = () => {
      const held: FrameRequestCallback[] = [];
      const spy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback) => {
          held.push(callback);
          return held.length;
        });
      return {
        waitForFrame: () => waitFor(() => expect(held.length).toBe(1)),
        release: () =>
          act(() => {
            spy.mockRestore();
            for (const callback of held.splice(0)) callback(0);
          }),
      };
    };
    it("CK-A8-frame a switch to another conversation says nothing", async () => {
      const h = await chat([], { skin });
      await loaded(h);
      const frames = holdFrames();
      await h.set("a", [reply("f1", "Frame text")]);
      await frames.waitForFrame();
      await h.switchTo("b");
      await loaded(h, "b");
      await frames.release();
      await quiet();
      expect(h.emissions).toEqual([]);
    });
    it("CK-A8-frame A to B to A says nothing", async () => {
      const h = await chat([], { skin });
      await loaded(h);
      const frames = holdFrames();
      await h.set("a", [reply("f1", "Frame text")]);
      await frames.waitForFrame();
      await h.switchTo("b");
      await loaded(h, "b");
      await h.switchTo("a");
      await loaded(h, "a");
      await frames.release();
      await quiet();
      expect(h.emissions).toEqual([]);
    });
    it("CK-A8-frame the message removed says nothing", async () => {
      const h = await chat([], { skin });
      await loaded(h);
      const frames = holdFrames();
      await h.set("a", [reply("f1", "Frame text")]);
      await frames.waitForFrame();
      await h.set("a", []);
      await frames.release();
      await quiet();
      expect(h.emissions).toEqual([]);
    });
    it("CK-A8-frame text replaced says the current text", async () => {
      const h = await chat([], { skin });
      await loaded(h);
      const frames = holdFrames();
      await h.set("a", [reply("f1", "Frame text")]);
      await frames.waitForFrame();
      await h.set("a", [reply("f1", "Redacted")]);
      await frames.release();
      await waitFor(() =>
        expect(h.emissions).toEqual(["New reply: \u2068Redacted\u2069"]),
      );
    });
    it("CK-A8-frame a stage not delivered is not marked announced", async () => {
      const h = await chat([], { skin });
      await loaded(h);
      const frames = holdFrames();
      await h.set("a", [reply("f1", "First")]);
      await frames.waitForFrame();
      await h.set("a", []);
      await frames.release();
      await quiet();
      await h.set("a", [reply("f1", "Back again")]);
      await waitFor(() =>
        expect(h.emissions).toEqual(["New reply: \u2068Back again\u2069"]),
      );
    });
  });

  it("CK-E1-normalized a shown image written with a space is announced without its alt text", async () => {
    const shown = await chat([], {
      skin,
      extra: { markdownImages: { origin: window.location.origin } },
    });
    await loaded(shown);
    await shown.set("a", [reply("g1", "Look ![Secret alt](</image one.png>)")]);
    await waitFor(() =>
      expect(shown.emissions).toEqual(["New reply: \u2068Look\u2069"]),
    );
  });
  it("CK-E1-reference a displayed referenced image's alt text is not announced; a link's is", async () => {
    const source = "Look ![Secret alt][image]\n\n[image]: /same-origin.png";
    const shown = await chat([], {
      skin,
      extra: { markdownImages: { origin: window.location.origin } },
    });
    await loaded(shown);
    await shown.set("a", [reply("g1", source)]);
    await waitFor(() =>
      expect(shown.emissions).toEqual(["New reply: \u2068Look\u2069"]),
    );
    cleanup();
    const linked = await chat([], { skin });
    await loaded(linked);
    await linked.set("a", [reply("g1", source)]);
    await waitFor(() =>
      expect(linked.emissions).toEqual([
        "New reply: \u2068Look Secret alt\u2069",
      ]),
    );
  });
  it("CK-A9 two identical texts in a row are two emissions", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [reply("i1", "", "failed")]);
    await waitFor(() => expect(h.emissions).toHaveLength(1));
    await h.set("a", [reply("i1", "", "failed"), reply("i2", "", "failed")]);
    await waitFor(() =>
      expect(h.emissions).toEqual([
        english["chat.arrivalFailed"],
        english["chat.arrivalFailed"],
      ]),
    );
    expect(h.sameRegion()).toBe(true);
  });

  it("CK-A10 the user's own messages are never announced", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    await h.set("a", [user("u1"), user("u2")]);
    await quiet();
    expect(h.emissions).toEqual([]);
  });

  it("the region is outside the transcript part and persists", async () => {
    const h = await chat([], { skin });
    await loaded(h);
    expect(h.region().getAttribute("role")).toBe("status");
    expect(h.region().closest('[data-part="transcript"]')).toBeNull();
  });
});

const hidden = "Visible start HIDDEN-REDACTED";
const opaque: [string, object][] = [
  [
    "a host Markdown renderer",
    { renderers: { markdown: () => <span>Redacted</span> } },
  ],
  ["a bubble part", { parts: { bubble: () => <span>Redacted</span> } }],
  ["a bubble slot", { slots: { bubble: () => <span>Redacted</span> } }],
  [
    "a transcript part that drops the children",
    { parts: { transcript: () => <span>Custom transcript</span> } },
  ],
  [
    "a transcript slot that drops the children",
    { slots: { transcript: () => <span>Custom transcript</span> } },
  ],
  [
    "a transcript slot keeping the stock children with a withheld bubble",
    {
      slots: {
        transcript: (props: { children?: unknown }) => (
          <>{props.children as never}</>
        ),
        bubble: () => <span>Redacted</span>,
      },
    },
  ],
];
describe.each(skins)(
  "CK-E2 the live region under opaque replacements (%s)",
  (_, skin) => {
    it.each(opaque)("%s: plain, never the hidden text", async (_, extra) => {
      const h = await chat([], { skin, extra });
      await loaded(h);
      await h.set("a", [reply("o1", hidden)]);
      await waitFor(() => expect(h.emissions).toEqual(["New reply"]));
      expect(h.region().textContent).not.toMatch(/HIDDEN/);
    });
    it.each(opaque)(
      "%s with messageExcerpt: only the host text",
      async (_, extra) => {
        const h = await chat([], {
          skin,
          extra: { ...extra, messageExcerpt: () => "Host summary" },
        });
        await loaded(h);
        await h.set("a", [reply("o1", hidden)]);
        await waitFor(() =>
          expect(h.emissions).toEqual(["New reply: \u2068Host summary\u2069"]),
        );
      },
    );
  },
);

describe("CK-A2-client the baseline belongs to the client as well as the conversation", () => {
  const ready = async (messages: () => Message[]) => {
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
            messages: structuredClone(messages()),
          }) as Conversation,
      },
    });
    await client.ready;
    return client;
  };
  it("a ready client replacing another with the same conversation id says none of its history, then its new replies", async () => {
    const first = await ready(() => [reply("a1", "First client")]);
    let second: Message[] = [
      reply("b1", "Second history"),
      reply("a1", "Reused id"),
    ];
    const next = await ready(() => second);
    const view = render(<WaypointChat client={first} />);
    const region = () => view.container.querySelector("[data-announcements]")!;
    const emissions: string[] = [];
    const observed = region();
    new MutationObserver(() => {
      if (observed.textContent) emissions.push(observed.textContent);
    }).observe(observed, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    await waitFor(() => expect(first.getSnapshot().conversation?.id).toBe("a"));
    view.rerender(<WaypointChat client={next} />);
    await quiet();
    expect(emissions).toEqual([]);
    expect(region()).toBe(observed);
    second = [...second, reply("b2", "New on the second")];
    await act(async () => {
      await next.refresh();
    });
    await waitFor(() =>
      expect(emissions).toEqual(["New reply: \u2068New on the second\u2069"]),
    );
  });
  it("an old client's pending batch is not said for the new client", async () => {
    let firstMessages: Message[] = [];
    const first = await ready(() => firstMessages);
    const next = await ready(() => [reply("p1", "Pending on the first")]);
    const view = render(<WaypointChat client={first} />);
    const region = view.container.querySelector("[data-announcements]")!;
    const emissions: string[] = [];
    new MutationObserver(() => {
      if (region.textContent) emissions.push(region.textContent);
    }).observe(region, { childList: true, characterData: true, subtree: true });
    await waitFor(() => expect(first.getSnapshot().conversation?.id).toBe("a"));
    firstMessages = [reply("p1", "Pending on the first")];
    await act(async () => {
      await first.refresh();
    });
    view.rerender(<WaypointChat client={next} />);
    await quiet();
    expect(emissions).toEqual([]);
  });
});

describe("the excerpt in an announcement while the parser loads (CK-E8)", () => {
  afterEach(() => vi.doUnmock("../../src/react/markdown"));
  it("resolved before emission: the pending announcement has its excerpt; resolved after: no new mutation", async () => {
    vi.resetModules();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    vi.doMock("../../src/react/markdown", async (importActual) => {
      await hold;
      return importActual();
    });
    const { WaypointChat: Chat } = await import("../../src/react/index");
    const { createWaypointClient: create } =
      await import("../../src/core/client");
    const base = config();
    let shown: Message[] = [reply("h1", "History")];
    const client = create({
      ...base,
      conversationId: "a",
      transport: {
        ...base.transport,
        read: async (id) =>
          ({ protocol: "1.0", id, title: id, messages: shown }) as Conversation,
      },
    });
    await client.ready;
    const view = render(<Chat client={client} />);
    const region = view.container.querySelector("[data-announcements]")!;
    const emissions: string[] = [];
    new MutationObserver(() => {
      if (region.textContent) emissions.push(region.textContent);
    }).observe(region, { childList: true, characterData: true, subtree: true });
    await waitFor(() =>
      expect(client.getSnapshot().conversation?.id).toBe("a"),
    );
    // Arrives while the parser is held; it loads before the batch emits.
    shown = [reply("h1", "History"), reply("n1", "Parsed **text**")];
    await act(async () => {
      await client.refresh();
    });
    await act(async () => {
      release();
      await hold;
    });
    await waitFor(() =>
      expect(emissions).toEqual(["New reply: ⁨Parsed text⁩"]),
    );
    await quiet();
    expect(emissions).toHaveLength(1);
  });
  it("emitted before the parser loads: plain, and never rewritten", async () => {
    vi.resetModules();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    vi.doMock("../../src/react/markdown", async (importActual) => {
      await hold;
      return importActual();
    });
    const { WaypointChat: Chat } = await import("../../src/react/index");
    const { createWaypointClient: create } =
      await import("../../src/core/client");
    const base = config();
    let shown: Message[] = [];
    const client = create({
      ...base,
      conversationId: "a",
      transport: {
        ...base.transport,
        read: async (id) =>
          ({ protocol: "1.0", id, title: id, messages: shown }) as Conversation,
      },
    });
    await client.ready;
    const view = render(<Chat client={client} />);
    const region = view.container.querySelector("[data-announcements]")!;
    const changes: string[] = [];
    await waitFor(() =>
      expect(client.getSnapshot().conversation?.id).toBe("a"),
    );
    shown = [reply("n1", "Parsed **text**")];
    await act(async () => {
      await client.refresh();
    });
    await waitFor(() => expect(region.textContent).toBe("New reply"));
    new MutationObserver(() => changes.push(region.textContent ?? "")).observe(
      region,
      { childList: true, characterData: true, subtree: true },
    );
    await act(async () => {
      release();
      await hold;
    });
    await quiet();
    expect(changes).toEqual([]);
    expect(region.textContent).toBe("New reply");
  });
});

describe("streamed replies and modal drawers", () => {
  it("CK-SC6 a streamed reply is said once, when its end frame completes it", async () => {
    const h = await chat([user("u1")]);
    await loaded(h);
    await quiet();
    const before = h.emissions.length;
    await h.frame({
      type: "message.start",
      messageId: "a1",
      role: "assistant",
    });
    await h.frame({ type: "text.delta", messageId: "a1", text: "Streamed" });
    // The host's read has the reply, without a status of its own.
    await h.set("a", [user("u1"), reply("a1", "Streamed", null)]);
    await quiet();
    expect(h.emissions.length).toBe(before);
    await h.frame({
      type: "message.end",
      messageId: "a1",
      status: "completed",
    });
    await waitFor(() => expect(h.emissions.length).toBe(before + 1));
    expect(h.emissions.at(-1)).toContain("Streamed");
    h.client.dispose();
  });

  it("CK-SC4 a mark dropped after a gap says nothing new", async () => {
    const h = await chat([user("u1")]);
    await loaded(h);
    await quiet();
    const before = h.emissions.length;
    await h.frame({
      type: "message.start",
      messageId: "a1",
      role: "assistant",
    });
    await h.set("a", [user("u1"), reply("a1", "Partial", null)]);
    expect(h.client.getSnapshot().conversation?.messages.at(-1)?.status).toBe(
      "writing",
    );
    // A gap, ended by a read that gives the reply no status.
    await h.status("reconnecting");
    await waitFor(() =>
      expect(
        h.client.getSnapshot().conversation?.messages.at(-1)?.status,
      ).toBeUndefined(),
    );
    await quiet();
    expect(h.emissions.length).toBe(before);
    h.client.dispose();
  });

  it("CK-DR2 what arrives while a modal drawer makes the region inert is said once it closes", async () => {
    const h = await chat([user("u1")]);
    await loaded(h);
    await quiet();
    const before = h.emissions.length;
    const host = h.region().closest("section")!.parentElement!;
    await act(async () => host.setAttribute("inert", ""));
    await h.set("a", [user("u1"), reply("a1", "While open")]);
    await quiet();
    expect(h.emissions.length).toBe(before);
    await act(async () => host.removeAttribute("inert"));
    await waitFor(() => expect(h.emissions.length).toBe(before + 1));
    expect(h.emissions.at(-1)).toContain("While open");
    await quiet();
    expect(h.emissions.length).toBe(before + 1);
    h.client.dispose();
  });
});
