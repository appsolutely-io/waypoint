import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  createMemoryStorage,
  versionWalk,
  replyRow,
} from "../../src/core/client";
import { config } from "../support/client";
it("withdrawing a known refusal restores it apart from the draft and the next send is a new message", async () => {
  const ids: string[] = [];
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        ids.push(reply.clientReplyId);
        if (ids.length === 1) throw { code: "refused", id: "p" };
        return { id: "stored" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Before");
  await client.send();
  await client.withdraw(ids[0]!);
  expect(client.getSnapshot().pending).toEqual([]);
  expect(client.getSnapshot().draft).toBe("");
  expect(client.getSnapshot().restored.map((r) => r.content)).toEqual([
    "Before",
  ]);
  await client.setDraft("Edited");
  await client.send();
  expect(ids[1]).not.toBe(ids[0]);
  client.dispose();
});
it("reply grace obeys authoritative overdue time and version navigation rejects malformed metadata", () => {
  const messages = [
    {
      id: "a",
      role: "user" as const,
      content: "Hello",
      blocks: [],
      createdAt: 0,
    },
  ];
  expect(
    replyRow({ messages, pending: [], now: 20000, overdueAt: 30000 }),
  ).toBe("writing");
  expect(
    replyRow({ messages, pending: [], now: 30000, overdueAt: 30000 }),
  ).toBe("overdue");
  expect(versionWalk({ versionCount: 3, versionIndex: 2 })).toEqual({
    index: 2,
    count: 3,
    previous: 1,
    next: 3,
  });
  expect(versionWalk({ versionCount: 3, versionIndex: 4 })).toBe(null);
});
for (const asynchronous of [false, true])
  it(`restores each conversation draft and a withdrawn message after reload (async=${asynchronous})`, async () => {
    const storage = createMemoryStorage(asynchronous);
    const base = config();
    const ids: string[] = [];
    const transport = {
      ...base.transport,
      send: async (reply: { clientReplyId: string }) => {
        ids.push(reply.clientReplyId);
        throw { id: "p", code: "refused" };
      },
    };
    const a = createWaypointClient({ ...base, storage, transport });
    await a.ready;
    await a.setDraft("First");
    await a.send();
    await a.withdraw(ids[0]!);
    a.dispose();
    const b = createWaypointClient({ ...base, storage, transport });
    await b.ready;
    expect(b.getSnapshot().restored.map((r) => r.content)).toEqual(["First"]);
    expect(b.getSnapshot().pending).toEqual([]);
    await b.setDraft("Conversation A");
    await b.switchConversation("conversation-b");
    await b.setDraft("Conversation B");
    await b.switchConversation("conversation-a");
    expect(b.getSnapshot().draft).toBe("Conversation A");
    b.dispose();
  });

for (const storage of [false, true])
  for (const acknowledged of [false, true])
    it(`keeps interrupted sends recoverable on same-id reload (storage=${storage}, acknowledged=${acknowledged})`, async () => {
      const cfg = config(storage ? { storage: createMemoryStorage(true) } : {});
      let reject!: (error: unknown) => void;
      const gate = new Promise<never>((_resolve, fail) => {
        reject = fail;
      });
      const send = vi
        .fn<typeof cfg.transport.send>()
        .mockImplementationOnce(async () => gate)
        .mockImplementation(async (reply) => ({ id: reply.clientReplyId }));
      cfg.transport.send = send;
      const client = createWaypointClient(cfg);
      await client.ready;
      await client.setDraft("Interrupted");
      const sending = client.send();
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
      const row = client.getSnapshot().pending[0]!;
      expect(row.failure).toBeNull();
      await client.setDraft("Keep new draft");
      cfg.transport.read = async (id) => ({
        protocol: "1.0",
        id,
        title: "Chat",
        messages: acknowledged
          ? [
              {
                id: "stored",
                clientMessageId: row.id,
                role: "user",
                content: row.content,
                createdAt: 100,
                blocks: [],
              },
            ]
          : [],
      });
      await client.switchConversation("conversation-a");
      if (acknowledged) expect(client.getSnapshot().pending).toEqual([]);
      else
        expect(client.getSnapshot().pending).toEqual([
          { ...row, failure: { code: "in-doubt", id: row.id } },
        ]);
      reject(new Error("Original response lost"));
      await sending;
      expect(client.getSnapshot().draft).toBe("Keep new draft");
      if (!acknowledged) {
        await client.retry(row.id);
        expect(send.mock.calls[1]![0].clientReplyId).toBe(row.id);
        expect(client.getSnapshot().pending).toEqual([]);
      } else expect(send).toHaveBeenCalledOnce();
      client.dispose();
    });
