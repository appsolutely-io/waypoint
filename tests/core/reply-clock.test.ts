import { it, expect } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
it("the injected clock advances a quiet reply to overdue", async () => {
  let now = 0;
  let scheduled: { fn: () => void; ms: number } | undefined;
  const base = config();
  const client = createWaypointClient({
    ...base,
    platform: {
      ...base.platform,
      clock: {
        now: () => now,
        setTimeout: (fn, ms) => {
          scheduled = { fn, ms };
          return 1;
        },
        clearTimeout: () => {},
      },
    },
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          {
            id: "user-a",
            role: "user",
            content: "Hello",
            blocks: [],
            createdAt: 0,
          },
        ],
        replyStatus: "expected",
        replyOverdueAt: 20000,
      }),
    },
  });
  await client.ready;
  expect(client.getSnapshot().replyState).toBe("writing");
  expect(scheduled?.ms).toBe(20000);
  now = 20000;
  scheduled!.fn();
  expect(client.getSnapshot().replyState).toBe("overdue");
  client.dispose();
});
