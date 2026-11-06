// Host-side terminal-intent resolver for protected plans: confirmation,
// Stop, both Cancel kinds, Leave and Keep, decision rounds and their join,
// the permanent Keep receipt and sealing, step fences and readback truth. It is a pure
// state transition over one plan's safety state: every function takes the
// current state and returns the next state with its reply, so a host can run
// it inside its own per-plan transaction (the reference fixture serializes
// per plan). It is not part of the client bundle.

import { sha256Base64Url } from "./digest";
import type {
  DecisionVersions,
  IntentCause,
  IntentKind,
  IntentRequest,
  IntentTarget,
  PlanIntentReply as IntentReply,
  RecoveryPhase,
  RecoveryView,
  WinnerKind,
} from "../protocol/generated";
export type {
  IntentCause,
  IntentKind,
  IntentRequest,
  IntentTarget,
  IntentReply,
  RecoveryPhase,
  WinnerKind,
};
export type IntentResult = IntentReply["result"];
export const RECOVERY_PROFILE = "plan-recovery-v1";
export const RECOVERY_PHASES = [
  "proposal",
  "initial-review",
  "forward-active",
  "readback",
  "completed",
  "cancelled",
  "left-known",
  "left-unconfirmed",
  "left-reopened",
] as const satisfies readonly RecoveryPhase[];
export const INTENT_KINDS: readonly IntentKind[] = [
  "stop",
  "cancel-initial",
  "cancel-review",
  "leave",
  "keep",
];
export interface Review {
  id: string;
  revision: number;
  digest: string;
  // current: the review awaiting confirmation; replaced: superseded before
  // acceptance; closed: closed unaccepted; accepted: its execution exists.
  state: "current" | "replaced" | "closed" | "accepted";
}
export interface StepRecord {
  admitted: boolean;
  operationId?: string;
  applied?: string;
  // The response the host returned when the operation committed, replayed
  // byte for byte to an exact retry.
  response?: string;
  noEffect?: string;
  // A receipt for this operation that disagrees, or cannot be read.
  contradictory?: boolean;
}
export interface Execution {
  id: string;
  fence: number;
  fenced: boolean;
  // How the execution ended: normally completed, or by a fence.
  result: "running" | "completed" | "stopped";
  reviewId: string;
  steps: Record<string, StepRecord>;
}
export interface Applied {
  kind: WinnerKind;
  round: number;
  target: string;
  payload: string;
  cause: IntentCause;
  // What its application did: closed the decision, fenced a live execution,
  // or resolved an already settled target.
  effect: "close" | "fence" | "settled";
  reply: IntentReply;
  // What a Leave closure saved: its disposition and count.
  disposition?: SavedDisposition;
}
// Names a slot's applied entry by its semantic identity.
export interface EntryRef {
  round: number;
  target: string;
  payload: string;
}
export type KeepEffect = NonNullable<
  IntentReply["finalHistory"]
>["keptFact"]["keepEffect"];
// What a Keep closure saved for good, before the record is sealed. The
// entries it names stay in their slots, which are kept for the record's
// lifetime, so their stored resolutions are the replay bytes.
export interface PermanentKeepReceipt {
  keepEntry: EntryRef;
  round: number;
  decisionDigest?: string;
  actorOrigin: { cause: IntentCause; principal?: string };
  appliedRevision: number;
  keepEffect: KeepEffect;
  cause: "kept";
  result: "already-kept";
  roundJoin?: RoundJoin;
  priorLeaveApplied?: EntryRef;
  finalWinner: { kind: WinnerKind; cause: IntentCause };
}
export type SavedDisposition = NonNullable<IntentReply["savedDisposition"]>;
export interface Slot {
  version: number;
  current?: Applied;
  lastApplied?: Applied;
}
// The one current join: the round a Leave opened from its predecessor, with
// the evidence it acknowledged and the winner and resolution versions it
// acknowledged at opening, which are the floors for joining it.
export interface RoundJoin {
  fromRound: number;
  toRound: number;
  sourceDecisionKey: string;
  acknowledgedEvidenceVersion: number;
  openingWinnerVersion: number;
  openingDecisionResolutionVersion: number;
  semanticEvidenceDigest: string;
  openingWinnerSnapshot?: Applied;
}
export interface ProtectedPlan {
  // Unique per created record, across hosts: binds proofs to this record.
  recordId: string;
  planId: string;
  conversationId: string;
  generation: string;
  // Earlier generations of this plan: their tokens are members but unrelated.
  earlierTokens: string[];
  round: number;
  revision: number;
  phase: RecoveryPhase;
  inhibited: boolean;
  reviews: Review[];
  acceptance?: {
    executionId: string;
    clientReplyId: string;
    reviewId: string;
    revision: number;
    digest: string;
    protocol: string;
  };
  executions: Record<string, Execution>;
  slots: Record<IntentKind, Slot>;
  // The current round's winner; the winner of the round before an opening
  // stays as `priorWinner` so its applied fact is still shown.
  winner?: Applied;
  priorWinner?: Applied;
  nextFence: number;
  // The plan's steps in order, for the decision's readback evidence.
  stepIds: string[];
  versions: DecisionVersions;
  // The versions when the current round opened.
  baseline: DecisionVersions;
  evidenceDigest?: string;
  // The execution result the evidence version last counted.
  evidenceResult?: Execution["result"];
  join?: RoundJoin;
  // Own history retention of a settled plan; ended only by Keep here.
  retention?: { completedAt?: number; ended?: "kept" };
  receipt?: PermanentKeepReceipt;
  // Final: no writer changes the decision history of a sealed record.
  sealed?: boolean;
  // Receipts learned after sealing, kept beside the sealed history.
  afterSeal?: { contradicted: string[] };
}

export function createProtectedPlan(input: {
  planId: string;
  conversationId: string;
  generation: string;
  review?: Review;
  steps?: readonly string[];
}): ProtectedPlan {
  const slot = (): Slot => ({ version: 0 });
  const zero = (): DecisionVersions => ({
    evidence: 0,
    winner: 0,
    decisionResolution: 0,
  });
  return {
    recordId: globalThis.crypto.randomUUID(),
    planId: input.planId,
    conversationId: input.conversationId,
    generation: input.generation,
    earlierTokens: [],
    round: 1,
    revision: 1,
    phase: input.review ? "initial-review" : "proposal",
    inhibited: false,
    reviews: input.review ? [{ ...input.review }] : [],
    executions: {},
    slots: {
      stop: slot(),
      "cancel-initial": slot(),
      "cancel-review": slot(),
      leave: slot(),
      keep: slot(),
    },
    nextFence: 1,
    stepIds: [...(input.steps ?? [])],
    versions: zero(),
    baseline: zero(),
  };
}
// Retry index, held by each record object: it changes only on the successor
// a transition returns, so it takes effect when the host stores that record
// and disappears with any record the host drops. An entry lives until its
// operation commits, its execution is fenced or the host releases the record.
const pending = new WeakMap<ProtectedPlan, Map<string, Admission>>();
// A successor record starts with its own copy of the source's retry index,
// so a transition that is discarded never changes the stored record's.
const clone = (plan: ProtectedPlan): ProtectedPlan => {
  const copy = JSON.parse(JSON.stringify(plan)) as ProtectedPlan;
  const entries = pending.get(plan);
  if (entries) pending.set(copy, new Map(entries));
  return copy;
};
// Only a record this host stored counts: an inherited name such as
// `constructor` or `__proto__` is never a member.
const own = <T>(map: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(map, key) ? map[key] : undefined;

// The decision's readback evidence: every step's truth in step order, whose
// digest commits to the whole unknown set, and the execution's result.
const evidenceOf = (plan: ProtectedPlan) => {
  const id = plan.acceptance?.executionId;
  if (!id) return undefined;
  const truths = readback(plan, id, plan.stepIds);
  return {
    digest: sha256Base64Url(
      JSON.stringify(truths.map((item) => [item.stepId, item.truth])),
    ),
    result: plan.executions[id]!.result,
    unknown: truths.filter((item) => item.truth === "unknown").length,
  };
};
// Called by every writer after it changed a plan record: a changed digest
// is new evidence, and actual evidence change invalidates the join.
const settle = (plan: ProtectedPlan): boolean => {
  const evidence = evidenceOf(plan);
  if (
    evidence?.digest === plan.evidenceDigest &&
    evidence?.result === plan.evidenceResult
  )
    return false;
  plan.evidenceDigest = evidence?.digest;
  plan.evidenceResult = evidence?.result;
  plan.versions.evidence++;
  delete plan.join;
  return true;
};

// ---------------------------------------------------------------------------
// Target mapping: ordered, membership first.

export type Mapping =
  | { rule: "foreign"; kind: "invalid" }
  | { rule: "earlier-generation" | "replaced-review"; kind: "obsolete" }
  | { rule: "unaccepted-generation"; kind: "generation" }
  | {
      rule: "first-acceptance" | "accepted-review" | "execution";
      kind: "execution";
      execution: string;
    }
  | { rule: "current-review"; kind: "review"; review: string }
  | { rule: "closed-review"; kind: "closed-review"; review: string };

export function mapTarget(plan: ProtectedPlan, target: IntentTarget): Mapping {
  const review = plan.reviews.find((item) => item.id === target.id);
  const execution = own(plan.executions, target.id);
  const member =
    (target.type === "generation" && target.id === plan.generation) ||
    (target.type === "review" && review !== undefined) ||
    (target.type === "execution" && execution !== undefined) ||
    plan.earlierTokens.includes(target.id);
  if (!member) return { rule: "foreign", kind: "invalid" };
  if (plan.earlierTokens.includes(target.id))
    return { rule: "earlier-generation", kind: "obsolete" };
  const accepted = plan.acceptance?.executionId;
  if (target.type === "generation")
    return accepted
      ? { rule: "first-acceptance", kind: "execution", execution: accepted }
      : { rule: "unaccepted-generation", kind: "generation" };
  if (target.type === "review") {
    if (review!.state === "current")
      return { rule: "current-review", kind: "review", review: review!.id };
    if (review!.state === "replaced")
      return { rule: "replaced-review", kind: "obsolete" };
    if (review!.state === "closed")
      return {
        rule: "closed-review",
        kind: "closed-review",
        review: review!.id,
      };
    const run = Object.values(plan.executions).find(
      (item) => item.reviewId === review!.id,
    )!;
    return { rule: "accepted-review", kind: "execution", execution: run.id };
  }
  return { rule: "execution", kind: "execution", execution: target.id };
}

// ---------------------------------------------------------------------------
// Confirmation: the first matching rule wins.

/**
 * A validated confirmation as it arrives (see `parseConfirm`); the host
 * resolves its review itself.
 */
export interface ConfirmCommand {
  clientReplyId: string;
  digest: string;
  protocol: string;
}
export type ConfirmReply =
  | {
      result: "accepted";
      rule: "first-acceptance";
      executionId: string;
      fence: number;
    }
  | { result: "replayed"; rule: "replay"; executionId: string }
  | {
      result: "refused";
      rule:
        | "inhibited"
        | "activation-history"
        | "not-initial-review"
        | "stale-review"
        | "digest-mismatch";
      key: string;
    };

export function confirm(
  input: ProtectedPlan,
  command: ConfirmCommand,
): { plan: ProtectedPlan; reply: ConfirmReply } {
  const plan = clone(input);
  const refuse = (
    rule:
      | "inhibited"
      | "activation-history"
      | "not-initial-review"
      | "stale-review"
      | "digest-mismatch",
    key: string,
  ) => ({
    plan: input,
    reply: { result: "refused" as const, rule, key },
  });
  if (plan.inhibited || plan.phase === "cancelled")
    return refuse("inhibited", "intentClosed");
  const accepted = plan.acceptance;
  if (accepted) {
    // An exact replay acknowledges the recorded acceptance again and grants
    // nothing new; any other confirmation meets activation history.
    // Every field of the command must equal the accepted one.
    const same =
      accepted.clientReplyId === command.clientReplyId &&
      accepted.digest === command.digest &&
      accepted.protocol === command.protocol;
    return same
      ? {
          plan: input,
          reply: {
            result: "replayed",
            rule: "replay",
            executionId: accepted.executionId,
          },
        }
      : refuse("activation-history", "activationHistory");
  }
  if (plan.phase !== "initial-review")
    return refuse(
      "not-initial-review",
      plan.phase === "proposal" ? "reviewMissing" : "activationHistory",
    );
  const review = plan.reviews.find((item) => item.state === "current");
  if (!review) return refuse("stale-review", "reviewStale");
  if (review.digest !== command.digest)
    return plan.reviews.some(
      (item) => item.state === "replaced" && item.digest === command.digest,
    )
      ? refuse("stale-review", "reviewStale")
      : refuse("digest-mismatch", "reviewStale");
  // The record id makes execution authority unique across record lifetimes,
  // so a replacement never reissues an earlier record's execution; the id
  // does not repeat the plan id, keeping it within the wire token bound
  // whatever the plan id's length.
  const executionId = `${plan.recordId}.e${plan.nextFence}`;
  const fence = plan.nextFence++;
  review.state = "accepted";
  plan.executions[executionId] = {
    id: executionId,
    fence,
    fenced: false,
    result: "running",
    reviewId: review.id,
    steps: {},
  };
  plan.acceptance = {
    executionId,
    clientReplyId: command.clientReplyId,
    reviewId: review.id,
    revision: review.revision,
    digest: review.digest,
    protocol: command.protocol,
  };
  plan.phase = "forward-active";
  plan.revision++;
  settle(plan);
  return {
    plan,
    reply: { result: "accepted", rule: "first-acceptance", executionId, fence },
  };
}

/** Replaces the current unaccepted review of the same generation. */
export function replaceReview(
  input: ProtectedPlan,
  review: Review,
): ProtectedPlan {
  const plan = clone(input);
  if (plan.acceptance || plan.inhibited) return input;
  for (const item of plan.reviews)
    if (item.state === "current") item.state = "replaced";
  plan.reviews.push({ ...review, state: "current" });
  plan.phase = "initial-review";
  plan.revision++;
  return plan;
}

// ---------------------------------------------------------------------------
// Fences and readback truth.

export type StepEvent = "admission" | "commit" | "renewal";
declare const admissionBrand: unique symbol;
/**
 * Proof that one operation of one step was admitted by this module. Only
 * an admission returns it; a commit requires it.
 */
export interface Admission {
  readonly [admissionBrand]: true;
}
interface Admitted {
  recordId: string;
  conversationId: string;
  generation: string;
  executionId: string;
  fence: number;
  stepId: string;
  operationId: string;
}
// Issued admissions, by identity: a copy or an object built elsewhere is
// never one, and an admission names exactly one operation of one plan
// record (record, conversation, generation, execution, fence, step).
const admissions = new WeakMap<Admission, Admitted>();
const admissionKey = (value: Admitted) =>
  JSON.stringify([
    value.recordId,
    value.conversationId,
    value.generation,
    value.executionId,
    value.fence,
    value.stepId,
    value.operationId,
  ]);
/** Admissions of this stored record still awaiting their commit. */
export function pendingAdmissions(plan: ProtectedPlan): number {
  return pending.get(plan)?.size ?? 0;
}
/** Releases everything this module keeps for a plan record the host drops. */
export function releasePlan(plan: ProtectedPlan): void {
  pending.delete(plan);
}
export type StepRequest =
  | { event: "renewal"; executionId: string; fence: number }
  | {
      event: "admission";
      executionId: string;
      fence: number;
      stepId: string;
      operationId: string;
    }
  | {
      event: "commit";
      executionId: string;
      fence: number;
      stepId: string;
      operationId: string;
      admission: Admission;
      receipt?: string;
      response?: string;
    };
export type FenceResult =
  | { result: "allowed"; rule: "live"; admission?: Admission }
  | {
      result: "existing";
      rule: "existing";
      receipt?: string;
      response?: string;
      admission?: Admission;
    }
  | {
      result: "refused";
      rule: "stale-token" | "fenced" | "live" | "sealed";
      key: "staleFence" | "fenced" | "notAdmitted" | "sealed";
    };

export function stepEvent(
  input: ProtectedPlan,
  request: StepRequest,
): { plan: ProtectedPlan; reply: FenceResult } {
  const execution = own(input.executions, request.executionId);
  if (!execution || execution.fence !== request.fence)
    return {
      plan: input,
      reply: { result: "refused", rule: "stale-token", key: "staleFence" },
    };
  // A sealed record admits nothing new; only an exact retry of a committed
  // operation gets its existing receipt back.
  if (input.sealed) {
    const step =
      request.event === "renewal"
        ? undefined
        : own(execution.steps, request.stepId);
    // A commit retry still needs this module's own admission for it.
    const proof =
      request.event === "commit"
        ? admissions.get(request.admission)
        : undefined;
    const proven =
      request.event !== "commit" ||
      (proof !== undefined &&
        admissionKey(proof) ===
          admissionKey({
            recordId: input.recordId,
            conversationId: input.conversationId,
            generation: input.generation,
            executionId: request.executionId,
            fence: request.fence,
            stepId: request.stepId,
            operationId: request.operationId,
          }));
    if (
      request.event !== "renewal" &&
      proven &&
      step?.applied !== undefined &&
      step.operationId === request.operationId
    )
      return {
        plan: input,
        reply: {
          result: "existing",
          rule: "existing",
          receipt: step.applied,
          response: step.response,
        },
      };
    return {
      plan: input,
      reply: { result: "refused", rule: "sealed", key: "sealed" },
    };
  }
  // A fence refuses every new event; the step's own record is untouched.
  if (execution.fenced)
    return {
      plan: input,
      reply: { result: "refused", rule: "fenced", key: "fenced" },
    };
  if (request.event === "renewal")
    return { plan: input, reply: { result: "allowed", rule: "live" } };
  const notAdmitted = {
    plan: input,
    reply: {
      result: "refused" as const,
      rule: "live" as const,
      key: "notAdmitted" as const,
    },
  };
  const step = own(execution.steps, request.stepId);
  const identity: Admitted = {
    recordId: input.recordId,
    conversationId: input.conversationId,
    generation: input.generation,
    executionId: request.executionId,
    fence: request.fence,
    stepId: request.stepId,
    operationId: request.operationId,
  };
  if (request.event === "admission") {
    if (step?.admitted) {
      // A retry of the same operation gets its admission back; another
      // operation on an admitted step is refused, evidence unchanged.
      if (step.operationId !== request.operationId) return notAdmitted;
      return {
        plan: input,
        reply: {
          result: "existing",
          rule: "existing",
          receipt: step.applied,
          response: step.response,
          admission: pending.get(input)?.get(admissionKey(identity)),
        },
      };
    }
    const plan = clone(input);
    plan.executions[request.executionId]!.steps[request.stepId] = {
      admitted: true,
      operationId: request.operationId,
    };
    plan.revision++;
    const admission = Object.freeze({}) as Admission;
    admissions.set(admission, identity);
    const entries = pending.get(plan) ?? new Map<string, Admission>();
    entries.set(admissionKey(identity), admission);
    pending.set(plan, entries);
    return { plan, reply: { result: "allowed", rule: "live", admission } };
  }
  // A commit needs this module's own admission for this exact operation.
  const proof = admissions.get(request.admission);
  if (
    !proof ||
    admissionKey(proof) !== admissionKey(identity) ||
    !step?.admitted ||
    step.operationId !== request.operationId
  )
    return notAdmitted;
  if (step.applied !== undefined)
    return {
      plan: input,
      reply: {
        result: "existing",
        rule: "existing",
        receipt: step.applied,
        response: step.response,
      },
    };
  const plan = clone(input);
  const committed =
    plan.executions[request.executionId]!.steps[request.stepId]!;
  committed.applied = request.receipt ?? "applied";
  if (request.response !== undefined) committed.response = request.response;
  plan.revision++;
  settle(plan);
  pending.get(plan)?.delete(admissionKey(identity));
  return { plan, reply: { result: "allowed", rule: "live" } };
}

export type StepTruth = "done" | "not-done" | "unknown";
export function stepTruth(
  step: StepRecord | undefined,
  excluded: boolean,
): {
  truth: StepTruth;
  rule:
    | "contradiction"
    | "applied"
    | "no-effect-excluded"
    | "never-admitted-excluded"
    | "unproven";
} {
  if (step?.contradictory || (step?.applied && step.noEffect))
    return { truth: "unknown", rule: "contradiction" };
  if (step?.applied) return { truth: "done", rule: "applied" };
  if (step?.noEffect && excluded)
    return { truth: "not-done", rule: "no-effect-excluded" };
  if (!step?.admitted && excluded)
    return { truth: "not-done", rule: "never-admitted-excluded" };
  return { truth: "unknown", rule: "unproven" };
}
export function readback(
  plan: ProtectedPlan,
  executionId: string,
  stepIds: readonly string[],
): { stepId: string; truth: StepTruth }[] {
  const execution = own(plan.executions, executionId);
  return stepIds.map((stepId) => ({
    stepId,
    truth: stepTruth(
      execution ? own(execution.steps, stepId) : undefined,
      execution?.fenced ?? false,
    ).truth,
  }));
}

/** Records normal completion of the accepted execution. */
export function completeExecution(
  input: ProtectedPlan,
  now?: number,
): ProtectedPlan {
  const id = input.acceptance?.executionId;
  const execution = id ? input.executions[id] : undefined;
  if (!execution || execution.fenced || execution.result !== "running")
    return input;
  const plan = clone(input);
  plan.executions[id!]!.result = "completed";
  plan.phase = "completed";
  plan.retention = now === undefined ? {} : { completedAt: now };
  plan.revision++;
  settle(plan);
  return plan;
}

/**
 * Records a receipt for a step that disagrees with what is recorded, or
 * cannot be read. A closed Leave decision whose evidence changes is
 * reopened.
 */
export function recordContradiction(
  input: ProtectedPlan,
  executionId: string,
  stepId: string,
): ProtectedPlan {
  const execution = own(input.executions, executionId);
  if (
    !execution ||
    !input.stepIds.includes(stepId) ||
    own(execution.steps, stepId)?.contradictory
  )
    return input;
  // A sealed record's decision history is final: the late receipt is kept
  // beside it, without changing its truths, versions, join or phase.
  if (input.sealed) {
    if (input.afterSeal?.contradicted.includes(stepId)) return input;
    const plan = clone(input);
    plan.afterSeal = {
      contradicted: [...(input.afterSeal?.contradicted ?? []), stepId],
    };
    plan.revision++;
    return plan;
  }
  const plan = clone(input);
  const steps = plan.executions[executionId]!.steps;
  // The receipt is a host fact even when the step's truth is already
  // unknown: it still decides the truth once a later proof arrives.
  steps[stepId] = {
    ...(own(steps, stepId) ?? { admitted: false }),
    contradictory: true,
  };
  plan.revision++;
  // Only an actual evidence change reopens a closure (and clears the join).
  if (
    settle(plan) &&
    (plan.phase === "left-known" || plan.phase === "left-unconfirmed")
  )
    plan.phase = "left-reopened";
  return plan;
}

// ---------------------------------------------------------------------------
// Intent request validation: every body is checked against its shape and
// bounds before any resolver code reads it.

/** The largest intent body a host accepts, in bytes. */
export const MAX_INTENT_BODY_BYTES = 8192;
const MAX_PAYLOAD_BYTES = 4096;
const TOKEN = /^[A-Za-z0-9._~-]{1,128}$/;
const CAUSES: readonly IntentCause[] = [
  "user",
  "connection-lost",
  "renewal-refused",
  "step-failed",
  "step-up-failed",
  "identity-lost",
  "attribution-missing",
  "plan-changed",
  "adapter-configuration",
];
const FIELDS = new Set([
  "kind",
  "planId",
  "target",
  "capturedRound",
  "expectedSlotVersion",
  "correlation",
  "cause",
  "payload",
  "acknowledgment",
  "review",
]);
const ACKNOWLEDGMENT_FIELDS = [
  "sourceDecisionKey",
  "evidenceVersion",
  "winnerVersion",
  "decisionResolutionVersion",
  "evidenceDigest",
  "unknownCount",
];
const DIGEST = /^[A-Za-z0-9_-]{43}$/;
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const CONFIRM_FIELDS = new Set([
  "kind",
  "protocol",
  "clientReplyId",
  // Checked by the host's confirmation boundary before this command.
  "confirmationToken",
  "planId",
  "digest",
]);
/**
 * Returns a confirmation's command when its body is exactly a confirmation
 * of `planId`; anything else (another field, another type, another plan)
 * is refused before any comparison, never coerced.
 */
export function parseConfirm(
  body: unknown,
  planId: string,
): ConfirmCommand | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return undefined;
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !CONFIRM_FIELDS.has(key)) ||
    value.kind !== "confirm" ||
    value.planId !== planId ||
    typeof value.protocol !== "string" ||
    !/^\d{1,3}\.\d{1,3}$/.test(value.protocol) ||
    typeof value.clientReplyId !== "string" ||
    !TOKEN.test(value.clientReplyId) ||
    typeof value.digest !== "string" ||
    !TOKEN.test(value.digest)
  )
    return undefined;
  return {
    clientReplyId: value.clientReplyId,
    digest: value.digest,
    protocol: value.protocol,
  };
}
/** Returns the request when it is well formed and within bounds. */
export function parseIntentRequest(body: unknown): IntentRequest | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return undefined;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !FIELDS.has(key))) return undefined;
  const target = value.target as Record<string, unknown> | null;
  if (
    !INTENT_KINDS.includes(value.kind as IntentKind) ||
    typeof value.planId !== "string" ||
    !TOKEN.test(value.planId) ||
    typeof target !== "object" ||
    target === null ||
    Object.keys(target).some((key) => key !== "type" && key !== "id") ||
    !["generation", "review", "execution"].includes(target.type as string) ||
    typeof target.id !== "string" ||
    !TOKEN.test(target.id) ||
    !count(value.capturedRound) ||
    !count(value.expectedSlotVersion) ||
    typeof value.correlation !== "string" ||
    !TOKEN.test(value.correlation) ||
    !CAUSES.includes(value.cause as IntentCause)
  )
    return undefined;
  // Only a Leave carries an acknowledgment, and it must be complete; Stop
  // and both Cancel kinds never join a round, even when a body claims to.
  const ack = value.acknowledgment as Record<string, unknown> | undefined;
  // Leave and Keep carry an acknowledgment, and only Keep a review.
  if ((value.kind === "leave" || value.kind === "keep") !== (ack !== undefined))
    return undefined;
  if (
    (value.kind === "keep") !== (value.review !== undefined) ||
    (value.review !== undefined &&
      value.review !== "forward-only" &&
      value.review !== "end-retention")
  )
    return undefined;
  if (
    ack !== undefined &&
    (typeof ack !== "object" ||
      ack === null ||
      Array.isArray(ack) ||
      Object.keys(ack).length !== ACKNOWLEDGMENT_FIELDS.length ||
      ACKNOWLEDGMENT_FIELDS.some((key) => !Object.hasOwn(ack, key)) ||
      typeof ack.sourceDecisionKey !== "string" ||
      !TOKEN.test(ack.sourceDecisionKey) ||
      typeof ack.evidenceDigest !== "string" ||
      !DIGEST.test(ack.evidenceDigest) ||
      !count(ack.evidenceVersion) ||
      !count(ack.winnerVersion) ||
      !count(ack.decisionResolutionVersion) ||
      !count(ack.unknownCount))
  )
    return undefined;
  if (value.payload !== undefined) {
    if (typeof value.payload !== "string") return undefined;
    const normalized = value.payload.normalize("NFC");
    if (new TextEncoder().encode(normalized).length > MAX_PAYLOAD_BYTES)
      return undefined;
  }
  return {
    kind: value.kind as IntentKind,
    planId: value.planId,
    target: { type: target.type as IntentTarget["type"], id: target.id },
    capturedRound: value.capturedRound as number,
    expectedSlotVersion: value.expectedSlotVersion as number,
    correlation: value.correlation,
    cause: value.cause as IntentCause,
    ...(value.payload !== undefined
      ? { payload: (value.payload as string).normalize("NFC") }
      : {}),
    ...(value.review !== undefined
      ? { review: value.review as NonNullable<IntentRequest["review"]> }
      : {}),
    ...(ack !== undefined
      ? {
          acknowledgment: {
            sourceDecisionKey: ack.sourceDecisionKey as string,
            evidenceVersion: ack.evidenceVersion as number,
            winnerVersion: ack.winnerVersion as number,
            decisionResolutionVersion: ack.decisionResolutionVersion as number,
            evidenceDigest: ack.evidenceDigest as string,
            unknownCount: ack.unknownCount as number,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Terminal intents: request steps, precedence and the per-phase cells.

const RANK: Record<WinnerKind, number> = {
  stop: 3,
  "cancel-initial": 2,
  "cancel-review": 2,
  keep: 1,
  leave: 0,
};
type DecisionState = "open" | "closed" | "settled" | "none";
const decisionState = (phase: RecoveryPhase): DecisionState =>
  phase === "forward-active" || phase === "readback"
    ? "open"
    : phase === "completed"
      ? "settled"
      : phase === "proposal" || phase === "initial-review"
        ? "none"
        : "closed";

// What one cell does to the plan, before precedence decides whether it
// applies. `fence` names a live execution the cell would fence.
interface Cell {
  outcome: "close" | "fence" | "settled" | "obsolete";
  keys: string[];
  fence?: string;
  target?: string;
}

function cell(plan: ProtectedPlan, kind: IntentKind, mapping: Mapping): Cell {
  const obsolete: Cell = { outcome: "obsolete", keys: ["intentSuperseded"] };
  if (mapping.kind === "obsolete" || mapping.kind === "invalid")
    return obsolete;
  const phase = plan.phase;
  const live =
    mapping.kind === "execution" &&
    !plan.executions[mapping.execution]!.fenced &&
    plan.executions[mapping.execution]!.result === "running";
  if (kind === "cancel-review") {
    // The review Cancel resolves only an exact captured review.
    if (
      mapping.rule === "current-review" ||
      mapping.rule === "unaccepted-generation"
    )
      return obsolete; // an initial review is not a review Cancel target
    if (mapping.kind === "closed-review")
      return {
        outcome: "settled",
        keys: ["alreadyClosed"],
        target: mapping.review,
      };
    if (mapping.rule !== "accepted-review") return obsolete;
    const execution = plan.executions[mapping.execution]!;
    if (live)
      return {
        outcome: "fence",
        keys: ["reviewTargetStopped"],
        fence: execution.id,
        target: execution.id,
      };
    return {
      outcome: "settled",
      keys: [
        execution.result === "completed"
          ? "reviewTargetSettled"
          : "reviewTargetStopped",
      ],
      target: execution.id,
    };
  }
  // Stop and the initial Cancel follow the generation to its first
  // acceptance.
  if (mapping.kind === "generation" || mapping.kind === "review") {
    if (
      phase !== "proposal" &&
      phase !== "initial-review" &&
      phase !== "cancelled"
    )
      return obsolete;
    return {
      outcome: "close",
      keys: [
        phase === "cancelled"
          ? "initialTargetClosed"
          : kind === "stop"
            ? "stoppedNoChanges"
            : "cancelledNoChanges",
      ],
      target: plan.generation,
    };
  }
  // A Stop captured on a review closed unaccepted resolves to that closure.
  if (mapping.kind === "closed-review")
    return {
      outcome: "settled",
      keys: ["alreadyClosed"],
      target: mapping.review,
    };
  const execution = plan.executions[mapping.execution]!;
  if (live)
    return {
      outcome: "fence",
      keys: [kind === "stop" ? "stopped" : "cancelStarted"],
      fence: execution.id,
      target: execution.id,
    };
  return {
    outcome: "settled",
    keys: [
      execution.result === "completed"
        ? "initialTargetSettled"
        : "initialTargetStopped",
    ],
    target: execution.id,
  };
}

export interface ResolveOptions {
  // Whether this host offers Leave and Keep on the safety-control route.
  leave?: boolean;
  keep?: boolean;
  // The authenticated principal, recorded as a Keep's origin.
  principal?: string;
  // The host clock, recorded when a closure settles the plan.
  now?: number;
}
// Planned forward work that will never run: steps never admitted and
// excluded by the fence.
const remainingOf = (plan: ProtectedPlan): number => {
  const id = plan.acceptance?.executionId;
  const run = id ? plan.executions[id] : undefined;
  if (!run?.fenced) return 0;
  return readback(plan, id!, plan.stepIds).filter(
    (item) =>
      item.truth === "not-done" && !own(run.steps, item.stepId)?.admitted,
  ).length;
};
/**
 * The host-owned Keep guards, in order: live work, unknown or unresolved
 * enrollment (including an admission still pending), an open review.
 */
export function keepBlocker(plan: ProtectedPlan): string | undefined {
  const id = plan.acceptance?.executionId;
  const run = id ? plan.executions[id] : undefined;
  if (run && !run.fenced && run.result === "running")
    return "keepBlockedActive";
  if (
    (evidenceOf(plan)?.unknown ?? 0) > 0 ||
    (run !== undefined &&
      Object.values(run.steps).some(
        (step) => step.admitted && step.applied === undefined && !step.noEffect,
      )) ||
    pendingAdmissions(plan) > 0
  )
    return "keepBlockedUnknown";
  if (plan.reviews.some((review) => review.state === "current"))
    return "keepBlockedReview";
  return undefined;
}
const keepGuard = keepBlocker;
/** A sealed record's final facts, reported beside any answer about it. */
function finalHistoryOf(
  plan: ProtectedPlan,
  extra: Partial<NonNullable<IntentReply["finalHistory"]>> = {},
): NonNullable<IntentReply["finalHistory"]> {
  const receipt = plan.receipt!;
  return {
    winner: { ...receipt.finalWinner },
    keptFact: {
      keepEffect: receipt.keepEffect,
      actorCause: receipt.actorOrigin.cause,
      round: receipt.round,
    },
    ...extra,
    ...(plan.afterSeal
      ? { contradictedAfterSeal: [...plan.afterSeal.contradicted] }
      : {}),
  };
}
/** The join a record classifies against: a sealed record keeps its Keep's. */
export function classificationJoin(plan: ProtectedPlan): RoundJoin | undefined {
  return plan.sealed ? plan.receipt?.roundJoin : plan.join;
}
/** Whether a sealed Keep covers a Leave that reached its round. */
export function keepCoversLeave(
  receipt: PermanentKeepReceipt,
  joined: boolean,
): boolean {
  return joined && receipt.keepEffect !== "retention-ended";
}
/** Whether a Keep completes the Leave closure that is the round's winner. */
export function keepCompletesLeave(
  plan: ProtectedPlan,
  joined: boolean,
): boolean {
  return (
    plan.phase === "left-known" &&
    joined &&
    plan.winner?.kind === "leave" &&
    plan.winner.effect === "close"
  );
}
const reviewFits = (plan: ProtectedPlan, review: IntentRequest["review"]) =>
  review === (remainingOf(plan) > 0 ? "forward-only" : "end-retention");
// Whether nothing still holds the record open: no open decision, no
// unknown or enrollment, no live run, no open review, own retention ended.
const sealable = (plan: ProtectedPlan) =>
  !["forward-active", "readback", "left-reopened", "left-unconfirmed"].includes(
    plan.phase,
  ) &&
  keepGuard(plan) === undefined &&
  plan.retention?.ended === "kept";
type Acknowledgment = NonNullable<IntentRequest["acknowledgment"]>;
// Whether an acknowledgment matches the current join's source and evidence.
const joinIdentity = (join: RoundJoin | undefined, ack: Acknowledgment) =>
  join !== undefined &&
  ack.sourceDecisionKey === join.sourceDecisionKey &&
  ack.evidenceVersion === join.acknowledgedEvidenceVersion &&
  ack.evidenceDigest === join.semanticEvidenceDigest;
const joinFloors = (join: RoundJoin, ack: Acknowledgment) =>
  ack.winnerVersion >= join.openingWinnerVersion &&
  ack.decisionResolutionVersion >= join.openingDecisionResolutionVersion;
/** Whether any decision version is newer than the round's baseline. */
export function newerThanBaseline(
  versions: DecisionVersions,
  baseline: DecisionVersions,
): boolean {
  return (
    versions.evidence > baseline.evidence ||
    versions.winner > baseline.winner ||
    versions.decisionResolution > baseline.decisionResolution
  );
}
// A Leave opens the next round only with every current version
// acknowledged, the exact current source and evidence, at least one version
// newer than the round's baseline, and a closure its cell will apply.
const opens = (plan: ProtectedPlan, ack: Acknowledgment) => {
  const evidence = evidenceOf(plan);
  const versions = plan.versions;
  return (
    (plan.phase === "readback" || plan.phase === "left-reopened") &&
    evidence !== undefined &&
    ack.sourceDecisionKey === plan.acceptance!.executionId &&
    ack.evidenceDigest === plan.evidenceDigest &&
    ack.evidenceVersion === versions.evidence &&
    ack.winnerVersion === versions.winner &&
    ack.decisionResolutionVersion === versions.decisionResolution &&
    newerThanBaseline(versions, plan.baseline) &&
    ack.unknownCount === evidence.unknown
  );
};
// Opens the next round: its baseline is the actual host versions, the join
// records the opening acknowledgment, and the new round starts without a
// winner or current intents.
const openRound = (input: ProtectedPlan, ack: Acknowledgment) => {
  const plan = clone(input);
  plan.join = {
    fromRound: input.round,
    toRound: input.round + 1,
    sourceDecisionKey: ack.sourceDecisionKey,
    acknowledgedEvidenceVersion: input.versions.evidence,
    openingWinnerVersion: input.versions.winner,
    openingDecisionResolutionVersion: input.versions.decisionResolution,
    semanticEvidenceDigest: input.evidenceDigest!,
    ...(input.winner ? { openingWinnerSnapshot: input.winner } : {}),
  };
  plan.baseline = { ...input.versions };
  plan.round++;
  if (input.winner) plan.priorWinner = input.winner;
  delete plan.winner;
  for (const kind of INTENT_KINDS) delete plan.slots[kind].current;
  return plan;
};
const winnerOf = (applied: Applied | undefined) =>
  applied ? { winner: { kind: applied.kind, cause: applied.cause } } : {};
// An answer against a Leave closure reports what that closure saved.
const savedOf = (applied: Applied | undefined) =>
  applied?.disposition ? { savedDisposition: { ...applied.disposition } } : {};

export function resolveIntent(
  input: ProtectedPlan,
  request: IntentRequest,
  options: ResolveOptions = {},
): { plan: ProtectedPlan; reply: IntentReply } {
  const base = (
    at: ProtectedPlan,
    result: IntentResult,
    keys: string[],
    extra: Partial<IntentReply> = {},
  ): IntentReply => ({
    planId: at.planId,
    kind: request.kind,
    capturedRound: request.capturedRound,
    correlation: request.correlation,
    effectiveRound: at.round,
    slotVersion: at.slots[request.kind].version,
    result,
    keys,
    ...winnerOf(at.winner),
    phase: at.phase,
    ...extra,
  });
  // Every answer on a sealed record also carries its final facts, apart
  // from whatever historical answer it gives.
  const unchanged = (reply: IntentReply) => ({
    plan: input,
    reply:
      input.sealed && !reply.finalHistory
        ? { ...reply, finalHistory: finalHistoryOf(input) }
        : reply,
  });
  // Only the phases this host can represent accept terminal intents.
  if (!(RECOVERY_PHASES as readonly string[]).includes(input.phase))
    return unchanged(base(input, "unavailable", ["intentUnavailable"]));
  // Leave and Keep are answered only where the host offers them.
  if (
    (request.kind === "leave" && options.leave !== true) ||
    (request.kind === "keep" && options.keep !== true)
  )
    return unchanged(base(input, "unavailable", ["capabilityMissing"]));
  // Target mapping, membership first: a foreign token is refused whatever
  // the round, never reported. The initial Cancel follows its generation:
  // any review or execution of the current generation resolves through it,
  // even a review replaced before acceptance.
  const raw = mapTarget(input, request.target);
  const mapping =
    request.kind === "cancel-initial" &&
    raw.kind !== "invalid" &&
    (raw.kind !== "obsolete" || raw.rule === "replaced-review")
      ? mapTarget(input, { type: "generation", id: input.generation })
      : raw;
  if (mapping.kind === "invalid")
    return unchanged(base(input, "invalid-target", ["invalidTarget"]));
  const target =
    mapping.kind === "execution"
      ? mapping.execution
      : mapping.kind === "review" || mapping.kind === "closed-review"
        ? mapping.review
        : mapping.kind === "generation"
          ? input.generation
          : request.target.id;
  // A superseded request names what is current now and whether this kind's
  // own earlier intent for the requested target was applied.
  const current_ = (): IntentTarget =>
    input.acceptance
      ? { type: "execution", id: input.acceptance.executionId }
      : input.reviews.some((item) => item.state === "current")
        ? {
            type: "review",
            id: input.reviews.find((item) => item.state === "current")!.id,
          }
        : { type: "generation", id: input.generation };
  const superseded = (keys: string[]) => {
    const slot = input.slots[request.kind];
    return unchanged(
      base(input, "superseded", keys, {
        requestedTargetApplied:
          slot.lastApplied !== undefined &&
          slot.lastApplied.round === request.capturedRound &&
          slot.lastApplied.target === target,
        replacement: current_(),
      }),
    );
  };
  let at = input;
  let opened = false;
  let joined = false;
  const ack = request.acknowledgment;
  const informed = request.kind === "leave" || request.kind === "keep";
  if (informed) {
    // Without an accepted decision there is nothing to leave or keep, and
    // nothing the acknowledgment's source could authorize.
    if (!input.acceptance)
      return unchanged(
        input.phase === "cancelled"
          ? base(input, "already-closed", ["alreadyClosedByWinner"])
          : base(input, "unavailable", [
              request.kind === "keep" ? "keepNoDecision" : "leaveNoDecision",
            ]),
      );
    // The canonical target must be the acknowledged decision.
    if (mapping.kind === "obsolete") return superseded(["intentSuperseded"]);
    if (mapping.kind === "closed-review")
      return unchanged(base(input, "already-closed", ["alreadyClosed"]));
    if (
      mapping.kind !== "execution" ||
      mapping.execution !== input.acceptance.executionId ||
      ack!.sourceDecisionKey !== mapping.execution
    )
      return unchanged(base(input, "invalid-target", ["invalidTarget"]));
    // An acknowledged version above the host's own is never trusted.
    if (
      ack!.evidenceVersion > input.versions.evidence ||
      ack!.winnerVersion > input.versions.winner ||
      ack!.decisionResolutionVersion > input.versions.decisionResolution
    )
      return unchanged(base(input, "refused", ["acknowledgmentAhead"]));
    // Round classification against the one current join; a sealed record
    // keeps the join its Keep recorded, which nothing changes afterwards.
    const join = classificationJoin(input);
    const identity = joinIdentity(join, ack!);
    const r = request.capturedRound;
    const c = input.round;
    if (identity && joinFloors(join!, ack!) && (r === c - 1 || r === c)) {
      // Joins the current round (or is already in it); never opens another.
      joined = true;
    } else if (identity && r === c - 1) {
      // A predecessor-round Leave below the floors is judged against the
      // winner the round had when it was opened, and changes nothing.
      const snapshot = join!.openingWinnerSnapshot;
      if (!snapshot) return superseded(["intentSuperseded"]);
      const historical = {
        effectiveRound: r,
        winner: { kind: snapshot.kind, cause: snapshot.cause },
      };
      // Openings happen only from an open readback or a reopened closure,
      // so the snapshot's own effect decides the historical answer.
      if (request.kind === "keep")
        return unchanged(
          snapshot.kind === "leave"
            ? base(input, "needs-review", ["keepReasonChanged"], historical)
            : base(input, "defeated", ["keepDefeatedByWinner"], historical),
        );
      if (snapshot.kind !== "leave")
        return unchanged(
          base(input, "defeated", ["leaveDefeatedByWinner"], historical),
        );
      if (snapshot.effect === "fence")
        return unchanged(
          base(
            input,
            "already-stopped",
            [
              "currentStopped",
              "alreadyStoppedNeedsDecision",
              "leaveSafetyAlreadyStopped",
            ],
            { ...historical, safetyApplied: true, dispositionApplied: false },
          ),
        );
      return unchanged(
        base(input, "already-closed", ["alreadyClosedByWinner"], {
          ...historical,
          ...savedOf(snapshot),
        }),
      );
    } else if (identity && r === c)
      return unchanged(base(input, "refused", ["acknowledgmentStale"]));
    else if (r !== c) return superseded(["intentSuperseded"]);
    else if (
      opens(input, ack!) &&
      (request.kind === "leave" ||
        (keepGuard(input) === undefined && reviewFits(input, request.review)))
    ) {
      at = openRound(input, ack!);
      opened = true;
    }
  } else if (request.capturedRound !== input.round)
    // Another round is superseded; nothing changes.
    return superseded(["intentSuperseded"]);
  const slot = at.slots[request.kind];
  const payload = informed
    ? JSON.stringify([
        ack!.sourceDecisionKey,
        ack!.evidenceVersion,
        ack!.winnerVersion,
        ack!.decisionResolutionVersion,
        ack!.evidenceDigest,
        ack!.unknownCount,
        request.review ?? "",
        request.payload ?? "",
      ])
    : (request.payload ?? "");
  // The envelope is this request's own: its round and correlation, and for
  // a coalesced Stop whether this requester pressed Stop itself.
  const envelope = (
    reply: IntentReply,
    coalesced: boolean,
    extra: Partial<IntentReply> = {},
  ): IntentReply => {
    const stored: IntentReply = { ...reply };
    delete stored.requestKey;
    return {
      ...stored,
      ...extra,
      capturedRound: request.capturedRound,
      correlation: request.correlation,
      ...(coalesced && request.kind === "stop"
        ? {
            requestKey:
              request.cause === "user"
                ? ("requestAlreadyStopped" as const)
                : ("requestTargetStopped" as const),
          }
        : {}),
    };
  };
  // A sealed record: the final classifier answers, and nothing changes.
  // Stored resolutions are returned as they were applied; the final facts
  // travel separately in this request's envelope.
  if (input.sealed) {
    const receipt = input.receipt!;
    const final = (
      extra: Partial<NonNullable<IntentReply["finalHistory"]>> = {},
    ): Partial<IntentReply> => ({ finalHistory: finalHistoryOf(input, extra) });
    const same = (ref: EntryRef | undefined) =>
      ref !== undefined &&
      ref.round === at.round &&
      ref.target === target &&
      ref.payload === payload;
    if (request.kind === "keep" && same(receipt.keepEntry))
      return unchanged(
        envelope(input.slots.keep.lastApplied!.reply, false, final()),
      );
    if (request.kind === "keep")
      return unchanged(
        base(
          input,
          "already-kept",
          ["keptElsewhere"],
          final({
            relation: "keptElsewhere",
          }),
        ),
      );
    if (request.kind === "leave" && same(receipt.priorLeaveApplied))
      return unchanged(
        envelope(
          input.slots.leave.lastApplied!.reply,
          false,
          final({
            relation: "leaveCompletedByKeep",
            requestedTargetApplied: true,
          }),
        ),
      );
    if (request.kind === "leave" && keepCoversLeave(receipt, joined))
      return unchanged(
        base(
          input,
          "already-closed",
          ["leaveCoveredByKeep"],
          final({
            relation: "leaveCoveredByKeep",
            requestedTargetApplied: false,
          }),
        ),
      );
    return unchanged(base(input, "sealed", ["planSealed"], final()));
  }
  // The same semantic intent returns its stored outcome, before CAS; a later
  // outcome in the same round never hides the applied one.
  for (const stored of [slot.current, slot.lastApplied])
    if (
      stored &&
      stored.round === at.round &&
      stored.target === target &&
      stored.payload === payload
    )
      return unchanged(envelope(stored.reply, true));
  // Compare-and-set on the slot version.
  if (request.expectedSlotVersion !== slot.version)
    return unchanged(base(input, "conflict", ["intentConflict"]));
  const plan = opened ? at : clone(at);
  const record = (
    result: IntentResult,
    keys: string[],
    applied: boolean,
    extra: Partial<IntentReply> = {},
  ): IntentReply => {
    const next = plan.slots[request.kind];
    next.version++;
    // The slot entry holds this reply object itself, so a later change to
    // it (the winner it becomes) is stored with it; only this transition's
    // own entry is ever written.
    const reply: IntentReply = {
      ...base(plan, result, keys),
      slotVersion: next.version,
      resolvedTarget: target,
      ...extra,
    };
    const entry: Applied = {
      kind: request.kind,
      round: plan.round,
      target,
      payload,
      cause: request.cause,
      effect,
      reply,
    };
    next.current = entry;
    if (applied) next.lastApplied = entry;
    plan.revision++;
    return reply;
  };
  // Makes the incoming intent the round's winner.
  const win = (reply: IntentReply) => {
    plan.winner = plan.slots[request.kind].current!;
    plan.versions.winner++;
    reply.winner = { kind: request.kind, cause: request.cause };
  };
  const fence = (id: string) => {
    const execution = plan.executions[id]!;
    execution.fenced = true;
    // A fenced execution's admissions can never commit.
    pending.delete(plan);
    execution.result = "stopped";
    plan.phase = "readback";
    settle(plan);
  };
  const state = decisionState(at.phase);
  const winner = at.winner;
  let effect: Applied["effect"] = "settled";
  let reply: IntentReply;
  if (request.kind === "keep") {
    const guard = keepGuard(plan);
    // Acknowledged exactly what the host holds now (or joined the round).
    const current =
      joined ||
      (ack!.sourceDecisionKey === plan.acceptance!.executionId &&
        ack!.evidenceDigest === plan.evidenceDigest &&
        ack!.evidenceVersion === plan.versions.evidence &&
        ack!.winnerVersion === plan.versions.winner &&
        ack!.decisionResolutionVersion === plan.versions.decisionResolution);
    const fits = reviewFits(plan, request.review);
    const remaining = remainingOf(plan);
    // A Keep closure: what it ended, saved for good, then the seal.
    const close = (keepEffect: KeepEffect, keys: string[], wins: boolean) => {
      if (plan.phase === "readback") plan.phase = "left-known";
      plan.retention = {
        ...(plan.retention ?? {}),
        ...(plan.retention?.completedAt === undefined &&
        options.now !== undefined
          ? { completedAt: options.now }
          : {}),
        ended: "kept",
      };
      const prior = plan.slots.leave.lastApplied;
      effect = "close";
      reply = record("already-kept", keys, true, {
        safetyApplied: false,
        dispositionApplied: true,
      });
      if (wins) win(reply);
      const entry = plan.slots.keep.current!;
      plan.receipt = {
        keepEntry: {
          round: entry.round,
          target: entry.target,
          payload: entry.payload,
        },
        round: plan.round,
        ...(plan.evidenceDigest ? { decisionDigest: plan.evidenceDigest } : {}),
        actorOrigin: {
          cause: request.cause,
          ...(options.principal ? { principal: options.principal } : {}),
        },
        appliedRevision: plan.revision,
        keepEffect,
        cause: "kept",
        result: "already-kept",
        ...(plan.join ? { roundJoin: structuredClone(plan.join) } : {}),
        ...(keepEffect === "leave-completed" && prior
          ? {
              priorLeaveApplied: {
                round: prior.round,
                target: prior.target,
                payload: prior.payload,
              },
            }
          : {}),
        finalWinner: { kind: plan.winner!.kind, cause: plan.winner!.cause },
      };
      if (sealable(plan)) plan.sealed = true;
    };
    if (guard) reply = record("needs-review", [guard], false);
    // A higher winner the Keep was rendered before defeats it, before any
    // question of freshness.
    else if (
      winner &&
      winner.kind !== "leave" &&
      winner.kind !== "keep" &&
      ack!.winnerVersion < plan.versions.winner
    )
      reply = record("defeated", ["keepDefeatedByWinner"], false);
    else if (!current || !fits)
      reply = record("needs-review", ["keepReasonChanged"], false);
    else if (plan.phase === "readback" && opened && !winner)
      close(
        remaining > 0 ? "forward-closed" : "decision-closed",
        remaining > 0
          ? ["alreadyKept", "planClosedKept", "keptForwardClosed"]
          : ["alreadyKept", "planClosedKept"],
        true,
      );
    else if (
      plan.phase === "completed" &&
      (!winner || (winner.kind !== "leave" && winner.kind !== "keep"))
    )
      // Ends own retention; a settled Stop or Cancel stays the winner.
      close("retention-ended", ["alreadyKept", "planClosedKept"], !winner);
    else if (keepCompletesLeave(plan, joined))
      // The sole exception: a compatible Keep completes the Leave.
      close(
        "leave-completed",
        remaining > 0
          ? [
              "alreadyKept",
              "planClosedKept",
              "leaveCompletedByKeep",
              "keptForwardClosed",
            ]
          : ["alreadyKept", "planClosedKept", "leaveCompletedByKeep"],
        true,
      );
    else reply = record("needs-review", ["keepReasonChanged"], false);
    return { plan, reply: reply! };
  }
  if (request.kind === "leave") {
    const execution = plan.executions[target]!;
    const live = !execution.fenced && execution.result === "running";
    if (!winner && live) {
      // Strict fence: no more action against a running execution must
      // exclude its later effects first; no disposition is saved.
      effect = "fence";
      fence(target);
      reply = record("needs-review", ["leaveSafetyNeedsReview"], true, {
        safetyApplied: true,
        dispositionApplied: false,
      });
      win(reply);
    } else if (!winner && opened) {
      // The closure the round was opened for.
      effect = "close";
      const unknown = evidenceOf(plan)!.unknown;
      plan.phase = unknown === 0 ? "left-known" : "left-unconfirmed";
      if (options.now !== undefined)
        plan.retention = {
          ...(plan.retention ?? {}),
          completedAt: plan.retention?.completedAt ?? options.now,
        };
      reply = record(
        "applied",
        [unknown === 0 ? "leftKnown" : "leftUnconfirmed"],
        true,
        {
          count: unknown === 0 ? plan.stepIds.length : unknown,
          forwardClosed: true,
          safetyApplied: false,
          dispositionApplied: true,
        },
      );
      plan.slots[request.kind].current!.disposition = {
        phase: plan.phase,
        count: reply.count!,
      };
      win(reply);
    } else if (!winner)
      // Nothing to apply: no winner is created and no version moves.
      reply =
        plan.phase === "readback"
          ? record("needs-review", ["leaveNeedsReview"], false)
          : record("already-closed", ["alreadyClosed"], false);
    else if (winner.kind !== "leave")
      reply =
        state === "open"
          ? record("defeated", ["leaveDefeatedByWinner"], false)
          : record("already-closed", ["alreadyClosedByWinner"], false);
    else if (winner.effect === "fence")
      reply = record(
        "already-stopped",
        [
          "currentStopped",
          "alreadyStoppedNeedsDecision",
          "leaveSafetyAlreadyStopped",
        ],
        false,
        { safetyApplied: true, dispositionApplied: false },
      );
    else
      reply = record(
        "already-closed",
        plan.phase === "left-reopened"
          ? ["alreadyClosedByWinner", "reopenedEvidence"]
          : ["alreadyClosedByWinner"],
        false,
        savedOf(winner),
      );
    return { plan, reply };
  }
  // The phase cell, then precedence.
  const cellOf = cell(at, request.kind, mapping);
  if (cellOf.outcome === "obsolete") return superseded(cellOf.keys);
  effect = cellOf.outcome;
  const apply = () => {
    if (cellOf.outcome === "close") {
      plan.inhibited = true;
      for (const review of plan.reviews)
        if (review.state === "current") review.state = "closed";
      plan.phase = "cancelled";
    } else if (cellOf.outcome === "fence") fence(cellOf.fence!);
  };
  const addsSafety = cellOf.outcome === "fence";
  let coalesced = false;
  if (!winner) {
    // No winner: the first valid Stop or Cancel applies and becomes winner.
    apply();
    reply = record("applied", cellOf.keys, true);
    win(reply);
  } else if (winner.kind === "leave") {
    if (winner.effect === "fence" && state === "open")
      // The Leave already fenced the work; its decision is still open.
      reply = record(
        "already-stopped",
        [
          "currentStopped",
          "alreadyStoppedNeedsDecision",
          request.kind === "stop"
            ? "leaveSafetyAlreadyStopped"
            : "cancelCoveredByLeaveSafety",
        ],
        false,
        { safetyApplied: true, dispositionApplied: false },
      );
    else
      // A Leave closure keeps its decision; adding safety is unreachable
      // in the left phases.
      reply = record(
        "already-closed",
        at.phase === "left-reopened"
          ? ["alreadyClosedByWinner", "reopenedEvidence"]
          : ["alreadyClosedByWinner"],
        false,
        savedOf(winner),
      );
  } else if (RANK[request.kind] > RANK[winner.kind]) {
    // Stop over a Cancel winner.
    if (addsSafety) {
      apply();
      reply = record(
        "replaced",
        ["choiceReplacedByStop", ...cellOf.keys],
        true,
      );
      win(reply);
    } else if (state === "open")
      reply = record(
        "already-stopped",
        ["currentStopped", "alreadyStoppedNeedsDecision"],
        false,
      );
    else reply = record("already-closed", ["alreadyClosedByWinner"], false);
  } else if (RANK[request.kind] < RANK[winner.kind]) {
    // A Cancel under a Stop winner is defeated.
    reply = record(
      "defeated",
      [at.acceptance ? "cancelDefeatedByStop" : "cancelCoveredByStopNoChanges"],
      false,
    );
  } else if (addsSafety) {
    // The same rank adds its fence; the winner stays.
    apply();
    reply = record("applied", cellOf.keys, true);
  } else if (state === "open") {
    // The same rank without added safety, decision open.
    reply = record(
      "already-stopped",
      ["currentStopped", "alreadyStoppedNeedsDecision"],
      false,
    );
    coalesced = winner.kind === "stop";
  }
  // Otherwise the decision is closed or settled.
  else reply = record("already-closed", ["alreadyClosedByWinner"], false);
  return { plan, reply: coalesced ? envelope(reply, true) : reply };
}

// ---------------------------------------------------------------------------
// Projection for reads.

export function recoveryView(plan: ProtectedPlan): RecoveryView {
  const review = plan.reviews.find((item) => item.state === "current");
  const evidence = evidenceOf(plan);
  return {
    profile: RECOVERY_PROFILE,
    phase: plan.phase,
    generation: plan.generation,
    round: plan.round,
    revision: plan.revision,
    conversationId: plan.conversationId,
    ...(review ? { reviewId: review.id } : {}),
    ...(plan.acceptance
      ? {
          executionId: plan.acceptance.executionId,
          decisionKey: plan.acceptance.executionId,
        }
      : {}),
    slots: {
      stop: plan.slots.stop.version,
      "cancel-initial": plan.slots["cancel-initial"].version,
      "cancel-review": plan.slots["cancel-review"].version,
      leave: plan.slots.leave.version,
      keep: plan.slots.keep.version,
    },
    versions: { ...plan.versions },
    ...(plan.acceptance ? { remaining: remainingOf(plan) } : {}),
    ...(plan.sealed ? { sealed: true } : {}),
    ...(plan.afterSeal
      ? { contradictedAfterSeal: [...plan.afterSeal.contradicted] }
      : {}),
    ...(plan.evidenceDigest
      ? { evidenceDigest: plan.evidenceDigest, unknownCount: evidence!.unknown }
      : {}),
    ...winnerOf(plan.winner ?? plan.priorWinner),
  };
}
