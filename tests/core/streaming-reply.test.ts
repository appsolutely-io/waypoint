import { it, expect } from "vitest";
import { replyRow } from "../../src/core/client";

const user = {
  id: "u",
  role: "user" as const,
  content: "Hello",
  blocks: [],
  createdAt: 0,
};
const streaming = {
  id: "a",
  role: "assistant" as const,
  content: "Working through the list: the first item is",
  blocks: [],
  createdAt: 1000,
  status: "writing" as const,
};

it("a reply streaming in is being written while its text keeps arriving", () => {
  for (const now of [2000, 60000, 600000])
    expect(
      replyRow({
        messages: [user, streaming],
        pending: [],
        now,
        activityAt: now - 14999,
      }),
    ).toBe("writing");
});

it("a reply whose text stopped arriving 15 seconds ago is overdue", () => {
  expect(
    replyRow({
      messages: [user, streaming],
      pending: [],
      now: 61000,
      activityAt: 46000,
    }),
  ).toBe("overdue");
});

it("a finished or failed reply leaves the row empty", () => {
  for (const status of ["completed", "failed", "unavailable"] as const)
    expect(
      replyRow({
        messages: [user, { ...streaming, status }],
        pending: [],
        now: 2000,
      }),
    ).toBe("none");
  const unmarked = { ...streaming, status: undefined };
  expect(replyRow({ messages: [user, unmarked], pending: [], now: 2000 })).toBe(
    "none",
  );
});

it("a known failure or a lost stream wins over a reply still marked writing", () => {
  const messages = [user, streaming];
  expect(replyRow({ messages, pending: [], now: 2000, failed: true })).toBe(
    "failed",
  );
  expect(
    replyRow({ messages, pending: [], now: 2000, unavailable: true }),
  ).toBe("unavailable");
  expect(replyRow({ messages, pending: [], now: 2000, streamLost: true })).toBe(
    "unavailable",
  );
});

it("without activityAt the stall is not measured: a reply being written stays writing", () => {
  // The message's createdAt is the host's clock, not the caller's.
  expect(
    replyRow({ messages: [user, streaming], pending: [], now: 17000 }),
  ).toBe("writing");
});
