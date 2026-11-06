import { it, expect } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import type { TransportEvent } from "../../src/core/client";
it("token and refetch streams converge after reconnect without sharing connection maps", async () => {
  const histories = [];
  for (const tokens of [true, false]) {
    let listener: (event: TransportEvent) => void = () => {};
    let history = {
      protocol: "1.0",
      id: "conversation-a",
      title: "Chat",
      messages: [] as {
        id: string;
        role: "assistant";
        content: string;
        blocks: [];
        createdAt: number;
      }[],
    };
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async () => structuredClone(history),
        subscribe: (_id, fn) => {
          listener = fn;
          return () => {};
        },
      },
    });
    await client.ready;
    if (tokens) {
      listener({
        type: "frame",
        frame: {
          protocol: "1.0",
          sequence: 1,
          type: "message.start",
          messageId: "assistant-a",
          role: "assistant",
        },
      });
      listener({
        type: "frame",
        frame: {
          protocol: "1.0",
          sequence: 2,
          type: "text.delta",
          messageId: "assistant-a",
          text: "Partial",
        },
      });
    }
    history = {
      ...history,
      messages: [
        {
          id: "assistant-a",
          role: "assistant",
          content: "Authoritative",
          blocks: [],
          createdAt: 1,
        },
      ],
    };
    listener({ type: "status", status: "reconnecting" });
    await client.refresh();
    histories.push(client.getSnapshot().conversation);
    client.dispose();
  }
  expect(histories[0]).toEqual(histories[1]);
});

for (const id of ["conversation-a", "child"])
  it(`resets inherited stream status when selecting ${id}`, async () => {
    const cfg = config();
    const listeners: ((event: TransportEvent) => void)[] = [];
    cfg.transport.subscribe = (_id, listener) => {
      listeners.push(listener);
      return () => {};
    };
    const client = createWaypointClient(cfg);
    await client.ready;
    listeners[0]!({ type: "status", status: "open" });
    await client.refresh();
    expect(client.getSnapshot().status).toBe("open");
    await client.switchConversation(id);
    expect(client.getSnapshot().status).toBe("unsubscribed");
    listeners[0]!({ type: "status", status: "open" });
    expect(client.getSnapshot().status).toBe("unsubscribed");
    listeners[1]!({ type: "status", status: "connecting" });
    expect(client.getSnapshot().status).toBe("connecting");
    listeners[1]!({ type: "status", status: "open" });
    await client.refresh();
    expect(client.getSnapshot().status).toBe("open");
    client.dispose();
  });
