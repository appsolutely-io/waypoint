import { it, expect } from "vitest";
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
