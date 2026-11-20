import { afterEach, expect, it, vi } from "vitest";
import type {
  ClientConfig,
  TransportEvent,
  WaypointClient,
} from "../../src/core/client";
import type { Conversation } from "../../src/protocol/generated";
import { config, createManualClock } from "../support/client";

const chunk: {
  loads: number;
  wait?: Promise<void>;
  finished?: Promise<void>;
  release?: () => void;
  fail: boolean;
} = {
  loads: 0,
  fail: false,
};
const clients = new Set<WaypointClient>();
afterEach(async () => {
  for (const client of clients) client.dispose();
  chunk.release?.();
  await chunk.finished;
  clients.clear();
  chunk.finished = undefined;
  chunk.release = undefined;
  vi.doUnmock("../../src/core/on-demand");
  vi.resetModules();
  chunk.loads = 0;
  chunk.wait = undefined;
  chunk.fail = false;
});
const ordinary = (id = "conversation-a"): Conversation => ({
  protocol: "1.0",
  id,
  title: "Chat",
  messages: [
    { id: "user", role: "user", content: "Question", blocks: [], createdAt: 0 },
  ],
});
const refused = (): Conversation => ({
  ...ordinary(),
  replyStatus: "failed",
  replyFailure: {
    id: "episode",
    recovery: { kind: "resend", messageId: "user" },
  },
});
async function load(extra: Partial<ClientConfig> = {}) {
  vi.resetModules();
  vi.doMock("../../src/core/on-demand", async (original) => {
    chunk.loads++;
    let finish!: () => void;
    chunk.finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      await chunk.wait;
      if (chunk.fail) throw new Error("observer unavailable");
      return await original();
    } finally {
      finish();
    }
  });
  const { createWaypointClient } = await import("../../src/core/client");
  const client = createWaypointClient(config(extra));
  clients.add(client);
  return client;
}

it("a legacy conversation does not load optional reply failure observation", async () => {
  const client = await load();
  await client.ready;
  expect(chunk.loads).toBe(0);
});
it("the first host failure loads its observer before publishing synchronous recovery", async () => {
  const base = config();
  const client = await load({
    transport: { ...base.transport, read: async () => refused() },
    replies: { recover: async () => {} },
  });
  await client.ready;
  expect(chunk.loads).toBe(1);
  expect(client.getSnapshot().replyFailures).toMatchObject([
    { active: true, failure: { id: "episode" } },
  ]);
  expect(client.canRetryReply()).toBe(true);
});
it("pending observer preparation leaves the previous conversation atomic", async () => {
  const base = config();
  let next = ordinary();
  const client = await load({
    transport: { ...base.transport, read: async () => next },
  });
  await client.ready;
  let release!: () => void;
  chunk.wait = new Promise<void>((resolve) => {
    release = resolve;
    chunk.release = resolve;
  });
  next = refused();
  const read = client.refresh();
  await vi.waitFor(() => expect(chunk.loads).toBe(1));
  expect(client.getSnapshot().conversation?.replyStatus).toBeUndefined();
  expect(client.getSnapshot().replyFailures).toEqual([]);
  release();
  await read;
  expect(client.getSnapshot().conversation?.replyStatus).toBe("failed");
});
it("an observer import rejection keeps the previous conversation and reports its read failure", async () => {
  const base = config();
  let next = ordinary();
  const client = await load({
    transport: { ...base.transport, read: async () => next },
  });
  await client.ready;
  chunk.fail = true;
  next = refused();
  await client.refresh();
  expect(client.getSnapshot().conversation?.replyStatus).toBeUndefined();
  expect(client.getSnapshot().problem?.id).toBe("conversation-read");
});
async function recoverChunk(): Promise<void> {
  vi.doMock("../../src/core/on-demand", async () =>
    vi.importActual<typeof import("../../src/core/on-demand")>(
      "../../src/core/on-demand",
    ),
  );
  const recovered = await import("../../src/core/on-demand");
  expect(typeof recovered.observeReplyFailure).toBe("function");
}
it("a later refresh retries an observer import after the module recovers", async () => {
  const base = config();
  chunk.fail = true;
  const client = await load({
    transport: { ...base.transport, read: async () => refused() },
    replies: { recover: async () => {} },
  });
  await client.ready;
  expect(client.getSnapshot().conversation).toBeNull();
  expect(client.getSnapshot().problem?.id).toBe("conversation-read");
  await recoverChunk();
  expect(await client.refresh()).toMatchObject({ kind: "loaded" });
  expect(client.getSnapshot().replyFailures).toMatchObject([
    { active: true, failure: { id: "episode" } },
  ]);
  expect(client.canRetryReply()).toBe(true);
});
it("a later action retries a rejected shared module after it recovers", async () => {
  const list = vi.fn(() => []);
  const client = await load({
    tabs: ["recent"],
    flowSource: {
      list,
      setFavourite: () => {},
      run: async () => ({ conversationId: "conversation-a" }),
    },
  });
  await client.ready;
  chunk.fail = true;
  await client.loadFlows();
  expect(client.getSnapshot().problem?.id).toBe("on-demand-load");
  expect(list).not.toHaveBeenCalled();
  await recoverChunk();
  await client.loadFlows();
  expect(list).toHaveBeenCalledExactlyOnceWith("recent");
  expect(client.getSnapshot().flows).toEqual({ recent: [] });
});
it.each(["switch", "dispose"] as const)(
  "%s cancels a read waiting for the observer",
  async (operation) => {
    const base = config();
    let next = ordinary();
    const client = await load({
      transport: {
        ...base.transport,
        read: async (id) => (id === "other" ? ordinary(id) : next),
      },
    });
    await client.ready;
    let release!: () => void;
    chunk.wait = new Promise<void>((resolve) => {
      release = resolve;
      chunk.release = resolve;
    });
    next = refused();
    const read = client.refresh();
    await vi.waitFor(() => expect(chunk.loads).toBe(1));
    if (operation === "switch") await client.switchConversation("other");
    else client.dispose();
    expect(await read).toMatchObject({ kind: "superseded" });
    release();
    expect(client.getSnapshot().replyFailures).toEqual([]);
  },
);
it("an aborted connection suppresses a later observer import rejection", async () => {
  const base = config();
  const manual = createManualClock();
  let next = ordinary();
  let listener!: (event: TransportEvent) => void;
  const client = await load({
    platform: { ...base.platform, clock: manual.clock },
    transport: {
      ...base.transport,
      negotiate: async () => ({
        protocol: "1.0",
        agreementId: "binding",
        capabilities: [],
      }),
      read: async () => next,
      subscribe: (_id, fn) => {
        listener = fn;
        return () => {};
      },
    },
  });
  await client.ready;
  let release!: () => void;
  chunk.wait = new Promise<void>((resolve) => {
    release = resolve;
    chunk.release = resolve;
  });
  next = refused();
  listener({ type: "status", status: "open" });
  await vi.waitFor(() => expect(chunk.loads).toBe(1));
  listener({ type: "status", status: "reconnecting" });
  chunk.fail = true;
  release();
  await vi.waitFor(() =>
    expect(client.getSnapshot().status).toBe("reconnecting"),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(client.getSnapshot().problem?.id).not.toBe("conversation-read");
  expect(client.getSnapshot().conversation?.replyStatus).toBeUndefined();
});
