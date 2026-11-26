// The reads the host asks for while it writes a reply are shown as steps,
// named in the host's words, until the user's next message.
import { it, expect, vi } from "vitest";
import {
  createMemoryStorage,
  createWaypointClient,
  type ClientConfig,
  type TransportEvent,
} from "../../src/core/client";
import type {
  Conversation,
  Frame,
  ManifestEntry,
  ToolCall,
} from "../../src/protocol/generated";
import { config, flush } from "../support/client";
import samples from "../protocol/samples.json";

async function setup(request: (call: ToolCall) => Promise<unknown>) {
  const base = config();
  let listener!: (event: TransportEvent) => void;
  const client = createWaypointClient({
    ...base,
    reads: { manifest: [samples.ManifestEntry as ManifestEntry], request },
    transport: {
      ...base.transport,
      subscribe: (_id, fn) => {
        listener = fn;
        return () => {};
      },
    },
  } as ClientConfig);
  await client.ready;
  let sequence = 0;
  const call = (value: Partial<ToolCall>) =>
    listener({
      type: "frame",
      frame: {
        type: "tool.call",
        protocol: "1.0",
        sequence: ++sequence,
        call: { ...(samples.ToolCall as ToolCall), ...value },
      },
    });
  return { client, call };
}

async function hostChat(
  messages?: Conversation["messages"],
  extra: Partial<ClientConfig> = {},
) {
  const cfg = config();
  let listener!: (event: TransportEvent) => void;
  let conversation: Conversation = {
    protocol: "1.2",
    id: "conversation-a",
    title: "Chat",
    messages: messages ?? [
      { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
      {
        id: "a",
        role: "assistant",
        content: "",
        blocks: [],
        createdAt: 1,
        status: "writing",
      },
    ],
  };
  const send = vi.fn(async () => ({ id: "sent" }));
  const read = vi.fn(async () => conversation);
  const client = createWaypointClient({
    ...cfg,
    ...extra,
    transport: {
      ...cfg.transport,
      negotiate: async () => ({ protocol: "1.2", capabilities: [] }),
      read,
      send,
      subscribe: (_id, fn) => {
        listener = fn;
        return () => {};
      },
    },
  });
  await client.ready;
  let sequence = 0;
  const receive = listener;
  const frame = (value: Record<string, unknown>) =>
    receive({
      type: "frame",
      frame: {
        protocol: "1.2",
        sequence: ++sequence,
        ...value,
      } as Frame,
    });
  return {
    client,
    frame,
    send,
    read,
    replace: (value: Conversation) => {
      conversation = value;
    },
    step: (step: unknown, messageId = "a") =>
      frame({ type: "step", messageId, step }),
  };
}

it("displays host work without a reads adapter, answer or problem", async () => {
  const { client, step, send, read } = await hostChat();
  step({
    id: "one",
    label: "Reading orders",
    status: "running",
    ignored: true,
  });
  step({ id: "two", status: "failed" });
  step({ id: "one", label: "Orders read", status: "done" });
  expect(client.getSnapshot().toolSteps).toEqual([
    { id: "one", label: "Orders read", status: "done" },
    { id: "two", status: "failed" },
  ]);
  expect(client.getSnapshot().problem).toBeNull();
  expect(send).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledOnce();
  client.dispose();
});

it("drops malformed display input and ineligible targets without changing the reply", async () => {
  const { client, frame, step, send } = await hostChat();
  for (const value of [
    null,
    {},
    { id: "", status: "done" },
    { id: "s", status: "future" },
  ])
    step(value);
  for (const id of ["missing", "u"]) step({ id: "s", status: "done" }, id);
  step({ id: "s", label: "x".repeat(201), status: "running" });
  expect(client.getSnapshot().toolSteps).toEqual([
    { id: "s", status: "running" },
  ]);
  frame({ type: "message.end", messageId: "a", status: "completed" });
  step({ id: "late", status: "done" });
  expect(client.getSnapshot().toolSteps).toHaveLength(1);
  expect(client.getSnapshot().problem).toBeNull();
  expect(send).not.toHaveBeenCalled();
  client.dispose();
});

it.each([false, true])(
  "distinguishes invalid step envelopes from invalid payload ordering (%s)",
  async (badEnvelope) => {
    const { client, frame } = await hostChat();
    frame({
      type: "step",
      sequence: 100,
      messageId: badEnvelope ? "" : "a",
      step: { id: "s", status: "bad" },
    });
    frame({ type: "text.delta", sequence: 11, messageId: "a", text: "new" });
    expect(client.getSnapshot().conversation?.messages.at(-1)?.content).toBe(
      badEnvelope ? "new" : "",
    );
    expect(client.getSnapshot().problem).toBeNull();
    client.dispose();
  },
);

it("normalizes read steps, deduplicates in place and limits display to the latest user turn", async () => {
  const msg = (
    id: string,
    role: "assistant" | "user" | "notice",
    steps: unknown,
  ) => ({ id, role, content: "", blocks: [], createdAt: 0, steps });
  const messages = [
    msg("old", "assistant", [{ id: "old", status: "done" }]),
    msg("u", "user", [{ id: "user", status: "done" }]),
    msg("a", "assistant", [
      null,
      { id: "s", status: "running" },
      { id: "t", status: "failed", label: "" },
      { id: "s", status: "done", extra: true },
    ]),
    msg("notice", "notice", [{ id: "notice", status: "done" }]),
  ] as Conversation["messages"];
  const { client, replace } = await hostChat(messages);
  expect(client.getSnapshot().toolSteps).toEqual([
    { id: "s", status: "done" },
    { id: "t", status: "failed" },
  ]);
  const original = client.getSnapshot().conversation!;
  replace({
    ...original,
    messages: original.messages.map((m) => ({ ...m, steps: [] })),
  } as Conversation);
  await client.refresh();
  expect(client.getSnapshot().toolSteps).toEqual([]);
  expect(client.getSnapshot().problem).toBeNull();
  client.dispose();
});

it("keeps a host value ahead of a colliding local tool completion", async () => {
  let release!: (value: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { client, frame, step } = await hostChat(undefined, {
    reads: { manifest: [samples.ManifestEntry as ManifestEntry], request },
  });
  frame({
    type: "tool.call",
    call: { ...samples.ToolCall, id: "s", label: "Local" },
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  step({ id: "s", label: "Host", status: "failed" });
  release({ title: "A" });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps).toEqual([
      { id: "s", label: "Host", status: "failed" },
    ]),
  );
  client.dispose();
});

it("does not repopulate old steps after a new user send and late tool completion", async () => {
  let release!: (value: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { client, frame, step } = await hostChat(undefined, {
    reads: { manifest: [samples.ManifestEntry as ManifestEntry], request },
  });
  frame({ type: "tool.call", call: { ...samples.ToolCall, id: "local" } });
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  step({ id: "host", status: "done" });
  await client.setDraft("Next");
  await client.send();
  release({ title: "A" });
  await client.refresh();
  expect(client.getSnapshot().toolSteps).toEqual([]);
  client.dispose();
});

it("keeps a new send's running tool when its user message is confirmed by a read", async () => {
  let release!: (value: unknown) => void;
  const request = vi.fn(() => new Promise((resolve) => (release = resolve)));
  const { client, frame, send, replace } = await hostChat(undefined, {
    reads: { manifest: [samples.ManifestEntry as ManifestEntry], request },
  });
  send.mockImplementationOnce(async () => {
    const clientMessageId = client.getSnapshot().pending[0]!.id;
    frame({ type: "message.start", messageId: "next-a", role: "assistant" });
    frame({ type: "tool.call", call: { ...samples.ToolCall, id: "new-tool" } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    const before = client.getSnapshot().conversation!;
    replace({
      ...before,
      messages: [
        ...before.messages.filter((message) => message.id !== "next-a"),
        {
          id: "next-u",
          clientMessageId,
          role: "user",
          content: "Next",
          blocks: [],
          createdAt: 2,
        },
        before.messages.find((message) => message.id === "next-a")!,
      ],
    });
    return { id: "sent" };
  });
  await client.setDraft("Next");
  await client.send();
  // The queued row leaves with its delivery; its frames settle after.
  await flush();
  expect(client.getSnapshot().toolSteps).toEqual([
    { id: "new-tool", status: "running" },
  ]);
  release({ title: "A" });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps).toEqual([
      { id: "new-tool", status: "done" },
    ]),
  );
  client.dispose();
});

it.each([
  ["outbox", false, false],
  ["outbox", true, false],
  ["reply", false, false],
  ["reply", true, false],
  ["reply", false, true],
  ["replyOutcome", false, true],
] as const)(
  "keeps a restored message's tool through %s retry confirmation and completion (%s, replay %s)",
  async (path, repeatRetry, replayConfirmed) => {
    const storage = createMemoryStorage();
    const original = await hostChat(undefined, { storage });
    original.send.mockRejectedValueOnce({ code: "refused" });
    await original.client.setDraft("Restored question");
    await original.client.send();
    // The refusal settles after the send resolves; the reload below reads it.
    await flush();
    const id = original.client.getSnapshot().pending[0]!.id;
    original.client.dispose();

    let release!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => (release = resolve)));
    const { client, frame, send, replace } = await hostChat(undefined, {
      storage,
      reads: { manifest: [samples.ManifestEntry as ManifestEntry], request },
    });
    expect(client.getSnapshot().pending[0]).toMatchObject({
      id,
      failure: { code: "refused" },
    });
    const running = [{ id: "retried-tool", status: "running" }];
    send.mockImplementationOnce(async () => {
      frame({
        type: "tool.call",
        call: { ...samples.ToolCall, id: "retried-tool" },
      });
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      if (repeatRetry) throw { code: "retryable" };
      return { id: "sent" };
    });
    const before = client.getSnapshot().conversation!;
    const confirmed: Conversation = {
      ...before,
      messages: [
        ...before.messages,
        {
          id: "retried-user",
          clientMessageId: id,
          role: "user",
          content: "Restored question",
          blocks: [],
          createdAt: 2,
        },
        {
          id: "retried-reply",
          role: "assistant",
          content: "",
          status: "writing",
          blocks: [],
          createdAt: 3,
        },
      ],
    };
    const retry = () => {
      if (path === "outbox") return client.retry(id);
      const message = {
        kind: "message",
        clientReplyId: id,
        clientMessageId: id,
        content: "Restored question",
      } as const;
      return path === "reply"
        ? client.reply(message)
        : client.replyOutcome(message);
    };
    if (!repeatRetry) replace(confirmed);
    await retry();
    // The retried row is queued; its frames and the read that follows
    // settle after.
    await vi.waitFor(() => expect(client.getSnapshot().sending).toBe(false));
    if (repeatRetry) {
      expect(client.getSnapshot().toolSteps).toEqual(running);
      send.mockImplementationOnce(async () => {
        expect(client.getSnapshot().toolSteps).toEqual(running);
        return { id: "sent" };
      });
      replace(confirmed);
      await retry();
      await vi.waitFor(() => expect(client.getSnapshot().sending).toBe(false));
    }
    await vi.waitFor(() =>
      expect(client.getSnapshot().conversation?.messages.at(-2)?.id).toBe(
        "retried-user",
      ),
    );
    expect(client.getSnapshot().toolSteps).toEqual(running);
    if (replayConfirmed) {
      await retry();
      await flush();
      expect(client.getSnapshot().toolSteps).toEqual(running);
      expect(request).toHaveBeenCalledOnce();
    }
    release({ title: "A" });
    await vi.waitFor(() =>
      expect(client.getSnapshot().toolSteps).toEqual([
        { id: "retried-tool", status: "done" },
      ]),
    );
    client.dispose();
  },
);

it.each(["1.3", "1.10"])(
  "keeps steps read under a newer compatible protocol (%s)",
  async (protocol) => {
    const { client, replace } = await hostChat();
    const before = client.getSnapshot().conversation!;
    replace({
      ...before,
      protocol,
      messages: before.messages.map((message) =>
        message.id === "a"
          ? { ...message, steps: [{ id: "compatible", status: "done" }] }
          : message,
      ),
    });
    await client.refresh();
    expect(client.getSnapshot().toolSteps).toEqual([
      { id: "compatible", status: "done" },
    ]);
    client.dispose();
  },
);

it("preserves frame steps across an older read and lets a later read replace them", async () => {
  const { client, frame, step, read, replace } = await hostChat();
  const original = client.getSnapshot().conversation!;
  let finish!: (value: Conversation) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const refresh = client.refresh();
  step({ id: "s", status: "done" });
  finish(original);
  await refresh;
  expect(client.getSnapshot().toolSteps).toEqual([{ id: "s", status: "done" }]);
  replace(original);
  await client.refresh();
  expect(client.getSnapshot().toolSteps).toEqual([]);
  step({ id: "old", status: "running" });
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const nextRead = client.refresh();
  frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    versionIndex: 2,
  });
  finish({
    ...original,
    messages: original.messages.map((m) =>
      m.id === "a" ? { ...m, steps: [{ id: "old", status: "running" }] } : m,
    ),
  });
  await nextRead;
  expect(client.getSnapshot().toolSteps).toEqual([]);
  client.dispose();
});

it("keeps steps display-only in a form-bound conversation", async () => {
  const { client, replace, step, send } = await hostChat();
  replace({ ...client.getSnapshot().conversation!, mode: "form-fill" });
  await client.refresh();
  step({ id: "form", status: "done" });
  expect(client.getSnapshot().toolSteps).toEqual([
    { id: "form", status: "done" },
  ]);
  expect(client.getSnapshot().problem).toBeNull();
  expect(send).not.toHaveBeenCalled();
  client.dispose();
});

it("drops a previous subscription's steps after switching conversation", async () => {
  const { client, step } = await hostChat();
  step({ id: "s", status: "done" });
  await client.switchConversation("other");
  step({ id: "late", status: "done" });
  expect(client.getSnapshot().toolSteps).toEqual([]);
  client.dispose();
});

it("clears local steps on navigation even when neither conversation has a user message", async () => {
  const request = vi.fn(async () => ({ title: "A" }));
  const { client, frame } = await hostChat([], {
    reads: { manifest: [samples.ManifestEntry as ManifestEntry], request },
  });
  frame({ type: "tool.call", call: { ...samples.ToolCall, id: "local" } });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps).toHaveLength(1),
  );
  await client.switchConversation("other");
  expect(client.getSnapshot().toolSteps).toEqual([]);
  client.dispose();
});

it("names each read as a step that runs, then is done", async () => {
  let release = () => {};
  const { client, call } = await setup(
    () => new Promise((resolve) => (release = () => resolve({ title: "A" }))),
  );
  expect(client.getSnapshot().toolSteps).toEqual([]);
  call({ id: "one", label: "Reading 3 orders…" });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps).toEqual([
      { id: "one", label: "Reading 3 orders…", status: "running" },
    ]),
  );
  release();
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps[0]?.status).toBe("done"),
  );
  client.dispose();
});

it("marks a read that failed, and keeps a step without a label", async () => {
  const { client, call } = await setup(async () => {
    throw new Error("down");
  });
  call({ id: "two" });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps).toEqual([
      { id: "two", status: "failed" },
    ]),
  );
  client.dispose();
});

it("forgets the steps when the user sends the next message", async () => {
  const { client, call } = await setup(async () => ({ title: "A" }));
  call({ id: "three", label: "Reading" });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps[0]?.status).toBe("done"),
  );
  await client.setDraft("Next");
  await client.send();
  expect(client.getSnapshot().toolSteps).toEqual([]);
  client.dispose();
});
