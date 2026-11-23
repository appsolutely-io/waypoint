import { it, expect, vi } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import type { Conversation } from "../../src/protocol/generated";
import { decodeFrames, createSignalTransport } from "../../src/core/transports";
import type { TransportEvent } from "../../src/core/client";
async function* chunks(values: string[]) {
  for (const value of values) yield value;
}
it("decodes SSE multiline/CRLF/chunk boundaries and NDJSON last line", async () => {
  const frame = {
    protocol: "1.0",
    type: "text.delta",
    messageId: "a",
    sequence: 1,
    text: "你好",
  };
  for (const format of ["sse", "ndjson"] as const) {
    const raw =
      format === "sse"
        ? `data: ${JSON.stringify(frame)}\r\n\r\n`
        : JSON.stringify(frame);
    const output = [];
    for await (const value of decodeFrames(
      chunks([raw.slice(0, 14), raw.slice(14)]),
      format,
    ))
      output.push(value);
    expect(output).toEqual([frame]);
  }
});
it.each(["sse", "ndjson"] as const)(
  "drops malformed step envelopes while decoding %s",
  async (format) => {
    const values = [
      { type: "step", sequence: 1, messageId: "a" },
      { type: "step", protocol: "1.2", sequence: -1, messageId: "a" },
      { type: "step", protocol: "1.2", sequence: 1, messageId: "", step: null },
      {
        type: "step",
        protocol: "1.2",
        sequence: 2,
        messageId: "a",
        step: { id: "s", status: "done" },
      },
    ];
    const raw = values
      .map((v) =>
        format === "sse"
          ? `data: ${JSON.stringify(v)}\n\n`
          : `${JSON.stringify(v)}\n`,
      )
      .join("");
    const result = [];
    for await (const frame of decodeFrames(chunks([raw]), format))
      result.push(frame);
    expect(result).toEqual([values.at(-1)]);
    await expect(async () => {
      for await (const frame of decodeFrames(
        chunks([format === "sse" ? "data: {\n\n" : "{\n"]),
        format,
      ))
        void frame;
    }).rejects.toThrow();
  },
);

it.each(["sse", "ndjson"] as const)(
  "rejects malformed ordinary envelopes while decoding %s",
  async (format) => {
    for (const value of [
      null,
      [],
      1,
      { type: "text.delta", sequence: 1 },
      { type: "text.delta", protocol: "1.2", sequence: 1.5 },
      { protocol: "1.2", sequence: 1 },
    ]) {
      const json = JSON.stringify(value);
      await expect(async () => {
        for await (const frame of decodeFrames(
          chunks([format === "sse" ? `data: ${json}\n\n` : `${json}\n`]),
          format,
        ))
          void frame;
      }).rejects.toThrow("Invalid frame");
    }
  },
);

it("signal reads restore host steps and a fresh client reloads them without answering", async () => {
  let push!: (chunk: string) => void;
  let conversation: Conversation = {
    protocol: "1.2",
    id: "conversation-a",
    title: "Chat",
    messages: [],
  };
  const requests: string[] = [];
  const transport = createSignalTransport(
    async (url) => {
      requests.push(url);
      return {
        status: 200,
        body:
          url === "/negotiate"
            ? { protocol: "1.2", capabilities: [] }
            : conversation,
      };
    },
    {
      subscribe: (_url, chunk) => {
        push = chunk;
        return () => {};
      },
    },
  );
  const client = createWaypointClient(config({ transport }));
  await client.ready;
  conversation = {
    ...conversation,
    messages: [
      {
        id: "a",
        role: "assistant",
        content: "Answer",
        blocks: [],
        createdAt: 0,
        steps: [{ id: "s", status: "done", label: "Read orders" }],
      },
    ],
  };
  push(
    '{"type":"step","messageId":"a","step":{"id":"untrusted","status":"failed"}}\n',
  );
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps).toEqual(
      conversation.messages[0]!.steps,
    ),
  );
  expect(client.getSnapshot().problem).toBeNull();
  expect(
    requests.every(
      (url) => url === "/negotiate" || url === "/conversations/conversation-a",
    ),
  ).toBe(true);
  client.dispose();
  const reloaded = createWaypointClient(config({ transport }));
  await reloaded.ready;
  expect(reloaded.getSnapshot().toolSteps).toEqual(
    conversation.messages[0]!.steps,
  );
  expect(reloaded.getSnapshot().problem).toBeNull();
  reloaded.dispose();
});

it("a signal transport turns every line into an invalidate hint, never a frame", () => {
  const events: TransportEvent[] = [];
  let push!: (chunk: string) => void;
  const transport = createSignalTransport(
    async () => ({ status: 200, body: {} }),
    {
      subscribe: (_path, onChunk) => {
        push = onChunk;
        return () => {};
      },
    },
  );
  transport.subscribe("conversation-a", (event) => events.push(event));
  push(
    '{"protocol":"1.0","sequence":1,"type":"message.start","messageId":"m","role":"assistant"}\nchanged\n\n',
  );
  expect(events).toEqual([{ type: "invalidate" }, { type: "invalidate" }]);
});
