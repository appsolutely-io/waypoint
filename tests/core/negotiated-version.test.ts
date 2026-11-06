import { it, expect, vi } from "vitest";
vi.mock("../../src/protocol/index", async (original) => ({
  ...(await original<object>()),
  SUPPORTED_PROTOCOLS: ["1.1"],
}));
import {
  createWaypointClient,
  type TransportEvent,
} from "../../src/core/client";
import { config } from "../support/client";
it("frames and outgoing replies use the selected protocol version", async () => {
  const base = config();
  let listener!: (event: TransportEvent) => void;
  const protocols: string[] = [];
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      negotiate: async () => ({ protocol: "1.1", capabilities: [] }),
      subscribe: (_id, fn) => {
        listener = fn;
        return () => {};
      },
      send: async (reply) => {
        protocols.push(reply.protocol);
        return { id: reply.clientReplyId };
      },
    },
  });
  await client.ready;
  listener({
    type: "frame",
    frame: {
      type: "problem",
      protocol: "1.1",
      sequence: 1,
      problem: { code: "refused", id: "frame-a" },
    },
  });
  expect(client.getSnapshot().problem?.code).toBe("refused");
  await client.setDraft("Hello");
  await client.send();
  expect(protocols).toEqual(["1.1"]);
  client.dispose();
});
it("widget replies built before readiness receive the negotiated protocol at dispatch", async () => {
  const base = config();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const protocols: string[] = [];
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      negotiate: async () => {
        await gate;
        return { protocol: "1.1", capabilities: [] };
      },
      send: async (reply) => {
        protocols.push(reply.protocol);
        return { id: reply.clientReplyId };
      },
    },
  });
  const reply = {
    kind: "action" as const,
    clientReplyId: "early-widget",
    blockId: "block-a",
    actionId: "action-a",
  };
  const sending = client.reply(reply);
  release();
  expect(await sending).toBe(true);
  expect(protocols).toEqual(["1.1"]);
  expect(reply).not.toHaveProperty("protocol");
  client.dispose();
});
