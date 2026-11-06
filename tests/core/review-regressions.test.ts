import { it, expect } from "vitest";
import {
  createWaypointClient,
  type TransportEvent,
} from "../../src/core/client";
import type {
  PlanRecord,
  Conversation,
  ImmediatePlan,
} from "../../src/protocol/generated";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
for (const failure of ["unsupported", "rejected"])
  it(`blocks outgoing actions after ${failure} negotiation`, async () => {
    const base = config();
    let sent = 0;
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        negotiate: async () => {
          if (failure === "rejected") throw new Error("offline");
          return { protocol: "9.0", capabilities: [] };
        },
        send: async () => {
          sent++;
          return { id: "unexpected" };
        },
      },
    });
    await client.ready;
    await client.setDraft("Keep");
    await client.send();
    expect(
      await client.reply({
        kind: "action",
        protocol: "1.0",
        clientReplyId: "reply-a",
        blockId: "block-a",
        actionId: "action-a",
      }),
    ).toBe(false);
    expect(sent).toBe(0);
    expect(client.getSnapshot().draft).toBe("Keep");
    expect(client.getSnapshot().problem?.code).toBe(
      failure === "rejected" ? "unavailable" : "update-required",
    );
    client.dispose();
  });
for (const source of ["stream", "resume", "runner"])
  it(`clears plans and ignores late ${source} records after a conversation switch`, async () => {
    const base = config();
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    let listener!: (event: TransportEvent) => void;
    let release!: (value: PlanRecord) => void;
    let entered!: () => void;
    const pending = new Promise<PlanRecord>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        subscribe: (_id, fn) => {
          listener = fn;
          return () => {};
        },
      },
      plans: {
        read: () => {
          entered();
          return pending;
        },
        resume: () => {
          entered();
          return pending;
        },
        heartbeat: async () => {},
        stop: async () => record,
        request: async () => {},
      },
    });
    await client.ready;
    client.setPlan(record);
    let operation: Promise<void> | undefined;
    if (source === "stream")
      listener({
        type: "frame",
        frame: {
          protocol: "1.0",
          sequence: 1,
          type: "plan.final",
          messageId: "assistant-a",
          plan: record.plan as ImmediatePlan,
        },
      });
    else if (source === "resume") operation = client.resumePlan();
    else operation = client.runPlan(record.id, "plan-digest");
    await started;
    await client.switchConversation("conversation-b");
    expect(client.getSnapshot().plan).toBeNull();
    release(record);
    await operation;
    await Promise.resolve();
    expect(client.getSnapshot().plan).toBeNull();
    client.dispose();
  });
it("version retries keep identity only for identical payloads", async () => {
  const base = config();
  const ids: string[] = [];
  const history: Conversation = {
    protocol: "1.0",
    id: "conversation-a",
    title: "Chat",
    messages: [
      {
        id: "user-a",
        role: "user",
        content: "Before",
        blocks: [],
        createdAt: 0,
      },
    ],
  };
  const client = createWaypointClient({
    ...base,
    transport: { ...base.transport, read: async () => history },
    versions: {
      edit: async (input) => {
        ids.push(input.clientReplyId);
        throw new Error("retry");
      },
      regenerate: () => {},
      select: () => {},
    },
  });
  await client.ready;
  await client.editMessage("user-a", "First");
  await client.editMessage("user-a", "First");
  await client.editMessage("user-a", "Second");
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).not.toBe(ids[0]);
  client.dispose();
});
it("a late reply failure cannot report into a different conversation", async () => {
  const base = config();
  let reject!: (error: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: () => {
        entered();
        return new Promise((_resolve, fail) => {
          reject = fail;
        });
      },
    },
  });
  await client.ready;
  const reply = client.reply({
    kind: "action",
    protocol: "1.0",
    clientReplyId: "reply-a",
    blockId: "block-a",
    actionId: "action-a",
  });
  await started;
  await client.switchConversation("conversation-b");
  reject({ code: "refused", id: "old-reply" });
  expect(await reply).toBe(false);
  expect(client.getSnapshot().problem).toBeNull();
  client.dispose();
});
