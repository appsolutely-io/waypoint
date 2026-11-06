// Feedback on a reply goes to the host's feedback port, once per rating
// while it is in flight; a failure is reported and changes nothing.
import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  type FeedbackInput,
} from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { config } from "../support/client";

const messages: Message[] = [
  { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
  {
    id: "a",
    role: "assistant",
    content: "Hello",
    blocks: [],
    createdAt: 1,
    status: "completed",
  },
];

async function setup(send?: (input: FeedbackInput) => Promise<void>) {
  const base = config();
  const client = createWaypointClient({
    ...base,
    ...(send && { feedback: { send } }),
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages,
      }),
    },
  });
  await client.ready;
  return client;
}

it("sends a rating once, with one reply id while it is in flight", async () => {
  const calls: FeedbackInput[] = [];
  let release = () => {};
  const client = await setup(
    (input) =>
      new Promise<void>((resolve) => {
        calls.push(input);
        release = resolve;
      }),
  );
  expect(client.canSendFeedback()).toBe(true);
  const first = client.sendFeedback("a", "positive");
  const second = client.sendFeedback("a", "positive");
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  release();
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(calls).toEqual([
    {
      conversationId: "conversation-a",
      messageId: "a",
      clientReplyId: expect.any(String),
      rating: "positive",
    },
  ]);
  client.dispose();
});

it("refuses feedback on the user's own message", async () => {
  const calls: FeedbackInput[] = [];
  const client = await setup(async (input) => void calls.push(input));
  expect(await client.sendFeedback("u", "negative")).toBe(false);
  expect(calls).toEqual([]);
  expect(client.getSnapshot().problem).toEqual({
    code: "refused",
    id: "message-feedback",
  });
  client.dispose();
});

it("reports a failed send and says it was not sent", async () => {
  const client = await setup(async () => {
    throw { code: "unavailable", id: "feedback" };
  });
  expect(await client.sendFeedback("a", "negative")).toBe(false);
  expect(client.getSnapshot().problem?.code).toBe("unavailable");
  client.dispose();
});

it("offers no feedback without a port, and says whether versions can change", async () => {
  const client = await setup();
  expect(client.canSendFeedback()).toBe(false);
  expect(await client.sendFeedback("a", "positive")).toBe(false);
  expect(client.canChangeVersions()).toBe(false);
  client.dispose();
});
