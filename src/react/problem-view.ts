// How a problem and the reply row are worded, as message keys and the one
// action each offers: shared by the web chat and any UI drawn from
// `/hooks`. No strings, no React, no DOM.
import type {
  MaybePromise,
  PendingSend,
  ReplyBusy,
  ReplyPresentation,
  ReplyState,
} from "../core/client";
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
  "attachments-lost": "chat.problem.attachmentsLost",
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
export interface ProblemDisplayOptions {
  checking?: boolean;
  planStopped?: boolean;
  conversationUnavailable?: boolean;
}
/** The problem eligible for the shared transcript/composer presentation. */
export function visibleProblem(
  problem: Problem | null,
  options: ProblemDisplayOptions = {},
): Problem | undefined {
  return problem &&
    !options.checking &&
    problem.id !== "conversation-unavailable" &&
    !(problem.code === "stopped" && options.planStopped) &&
    !problem.confirmation &&
    !(options.conversationUnavailable && problem.id === "conversation-read")
    ? problem
    : undefined;
}
/** A current eligible override applies only to a row that is still failed. */
export function pendingProblem(
  row: Pick<PendingSend, "id" | "failure">,
  eligibleProblem: Problem | undefined,
): Problem | null {
  if (!row.failure) return null;
  return eligibleProblem?.id === row.id ? eligibleProblem : row.failure;
}
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
export interface HostBusyStopControl {
  label: string;
  onPress(): MaybePromise<void>;
  disabled?: boolean;
  busy?: boolean;
}
export interface ReplyRowAction {
  id: "keepWaiting" | "retry" | "stop" | "hostStop";
  labelKey: MessageKey;
  label?: string;
}
export interface ReplyRowView {
  key?: MessageKey;
  actions: ReplyRowAction[];
  busy?: {
    kind: "expected" | "expected-overdue";
    key: MessageKey;
    label?: string;
    stop?: HostBusyStopControl;
    actions: ReplyRowAction[];
  };
}
export function replyRowView(
  state: ReplyState,
  options: {
    canStop?: boolean;
    canRetry?: boolean;
    canRegenerate?: boolean;
    recovery?: "regenerate" | "resend" | "none";
    presentation?: ReplyPresentation;
    busy?: ReplyBusy;
    replyLabel?: string | null;
    expectedReplyStop?: HostBusyStopControl;
  } = {},
): ReplyRowView {
  const expected = state === "expected" || state === "expected-overdue";
  const hostBusy =
    options.busy ??
    (expected
      ? {
          label: options.replyLabel ?? undefined,
          overdue: state === "expected-overdue",
        }
      : undefined);
  const wait: ReplyRowAction = {
    id: "keepWaiting",
    labelKey: "chat.reply.keepWaiting",
  };
  const busy: ReplyRowView["busy"] = hostBusy && {
    kind: hostBusy.overdue ? "expected-overdue" : "expected",
    key: hostBusy.overdue ? "reply.expected-overdue" : "reply.expected",
    label: hostBusy.label,
    stop: options.expectedReplyStop,
    actions: [
      ...(hostBusy.overdue ? [wait] : []),
      ...(options.expectedReplyStop
        ? [
            {
              id: "hostStop" as const,
              labelKey: "chat.reply.stop" as const,
              label: options.expectedReplyStop.label,
            },
          ]
        : []),
    ],
  };
  if (state === "none") return { actions: [], ...(busy && { busy }) };
  if (expected) return { key: busy!.key, actions: busy!.actions, busy };
  const retry: ReplyRowAction = {
    id: "retry",
    labelKey:
      options.recovery === "regenerate" ||
      (state === "overdue" &&
        options.presentation === "writing" &&
        options.canRegenerate)
        ? "chat.message.regenerate"
        : options.recovery === "resend"
          ? "chat.resend"
          : "chat.retry",
  };
  const key: MessageKey =
    state === "overdue"
      ? options.presentation === "writing"
        ? "reply.writingOverdue"
        : options.presentation === "waiting"
          ? "reply.waitOverdue"
          : "reply.overdue"
      : state === "writing" && options.presentation === "waiting"
        ? "reply.waiting"
        : `reply.${state}`;
  const actions: ReplyRowAction[] =
    state === "overdue"
      ? options.presentation === "writing"
        ? [
            ...(options.canStop
              ? [{ id: "stop" as const, labelKey: "chat.reply.stop" as const }]
              : []),
            retry,
            wait,
          ]
        : [wait, retry]
      : state === "writing"
        ? options.canStop
          ? [{ id: "stop", labelKey: "chat.reply.stop" }]
          : []
        : options.canRetry === false || options.recovery === "none"
          ? []
          : [retry];
  return { key, actions, ...(busy && { busy }) };
}
