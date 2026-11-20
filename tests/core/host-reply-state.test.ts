import { afterEach, expect, it, vi } from "vitest";
import {
  createWaypointClient,
  type ClientSnapshot,
  type TransportEvent,
  type WaypointClient,
} from "../../src/core/client";
import type {
  Conversation,
  Frame,
  Message,
} from "../../src/protocol/generated";
import { config, createManualClock, flush } from "../support/client";

const clients: WaypointClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.dispose()));
const user: Message = {
  id: "u",
  role: "user",
  content: "Question",
  createdAt: 0,
  blocks: [],
};
const writer: Message = {
  id: "a",
  role: "assistant",
  content: "Partial",
  createdAt: 1,
  status: "writing",
  blocks: [],
  versionIndex: 1,
};
type HostConversation = Conversation & {
  replyOverdueFor?: string | null;
  replyOverdueVersion?: number;
  replyExpectedId?: string;
  replyLabel?: string | null;
};
function harness(fields: Partial<HostConversation> = {}, paged = false) {
  const manual = createManualClock(1000);
  let current: HostConversation = {
    protocol: "1.0",
    id: "conversation-a",
    title: "Chat",
    messages: [user],
    ...fields,
  };
  let held: Promise<void> | undefined;
  let listener: (event: TransportEvent) => void = () => {};
  let sequence = 0;
  const base = config();
  const regenerate = vi.fn(async () => {});
  const read = vi.fn(async () => {
    const snapshot = structuredClone(current);
    const gate = held;
    held = undefined;
    if (gate) await gate;
    return snapshot;
  });
  const client = createWaypointClient({
    ...base,
    platform: { ...base.platform, clock: manual.clock, ids: () => "next-user" },
    versions: { regenerate, edit: async () => {}, select: async () => {} },
    transport: {
      ...base.transport,
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: ["reply-stop"],
      }),
      read,
      ...(paged
        ? {
            readPage: async () => {
              const conversation = await read();
              return {
                conversation,
                snapshotId: JSON.stringify(conversation),
                olderCursor: null,
                heldClientMessageIds: [],
                outline: conversation.messages.map((message) => ({
                  id: message.id,
                  role: message.role,
                  sender: message.sender,
                  text: message.content,
                  revision: JSON.stringify(message),
                })),
              };
            },
          }
        : {}),
      subscribe: (_id, value) => {
        listener = value;
        return () => {};
      },
    },
  });
  clients.push(client);
  const snapshot = () =>
    client.getSnapshot() as ClientSnapshot & {
      replyPresentation?: "writing" | "waiting" | "expected";
      replyBusy?: { label?: string; overdue: boolean };
    };
  return {
    client,
    manual,
    snapshot,
    read,
    regenerate,
    set(value: Partial<HostConversation>) {
      current = { ...current, ...value };
    },
    frame(value: Record<string, unknown>) {
      listener({
        type: "frame",
        frame: { protocol: "1.0", sequence: ++sequence, ...value } as Frame,
      });
    },
    status(status: "open" | "reconnecting") {
      listener({ type: "status", status });
    },
    hold() {
      let release!: () => void;
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

it.each([
  ["expected with empty history shows the busy row", []],
  [
    "expected at mount after a completed assistant offers no writer controls",
    [{ ...writer, status: "completed" }],
  ],
] as const)("%s", async (_name, messages) => {
  const h = harness({
    messages: [...messages],
    replyStatus: "expected",
    replyLabel: "Discussing",
  });
  await h.client.ready;
  expect(h.snapshot().replyState).toBe("expected");
  expect(h.snapshot().replyBusy).toEqual({
    label: "Discussing",
    overdue: false,
  });
  expect(h.client.canStopReply()).toBe(false);
  expect(h.manual.pending()).toBe(0);
});

it("expected ignores an old user timestamp", async () => {
  const h = harness({ replyStatus: "expected" });
  await h.client.ready;
  await h.manual.advance(60000);
  expect(h.snapshot().replyState).toBe("expected");
  expect(h.manual.pending()).toBe(0);
});

it.each([
  [
    "a matching user owner applies the host deadline without the legacy floor",
    [user],
    "u",
    1,
    "overdue",
  ],
  [
    "read messages without versionIndex use version one",
    [user],
    "u",
    1,
    "overdue",
  ],
  [
    "an older user owner does not control the current user wait",
    [user],
    "previous",
    1,
    "writing",
  ],
  [
    "an unowned user deadline retains the legacy 15-second floor",
    [user],
    null,
    undefined,
    "writing",
  ],
  [
    "a matching writer owner stays overdue while text streams",
    [user, writer],
    "a",
    1,
    "overdue",
  ],
  [
    "an older writer owner does not control the current writer",
    [user, writer],
    "previous",
    1,
    "writing",
  ],
  [
    "an unowned writer deadline keeps the content stall",
    [user, writer],
    null,
    undefined,
    "writing",
  ],
  [
    "a regenerated writer is not overdue from its previous version's owned deadline",
    [user, { ...writer, versionIndex: 2 }],
    "a",
    1,
    "writing",
  ],
] as const)("%s", async (_name, messages, owner, version, expected) => {
  const h = harness({
    messages: [...messages],
    replyOverdueFor: owner,
    replyOverdueVersion: version,
    replyOverdueAt: 500,
  });
  await h.client.ready;
  expect(h.snapshot().replyState).toBe(expected);
  if (owner === "a" && version === 1 && messages.at(-1)?.versionIndex === 1) {
    h.frame({ type: "text.delta", messageId: "a", text: " more" });
    await flush();
    expect(h.snapshot().replyState).toBe("overdue");
    expect(h.client.canStopReply()).toBe(true);
  }
});

it.each([
  [
    "a matching expected owner applies its host deadline",
    "episode",
    "expected-overdue",
  ],
  [
    "an older expected owner does not control the current busy episode",
    "old-episode",
    "expected",
  ],
  [
    "an unowned expected deadline does not start an overdue timer",
    null,
    "expected",
  ],
  ["a user-tail owner cannot time an expected episode", "u", "expected"],
] as const)("%s", async (_name, owner, expected) => {
  const h = harness({
    replyStatus: "expected",
    replyExpectedId: "episode",
    replyOverdueFor: owner,
    replyOverdueVersion: 1,
    replyOverdueAt: 500,
  });
  await h.client.ready;
  expect(h.snapshot().replyState).toBe(expected);
  expect(h.manual.pending()).toBe(0);
});

it("a matching future writer deadline suppresses the content stall", async () => {
  const h = harness({
    messages: [user, writer],
    replyOverdueFor: "a",
    replyOverdueVersion: 1,
    replyOverdueAt: 50000,
  });
  await h.client.ready;
  await h.manual.advance(20000);
  expect(h.snapshot().replyState).toBe("writing");
  await h.manual.advance(29000);
  expect(h.snapshot().replyState).toBe("overdue");
});

it("host deadline extension cancels the old timer", async () => {
  const h = harness({
    messages: [user, writer],
    replyOverdueFor: "a",
    replyOverdueVersion: 1,
    replyOverdueAt: 3000,
  });
  await h.client.ready;
  h.set({ replyOverdueAt: 9000 });
  await h.client.refresh();
  await h.manual.advance(2000);
  expect(h.snapshot().replyState).toBe("writing");
  await h.manual.advance(6000);
  expect(h.snapshot().replyState).toBe("overdue");
});

it("disposing a writer removes its reply timer", async () => {
  const h = harness({
    messages: [user, writer],
    replyOverdueFor: "a",
    replyOverdueVersion: 1,
    replyOverdueAt: 3000,
  });
  await h.client.ready;
  expect(h.manual.pending()).toBe(1);
  h.client.dispose();
  expect(h.manual.pending()).toBe(0);
});

it("expected reported during an active writer keeps reply Stop and shows the host busy row", async () => {
  const h = harness({
    messages: [user, writer],
    replyStatus: "expected",
    replyExpectedId: "episode",
    replyLabel: "Discussing",
    replyOverdueFor: "episode",
    replyOverdueAt: 2000,
  });
  await h.client.ready;
  expect(h.snapshot().replyState).toBe("writing");
  expect(h.snapshot().replyBusy).toEqual({
    label: "Discussing",
    overdue: false,
  });
  expect(h.client.canStopReply()).toBe(true);
  await h.manual.advance(1000);
  expect(h.snapshot().replyState).toBe("writing");
  expect(h.snapshot().replyBusy?.overdue).toBe(false);
  h.set({ messages: [user, { ...writer, status: "completed" }] });
  await h.client.refresh();
  expect(h.snapshot().replyState).toBe("expected-overdue");
});

it("a read after the writer start may report the same expected episode", async () => {
  const h = harness({
    replyStatus: "expected",
    replyExpectedId: "episode",
    replyLabel: "Discussing",
  });
  await h.client.ready;
  const release = h.hold();
  const before = h.client.refresh();
  await flush();
  h.frame({
    type: "message.start",
    messageId: "b",
    role: "assistant",
    versionIndex: 1,
  });
  h.frame({ type: "text.delta", messageId: "b", text: "New answer" });
  await flush();
  release();
  expect((await before).kind).toBe("loaded");
  expect(h.snapshot().replyBusy).toBeUndefined();
  expect(h.snapshot().conversation?.messages.at(-1)).toMatchObject({
    id: "b",
    status: "writing",
    content: "New answer",
  });
  expect(h.client.canStopReply()).toBe(true);
  h.set({ messages: [user, { ...writer, id: "b", content: "New answer" }] });
  await h.client.refresh();
  expect(h.snapshot().replyBusy).toEqual({
    label: "Discussing",
    overdue: false,
  });
  expect(h.snapshot().replyState).toBe("writing");
});

it("a completion read for an earlier turn does not silence a newer user message", async () => {
  const h = harness({ replyStatus: "complete" });
  await h.client.ready;
  expect(h.snapshot().replyState).toBe("none");
  const release = h.hold();
  const read = h.client.refresh();
  await flush();
  h.frame({ type: "message.start", messageId: "u2", role: "user" });
  await flush();
  release();
  expect((await read).kind).toBe("loaded");
  expect(h.snapshot().conversation?.messages.at(-1)?.id).toBe("u2");
  expect(h.snapshot().replyState).toBe("writing");
  h.set({ messages: [user, { ...user, id: "u2" }] });
  await h.client.refresh();
  expect(h.snapshot().replyState).toBe("none");
});

it.each([false, true])(
  "an older read keeps a message started after it was issued (%s)",
  async (empty) => {
    const h = harness({ messages: empty ? [] : [user] });
    await h.client.ready;
    const release = h.hold();
    const read = h.client.refresh();
    await flush();
    h.frame({
      type: "message.start",
      messageId: "b",
      role: "assistant",
      versionIndex: 1,
    });
    h.frame({ type: "text.delta", messageId: "b", text: "Complete text" });
    await flush();
    release();
    expect((await read).kind).toBe("loaded");
    expect(h.snapshot().conversation?.messages.at(-1)).toMatchObject({
      id: "b",
      status: "writing",
      content: "Complete text",
    });
    expect(h.client.canStopReply()).toBe(true);
  },
);

it.each(["whole", "paged"])(
  "a read whose snapshot already contains streamed text does not duplicate it (%s)",
  async (mode) => {
    const h = harness({ messages: [user, writer] }, mode === "paged");
    await h.client.ready;
    h.set({ messages: [user, { ...writer, content: "Partial more" }] });
    const release = h.hold();
    const read = h.client.refresh();
    await flush();
    h.frame({ type: "text.delta", messageId: "a", text: " more" });
    await flush();
    release();
    await read;
    expect(h.snapshot().conversation?.messages.at(-1)?.content).toBe(
      "Partial more",
    );
  },
);

it.each(["whole", "paged"])(
  "a read supplies fields the newer frame did not write (%s)",
  async (mode) => {
    const h = harness({ messages: [user, writer] }, mode === "paged");
    await h.client.ready;
    h.set({ messages: [user, { ...writer, versionCount: 4 }] });
    const release = h.hold();
    const read = h.client.refresh();
    await flush();
    h.frame({ type: "text.delta", messageId: "a", text: " more" });
    await flush();
    release();
    await read;
    expect(h.snapshot().conversation?.messages.at(-1)).toMatchObject({
      content: "Partial more",
      versionCount: 4,
    });
  },
);

it.each(["whole", "paged"])(
  "a read issued after a frame replaces the included overlay (%s)",
  async (mode) => {
    const h = harness({ messages: [user, writer] }, mode === "paged");
    await h.client.ready;
    h.frame({ type: "text.delta", messageId: "a", text: " more" });
    await flush();
    h.set({ messages: [user, { ...writer, content: "Authoritative" }] });
    await h.client.refresh();
    expect(h.snapshot().conversation?.messages.at(-1)?.content).toBe(
      "Authoritative",
    );
  },
);

it("a deadline frame applied after read issuance survives adoption", async () => {
  const h = harness({ messages: [user, writer] });
  await h.client.ready;
  const release = h.hold();
  const read = h.client.refresh();
  await flush();
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    versionIndex: 2,
    replyOverdueFor: "a",
    replyOverdueAt: 500,
  });
  await flush();
  release();
  await read;
  expect(h.snapshot().conversation).toMatchObject({
    replyOverdueFor: "a",
    replyOverdueAt: 500,
    replyOverdueVersion: 2,
  });
  expect(h.snapshot().replyState).toBe("overdue");
});

it("a versionless start keeps the current stream version unknown", async () => {
  const h = harness({ messages: [user, writer] });
  await h.client.ready;
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    replyOverdueFor: "a",
    replyOverdueAt: 500,
  });
  await flush();
  expect(h.snapshot().replyState).toBe("writing");
  await h.client.stopReply();
});

it.each(["expected", "writing", "restart", "user", "user-expected"] as const)(
  "a Keep waiting hold does not carry into a new writer (%s)",
  async (kind) => {
    const isUser = kind === "user" || kind === "user-expected";
    const h = harness(
      kind === "expected"
        ? {
            replyStatus: "expected",
            replyExpectedId: "episode",
            replyOverdueFor: "episode",
            replyOverdueAt: 500,
          }
        : {
            messages: isUser ? [user] : [user, writer],
            replyOverdueFor: isUser ? "u" : "a",
            replyOverdueVersion: 1,
            replyOverdueAt: 500,
          },
    );
    await h.client.ready;
    h.client.keepWaiting();
    if (kind === "user-expected") {
      h.set({
        replyStatus: "expected",
        replyExpectedId: "next",
        replyOverdueFor: "next",
        replyOverdueAt: 500,
      });
      await h.client.refresh();
      expect(h.snapshot().replyState).toBe("expected-overdue");
    } else if (kind === "user") {
      const id = "next-user";
      h.set({
        messages: [user, { ...user, id, clientMessageId: id }],
        replyOverdueFor: id,
        replyOverdueVersion: 1,
        replyOverdueAt: 6000,
      });
      await h.client.setDraft("Another question");
      await h.client.send();
      await h.manual.advance(5000);
      expect(h.snapshot().replyState).toBe("overdue");
    } else {
      const id = kind === "restart" ? "a" : "b";
      h.frame({
        type: "message.start",
        messageId: id,
        role: "assistant",
        versionIndex: kind === "restart" ? 2 : 1,
        replyOverdueFor: id,
        replyOverdueAt: 500,
      });
      await flush();
      expect(h.snapshot().replyState).toBe("overdue");
      expect(h.client.canStopReply()).toBe(true);
    }
  },
);

it("same-owner Keep waiting survives reads and text progress", async () => {
  const h = harness({
    messages: [user, writer],
    replyOverdueFor: "a",
    replyOverdueVersion: 1,
    replyOverdueAt: 500,
  });
  await h.client.ready;
  h.client.keepWaiting();
  await h.client.refresh();
  h.frame({ type: "text.delta", messageId: "a", text: " more" });
  await flush();
  expect(h.snapshot().replyState).toBe("writing");
  await h.manual.advance(15000);
  expect(h.snapshot().replyState).toBe("overdue");
});

it("a matching frame updates the writer deadline without waiting for a read", async () => {
  const h = harness({
    messages: [user, writer],
    replyOverdueFor: "a",
    replyOverdueVersion: 1,
    replyOverdueAt: 500,
  });
  await h.client.ready;
  const release = h.hold();
  h.frame({
    type: "stale",
    reads: ["conversation"],
    replyOverdueFor: "a",
    replyOverdueAt: 5000,
    versionIndex: 1,
  });
  await flush();
  expect(h.snapshot().conversation?.replyOverdueAt).toBe(5000);
  expect(h.snapshot().replyState).toBe("writing");
  release();
  await flush();
});
it("an explicit null frame deadline restores the content stall", async () => {
  const h = harness({
    messages: [user, writer],
    replyOverdueFor: "a",
    replyOverdueVersion: 1,
    replyOverdueAt: 500,
  });
  await h.client.ready;
  h.set({ replyOverdueAt: null });
  h.frame({
    type: "stale",
    reads: ["conversation"],
    replyOverdueFor: "a",
    replyOverdueAt: null,
    versionIndex: 1,
  });
  await flush();
  expect(h.snapshot().replyState).toBe("writing");
  await h.manual.advance(15000);
  expect(h.snapshot().replyState).toBe("overdue");
});
it.each([undefined, 1, 1.5, "2", 0])(
  "a hint without a version cannot move a regenerated writer's deadline (%s)",
  async (version) => {
    const h = harness({
      messages: [user, { ...writer, versionIndex: 2 }],
      replyOverdueFor: "a",
      replyOverdueVersion: 2,
      replyOverdueAt: 50000,
    });
    await h.client.ready;
    h.frame({
      type: "stale",
      reads: ["conversation"],
      replyOverdueFor: "a",
      replyOverdueAt: 500,
      versionIndex: version,
    });
    await flush();
    expect(h.snapshot().conversation?.replyOverdueAt).toBe(50000);
    expect(h.snapshot().replyState).toBe("writing");
  },
);
it("malformed frame deadline fields are ignored at runtime", async () => {
  const h = harness({ messages: [user, writer] });
  await h.client.ready;
  h.frame({
    type: "message.start",
    messageId: "b",
    role: "assistant",
    versionIndex: 1.5,
    replyOverdueFor: 5,
    replyOverdueAt: "past",
  });
  await flush();
  expect(h.snapshot().conversation?.messages.at(-1)?.id).toBe("b");
  expect(h.snapshot().replyState).toBe("writing");
  expect(h.snapshot().conversation?.replyOverdueAt).toBeUndefined();
});
it("valid frame fields survive boundary normalization", async () => {
  const h = harness();
  await h.client.ready;
  h.frame({
    type: "message.start",
    messageId: "b",
    role: "assistant",
    versionIndex: 3,
    replyOverdueFor: "b",
    replyOverdueAt: 500,
  });
  await flush();
  expect(h.snapshot().conversation?.messages.at(-1)?.versionIndex).toBe(3);
  expect(h.snapshot().replyState).toBe("overdue");
});
it("malformed read busy and recovery fields are treated as absent", async () => {
  const h = harness();
  h.set({
    replyLabel: 5,
    replyExpectedId: {},
    replyStatus: "unknown",
    replyOverdueFor: {},
    replyOverdueVersion: -1,
    replyOverdueAt: Number.POSITIVE_INFINITY,
    replyFailure: { id: false },
  } as unknown as Partial<HostConversation>);
  await h.client.ready;
  expect(h.snapshot().replyBusy).toBeUndefined();
  expect(h.snapshot().replyState).toBe("writing");
  expect(h.snapshot().conversation).toMatchObject({
    replyStatus: undefined,
    replyLabel: undefined,
    replyExpectedId: undefined,
    replyOverdueAt: undefined,
    replyOverdueFor: undefined,
    replyOverdueVersion: undefined,
    replyFailure: undefined,
  });
});
it("busy failure and recovery payloads arrive only through conversation reads", async () => {
  const h = harness();
  await h.client.ready;
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    versionIndex: 1,
    replyStatus: "expected",
    replyExpectedId: "episode",
    replyLabel: "Injected",
    replyFailure: { id: "injected", recovery: { kind: "none" } },
  });
  await flush();
  expect(h.snapshot().replyBusy).toBeUndefined();
  expect(h.snapshot().conversation?.replyFailure).toBeUndefined();
  h.set({
    messages: [user, writer],
    replyStatus: "expected",
    replyExpectedId: "episode",
    replyLabel: "Read label",
  });
  await h.client.refresh();
  expect(h.snapshot().replyBusy).toEqual({
    label: "Read label",
    overdue: false,
  });
});
it.each(["failed", "unavailable", "expected", "complete"] as const)(
  "frame-cleared reply fields are not restored by an older read (%s)",
  async (status) => {
    const h = harness({
      replyStatus: status,
      replyLabel: "Previous label",
      replyExpectedId: "episode",
      replyFailure: {
        id: "failure",
        forMessageId: "u",
        reason: { code: "availability" },
        recovery: { kind: "none" },
      },
    });
    await h.client.ready;
    const release = h.hold();
    const read = h.client.refresh();
    await flush();
    h.frame({
      type: "message.start",
      messageId: "b",
      role: "assistant",
      versionIndex: 1,
    });
    await flush();
    release();
    expect((await read).kind).toBe("loaded");
    expect(h.snapshot().conversation).toMatchObject({
      replyStatus: undefined,
      replyFailure: undefined,
      replyLabel: undefined,
      replyExpectedId: undefined,
    });
    expect(h.snapshot().replyState).toBe("writing");
    expect(h.client.canStopReply()).toBe(true);
  },
);
it("a versionless start does not reuse the previous owned deadline", async () => {
  const h = harness({
    messages: [user, writer],
    replyOverdueFor: "a",
    replyOverdueVersion: 1,
    replyOverdueAt: 500,
  });
  await h.client.ready;
  expect(h.snapshot().replyState).toBe("overdue");
  h.frame({ type: "message.start", messageId: "a", role: "assistant" });
  await flush();
  expect(h.snapshot().replyState).toBe("writing");
});
it("a conversation-failed writing reply never shows writing-overdue copy", async () => {
  const h = harness({
    messages: [user, writer],
    replyStatus: "failed",
    replyFailure: {
      id: "failure",
      forMessageId: "a",
      recovery: { kind: "regenerate", messageId: "a" },
    },
  });
  await h.client.ready;
  await h.manual.advance(60000);
  expect(h.snapshot().replyState).toBe("failed");
  expect(h.snapshot().replyPresentation).toBeUndefined();
  expect(h.client.canStopReply()).toBe(false);
  expect(h.manual.pending()).toBe(0);
});
it("sending while expected preserves the host busy label and control", async () => {
  const h = harness({ replyStatus: "expected", replyLabel: "Discussing" });
  await h.client.ready;
  await h.client.setDraft("Another question");
  await h.client.send();
  expect(h.snapshot().replyState).toBe("expected");
  expect(h.snapshot().replyBusy).toEqual({
    label: "Discussing",
    overdue: false,
  });
});
it("absent replyStatus keeps inferred waiting", async () => {
  const h = harness();
  await h.client.ready;
  expect(h.snapshot().replyState).toBe("writing");
  await h.manual.advance(14000);
  expect(h.snapshot().replyState).toBe("overdue");
});
it("overdue Regenerate calls versions for the active writer", async () => {
  const h = harness({
    messages: [user, writer],
    replyOverdueFor: "a",
    replyOverdueVersion: 1,
    replyOverdueAt: 500,
  });
  await h.client.ready;
  await h.client.retryReply();
  expect(h.regenerate).toHaveBeenCalledOnce();
});

it.each(["user", "writer", "expected"] as const)(
  "two tabs with confirmed tails and settled sends resolve the same deadline owner (%s)",
  async (owner) => {
    const fields: Partial<HostConversation> = {
      messages: owner === "writer" ? [user, writer] : [user],
      replyOverdueFor:
        owner === "writer" ? "a" : owner === "user" ? "u" : "episode",
      replyOverdueVersion: owner === "expected" ? undefined : 1,
      replyStatus: owner === "expected" ? "expected" : undefined,
      replyExpectedId: owner === "expected" ? "episode" : undefined,
      replyOverdueAt: 3000,
    };
    const first = harness(fields);
    const second = harness(fields);
    await Promise.all([first.client.ready, second.client.ready]);
    expect(first.snapshot().pending).toEqual([]);
    expect(second.snapshot().pending).toEqual([]);
    expect(first.snapshot().replyState).toBe(second.snapshot().replyState);
    await first.manual.advance(2500);
    await second.manual.advance(2500);
    const overdue = owner === "expected" ? "expected-overdue" : "overdue";
    expect(first.snapshot().replyState).toBe(overdue);
    expect(second.snapshot().replyState).toBe(overdue);
    const reloaded = harness(fields);
    await reloaded.client.ready;
    await reloaded.manual.advance(2500);
    expect(reloaded.snapshot().replyState).toBe(overdue);
    expect(reloaded.snapshot().conversation?.replyOverdueAt).toBe(3000);
  },
);

it("an older read does not restore the previous version's blocks under a restarted reply", async () => {
  const old = {
    ...writer,
    blocks: [
      { id: "old-block", type: "unknown", fallback: "Old answer", body: {} },
    ],
  };
  const h = harness({ messages: [user, old] });
  await h.client.ready;
  h.set({ messages: [user, { ...old, versionCount: 7 }] });
  const release = h.hold();
  const read = h.client.refresh();
  await flush();
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    versionIndex: 2,
  });
  h.frame({ type: "text.delta", messageId: "a", text: "New answer" });
  await flush();
  release();
  expect((await read).kind).toBe("loaded");
  expect(h.snapshot().conversation?.messages.at(-1)).toMatchObject({
    content: "New answer",
    blocks: [],
    versionIndex: 2,
    versionCount: 7,
    status: "writing",
  });
});

it.each(["end", "stale", "open", "reconnecting"] as const)(
  "end stale and reconnect keep their existing refresh paths (%s)",
  async (event) => {
    const h = harness({ messages: [user, writer] });
    await h.client.ready;
    const release = h.hold();
    const previous = h.client.refresh();
    await flush();
    const before = h.read.mock.calls.length;
    if (event === "end") h.frame({ type: "message.end", messageId: "a" });
    else if (event === "stale") h.frame({ type: "stale", reads: [] });
    else h.status(event);
    await flush();
    expect(h.read.mock.calls.length).toBe(before + 1);
    release();
    await previous;
  },
);

it("a reconnect read superseding another preserves newer frame overlays", async () => {
  const h = harness({ messages: [user, writer] });
  await h.client.ready;
  const releaseFirst = h.hold();
  const first = h.client.refresh();
  await flush();
  const releaseSecond = h.hold();
  const before = h.read.mock.calls.length;
  h.status("reconnecting");
  await flush();
  expect(h.read.mock.calls.length).toBe(before + 1);
  h.frame({ type: "text.delta", messageId: "a", text: " newer" });
  await flush();
  releaseFirst();
  await flush();
  expect(h.snapshot().conversation?.messages.at(-1)?.content).toBe(
    "Partial newer",
  );
  releaseSecond();
  expect((await first).kind).toBe("loaded");
  expect(h.snapshot().conversation?.messages.at(-1)?.content).toBe(
    "Partial newer",
  );
});

it("a host-completed turn ending in a notice does not wait for a reply", async () => {
  const h = harness({
    replyStatus: "complete",
    messages: [
      user,
      {
        id: "notice",
        role: "notice",
        content: "Request accepted",
        blocks: [],
        createdAt: 2,
      },
    ],
  });
  await h.client.ready;
  await h.manual.advance(60000);
  expect(h.snapshot().replyState).toBe("none");
  expect(h.manual.pending()).toBe(0);
});
it("expected with only notices shows the busy row", async () => {
  const h = harness({
    replyStatus: "expected",
    replyLabel: "Discussing",
    messages: [
      {
        id: "notice",
        role: "notice",
        content: "Request accepted",
        blocks: [],
        createdAt: 2,
      },
    ],
  });
  await h.client.ready;
  await h.manual.advance(60000);
  expect(h.snapshot().replyState).toBe("expected");
  expect(h.snapshot().replyBusy).toEqual({
    label: "Discussing",
    overdue: false,
  });
  expect(h.client.canStopReply()).toBe(false);
  expect(h.manual.pending()).toBe(0);
});
