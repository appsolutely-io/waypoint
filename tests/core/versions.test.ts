import { it, expect } from "vitest";
import { createWaypointClient, versionWalk } from "../../src/core/client";
import { config } from "../support/client";
import type { Conversation } from "../../src/protocol/generated";
it("edit, regenerate and version selection use host operations and refetch authoritative siblings", async () => {
  const base = config();
  const history: Conversation = {
    protocol: "1.0",
    id: "conversation-a",
    title: "Chat",
    messages: [
      {
        id: "user-a",
        role: "user",
        content: "Before",
        blocks: [],
        createdAt: 0,
        versionIndex: 1,
        versionCount: 1,
      },
      {
        id: "assistant-a",
        role: "assistant",
        content: "Original",
        blocks: [],
        createdAt: 1,
        versionIndex: 1,
        versionCount: 1,
      },
    ],
  };
  const calls: unknown[] = [];
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async () => structuredClone(history),
    },
    versions: {
      edit: (input) => {
        calls.push(input);
        Object.assign(history.messages[0]!, {
          content: input.content,
          versionIndex: 2,
          versionCount: 2,
        });
      },
      regenerate: (input) => {
        calls.push(input);
        Object.assign(history.messages[1]!, {
          content: "Regenerated",
          versionIndex: 2,
          versionCount: 2,
        });
      },
      select: (input) => {
        calls.push(input);
        Object.assign(history.messages[1]!, {
          content: "Original",
          versionIndex: input.index,
        });
      },
    },
  });
  await client.ready;
  await client.editMessage("user-a", "Edited");
  await client.regenerate("assistant-a");
  expect(client.getSnapshot().conversation?.messages[0]?.content).toBe(
    "Edited",
  );
  expect(client.getSnapshot().conversation?.messages[1]?.content).toBe(
    "Regenerated",
  );
  await client.selectVersion("assistant-a", 1);
  expect(versionWalk(client.getSnapshot().conversation!.messages[1]!)).toEqual({
    index: 1,
    count: 2,
    previous: null,
    next: 2,
  });
  expect(calls).toHaveLength(3);
  expect(calls[0]).toMatchObject({
    conversationId: "conversation-a",
    messageId: "user-a",
    content: "Edited",
  });
  client.dispose();
});
