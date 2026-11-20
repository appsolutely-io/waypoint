import type { ConfirmationRecord, PlanRecord } from "../protocol/generated";

/**
 * The plan's confirmation record, when it is bound to this plan, this
 * conversation and the plan's host revision. A record without a whole
 * revision is never a match; a legacy plan record has no revision of its
 * own to compare, so its host refuses a stale token.
 */
export function confirmationOf(
  plan: PlanRecord | null | undefined,
  conversationId: string | undefined,
): ConfirmationRecord | undefined {
  const record = plan?.confirmation;
  return record &&
    record.planId === plan!.id &&
    record.conversationId === conversationId &&
    Number.isInteger(record.revision) &&
    record.revision === (plan!.recovery ?? record).revision
    ? record
    : undefined;
}
