import { it, expect } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import {
  createScriptedTransport,
  createTestPlatform,
} from "../../src/testing/transport";
it("a scripted send without an answer starts inside the reply grace period", async () => {
  const fixture = createScriptedTransport();
  const client = createWaypointClient({
    accountId: "fixture",
    conversationId: "conversation-a",
    platform: createTestPlatform(),
    transport: fixture.transport,
  });
  await client.ready;
  try {
    await client.setDraft("Hello");
    await client.send();
    expect(client.getSnapshot().replyState).toBe("writing");
  } finally {
    client.dispose();
  }
});
it("the scripted host takes one answer per card and marks the card answered", async () => {
  const fixture = createScriptedTransport();
  fixture.enqueue({
    blocks: [
      {
        type: "card",
        id: "card-a",
        fallback: "Card",
        body: {
          title: "Question",
          blocks: [
            {
              type: "buttons",
              id: "child-a",
              fallback: "Answer",
              body: {
                actions: [
                  { id: "accept", label: "Accept" },
                  { id: "decline", label: "Decline" },
                ],
              },
            },
          ],
        },
      },
    ],
  });
  const { transport } = fixture;
  await transport.send(
    {
      kind: "message",
      protocol: "1.0",
      clientReplyId: "m-1",
      clientMessageId: "m-1",
      content: "Ask",
    },
    "conversation-a",
  );
  const answer = (actionId: string, clientReplyId: string) =>
    transport.send(
      {
        kind: "action",
        protocol: "1.0",
        clientReplyId,
        blockId: "child-a",
        actionId,
      },
      "conversation-a",
    );
  const first = await answer("accept", "r-1");
  // A replay of the applied request gets its first response.
  expect(await answer("accept", "r-1")).toEqual(first);
  // The same id with another body, or another answer, is a conflict.
  await expect(answer("decline", "r-1")).rejects.toMatchObject({
    code: "refused",
  });
  await expect(answer("decline", "r-2")).rejects.toMatchObject({
    code: "refused",
  });
  const read = await transport.read("conversation-a");
  const card = read.messages.at(-1)!.blocks[0]!;
  expect(card.answered).toBe(true);
  // The card names the answer it holds: the applied reply, no protocol.
  expect(card.answer).toEqual({
    kind: "action",
    clientReplyId: "r-1",
    blockId: "child-a",
    actionId: "accept",
  });
});
