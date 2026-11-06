// Real protected-plan records and intent replies, produced by the reference
// host's own transitions, for tests of what the UI shows.
import {
  completeExecution,
  confirm,
  createProtectedPlan,
  readback,
  recordContradiction,
  recoveryView,
  resolveIntent,
  stepEvent,
  type IntentKind,
  type IntentRequest,
  type ProtectedPlan,
} from "../../src/host/plan-intents";
import type { Admission } from "../../src/host/plan-intents";
import type { PlanRecord, PlanState } from "../../src/protocol/generated";
import type { IntentNotice } from "../../src/core/intent";

export type { ProtectedPlan };
const offered = { leave: true, keep: true, principal: "owner", now: 1000 };
export const fresh = (steps = ["s1", "s2"]) =>
  createProtectedPlan({
    planId: "p",
    conversationId: "c",
    generation: "g1",
    review: { id: "r1", revision: 1, digest: "d1", state: "current" },
    steps,
  });
export const running = (steps?: string[]) =>
  confirm(fresh(steps), {
    clientReplyId: "confirm-1",
    digest: "d1",
    protocol: "1.0",
  }).plan;
const runOf = (plan: ProtectedPlan) =>
  plan.executions[plan.acceptance!.executionId]!;
/** Admits a step without committing it: its result stays unknown. */
export function admit(plan: ProtectedPlan, stepId: string) {
  const run = runOf(plan);
  return stepEvent(plan, {
    executionId: run.id,
    fence: run.fence,
    stepId,
    operationId: stepId,
    event: "admission",
  }).plan;
}
export function commit(plan: ProtectedPlan, stepId: string) {
  const run = runOf(plan);
  const step = {
    executionId: run.id,
    fence: run.fence,
    stepId,
    operationId: stepId,
  };
  const admitted = stepEvent(plan, { ...step, event: "admission" });
  return stepEvent(admitted.plan, {
    ...step,
    event: "commit",
    admission: (admitted.reply as { admission: Admission }).admission,
    receipt: `${stepId}-r`,
  }).plan;
}
let correlations = 0;
export function intent(
  plan: ProtectedPlan,
  kind: IntentKind,
  overrides: Partial<IntentRequest> = {},
): IntentRequest {
  const view = recoveryView(plan);
  const decision = kind === "leave" || kind === "keep";
  return {
    kind,
    planId: plan.planId,
    target: plan.acceptance
      ? { type: "execution", id: plan.acceptance.executionId }
      : { type: "generation", id: plan.generation },
    capturedRound: view.round,
    expectedSlotVersion: view.slots[kind],
    correlation: `c-${++correlations}`,
    cause: "user",
    ...(decision
      ? {
          acknowledgment: {
            sourceDecisionKey: view.decisionKey ?? "none",
            evidenceVersion: view.versions.evidence,
            winnerVersion: view.versions.winner,
            decisionResolutionVersion: view.versions.decisionResolution,
            evidenceDigest: view.evidenceDigest ?? "A".repeat(43),
            unknownCount: view.unknownCount ?? 0,
          },
        }
      : {}),
    ...(kind === "keep"
      ? {
          review:
            (view.remaining ?? 0) > 0
              ? ("forward-only" as const)
              : ("end-retention" as const),
        }
      : {}),
    ...overrides,
  };
}
export const resolve = (plan: ProtectedPlan, request: IntentRequest) =>
  resolveIntent(plan, request, offered);
export const completed = () =>
  completeExecution(commit(commit(running(), "s1"), "s2"), 500);
export const contradict = (plan: ProtectedPlan, stepId: string) =>
  recordContradiction(plan, plan.acceptance!.executionId, stepId);
// Readback after a connection-lost Stop: step one committed, step two never ran.
export const stoppedReadback = () => {
  const plan = commit(running(), "s1");
  return resolve(plan, intent(plan, "stop", { cause: "connection-lost" })).plan;
};
const WIRE: Record<string, PlanState> = {
  proposal: "proposed",
  "initial-review": "awaiting-confirmation",
  "forward-active": "running",
  readback: "needs-attention",
  completed: "completed",
  cancelled: "cancelled",
  "left-known": "needs-attention",
  "left-unconfirmed": "needs-attention",
  "left-reopened": "needs-attention",
};
/** The plan record a client would adopt for this host state. */
/** A copy of a record with recovery fields changed, and top-level ones. */
export function withRecovery(
  record: PlanRecord,
  change: Record<string, unknown>,
  extra: Partial<PlanRecord> = {},
): PlanRecord {
  const next = { ...structuredClone(record), ...structuredClone(extra) };
  next.recovery = { ...next.recovery!, ...change };
  return next;
}
/**
 * A copy at another revision, with recovery fields changed; its
 * confirmation record, if any, is issued again for that revision.
 */
export function atRevision(
  record: PlanRecord,
  revision: number,
  change: Record<string, unknown> = {},
): PlanRecord {
  const next = withRecovery(record, { revision, ...change });
  if (next.confirmation)
    next.confirmation = {
      ...next.confirmation,
      revision,
      token: `token-${revision}`,
    };
  return next;
}
export function recordOf(plan: ProtectedPlan): PlanRecord {
  // As the reference fixture projects it: steps once an execution exists.
  const execution = plan.acceptance
    ? plan.executions[plan.acceptance.executionId]
    : undefined;
  const recovery = {
    ...recoveryView(plan),
    ...(execution ? { steps: readback(plan, execution.id, ["s1", "s2"]) } : {}),
  };
  return {
    protocol: "1.0",
    id: plan.planId,
    state: WIRE[recovery.phase]!,
    plan: {
      kind: "immediate",
      stage: "final",
      digest: "d1",
      stepUpCount: 0,
      steps: ["s1", "s2"].map((id) => ({
        id,
        operation: "items.update",
        resource: `/items/${id}`,
        rows: [id],
        fields: ["title"],
        view: `Update ${id}`,
        tier: "low",
        undo: "restore",
        stepUp: false,
      })),
    },
    outcomes: [],
    // A plan in initial review carries the host's confirmation record.
    ...(recovery.phase === "initial-review"
      ? {
          confirmation: {
            token: `token-${plan.recordId}`,
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            planId: plan.planId,
            conversationId: plan.conversationId,
            revision: plan.revision,
            heading: "Update 2 records in items",
            items: [{ label: "Item s1: title", after: '"After"' }],
            irreversible: false,
            undo: "Undoing these changes is not available in this version.",
            verificationCount: 0,
          },
        }
      : {}),
    recovery,
  } as unknown as PlanRecord;
}
/** The notice a client publishes for this reply. */
export function noticeOf(reply: unknown): IntentNotice {
  const { slotVersion, ...facts } = reply as { slotVersion: number };
  return { ...facts, resolvedSlotVersion: slotVersion } as IntentNotice;
}
