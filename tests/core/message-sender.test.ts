import { afterEach, expect, it, vi } from "vitest";
import {
  createWaypointClient,
  type TransportEvent,
  type WaypointClient,
} from "../../src/core/client";
import type {
  Conversation,
  Frame,
  Message,
} from "../../src/protocol/generated";
import { CAPABILITIES, negotiate } from "../../src/protocol/index";
import { config, createManualClock } from "../support/client";

const clients: WaypointClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.dispose()));
const sender = { id: "reviewer", name: "Reviewer", avatarUrl: "/reviewer.png" };
const user: Message = {
  id: "u",
  role: "user",
  content: "Question",
  blocks: [],
  createdAt: 0,
};
const assistant: Message = {
  id: "a",
  role: "assistant",
  content: "Partial",
  blocks: [],
  createdAt: 1,
  status: "writing",
  versionIndex: 1,
};
const notice = {
  id: "n",
  role: "notice",
  content: "Review started",
  blocks: [],
  createdAt: 2,
  versionIndex: 1,
  versionCount: 2,
} as Message;
function harness(messages: Message[] = [], fields: Partial<Conversation> = {}) {
  const base = config();
  const clock = createManualClock(1000);
  let current: Conversation = {
    protocol: "1.0",
    id: "conversation-a",
    title: "Chat",
    messages,
    ...fields,
  };
  let receive: (event: TransportEvent) => void = () => {};
  let sequence = 0;
  const versions = {
    regenerate: vi.fn(async () => {}),
    edit: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
  };
  const feedback = { send: vi.fn(async () => {}) };
  const send = vi.fn(base.transport.send);
  const client = createWaypointClient({
    ...base,
    versions,
    feedback,
    platform: { ...base.platform, clock: clock.clock },
    transport: {
      ...base.transport,
      send,
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: ["reply-stop", "notice-messages"],
      }),
      read: async () => structuredClone(current),
      subscribe: (_id, listener) => {
        receive = listener;
        return () => {};
      },
    },
  });
  clients.push(client);
  return {
    client,
    clock,
    versions,
    feedback,
    send,
    set(value: Partial<Conversation>) {
      current = { ...current, ...value };
    },
    frame(value: Record<string, unknown>) {
      receive({
        type: "frame",
        frame: { protocol: "1.0", sequence: ++sequence, ...value } as Frame,
      });
    },
  };
}

it("sender survives streamed creation and updates", async () => {
  const h = harness();
  await h.client.ready;
  h.frame({ type: "message.start", messageId: "a", role: "assistant", sender });
  expect(h.client.getSnapshot().conversation?.messages[0]).toMatchObject({
    sender,
  });
  const next = { ...sender, name: "Editor" };
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    sender: next,
  });
  h.frame({ type: "text.delta", messageId: "a", text: "Updated" });
  expect(h.client.getSnapshot().conversation?.messages[0]).toMatchObject({
    sender: next,
    content: "Updated",
  });
});
it("sender survives authoritative reads and version selection", async () => {
  const h = harness([
    { ...assistant, sender, status: "completed", versionCount: 2 } as Message,
  ]);
  await h.client.ready;
  h.set({
    messages: [
      {
        ...assistant,
        sender: { ...sender, name: "Editor" },
        status: "completed",
        versionIndex: 2,
        versionCount: 2,
      } as Message,
    ],
  });
  await h.client.selectVersion("a", 2);
  expect(h.versions.select).toHaveBeenCalledOnce();
  expect(h.client.getSnapshot().conversation?.messages[0]).toMatchObject({
    sender: { ...sender, name: "Editor" },
    versionIndex: 2,
  });
});
it("malformed frame sender and deadline fields are ignored at runtime", async () => {
  const h = harness();
  await h.client.ready;
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    sender: { id: "reviewer", name: 5 },
    replyOverdueAt: "bad",
    replyOverdueFor: 5,
    versionIndex: -1,
  });
  expect(h.client.getSnapshot().conversation?.messages[0]).not.toHaveProperty(
    "sender",
  );
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    sender: { ...sender, avatarUrl: 5 },
  });
  expect(h.client.getSnapshot().conversation?.messages[0]).toHaveProperty(
    "sender",
    { id: sender.id, name: sender.name },
  );
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    sender: { ...sender, name: "x".repeat(81) },
  });
  expect(h.client.getSnapshot().conversation?.messages[0]).toHaveProperty(
    "sender",
    { id: sender.id, name: sender.name },
  );
});
it("valid frame fields survive boundary normalization", async () => {
  const h = harness();
  await h.client.ready;
  h.frame({
    type: "message.start",
    messageId: "a",
    role: "assistant",
    sender,
    versionIndex: 2,
    replyOverdueAt: 500,
    replyOverdueFor: "a",
  });
  expect(h.client.getSnapshot().conversation?.messages[0]).toMatchObject({
    sender,
    versionIndex: 2,
  });
  expect(h.client.getSnapshot().replyState).toBe("overdue");
});
it("a notice never starts an inferred reply", async () => {
  const h = harness([notice]);
  await h.client.ready;
  await h.clock.advance(30000);
  expect(h.client.getSnapshot().replyState).toBe("none");
  expect(h.clock.pending()).toBe(0);
});
it.each([
  [user, "writing", false],
  [assistant, "writing", true],
] as const)(
  "a notice preserves an existing user's wait and writer Stop (%s)",
  async (message, state, stop) => {
    const h = harness([message, notice]);
    await h.client.ready;
    expect(h.client.getSnapshot().replyState).toBe(state);
    expect(h.client.canStopReply()).toBe(stop);
  },
);
it("notice cannot postpone a stalled assistant", async () => {
  const h = harness([assistant]);
  await h.client.ready;
  await h.clock.advance(10000);
  h.frame({ type: "message.start", messageId: "n", role: "notice", sender });
  h.frame({ type: "text.delta", messageId: "n", text: "Still reviewing" });
  await h.clock.advance(5000);
  expect(h.client.getSnapshot().replyState).toBe("overdue");
  expect(h.client.canStopReply()).toBe(true);
});
it("notice roles cannot edit regenerate rate stop or select versions", async () => {
  const h = harness([notice]);
  await h.client.ready;
  await h.client.editMessage("n", "Edited");
  await h.client.regenerate("n");
  await h.client.selectVersion("n", 2);
  expect(await h.client.sendFeedback("n", "positive")).toBe(false);
  await h.client.stopReply();
  expect(h.versions.edit).not.toHaveBeenCalled();
  expect(h.versions.regenerate).not.toHaveBeenCalled();
  expect(h.versions.select).not.toHaveBeenCalled();
  expect(h.feedback.send).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
});
it("notice capability negotiation excludes notices for older clients", () => {
  expect(CAPABILITIES).toContain("notice-messages");
  expect(
    negotiate(["1.0"], ["notice-messages"], { capabilities: [] }).capabilities,
  ).not.toContain("notice-messages");
  expect(
    negotiate(["1.0"], ["notice-messages"], {
      capabilities: ["notice-messages"],
    }).capabilities,
  ).toContain("notice-messages");
});
