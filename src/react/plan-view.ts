// What the recovery and decision UI shows for the current plan, computed
// once for every renderer (neutral UI, skins, custom parts). DOM-free and
// outside core. It shows only facts the host reported (the adopted record,
// the intent notice and its keys) or the client knows (overlay, alert,
// capabilities); where a fact is absent it says "not known yet" or shows
// nothing. It never decides authority: every press still goes through the
// client, which refuses what it must.
import {
  confirmationOf,
  type IntentAlert,
  type IntentOverlay,
  type KeepChangesReviewResult,
} from "../core/client";
import type { IntentNotice } from "../core/intent";
import type {
  IntentCause,
  IntentKind,
  PlanRecord,
  PlanState,
} from "../protocol/generated";
import type { MessageKey } from "./i18n";

export interface ViewMessage {
  key: MessageKey;
  values?: Record<string, number>;
}
export type Tone = "neutral" | "progress" | "warning" | "success";
export interface StepStatus {
  stepId: string;
  label: string;
  truth: "done" | "not-done" | "unknown";
  // While the plan runs, an unknown step is only not known yet.
  textKey: MessageKey;
  lateReport?: "contradicted";
}
export type ActionId =
  | "confirm"
  | "stop"
  | "decline"
  | "leave"
  | "keep"
  | "status"
  | "undoSelected"
  | "continue";
export interface ActionEntry {
  id: ActionId;
  labelKey: MessageKey;
  available: boolean;
  reasonKey?: MessageKey;
  reasonValues?: Record<string, number>;
  busy?: boolean;
  // The confirmation schedules the plan instead of applying it now.
  schedule?: boolean;
}
export interface PlanViewStatus {
  dataStatus: string;
  wireState: PlanState;
  label: ViewMessage;
  tone: Tone;
  attention: boolean;
  result?: "kept";
}
export interface PlanViewAlert {
  serial: number;
  action?: "checkStatus" | "retry" | "signIn" | "hostGuidance" | "wait";
  restoreFocus?: true;
  message?: ViewMessage;
  retryAvailable: boolean;
  // Why Retry cannot be used now: the same guard as the status entry.
  retryReasonKey?: MessageKey;
  retryValues?: Record<string, number>;
}
export interface PlanView {
  planId: string;
  /** Null for a plan without the recovery profile (legacy). */
  status: PlanViewStatus | null;
  intent: { kind: IntentKind; status: IntentOverlay["delivery"] } | null;
  steps: StepStatus[];
  lines: ViewMessage[];
  notice: ViewMessage[];
  alert: PlanViewAlert | null;
  actions: ActionEntry[];
  // Kinds this view pressed whose delivery has not settled yet.
  pending: readonly IntentKind[];
  conversationUnavailable: boolean;
  /** A protected plan this client cannot control: shown, never acted on. */
  readOnly?: true;
}
export interface PlanViewInput {
  plan: PlanRecord | null;
  capabilities: readonly string[];
  conversationUnavailable: boolean;
  overlay: IntentOverlay | undefined;
  notice: IntentNotice | null;
  alert: IntentAlert | null;
  keepReview: KeepChangesReviewResult;
  // Kinds this view pressed whose delivery has not settled and that have no
  // overlay yet (a press made while the intent chunk loads).
  pending: readonly IntentKind[];
  now: number;
  // The client's current conversation: a confirmation issued for another
  // one is not this plan's.
  conversationId: string;
  // The client's own verdict (the snapshot's `planReadOnly`): it covers
  // what the record alone cannot show, such as a fresh read still due
  // after a new agreement.
  readOnly?: boolean;
}

const k = (key: string) => `chat.recovery.${key}` as MessageKey;
// Host reply keys → catalogue messages. A key missing here shows nothing.
const SAME = [
  "alreadyClosedByWinner",
  "alreadyKept",
  "alreadyStoppedNeedsDecision",
  "cancelStarted",
  "cancelledNoChanges",
  "capabilityMissing",
  "currentStopped",
  "initialTargetSettled",
  "initialTargetStopped",
  "intentSuperseded",
  "keepReasonChanged",
  "keptForwardClosed",
  "leaveCompletedByKeep",
  "leaveCoveredByKeep",
  "leaveNeedsReview",
  "leaveSafetyNeedsReview",
  "leftKnown",
  "leftUnconfirmed",
  "planClosedKept",
  "reviewTargetSettled",
  "reviewTargetStopped",
  "stopped",
  "stoppedNoChanges",
  "acknowledgmentAhead",
  "cancelCoveredByLeaveSafety",
  "cancelCoveredByStopNoChanges",
  "cancelDefeatedByStop",
  "choiceReplacedByStop",
  "initialTargetClosed",
  "keepDefeatedByWinner",
  "leaveDefeatedByWinner",
  "leaveNoDecision",
  "leaveSafetyAlreadyStopped",
  "reopenedEvidence",
];
export const HOST_KEYS: Readonly<Record<string, MessageKey>> = {
  ...Object.fromEntries(SAME.map((key) => [key, k(key)])),
  alreadyClosed: k("alreadyClosedByWinner"),
  acknowledgmentStale: k("keepReasonChanged"),
  intentConflict: k("intentTargetChanged"),
  invalidTarget: k("intentTargetChanged"),
  intentUnavailable: k("keepReasonUnavailable"),
  keepBlockedActive: k("keepReasonActive"),
  keepBlockedUnknown: k("keepReasonUnknown"),
  keepBlockedReview: k("keepReasonPreview"),
  keepNoDecision: k("keepReasonNoSource"),
  planSealed: k("alreadyKept"),
  keptElsewhere: k("keptAlready"),
};
// Client overlay keys → catalogue messages.
export const OVERLAY_KEYS: Readonly<Record<string, MessageKey>> = {
  ...Object.fromEntries(
    [
      "stopNotSent",
      "stopNotSentElsewhere",
      "stopUnconfirmed",
      "leaveNotSent",
      "leaveUnconfirmed",
      "keepNotSent",
      "keepUnconfirmed",
    ].map((key) => [key, k(key)]),
  ),
  cancelInitialNotSent: k("cancelNotSent"),
  cancelInitialUnconfirmed: k("cancelUnconfirmed"),
  cancelReviewNotSent: k("reviewCancelNotSent"),
  cancelReviewUnconfirmed: k("reviewCancelUnconfirmed"),
  stopRefused: k("requestRefused"),
  cancelInitialRefused: k("requestRefused"),
  cancelReviewRefused: k("requestRefused"),
  leaveRefused: k("requestRefused"),
  keepRefused: k("requestRefused"),
};
const COUNTED = new Set(["leftUnconfirmed"]);
const RELATION: Record<string, MessageKey> = {
  leaveCompletedByKeep: k("leaveCompletedByKeep"),
  leaveCoveredByKeep: k("leaveCoveredByKeep"),
  keptElsewhere: k("keptAlready"),
};

/** The notice's messages, built only from what the host reported. */
export function noticeMessages(notice: IntentNotice): ViewMessage[] {
  const out: ViewMessage[] = [];
  const add = (key: MessageKey | undefined, values?: ViewMessage["values"]) => {
    if (key && !out.some((message) => message.key === key))
      out.push(values ? { key, values } : { key });
  };
  for (const key of notice.keys ?? [])
    add(
      HOST_KEYS[key],
      COUNTED.has(key) && typeof notice.count === "number"
        ? { count: notice.count }
        : undefined,
    );
  if (notice.requestKey) add(k(notice.requestKey));
  const applied = (value: boolean | undefined) => {
    if (value !== undefined)
      add(k(value ? "requestedIntentApplied" : "requestedIntentNotApplied"));
  };
  applied(notice.requestedTargetApplied);
  const saved = notice.savedDisposition;
  if (saved)
    add(
      k(saved.phase === "left-known" ? "leftKnown" : "leftUnconfirmed"),
      saved.phase === "left-known" ? undefined : { count: saved.count },
    );
  const final = notice.finalHistory;
  if (final) {
    if (final.relation) add(RELATION[final.relation]);
    if (final.keptFact?.keepEffect === "forward-closed")
      add(k("keptForwardClosed"));
    applied(final.requestedTargetApplied);
    if (final.contradictedAfterSeal?.length) add(k("laterReportAfterKeep"));
  }
  return out;
}

const STOP_CAUSE: Record<IntentCause, string> = {
  user: "winnerStopUser",
  "connection-lost": "winnerStopConnection",
  "renewal-refused": "winnerStopRenewal",
  "step-failed": "winnerStopStep",
  "step-up-failed": "winnerStopStepUp",
  "identity-lost": "winnerStopIdentity",
  "attribution-missing": "winnerStopAttribution",
  "plan-changed": "winnerStopChanged",
  "adapter-configuration": "winnerStopAdapter",
};
const RANK: Record<IntentKind, number> = {
  stop: 4,
  "cancel-initial": 3,
  "cancel-review": 3,
  keep: 2,
  leave: 1,
};
const ENTRY_KIND: Partial<Record<ActionId, IntentKind>> = {
  stop: "stop",
  decline: "cancel-initial",
  leave: "leave",
  keep: "keep",
};
const STATUS_LABEL: Record<IntentKind, MessageKey> = {
  stop: k("checkIntentStatus"),
  "cancel-initial": k("checkIntentStatus"),
  "cancel-review": k("checkIntentStatus"),
  leave: k("checkSavedChoice"),
  keep: k("checkKeepStatus"),
};
const KEEP_REASON: Record<string, MessageKey | null> = {
  capabilityMissing: null,
  keepNoDecision: null,
  sealed: null,
  keepBlockedActive: k("keepReasonActive"),
  keepBlockedUnknown: k("keepReasonUnknown"),
  loading: k("actionLoading"),
  intentUnavailable: k("keepReasonUnavailable"),
};
const NO_EXECUTION = new Set(["proposal", "initial-review", "cancelled"]);
const KEEP_PHASES = new Set([
  "forward-active",
  "readback",
  "left-reopened",
  "left-unconfirmed",
  "completed",
  "left-known",
]);
const LEAVE_PHASES = new Set(["forward-active", "readback", "left-reopened"]);
const DEFERRED_PHASES = new Set(["readback", "left-reopened"]);

const entry = (
  id: ActionId,
  labelKey: MessageKey,
  reasonKey?: MessageKey,
): ActionEntry =>
  reasonKey
    ? { id, labelKey, available: false, reasonKey }
    : { id, labelKey, available: true };

function legacyActions(input: PlanViewInput, plan: PlanRecord): ActionEntry[] {
  // A legacy plan has no decline reply in the protocol, so no Cancel.
  const confirm = confirmEntry(input, plan);
  const actions: ActionEntry[] = confirm ? [confirm] : [];
  if (plan.state === "running")
    actions.push(entry("stop", "chat.stop" as MessageKey));
  return actions;
}
// Confirming needs the host's confirmation record for this plan: it is
// named by whether it schedules, and unusable once it expired.
function confirmEntry(
  input: PlanViewInput,
  plan: PlanRecord,
): ActionEntry | undefined {
  const record = confirmationOf(plan, input.conversationId);
  if (plan.state !== "awaiting-confirmation" || !record) return undefined;
  const confirm = entry(
    "confirm",
    (record.schedule
      ? "chat.confirmation.schedule"
      : "chat.confirmation.apply") as MessageKey,
    input.now >= Date.parse(record.expiresAt)
      ? ("chat.confirmation.expired" as MessageKey)
      : undefined,
  );
  return record.schedule ? { ...confirm, schedule: true } : confirm;
}

function protectedActions(
  input: PlanViewInput,
  plan: PlanRecord,
): ActionEntry[] {
  const view = plan.recovery!;
  const phase = view.phase;
  const actions: ActionEntry[] = [];
  const confirm = phase === "initial-review" && confirmEntry(input, plan);
  if (confirm) actions.push(confirm);
  if (
    phase === "proposal" ||
    phase === "initial-review" ||
    phase === "forward-active"
  )
    actions.push(entry("stop", "chat.stop" as MessageKey));
  if (phase === "proposal" || phase === "initial-review")
    actions.push(entry("decline", "chat.cancel" as MessageKey));
  if (LEAVE_PHASES.has(phase))
    actions.push(
      entry(
        "leave",
        k("leave"),
        input.capabilities.includes("plan-leave")
          ? undefined
          : k("capabilityMissing"),
      ),
    );
  if (KEEP_PHASES.has(phase)) {
    const review = input.keepReview;
    if (!("disabled" in review)) actions.push(entry("keep", k("keepChanges")));
    else {
      const reason = KEEP_REASON[review.disabled];
      if (reason) actions.push(entry("keep", k("keepChanges"), reason));
    }
  }
  if (DEFERRED_PHASES.has(phase))
    for (const id of ["undoSelected", "continue"] as const)
      actions.push(entry(id, k(id), k("notAvailableYet")));
  return actions;
}

function waitGuard(input: PlanViewInput, overlay: IntentOverlay | undefined) {
  if (
    overlay?.retryAt === undefined ||
    overlay.lastProblem?.cause !== "rate-limited" ||
    input.now >= overlay.retryAt
  )
    return undefined;
  return { seconds: Math.ceil((overlay.retryAt - input.now) / 1000) };
}

function applyModifiers(
  input: PlanViewInput,
  base: ActionEntry[],
  overlay: IntentOverlay | undefined,
): ActionEntry[] {
  let actions = base;
  const wait = waitGuard(input, overlay);
  if (overlay) {
    const status: ActionEntry = wait
      ? {
          id: "status",
          labelKey: STATUS_LABEL[overlay.kind],
          available: false,
          reasonKey: k("retryAfterSeconds"),
          reasonValues: wait,
        }
      : {
          id: "status",
          labelKey: STATUS_LABEL[overlay.kind],
          available: true,
          busy: overlay.delivery === "sending",
        };
    let placed = false;
    actions = actions.map((action) => {
      if (ENTRY_KIND[action.id] === overlay.kind) {
        placed = true;
        return status;
      }
      return action;
    });
    // A request in flight can always be checked, whatever the record became.
    if (!placed) actions = [...actions, status];
  }
  const blocking = [...(overlay ? [overlay.kind] : []), ...input.pending].map(
    (kind) => RANK[kind],
  );
  if (blocking.length) {
    const top = Math.max(...blocking);
    actions = actions.map((action) => {
      if (action.id === "status") return action;
      const kind = ENTRY_KIND[action.id];
      const rank = action.id === "confirm" ? 0 : kind ? RANK[kind] : undefined;
      if (rank === undefined || rank > top) return action;
      const pressed = kind && input.pending.includes(kind);
      return {
        ...action,
        available: false,
        reasonKey: k("intentPendingReason"),
        ...(pressed ? { busy: true } : {}),
      };
    });
  }
  if (input.conversationUnavailable)
    actions = actions.map((action) => ({
      ...action,
      available: false,
      reasonKey: k("refreshConversation"),
    }));
  return actions;
}

function statusOf(plan: PlanRecord, overlay: IntentOverlay | undefined) {
  const view = plan.recovery!;
  const steps = view.steps ?? [];
  const count = (truth: string) =>
    steps.filter((step) => step.truth === truth).length;
  const label = (key: string, values?: ViewMessage["values"]): ViewMessage =>
    values ? { key: k(key), values } : { key: k(key) };
  if (view.sealed)
    return {
      label: label("keptKnown"),
      tone: "neutral" as Tone,
      attention: false,
    };
  switch (view.phase) {
    case "proposal":
      return {
        label: label("statusProposal"),
        tone: "neutral" as Tone,
        attention: false,
      };
    case "initial-review":
      return {
        label: label("heading"),
        tone: "neutral" as Tone,
        attention: false,
      };
    case "forward-active":
      return {
        label: label(overlay?.kind === "stop" ? "stopping" : "currentRunning"),
        tone: "progress" as Tone,
        attention: false,
      };
    case "readback":
    case "left-reopened":
      return {
        label: label("heading"),
        tone: "warning" as Tone,
        attention: true,
      };
    case "completed":
      return {
        label: label("statusCompleted"),
        tone: "success" as Tone,
        attention: false,
      };
    case "cancelled":
      return {
        label: label(count("done") ? "currentStopped" : "cancelledNoChanges"),
        tone: "neutral" as Tone,
        attention: false,
      };
    case "left-known":
      return {
        label: label("leftKnown"),
        tone: "neutral" as Tone,
        attention: false,
      };
    case "left-unconfirmed":
      return {
        label: label("leftUnconfirmed", { count: count("unknown") }),
        tone: "warning" as Tone,
        attention: false,
      };
  }
}

/** The view of the current plan, or null without one. */
export function planView(input: PlanViewInput): PlanView | null {
  const plan = input.plan;
  if (!plan) return null;
  const protectedPlan =
    !!plan.recovery && input.capabilities.includes("plan-recovery");
  // A profile, phase or capability this client lacks: the recorded state,
  // and why nothing can be done here.
  if (
    plan.recovery &&
    (input.readOnly ||
      !protectedPlan ||
      plan.recovery.profile !== "plan-recovery-v1" ||
      !statusOf(plan, undefined))
  )
    return {
      planId: plan.id,
      status: {
        dataStatus: plan.recovery.phase,
        wireState: plan.state,
        label: { key: k("heading") },
        tone: "neutral",
        attention: false,
      },
      intent: null,
      steps: [],
      // Why nothing can be done here, then the recorded state.
      lines: [
        { key: k("updateToControl") },
        { key: `chat.block.state.${plan.state}` as MessageKey },
      ],
      notice: [],
      alert: null,
      actions: [],
      pending: [],
      conversationUnavailable: input.conversationUnavailable,
      readOnly: true,
    };
  const overlay =
    input.overlay && input.overlay.planId === plan.id
      ? input.overlay
      : undefined;
  const notice =
    input.notice && (input.notice.planId ?? plan.id) === plan.id
      ? noticeMessages(input.notice)
      : [];
  const alertSource = input.alert;
  const wait = waitGuard(input, overlay);
  const problemKey = overlay?.lastProblem?.key;
  const alert: PlanViewAlert | null =
    alertSource && overlay
      ? {
          serial: alertSource.serial,
          ...("restoreFocus" in alertSource
            ? { restoreFocus: true as const }
            : { action: alertSource.action }),
          ...(problemKey && OVERLAY_KEYS[problemKey]
            ? { message: { key: OVERLAY_KEYS[problemKey]! } }
            : {}),
          retryAvailable: !wait && !input.conversationUnavailable,
          ...(input.conversationUnavailable
            ? { retryReasonKey: k("refreshConversation") }
            : wait
              ? { retryReasonKey: k("retryAfterSeconds"), retryValues: wait }
              : {}),
        }
      : alertSource && "restoreFocus" in alertSource
        ? {
            serial: alertSource.serial,
            restoreFocus: true,
            retryAvailable: true,
          }
        : null;
  if (!protectedPlan)
    return {
      planId: plan.id,
      status: null,
      intent: null,
      steps: [],
      lines: [],
      notice: [],
      alert: null,
      actions: applyModifiers(
        { ...input, pending: [] },
        legacyActions(input, plan),
        undefined,
      ),
      pending: [],
      conversationUnavailable: input.conversationUnavailable,
    };
  const view = plan.recovery!;
  const labels = new Map(
    plan.plan.kind === "immediate"
      ? plan.plan.steps.map((step) => [step.id, step.view])
      : [],
  );
  const contradicted = new Set(view.contradictedAfterSeal ?? []);
  const live = view.phase === "forward-active";
  const steps: StepStatus[] = (view.steps ?? []).map((step) => ({
    stepId: step.stepId,
    label: labels.get(step.stepId) ?? step.stepId,
    truth: step.truth,
    textKey: k(
      step.truth === "done"
        ? "done"
        : step.truth === "not-done"
          ? "notDone"
          : live
            ? "stepNotKnownYet"
            : "unknown",
    ),
    ...(view.sealed && contradicted.has(step.stepId)
      ? { lateReport: "contradicted" as const }
      : {}),
  }));
  const lines: ViewMessage[] = [];
  const unknown = steps.filter((step) => step.truth === "unknown").length;
  const notDone = steps.filter((step) => step.truth === "not-done").length;
  if (!view.steps?.length && !NO_EXECUTION.has(view.phase))
    lines.push({ key: k("stepsNotKnownYet") });
  let evidence = false;
  if (!view.sealed && !live && unknown) {
    lines.push({ key: k("stepsUnknown"), values: { count: unknown } });
    evidence = true;
  }
  if (!view.sealed && view.phase === "completed" && notDone) {
    lines.push({ key: k("stepsNotDone"), values: { count: notDone } });
    evidence = true;
  }
  if (view.sealed && contradicted.size) {
    lines.push({ key: k("laterReportAfterKeep") });
    evidence = true;
  }
  const winner = view.winner;
  if (winner?.kind === "stop") {
    lines.push({ key: k(STOP_CAUSE[winner.cause]) });
    if (view.phase === "readback") lines.push({ key: k("stopped") });
  } else if (winner)
    lines.push({
      key: k(
        winner.kind === "leave"
          ? "winnerLeave"
          : winner.kind === "keep"
            ? "winnerKeep"
            : "winnerCancel",
      ),
    });
  const status = statusOf(plan, overlay)!;
  return {
    planId: plan.id,
    status: {
      dataStatus: view.phase,
      wireState: plan.state,
      label: status.label,
      tone: status.tone,
      attention: status.attention || evidence,
      ...(view.sealed ? { result: "kept" as const } : {}),
    },
    intent: overlay ? { kind: overlay.kind, status: overlay.delivery } : null,
    steps,
    lines,
    notice,
    alert,
    actions: applyModifiers(input, protectedActions(input, plan), overlay),
    pending: input.pending,
    conversationUnavailable: input.conversationUnavailable,
  };
}

export interface KeepSheetView {
  messages: ViewMessage[];
  proceed: { available: boolean; reasonKey?: MessageKey };
}
/** What the Keep confirmation states for the review captured at opening. */
export function keepSheet(
  review: { review: "forward-only" | "end-retention"; remaining: number },
  view: PlanView,
): KeepSheetView {
  const messages: ViewMessage[] =
    review.review === "forward-only"
      ? [
          { key: k("confirmKeepForwardOnly") },
          { key: k("keepRemainingSteps"), values: { count: review.remaining } },
        ]
      : [{ key: k("confirmEndRetention") }];
  const blocked = view.conversationUnavailable
    ? k("refreshConversation")
    : view.status?.result === "kept"
      ? k("alreadyKept")
      : view.intent || view.pending.length
        ? k("intentPendingReason")
        : undefined;
  return {
    messages,
    proceed: blocked
      ? { available: false, reasonKey: blocked }
      : { available: true },
  };
}
/** A message block as part data: its identity only, never its body. */
export interface BlockSummary {
  id: string;
  type: string;
  answered: boolean;
}
