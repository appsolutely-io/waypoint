// Host-issued confirmations: before a plan can be confirmed the host issues
// a record of exactly what it will apply, worded by the host, with a
// single-use opaque token bound to the conversation, the plan, the record
// revision and an expiry. Applying or scheduling sends only the token; the
// host applies only the plan bound to it, consumes it once, and refuses an
// expired, used, stale, mismatched or missing token.
import type {
  ConfirmationItem,
  ConfirmationRecord,
  ConfirmationSchedule,
} from "../protocol/generated";

export type ConfirmationRefusal =
  "expired" | "used" | "stale" | "mismatch" | "missing";

/** The host's own state of the token it issued for one plan. */
export interface IssuedConfirmation {
  token: string;
  expiresAt: number;
  planId: string;
  conversationId: string;
  revision: number;
  // The confirmation that consumed the token, once consumed.
  consumedBy?: string;
  // Tokens issued earlier for this plan; each was revoked by a reissue.
  revoked: string[];
}

export interface ConfirmationWording {
  heading: string;
  items: ConfirmationItem[];
  schedule?: ConfirmationSchedule;
  irreversible: boolean;
  undo: string;
  verificationCount: number;
  actionLabel?: string;
}

/** Issues a new token for a plan, revoking any earlier one. */
export function issueConfirmation(
  previous: IssuedConfirmation | undefined,
  input: {
    planId: string;
    conversationId: string;
    revision: number;
    now: number;
    ttl: number;
    token: string;
  },
): IssuedConfirmation {
  return {
    token: input.token,
    expiresAt: input.now + input.ttl,
    planId: input.planId,
    conversationId: input.conversationId,
    revision: input.revision,
    revoked: previous ? [...previous.revoked, previous.token] : [],
  };
}

/** The record the client renders verbatim. */
export function confirmationRecord(
  issued: IssuedConfirmation,
  wording: ConfirmationWording,
): ConfirmationRecord {
  return {
    token: issued.token,
    expiresAt: new Date(issued.expiresAt).toISOString(),
    planId: issued.planId,
    conversationId: issued.conversationId,
    revision: issued.revision,
    heading: wording.heading,
    items: wording.items.map((item) => ({ ...item })),
    ...(wording.schedule ? { schedule: { ...wording.schedule } } : {}),
    irreversible: wording.irreversible,
    undo: wording.undo,
    verificationCount: wording.verificationCount,
    ...(wording.actionLabel ? { actionLabel: wording.actionLabel } : {}),
  };
}

export type ConfirmationCheck =
  { result: "consume" } | { result: "refused"; reason: ConfirmationRefusal };

/**
 * Decides a confirmation against the token issued for the plan. Pure: the
 * caller consumes (sets `consumedBy`) in the same transition that accepts
 * or enrolls the plan.
 */
export function checkConfirmation(
  issued: IssuedConfirmation | undefined,
  command: { token: unknown },
  current: { planId: string; conversationId: string; revision: number },
  now: number,
): ConfirmationCheck {
  const token = command.token;
  if (typeof token !== "string" || !token || !issued)
    return { result: "refused", reason: "missing" };
  if (issued.revoked.includes(token))
    return { result: "refused", reason: "stale" };
  if (token !== issued.token) return { result: "refused", reason: "mismatch" };
  if (
    issued.planId !== current.planId ||
    issued.conversationId !== current.conversationId
  )
    return { result: "refused", reason: "mismatch" };
  // A consumed token never accepts again, not even for a retry of the
  // confirmation that consumed it: the accepted work stays as it is.
  if (issued.consumedBy !== undefined)
    return { result: "refused", reason: "used" };
  if (issued.revision !== current.revision)
    return { result: "refused", reason: "stale" };
  if (now >= issued.expiresAt) return { result: "refused", reason: "expired" };
  return { result: "consume" };
}

/** The refusal body: the existing problem shape with its typed reason. */
export const refusalBody = (id: string, reason: ConfirmationRefusal) => ({
  code: "refused" as const,
  id,
  confirmation: { reason },
});
