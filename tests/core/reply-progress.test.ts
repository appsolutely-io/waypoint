// A reply that keeps arriving is being written on every transport, however
// its text arrives: as frames (SSE, fetch-stream) or through reads after a
// signal. Only 15 seconds with no progress at all makes it overdue.
import { describe, expect, it } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import {
  createFetchStreamTransport,
  createSignalTransport,
  createSseTransport,
} from "../../src/core/transports";
import type { HttpRequest } from "../../src/conformance/index";
import type { Message } from "../../src/protocol/generated";
import { config, createManualClock, flush } from "../support/client";

const transports = {
  sse: createSseTransport,
  "fetch-stream": createFetchStreamTransport,
  signal: createSignalTransport,
} as const;

function host(kind: keyof typeof transports) {
  const manual = createManualClock(1000);
  const messages: Message[] = [
    { id: "u", role: "user", content: "Question", blocks: [], createdAt: 1 },
    {
      id: "m",
      role: "assistant",
      content: "A",
      blocks: [],
      createdAt: 2,
      status: "writing",
    },
  ];
  let push: (chunk: string) => void = () => {};
  let sequence = 0;
  const request: HttpRequest = async (path) => {
    if (path === "/negotiate")
      return {
        status: 200,
        body: { protocol: "1.0", capabilities: ["plans", "widgets"] },
      };
    return {
      status: 200,
      body: {
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: structuredClone(messages),
      },
    };
  };
  const transport = transports[kind](request, {
    subscribe: (_path, onChunk, onStatus) => {
      push = onChunk;
      onStatus("open");
      return () => {};
    },
  });
  const client = createWaypointClient({
    ...config(),
    platform: { ...config().platform, clock: manual.clock },
    transport,
  });
  // One step of progress, the way this transport carries it.
  const progress = () => {
    messages[1]!.content += "b";
    const frame = {
      protocol: "1.0",
      sequence: ++sequence,
      type: "text.delta",
      messageId: "m",
      text: "b",
    };
    if (kind === "sse") push(`data: ${JSON.stringify(frame)}\n\n`);
    else if (kind === "fetch-stream") push(`${JSON.stringify(frame)}\n`);
    else push("changed\n");
  };
  return { client, manual, progress };
}

describe.each(Object.keys(transports) as (keyof typeof transports)[])(
  "a reply's progress on the %s transport",
  (kind) => {
    it("is being written while it progresses, and overdue 15 seconds after it stops", async () => {
      const h = host(kind);
      await h.manual.advance(0);
      await h.client.ready;
      await flush();
      expect(h.client.getSnapshot().replyState).toBe("writing");
      for (let step = 0; step < 6; step++) {
        await h.manual.advance(5000);
        h.progress();
        await flush();
        expect([step, h.client.getSnapshot().replyState]).toEqual([
          step,
          "writing",
        ]);
      }
      expect(
        h.client.getSnapshot().conversation?.messages.at(-1)?.content.length,
      ).toBeGreaterThan(1);
      await h.manual.advance(14000);
      expect(h.client.getSnapshot().replyState).toBe("writing");
      await h.manual.advance(1000);
      expect(h.client.getSnapshot().replyState).toBe("overdue");
      h.client.dispose();
    });
  },
);
