import { describe, expect, it } from "vitest";
import {
  createWaypointClient,
  type TransportEvent,
  type TransportPort,
} from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { config, createManualClock, flush } from "../support/client";

type Status = Message["status"];
interface Subscription {
  listener: (event: TransportEvent) => void;
}
// A host whose read answers with `messages`, a read that can be held, and
// frames sent on the latest subscription with rising sequence numbers.
function harness() {
  const manual = createManualClock(1000);
  const subscriptions: Subscription[] = [];
  const host = {
    messages: [] as Message[],
    hold: undefined as Promise<void> | undefined,
    fail: false,
    replyStatus: undefined as "failed" | "unavailable" | undefined,
  };
  let sequence = 0;
  const base = config();
  const transport: TransportPort = {
    ...base.transport,
    negotiate: async () => ({
      protocol: "1.0",
      capabilities: ["plans", "flows", "widgets"],
      agreementId: "agreement-1",
    }),
    read: async (id) => {
      // The host's answer is fixed when the read is asked for.
      const messages = structuredClone(host.messages);
      const held = host.hold;
      host.hold = undefined;
      const fail = host.fail;
      if (held) await held;
      if (fail) throw new Error("network");
      return {
        protocol: "1.0",
        id,
        title: "Chat",
        messages,
        ...(host.replyStatus && { replyStatus: host.replyStatus }),
      };
    },
    subscribe: (_id, listener) => {
      subscriptions.push({ listener });
      return () => {};
    },
  };
  const client = createWaypointClient({
    ...base,
    platform: { ...base.platform, clock: manual.clock },
    transport,
  });
  const last = () => subscriptions[subscriptions.length - 1]!;
  const frame = (value: Record<string, unknown>) =>
    last().listener({
      type: "frame",
      frame: { protocol: "1.0", sequence: ++sequence, ...value } as never,
    });
  const start = (id: string, role: "assistant" | "user" = "assistant") =>
    frame({ type: "message.start", messageId: id, role });
  const delta = (id: string, text: string) =>
    frame({ type: "text.delta", messageId: id, text });
  const end = (id: string, status: Exclude<Status, "writing" | undefined>) =>
    frame({ type: "message.end", messageId: id, status });
  const message = (id: string) =>
    client.getSnapshot().conversation?.messages.find((m) => m.id === id);
  const shown = (id: string, content: string, status?: Status): Message => ({
    id,
    role: "assistant",
    content,
    blocks: [],
    createdAt: 1,
    ...(status ? { status } : {}),
  });
  const hold = () => {
    let release!: () => void;
    host.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    return async () => {
      release();
      await flush();
    };
  };
  const ready = async () => {
    await manual.advance(0);
    await client.ready;
    await flush();
    last().listener({ type: "status", status: "open" });
    await flush();
  };
  return {
    client,
    host,
    manual,
    subscriptions,
    frame,
    start,
    delta,
    end,
    message,
    shown,
    hold,
    ready,
  };
}

describe("stream status of a message", () => {
  it("CK-SC1 an assistant start marks a new message writing; a user start adds no status", async () => {
    const h = harness();
    await h.ready();
    h.start("a");
    h.start("u", "user");
    expect(h.message("a")?.status).toBe("writing");
    expect(h.message("u")?.status).toBeUndefined();
    h.client.dispose();
  });

  it("CK-SC1b a start for a shown id clears its text, whatever its status", async () => {
    const h = harness();
    h.host.messages = [h.shown("m", "Hello", "writing")];
    await h.ready();
    h.start("m");
    h.delta("m", "Hello");
    expect(h.message("m")?.content).toBe("Hello");
    expect(h.message("m")?.status).toBe("writing");
    h.end("m", "completed");
    expect(h.message("m")?.status).toBe("completed");
    h.client.dispose();
  });

  it("CK-SC1b a status-less read of the previous version never joins the new one", async () => {
    const h = harness();
    h.host.messages = [h.shown("m", "Paris is the capital.")];
    await h.ready();
    h.host.fail = true;
    h.start("m");
    h.delta("m", "The capital is Paris.");
    expect(h.message("m")?.content).toBe("The capital is Paris.");
    h.end("m", "failed");
    await flush();
    expect(h.message("m")?.content).toBe("The capital is Paris.");
    expect(h.message("m")?.status).toBe("failed");
    h.client.dispose();
  });

  it("CK-SC1b a regenerate on the same binding shows writing again", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.delta("m", "One");
    h.host.messages = [h.shown("m", "One", "completed")];
    h.end("m", "completed");
    await flush();
    expect(h.message("m")?.status).toBe("completed");
    h.start("m");
    expect(h.message("m")?.status).toBe("writing");
    expect(h.message("m")?.content).toBe("");
    h.delta("m", "Two");
    h.end("m", "failed");
    expect(h.message("m")?.status).toBe("failed");
    expect(h.message("m")?.content).toBe("Two");
    h.client.dispose();
  });

  for (const status of ["completed", "failed", "unavailable"] as const)
    it(`CK-SC2 an end frame's own status is adopted: ${status}`, async () => {
      const h = harness();
      await h.ready();
      h.host.fail = true;
      h.start("m");
      h.end("m", status);
      await flush();
      expect(h.message("m")?.status).toBe(status);
      h.client.dispose();
    });

  it("CK-SC2 an end for an id not shown is ignored and nothing is synthesized", async () => {
    const h = harness();
    h.host.messages = [h.shown("old", "Earlier")];
    await h.ready();
    h.host.fail = true;
    h.end("other", "completed");
    await flush();
    expect(h.message("other")).toBeUndefined();
    expect(h.message("old")?.status).toBeUndefined();
    h.client.dispose();
  });

  it("CK-SC2 an end for a stream joined midway is the host's word", async () => {
    const h = harness();
    h.host.messages = [h.shown("m", "Partial", "writing")];
    await h.ready();
    h.host.fail = true;
    h.end("m", "completed");
    await flush();
    expect(h.message("m")?.status).toBe("completed");
    h.client.dispose();
  });

  it("CK-SC3 a later status-less or writing read keeps the adopted status; a terminal read replaces it", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.host.messages = [h.shown("m", "Done")];
    h.end("m", "completed");
    await flush();
    expect(h.message("m")?.status).toBe("completed");
    h.host.messages = [h.shown("m", "Done", "writing")];
    await h.client.refresh();
    expect(h.message("m")?.status).toBe("completed");
    h.host.messages = [h.shown("m", "Done", "failed")];
    await h.client.refresh();
    expect(h.message("m")?.status).toBe("failed");
    h.client.dispose();
  });

  it("CK-SC3 a newer terminal read ends a writing mark", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.host.messages = [h.shown("m", "Whole", "completed")];
    await h.client.refresh();
    expect(h.message("m")?.status).toBe("completed");
    h.client.dispose();
  });

  it("CK-SC3b an older read never ends a newer mark nor replaces its text", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.delta("m", "v1");
    h.host.messages = [h.shown("m", "v1", "completed")];
    const release = h.hold();
    h.end("m", "completed");
    h.start("m");
    h.delta("m", "v2");
    await release();
    expect(h.message("m")?.status).toBe("writing");
    expect(h.message("m")?.content).toBe("v2");
    h.host.messages = [h.shown("m", "v2 whole", "completed")];
    await h.client.refresh();
    expect(h.message("m")?.status).toBe("completed");
    expect(h.message("m")?.content).toBe("v2 whole");
    h.client.dispose();
  });

  it("CK-SC4b after a reopen, a status-less first read drops the mark, and a later delta brings it back", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.delta("m", "Part");
    h.host.messages = [h.shown("m", "Part one")];
    // The connection drops; the end frame is lost in the gap.
    h.subscriptions
      .at(-1)!
      .listener({ type: "status", status: "reconnecting" });
    await h.manual.advance(250);
    await flush();
    h.subscriptions.at(-1)!.listener({ type: "status", status: "open" });
    await flush();
    expect(h.message("m")?.status).toBeUndefined();
    h.delta("m", " two");
    expect(h.message("m")?.status).toBe("writing");
    h.end("m", "completed");
    expect(h.message("m")?.status).toBe("completed");
    h.client.dispose();
  });

  it("CK-SC4b after a reopen, a first read with a status makes it final", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.host.messages = [h.shown("m", "Whole", "completed")];
    h.subscriptions
      .at(-1)!
      .listener({ type: "status", status: "reconnecting" });
    await h.manual.advance(250);
    await flush();
    h.subscriptions.at(-1)!.listener({ type: "status", status: "open" });
    await flush();
    expect(h.message("m")?.status).toBe("completed");
    h.client.dispose();
  });

  it("CK-SC5 a mark survives a read that omits its message while the binding is open", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.host.messages = [];
    await h.client.refresh();
    expect(h.message("m")).toBeUndefined();
    h.host.messages = [h.shown("m", "Back")];
    await h.client.refresh();
    expect(h.message("m")?.status).toBe("writing");
    h.client.dispose();
  });

  it("CK-SC4 a mark is dropped when its binding ends, leaving the read's status", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.host.messages = [h.shown("m", "Part")];
    await h.client.refresh();
    expect(h.message("m")?.status).toBe("writing");
    // Five failed reopens: the binding gives up.
    h.host.fail = true;
    for (let attempt = 0; attempt < 6; attempt++) {
      h.subscriptions
        .at(-1)!
        .listener({ type: "status", status: "reconnecting" });
      await h.manual.advance(5000);
      await flush();
    }
    expect(h.client.getSnapshot().streamUnavailable).toBe(true);
    expect(h.message("m")?.status).toBeUndefined();
    h.client.dispose();
  });
});

describe("stream status after a gap and a failed refresh", () => {
  it("CK-SC4b a reply that already ended keeps its status across a reopen", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.host.messages = [h.shown("m", "Done")];
    h.end("m", "completed");
    await flush();
    h.subscriptions
      .at(-1)!
      .listener({ type: "status", status: "reconnecting" });
    await h.manual.advance(250);
    await flush();
    h.subscriptions.at(-1)!.listener({ type: "status", status: "open" });
    await flush();
    expect(h.message("m")?.status).toBe("completed");
    h.client.dispose();
  });

  it("CK-SC3 a failed refresh after the end keeps the end frame's status", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.delta("m", "Text");
    h.host.fail = true;
    h.end("m", "failed");
    await flush();
    expect(h.message("m")?.status).toBe("failed");
    expect(h.message("m")?.content).toBe("Text");
    h.client.dispose();
  });

  it("CK-SC3 a delayed refresh overtaken by a newer read leaves the newer status", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    h.host.messages = [h.shown("m", "Old", "writing")];
    const release = h.hold();
    const delayed = h.client.refresh();
    h.host.messages = [h.shown("m", "New", "completed")];
    await h.client.refresh();
    expect(h.message("m")?.status).toBe("completed");
    await release();
    await delayed;
    expect(h.message("m")?.status).toBe("completed");
    h.client.dispose();
  });

  it("CK-SC2 a frame from a connection that closed is ignored", async () => {
    const h = harness();
    await h.ready();
    h.start("m");
    const old = h.subscriptions.at(-1)!;
    old.listener({ type: "status", status: "reconnecting" });
    await h.manual.advance(250);
    await flush();
    old.listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 999,
        type: "message.end",
        messageId: "m",
        status: "failed",
      } as never,
    });
    expect(h.message("m")?.status).not.toBe("failed");
    h.client.dispose();
  });

  it("CK-SC1b an assistant start never blanks a user message", async () => {
    const h = harness();
    h.host.messages = [{ ...h.shown("u", "Question"), role: "user" }];
    await h.ready();
    h.start("u");
    expect(h.message("u")?.content).toBe("Question");
    expect(h.message("u")?.status).toBeUndefined();
    h.client.dispose();
  });
});

describe("a reply being written never outlasts what ended it", () => {
  const writing = (h: ReturnType<typeof harness>) => [
    { ...h.shown("u", "Question"), role: "user" as const },
    h.shown("m", "Part", "writing"),
  ];
  it("a reply the host reports failed is failed, not being written", async () => {
    const h = harness();
    h.host.messages = writing(h);
    h.host.replyStatus = "failed";
    await h.ready();
    expect(h.message("m")?.status).toBe("writing");
    expect(h.client.getSnapshot().replyState).toBe("failed");
    h.client.dispose();
  });
  it("a reply the host reports unavailable is unavailable, not being written", async () => {
    const h = harness();
    h.host.messages = writing(h);
    h.host.replyStatus = "unavailable";
    await h.ready();
    expect(h.client.getSnapshot().replyState).toBe("unavailable");
    h.client.dispose();
  });
  it("a reply read while streaming is no longer being written once its stream gives up", async () => {
    const h = harness();
    h.host.messages = writing(h);
    await h.ready();
    expect(h.client.getSnapshot().replyState).toBe("writing");
    h.host.fail = true;
    for (let attempt = 0; attempt < 6; attempt++) {
      h.subscriptions
        .at(-1)!
        .listener({ type: "status", status: "reconnecting" });
      await h.manual.advance(5000);
      await flush();
    }
    expect(h.client.getSnapshot().streamUnavailable).toBe(true);
    expect(h.client.getSnapshot().replyState).toBe("unavailable");
    h.client.dispose();
  });
});

describe("a reply that stops arriving", () => {
  it("is overdue 15 seconds after its last text, and writing again when text comes", async () => {
    const h = harness();
    h.host.messages = [{ ...h.shown("u", "Question"), role: "user" }];
    await h.ready();
    h.start("m");
    h.delta("m", "Part");
    await flush();
    expect(h.client.getSnapshot().replyState).toBe("writing");
    await h.manual.advance(14000);
    expect(h.client.getSnapshot().replyState).toBe("writing");
    await h.manual.advance(1000);
    expect(h.client.getSnapshot().replyState).toBe("overdue");
    h.delta("m", " more");
    await flush();
    expect(h.client.getSnapshot().replyState).toBe("writing");
    h.client.dispose();
  });
  it("a reply read while streaming, with no text after, is overdue 15 seconds after it was read", async () => {
    const h = harness();
    h.host.messages = [
      { ...h.shown("u", "Question"), role: "user" },
      h.shown("m", "Part", "writing"),
    ];
    await h.ready();
    expect(h.client.getSnapshot().replyState).toBe("writing");
    await h.manual.advance(15000);
    expect(h.client.getSnapshot().replyState).toBe("overdue");
    h.client.dispose();
  });
});
