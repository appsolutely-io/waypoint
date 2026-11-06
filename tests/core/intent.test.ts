import { it, expect } from "vitest";
import {
  answers,
  buildIntent,
  type CapturedIntent,
} from "../../src/core/intent";
import type { PlanIntentReply } from "../../src/protocol/generated";

const captured: CapturedIntent = {
  kind: "stop",
  planId: "plan-a",
  target: { type: "execution", id: "plan-a.e1" },
  capturedRound: 2,
  expectedSlotVersion: 1,
  correlation: "c-1",
};
const reply = (overrides: Partial<PlanIntentReply> = {}): PlanIntentReply => ({
  planId: "plan-a",
  kind: "stop",
  capturedRound: 2,
  correlation: "c-1",
  effectiveRound: 2,
  slotVersion: 2,
  result: "applied",
  keys: ["stopped"],
  phase: "readback",
  ...overrides,
});
it("builds the request from what was captured, with its cause", () => {
  expect(buildIntent(captured, "step-failed")).toEqual({
    ...captured,
    cause: "step-failed",
  });
});
it("accepts only a reply that answers this exact request", () => {
  const request = buildIntent(captured, "user");
  expect(answers(reply(), request)).toBe(true);
  for (const wrong of [
    { planId: "other" },
    { kind: "cancel-initial" as const },
    { correlation: "c-2" },
    { capturedRound: 1 },
    { result: "invented" as never },
    { keys: [1] as never },
  ])
    expect(answers(reply(wrong), request), JSON.stringify(wrong)).toBe(false);
  expect(answers(null, request)).toBe(false);
});
