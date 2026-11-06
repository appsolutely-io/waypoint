// How a problem and the reply row are worded, as message keys and the one
// action each offers: shared by the web chat and any UI drawn from
// `/hooks`. No strings, no React, no DOM.
import type { ReplyState } from "../core/client";
import type { Problem } from "../protocol/generated";
import type { MessageKey } from "./i18n";

// The client's default words for each problem code (a host's
// `problemText` replaces them).
const PROBLEM_TEXT: Partial<Record<Problem["code"], MessageKey>> = {
  "sign-in": "chat.problem.signIn",
  retryable: "chat.problem.retryable",
  "rate-limited": "chat.problem.rateLimited",
  refused: "chat.problem.refused",
  closed: "chat.problem.closed",
  full: "chat.problem.full",
  declined: "chat.problem.declined",
  unavailable: "chat.problem.unavailable",
  "step-up-cancelled": "chat.problem.stepUp",
  "invalid-read": "chat.problem.invalid",
  "invalid-plan": "chat.problem.invalid",
  "plan-changed": "chat.planChanged",
  "update-required": "chat.update",
  mismatch: "chat.problem.mismatch",
  "agreement-expired": "chat.problem.agreement",
  "in-doubt": "chat.problem.inDoubt",
  replaced: "chat.problem.replaced",
  "needs-attention": "chat.problem.needsAttention",
  stopped: "chat.stopped",
};
/** The one action a default problem text offers. */
export const problemAction = (
  problem: Problem,
): "retry" | "refresh" | undefined =>
  problem.code === "replaced"
    ? "refresh"
    : [
          "retryable",
          "rate-limited",
          "unavailable",
          "agreement-expired",
        ].includes(problem.code)
      ? "retry"
      : undefined;
export interface ProblemView {
  /** The plain words for the problem. */
  key: MessageKey;
  /** The one action they lead to, when there is one. */
  action?: "retry" | "refresh";
  /** What to show behind a disclosure (`chat.problem.code`, `.reference`). */
  code: Problem["code"];
  id: string;
}
/**
 * How the chat words a problem by default. `answeredElsewhere`: a card
 * answer was refused and the read after it shows the card answered (see the
 * README's Card answers).
 */
export function problemView(
  problem: Problem,
  options: { answeredElsewhere?: boolean } = {},
): ProblemView {
  // A read that failed for now names the conversation, not the site; one
  // that found the conversation gone keeps its own text.
  const readFailed =
    problem.id === "conversation-read" &&
    (problem.code === "unavailable" || problem.code === "retryable");
  const key: MessageKey =
    problem.id === "conversation-unavailable"
      ? "chat.conversationUnavailable"
      : readFailed
        ? "chat.conversationReadFailed"
        : options.answeredElsewhere
          ? "chat.problem.answered"
          : (PROBLEM_TEXT[problem.code] ?? "chat.failure");
  const action = problemAction(problem);
  return {
    key,
    ...(action && { action }),
    code: problem.code,
    id: problem.id,
  };
}
export interface ReplyRowAction {
  id: "keepWaiting" | "retry" | "stop";
  labelKey: MessageKey;
}
/**
 * The reply row's words and buttons for a `replyState`: Keep waiting and
 * Retry for an overdue reply (`keepWaiting()`, `retryReply()`), Retry for a
 * failed or unavailable one, Stop while one is written when `canStop`
 * (`canStopReply()`, `stopReply()`).
 */
export function replyRowView(
  state: ReplyState,
  options: { canStop?: boolean } = {},
): { key?: MessageKey; actions: ReplyRowAction[] } {
  if (state === "none") return { actions: [] };
  const retry: ReplyRowAction = { id: "retry", labelKey: "chat.retry" };
  return {
    key: `reply.${state}`,
    actions:
      state === "overdue"
        ? [{ id: "keepWaiting", labelKey: "chat.reply.keepWaiting" }, retry]
        : state === "writing"
          ? options.canStop
            ? [{ id: "stop", labelKey: "chat.reply.stop" }]
            : []
          : [retry],
  };
}
