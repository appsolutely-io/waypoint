import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ManifestEntry,
  Reply,
  ToolCall,
} from "../../src/protocol/generated";
import type { ClientConfig, TransportEvent } from "../../src/core/client";
import samples from "../protocol/samples.json";

const chunk: {
  fail: boolean;
  loads: number;
  wait?: Promise<void>;
  request?: Promise<void>;
} = {
  fail: false,
  loads: 0,
};
// Far more loads than any case here makes. A client that keeps loading
// again (a failed batch gating itself) gets a load that never settles past
// this, which ends the loop: the case's load count then fails it instead of
// the run hanging.
const RUNAWAY_LOADS = 32;

function setup(
  createWaypointClient: (
    config: ClientConfig,
  ) => ReturnType<typeof import("../../src/core/client").createWaypointClient>,
  config: () => ClientConfig,
  protocol = "1.0",
) {
  let listener!: (event: TransportEvent) => void;
  const replies: Reply[] = [];
  const requests: string[] = [];
  const base = config();
  if (protocol !== "1.0") {
    base.transport.negotiate = async () => ({ protocol, capabilities: [] });
    const read = base.transport.read;
    base.transport.read = async (...args) => ({
      ...(await read(...args)),
      protocol,
    });
  }
  const client = createWaypointClient({
    ...base,
    reads: {
      manifest: [samples.ManifestEntry as ManifestEntry],
      request: async (call) => {
        requests.push(call.id);
        await chunk.request;
        return { title: "Safe" };
      },
    },
    transport: {
      ...base.transport,
      subscribe: (_id, fn) => {
        listener = fn;
        return () => {};
      },
      send: async (reply) => {
        replies.push(reply);
        return { id: reply.clientReplyId };
      },
    },
  });
  let sequence = 0;
  const frame = (value: Record<string, unknown>) =>
    listener({
      type: "frame",
      frame: { protocol, sequence: ++sequence, ...value } as never,
    });
  return { client, replies, requests, frame };
}

describe("the stream read handlers chunk", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/reads-impl");
    vi.resetModules();
    chunk.fail = false;
    chunk.loads = 0;
    chunk.wait = undefined;
    chunk.request = undefined;
  });
  async function load(protocol = "1.0") {
    vi.resetModules();
    vi.doMock("../../src/core/reads-impl", async (original) => {
      if (++chunk.loads > RUNAWAY_LOADS) return new Promise<never>(() => {});
      await chunk.wait;
      if (chunk.fail) throw new Error("chunk unavailable");
      return await original();
    });
    const { createWaypointClient } = await import("../../src/core/client");
    const { config } = await import("../support/client");
    return setup(createWaypointClient, config, protocol);
  }

  it.each([false, true])(
    "keeps host steps behind a prior lazy read without answering them (%s)",
    async (fail) => {
      let release!: () => void;
      chunk.wait = new Promise((resolve) => {
        release = resolve;
      });
      let finish!: () => void;
      chunk.request = new Promise((resolve) => {
        finish = resolve;
      });
      chunk.fail = fail;
      const { client, frame, replies } = await load("1.2");
      await client.ready;
      frame({ type: "tool.call", call: { ...samples.ToolCall, id: "local" } });
      frame({ type: "message.start", messageId: "a", role: "assistant" });
      frame({
        type: "step",
        messageId: "a",
        step: { id: "host", status: "done" },
      });
      expect(client.getSnapshot().toolSteps).toEqual([]);
      release();
      await vi.waitFor(() =>
        expect(
          client.getSnapshot().toolSteps.some((s) => s.id === "host"),
        ).toBe(true),
      );
      expect(
        replies.every((r) => r.kind !== "tool-result" || r.callId === "local"),
      ).toBe(true);
      expect(client.getSnapshot().problem?.id).not.toBe("frame-dispatch");
      client.dispose();
      finish();
    },
  );

  it("is not loaded until a read frame arrives", async () => {
    const { client, frame } = await load();
    await client.ready;
    frame({ type: "message.start", messageId: "m", role: "assistant" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(chunk.loads).toBe(0);
    client.dispose();
  });

  it("answers read frames in arrival order once loaded", async () => {
    const { client, frame, replies } = await load();
    await client.ready;
    frame({ type: "tool.call", call: { ...samples.ToolCall, id: "first" } });
    frame({ type: "tool.call", call: { ...samples.ToolCall, id: "second" } });
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(
      replies.map((reply) => (reply as { callId: string }).callId),
    ).toEqual(["first", "second"]);
    client.dispose();
  });

  it("a failed load is a retryable problem, later frames still apply, and a retry answers the failed frame once", async () => {
    chunk.fail = true;
    const { client, frame, replies } = await load();
    await client.ready;
    frame({ type: "tool.call", call: samples.ToolCall as ToolCall });
    frame({ type: "message.start", messageId: "m", role: "assistant" });
    await vi.waitFor(() =>
      expect(client.getSnapshot().problem).toEqual({
        code: "retryable",
        id: "stream-reads-load",
      }),
    );
    expect(chunk.loads).toBe(1);
    expect(replies).toHaveLength(0);
    expect(
      client.getSnapshot().conversation?.messages.some((m) => m.id === "m"),
    ).toBe(true);
    chunk.fail = false;
    await client.refresh();
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(client.getSnapshot().problem).toBeNull();
    await client.refresh();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(replies).toHaveLength(1);
    client.dispose();
  });

  it("a failed read batch loads once, and one later read retries the retained batch once", async () => {
    chunk.fail = true;
    const { client, frame } = await load();
    await client.ready;
    let release!: () => void;
    chunk.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (let i = 0; i < 3; i++)
      frame({
        type: "tool.call",
        call: { ...samples.ToolCall, id: `first-${i}` },
      });
    await vi.waitFor(() => expect(chunk.loads).toBe(1));
    release();
    await vi.waitFor(() =>
      expect(client.getSnapshot().problem?.id).toBe("stream-reads-load"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chunk.loads).toBe(1);
    frame({ type: "tool.call", call: { ...samples.ToolCall, id: "next" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chunk.loads).toBe(2);
    frame({ type: "message.start", messageId: "m", role: "assistant" });
    frame({ type: "text.delta", messageId: "m", text: "Still responsive" });
    expect(
      client.getSnapshot().conversation?.messages.find((m) => m.id === "m")
        ?.content,
    ).toBe("Still responsive");
    client.dispose();
  });

  it("a failed read batch is reported once, and each failed retry once more", async () => {
    chunk.fail = true;
    const { client, frame } = await load();
    await client.ready;
    let problems = 0;
    client.on((event) => {
      if (event.type === "problem" && event.problemId === "stream-reads-load")
        problems++;
    });
    const announced = client.getSnapshot().announcement;
    let release!: () => void;
    chunk.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (let i = 0; i < 3; i++)
      frame({
        type: "tool.call",
        call: { ...samples.ToolCall, id: `batch-${i}` },
      });
    await vi.waitFor(() => expect(chunk.loads).toBe(1));
    release();
    await vi.waitFor(() =>
      expect(client.getSnapshot().problem?.id).toBe("stream-reads-load"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(problems).toBe(1);
    expect(client.getSnapshot().announcement).toBe(announced + 1);
    // A retry that fails again is said again, once.
    await client.refresh();
    await vi.waitFor(() => expect(chunk.loads).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(problems).toBe(2);
    expect(client.getSnapshot().announcement).toBe(announced + 2);
    client.dispose();
  });

  it("a delta cannot overtake a read in the same tick while its chunk is held", async () => {
    const { client, frame, replies, requests } = await load();
    await client.ready;
    frame({ type: "message.start", messageId: "m", role: "assistant" });
    let release!: () => void;
    chunk.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observed: { text: string; reads: number }[] = [];
    client.subscribe(() =>
      observed.push({
        text:
          client.getSnapshot().conversation?.messages.find((m) => m.id === "m")
            ?.content ?? "",
        reads: requests.length,
      }),
    );
    frame({ type: "tool.call", call: { ...samples.ToolCall, id: "held" } });
    frame({ type: "text.delta", messageId: "m", text: "After read" });
    await vi.waitFor(() => expect(chunk.loads).toBe(1));
    expect(observed.every((entry) => entry.text === "")).toBe(true);
    expect(replies).toHaveLength(0);
    release();
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(observed.find((entry) => entry.text === "After read")?.reads).toBe(
      1,
    );
    client.dispose();
  });

  it("a successful chunk retry preserves a different current problem", async () => {
    chunk.fail = true;
    const { client, frame, replies } = await load();
    await client.ready;
    frame({ type: "tool.call", call: samples.ToolCall });
    await vi.waitFor(() =>
      expect(client.getSnapshot().problem?.id).toBe("stream-reads-load"),
    );
    client.report({ code: "refused", id: "other" });
    chunk.fail = false;
    await client.refresh();
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(client.getSnapshot().problem).toEqual({
      code: "refused",
      id: "other",
    });
    client.dispose();
  });

  it("failed frames wait for a new read frame or a refresh, never retrying each other", async () => {
    chunk.fail = true;
    const { client, frame } = await load();
    await client.ready;
    frame({ type: "tool.call", call: { ...samples.ToolCall, id: "first" } });
    frame({ type: "tool.call", call: { ...samples.ToolCall, id: "second" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chunk.loads).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chunk.loads).toBe(1);
    client.dispose();
  }, 2000);

  it("keeps the latest sixteen failed frames and drops the oldest", async () => {
    chunk.fail = true;
    const { client, frame, replies } = await load();
    await client.ready;
    let release!: () => void;
    chunk.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (let i = 0; i < 17; i++)
      frame({
        type: "tool.call",
        call: { ...samples.ToolCall, id: `call-${i}` },
      });
    await vi.waitFor(() => expect(chunk.loads).toBe(1));
    release();
    await vi.waitFor(() =>
      expect(client.getSnapshot().problem?.id).toBe("stream-reads-load"),
    );
    chunk.fail = false;
    await client.refresh();
    await vi.waitFor(() => expect(replies).toHaveLength(16));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const answered = replies.map(
      (reply) => (reply as { callId: string }).callId,
    );
    expect(answered).toHaveLength(16);
    expect(answered).not.toContain("call-0");
    expect(answered[15]).toBe("call-16");
    client.dispose();
  }, 5000);

  it("a kept failed frame is not answered after a switch", async () => {
    chunk.fail = true;
    const { client, frame, replies } = await load();
    await client.ready;
    frame({ type: "tool.call", call: samples.ToolCall as ToolCall });
    await vi.waitFor(() =>
      expect(client.getSnapshot().problem?.id).toBe("stream-reads-load"),
    );
    chunk.fail = false;
    await client.switchConversation("conversation-b");
    await client.refresh();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(replies).toHaveLength(0);
    client.dispose();
  });
});
