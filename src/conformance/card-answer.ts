// Whether a card's `answer`, as a host read returns it, names the answer the
// conformance check applied: the fields `CardAnswer` requires of an action,
// in any key order, beside any others the schema allows. An answer is
// optional, so `undefined` passes; `null` or any other non-object fails
// without throwing.
const APPLIED = {
  kind: "action",
  clientReplyId: "card-answer-a",
  blockId: "card-answer-choice",
  actionId: "accept",
};
export function namesAppliedAnswer(answer: unknown): boolean {
  if (answer === undefined) return true;
  if (typeof answer !== "object" || answer === null || Array.isArray(answer))
    return false;
  return Object.entries(APPLIED).every(
    ([key, value]) => (answer as Record<string, unknown>)[key] === value,
  );
}
