import { it, expect } from "vitest";
import { namesAppliedAnswer } from "../../src/conformance/card-answer";

const applied = {
  kind: "action",
  clientReplyId: "card-answer-a",
  blockId: "card-answer-choice",
  actionId: "accept",
};

it("an absent answer passes, and the applied one in any key order", () => {
  expect(namesAppliedAnswer(undefined)).toBe(true);
  expect(namesAppliedAnswer(applied)).toBe(true);
  expect(
    namesAppliedAnswer(Object.fromEntries(Object.entries(applied).reverse())),
  ).toBe(true);
  expect(namesAppliedAnswer({ ...applied, extra: 1 })).toBe(true);
});

it("a null or non-object answer fails without throwing", () => {
  for (const answer of [null, "accept", 3, true, [applied]])
    expect(() => namesAppliedAnswer(answer)).not.toThrow();
  for (const answer of [null, "accept", 3, true, [applied]])
    expect(namesAppliedAnswer(answer)).toBe(false);
  expect(namesAppliedAnswer({ ...applied, actionId: "other" })).toBe(false);
});
