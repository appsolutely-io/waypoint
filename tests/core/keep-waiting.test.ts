// An overdue reply can be waited for again: the row stops saying overdue
// and says it again only after another long gap with no progress.
import { it, expect } from "vitest";
import { createWaypointClient, replyRow } from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { config, createManualClock } from "../support/client";

const user: Message = {
  id: "u",
  role: "user",
  content: "Hi",
  blocks: [],
  createdAt: 0,
};
const streaming: Message = {
  id: "a",
  role: "assistant",
  content: "The first",
  blocks: [],
  createdAt: 1,
  status: "writing",
};

it("a reply being written is not overdue before the wait it was given ends", () => {
  const input = { messages: [user, streaming], pending: [], activityAt: 0 };
  expect(replyRow({ ...input, now: 20_000 })).toBe("overdue");
  expect(replyRow({ ...input, now: 20_000, heldUntil: 35_000 })).toBe(
    "writing",
  );
  expect(replyRow({ ...input, now: 35_000, heldUntil: 35_000 })).toBe(
    "overdue",
  );
});

for (const [name, messages] of [
  ["never started", [user]],
  ["stalled", [user, streaming]],
] as const)
  it(`keep waiting on a reply that ${name} waits another 15 seconds`, async () => {
    const manual = createManualClock(0);
    const base = config();
    const client = createWaypointClient({
      ...base,
      platform: { ...base.platform, clock: manual.clock },
      transport: {
        ...base.transport,
        read: async () => ({
          protocol: "1.0",
          id: "conversation-a",
          title: "Chat",
          messages: [...messages],
        }),
      },
    });
    await client.ready;
    await manual.advance(16_000);
    expect(client.getSnapshot().replyState).toBe("overdue");
    client.keepWaiting();
    expect(client.getSnapshot().replyState).toBe("writing");
    await manual.advance(14_000);
    expect(client.getSnapshot().replyState).toBe("writing");
    await manual.advance(1_500);
    expect(client.getSnapshot().replyState).toBe("overdue");
    client.dispose();
  });

it("retrying an overdue reply reads the conversation again and waits again", async () => {
  const manual = createManualClock(0);
  const base = config();
  let reads = 0;
  const client = createWaypointClient({
    ...base,
    platform: { ...base.platform, clock: manual.clock },
    transport: {
      ...base.transport,
      read: async () => {
        reads++;
        return {
          protocol: "1.0",
          id: "conversation-a",
          title: "Chat",
          messages: [user],
        };
      },
    },
  });
  await client.ready;
  await manual.advance(16_000);
  const before = reads;
  await client.retryReply();
  expect(reads).toBe(before + 1);
  expect(client.getSnapshot().replyState).toBe("writing");
  client.dispose();
});
