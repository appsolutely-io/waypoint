// The load `npm run perf` puts on the playground: a history of the size
// asked for before the conversation's own messages, and one streamed reply
// of about the tokens asked for at the rate asked for.
import { expect, it } from "vitest";
import { longMarkdown, perfTurn, withPerf } from "../../playground/perf";
import type { Conversation } from "../../src/protocol/generated";

const conversation: Conversation = {
  protocol: "1.0",
  id: "a",
  title: "A",
  messages: [
    {
      id: "own",
      role: "user",
      content: "Hello",
      blocks: [],
      createdAt: 1,
      status: "completed",
    },
  ],
};

it("puts the history asked for before the conversation's own messages", () => {
  const shown = withPerf(conversation, 200);
  expect(shown.messages).toHaveLength(201);
  expect(shown.messages.at(-1)!.id).toBe("own");
  expect(new Set(shown.messages.map((message) => message.id)).size).toBe(201);
  const blockIds = shown.messages.flatMap((message) =>
    message.blocks.map((block) => block.id),
  );
  expect(new Set(blockIds).size).toBe(blockIds.length);
  expect(withPerf(conversation, 0)).toBe(conversation);
});

it("streams about the tokens asked for, four a piece, at the rate asked for", () => {
  const turn = perfTurn(15_000, 200);
  const text = turn.chunks!.join("");
  expect(text).toBe(longMarkdown(15_000));
  expect(text.length).toBeGreaterThanOrEqual(60_000);
  expect(text.length).toBeLessThan(61_000);
  expect(turn.chunks!.every((chunk) => chunk.length <= 16)).toBe(true);
  // 200 tokens a second at 4 tokens a piece: a piece every 20 ms.
  expect(turn.interval).toBe(20);
});
