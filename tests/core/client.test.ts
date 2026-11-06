import { it, expect, describe } from "vitest";
import {
  createWaypointClient,
  createMemoryStorage,
} from "../../src/core/client";
import { config } from "../support/client";
for (const asynchronous of [false, true])
  describe(`storage async=${asynchronous}`, () => {
    it("keeps drafts and unsettled sends isolated and reloads them", async () => {
      const storage = createMemoryStorage(asynchronous);
      const a = createWaypointClient(config({ storage }));
      await a.ready;
      await a.setDraft("Keep");
      const b = createWaypointClient(config({ storage }));
      await b.ready;
      expect(b.getSnapshot().draft).toBe("Keep");
      const other = createWaypointClient(
        config({ accountId: "account-b", storage }),
      );
      await other.ready;
      expect(other.getSnapshot().draft).toBe("");
      a.dispose();
      b.dispose();
      other.dispose();
    });
    it("same-id retry reconciles uncertain delivery without losing edits", async () => {
      let calls = 0;
      const ids: string[] = [];
      const base = config();
      const storage = createMemoryStorage(asynchronous);
      const client = createWaypointClient({
        ...base,
        storage,
        transport: {
          ...base.transport,
          send: async (reply) => {
            ids.push(reply.clientReplyId);
            if (calls++ === 0) throw { code: "in-doubt", id: "p" };
            return { id: "stored" };
          },
        },
      });
      await client.ready;
      await client.setDraft("Keep");
      await client.send();
      expect(client.getSnapshot().pending[0]?.failure?.code).toBe("in-doubt");
      await client.retry(ids[0]!);
      expect(ids[1]).toBe(ids[0]);
      client.dispose();
    });
  });
it("veto preserves draft; contributions hold then augment; events contain only ids in fixed order", async () => {
  const events: unknown[] = [];
  let hold = true;
  const received: unknown[] = [];
  const base = config();
  const client = createWaypointClient({
    ...base,
    beforeSend: async () => (hold ? false : undefined),
    contributions: [
      {
        id: "fixture",
        evaluate: () => ({
          hold: hold ? "Wait" : undefined,
          hint: "Hint",
          payload: { fixture: "field value" },
        }),
      },
    ],
    transport: {
      ...base.transport,
      send: async (reply) => {
        received.push(reply);
        return { id: "stored" };
      },
    },
  });
  await client.ready;
  client.on((event) => events.push(event));
  await client.setDraft("Private field value");
  await client.send();
  expect(client.getSnapshot().draft).toBe("Private field value");
  hold = false;
  await client.send();
  expect(received).toHaveLength(1);
  expect((received[0] as { extensions: unknown }).extensions).toEqual({
    fixture: { fixture: "field value" },
  });
  expect(events.map((e) => (e as { type: string }).type)).toEqual(["send"]);
  expect(JSON.stringify(events)).not.toContain("value");
  client.dispose();
});
it("two clients share no streams, failures or announcement counters", async () => {
  const a = createWaypointClient(config());
  const b = createWaypointClient(config());
  await Promise.all([a.ready, b.ready]);
  await a.setDraft("Only A");
  expect(b.getSnapshot().draft).toBe("");
  a.report({ code: "refused", id: "p" });
  expect(b.getSnapshot().announcement).toBe(0);
  a.dispose();
  b.dispose();
});
it("unknown capabilities are off; late reads cannot cross conversations", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      negotiate: async () => ({ protocol: "1.0", capabilities: ["future"] }),
    },
  });
  await client.ready;
  expect(client.getSnapshot().capabilities).toEqual([]);
  client.dispose();
});
it("observe-only listeners cannot veto a send by throwing", async () => {
  let sent = 0;
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async () => {
        sent++;
        return { id: "stored" };
      },
    },
  });
  await client.ready;
  client.on(() => {
    throw new Error("observer");
  });
  await client.setDraft("Keep");
  await client.send();
  expect(sent).toBe(1);
  expect(client.getSnapshot().draft).toBe("");
  client.dispose();
});
