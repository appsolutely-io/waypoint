// Loaded on first use by a terminal action (Stop, Cancel, Decline, Leave,
// Keep) on a protected plan, outside the core bundle. It builds the intent
// request from what the core captured before any await, keeps one pending
// overlay per plan with its delivery state, delivers within the logical
// budget, and accepts only a reply that answers this exact request.
import { acknowledgmentOf } from "./acknowledgment";
import { readProblem } from "./client";
import { onAbort, type ScopeSignal } from "./scope";
import type {
  IntentCause,
  IntentKind,
  IntentRequest,
  LeaveAcknowledgment,
  IntentTarget,
  PlanIntentReply,
  PlanRecord,
} from "../protocol/generated";

export interface CapturedIntent {
  kind: IntentKind;
  planId: string;
  target: IntentTarget;
  capturedRound: number;
  expectedSlotVersion: number;
  correlation: string;
  acknowledgment?: LeaveAcknowledgment;
  review?: IntentRequest["review"];
}
interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
// Every intent submission keeps a 10 s logical budget; a timeout releases
// only the local owner and proves nothing about delivery.
const INTENT_BUDGET_MS = 10000;
const RESULTS: readonly PlanIntentReply["result"][] = [
  "applied",
  "replaced",
  "already-closed",
  "already-stopped",
  "defeated",
  "superseded",
  "needs-review",
  "conflict",
  "unavailable",
  "invalid-target",
  "refused",
  "kept",
  "already-kept",
  "sealed",
];

/** What the core captured synchronously: the adopted record it saw. */
export interface IntentSource {
  record: PlanRecord;
  kind: IntentKind;
  correlation: string;
}
/** The exact target, round, slot version and acknowledgment of a capture. */
export function captureFrom(source: IntentSource): CapturedIntent {
  const { record, kind } = source;
  const view = record.recovery!;
  return {
    kind,
    planId: record.id,
    target:
      kind === "cancel-review" && view.reviewId
        ? { type: "review", id: view.reviewId }
        : view.executionId
          ? { type: "execution", id: view.executionId }
          : { type: "generation", id: view.generation },
    capturedRound: view.round,
    expectedSlotVersion: view.slots[kind],
    correlation: source.correlation,
    ...(kind === "keep"
      ? {
          review:
            (view.remaining ?? 0) > 0
              ? ("forward-only" as const)
              : ("end-retention" as const),
        }
      : {}),
    ...(kind === "leave" || kind === "keep"
      ? { acknowledgment: acknowledgmentOf(record) }
      : {}),
  };
}
export function buildIntent(
  captured: CapturedIntent,
  cause: IntentCause,
): IntentRequest {
  return {
    ...captured,
    target: { ...captured.target },
    ...(captured.acknowledgment
      ? { acknowledgment: { ...captured.acknowledgment } }
      : {}),
    cause,
  };
}

/** A reply is accepted only when it answers this exact request. */
export function answers(
  reply: unknown,
  request: IntentRequest,
): reply is PlanIntentReply {
  const value = reply as Partial<PlanIntentReply> | null;
  return (
    typeof value === "object" &&
    value !== null &&
    value.planId === request.planId &&
    value.kind === request.kind &&
    value.correlation === request.correlation &&
    value.capturedRound === request.capturedRound &&
    typeof value.slotVersion === "number" &&
    RESULTS.includes(value.result as PlanIntentReply["result"]) &&
    Array.isArray(value.keys) &&
    value.keys.every((key) => typeof key === "string")
  );
}

/** One protected plan's pending terminal intent, as the snapshot shows it. */
export interface IntentOverlay {
  planId: string;
  kind: IntentKind;
  // The complete wire request, exactly as first built (cause included);
  // every redelivery sends it unchanged.
  request: IntentRequest;
  producer: "user" | "automatic";
  delivery: "sending" | "uncertain" | "not-sent";
  // Stop only: this window inhibited its own run.
  ownRun: boolean;
  // Rate-limited: when Retry becomes eligible (clock time).
  retryAt?: number;
  lastProblem?: { key: string; cause: IntentFailure };
}
export type IntentFailure =
  | "offline"
  | "sign-in"
  | "forbidden"
  | "rate-limited"
  | "timeout"
  | "connection-lost";
export type IntentNotice = Omit<PlanIntentReply, "slotVersion"> & {
  resolvedSlotVersion: number;
};
// One alert per new failure, with the one action to focus; a success
// clears it and asks once to restore the previous focus.
export type IntentAlert =
  | {
      serial: number;
      action: "checkStatus" | "retry" | "signIn" | "hostGuidance" | "wait";
    }
  | { serial: number; restoreFocus: true };
/** A terminal action handed to the machine by the core. */
export interface IntentPress {
  captured: IntentSource;
  cause: IntentCause;
  producer: "user" | "automatic";
  scope: ScopeSignal;
  capability?: string;
  ownRun: boolean;
  // When the logical operation started: its 10 s deadline counts from here.
  startedAt: number;
  done(): void;
}
export interface IntentContext {
  // The client's own configuration: its intent port and platform.
  config: {
    plans?: { intent?(request: IntentRequest): Promise<PlanIntentReply> };
    platform: {
      clock: Clock & { now(): number };
      online(): boolean;
      ids(): string;
    };
  };
  publish(patch: {
    intentOverlays?: Record<string, IntentOverlay>;
    intentNotice?: IntentNotice | null;
    intentAlert?: IntentAlert | null;
  }): void;
  // The client, for its current capabilities and to publish a record
  // through the gate.
  client: {
    getSnapshot(): { capabilities: readonly string[] };
    setPlan(record: PlanRecord): void;
  };
  // The current conversation scope.
  scope(): ScopeSignal;
  report(problem: { code: string; id: string; retryAfter?: number }): void;
  // A factual read of the plan under the core's read ownership: its scope,
  // the read, and whether it is still the live read when it settles.
  read(
    planId: string,
  ): [
    { signal: ScopeSignal; abort(): void },
    Promise<PlanRecord>,
    () => boolean,
  ];
}
export interface IntentMachine {
  // A deferred press (made while the chunk loaded) is decided now and
  // delivered with the rest of its batch.
  press(press: IntentPress, deferred?: boolean): void;
  // The core's entry point: the same press, positional, settled when its
  // delivery settles. Only the runner's automatic Stop has a cause other
  // than the user, and only Leave needs a capability beyond plan recovery.
  submit(
    record: PlanRecord,
    kind: IntentKind,
    cause: IntentCause,
    ownRun: boolean,
    // The press time of a press made while the chunk loaded: it is
    // delivered with the rest of its batch, within its own budget.
    pressedAt?: number,
  ): Promise<void>;
  status(planId: string): Promise<void>;
  authenticated(): void;
  pending(planId: string): boolean;
  // What "Keep these changes" would confirm for an adopted record, or why
  // not; a review is sent only as this machine issued it.
  keepReview(record: PlanRecord | undefined): KeepReviewResult;
  keepChanges(review: object): Promise<void>;
}
export type KeepReviewResult =
  | {
      review: "forward-only" | "end-retention";
      remaining: number;
      acknowledgment: LeaveAcknowledgment;
    }
  | {
      disabled:
        | "capabilityMissing"
        | "keepNoDecision"
        | "sealed"
        | "keepBlockedActive"
        | "keepBlockedUnknown";
    };
interface Attempt {
  id: number;
  timer: unknown;
  waiters: (() => void)[];
}
interface Live {
  overlay: IntentOverlay;
  scope: ScopeSignal;
  capability?: string;
  attempt?: Attempt;
  // Waiters of a deferred press, until flush starts its attempt.
  waiting: (() => void)[];
  autoRetried: boolean;
  retryTimer?: unknown;
}
/**
 * Whether a sign-in-blocked intent may be sent once more after a successful
 * authenticated call: it is waiting on sign-in, has no delivery in flight,
 * has not used its one automatic retry, and its scope is still alive.
 */
export function signInRetryAllowed(live: {
  attempt?: unknown;
  autoRetried: boolean;
  overlay: { lastProblem?: { cause: IntentFailure } };
  scope: { aborted: boolean };
}): boolean {
  return (
    !live.attempt &&
    !live.autoRetried &&
    live.overlay.lastProblem?.cause === "sign-in" &&
    !live.scope.aborted
  );
}
// Stop > both Cancel kinds > Keep > Leave.
const RANK: Record<IntentKind, number> = {
  stop: 4,
  "cancel-initial": 3,
  "cancel-review": 3,
  keep: 2,
  leave: 1,
};
const PREFIX: Record<IntentKind, string> = {
  stop: "stop",
  "cancel-initial": "cancelInitial",
  "cancel-review": "cancelReview",
  leave: "leave",
  keep: "keep",
};
/** Equal for two requests the host treats as the same intent. */
export const semantic = (request: IntentRequest) =>
  JSON.stringify([
    request.target,
    request.capturedRound,
    request.expectedSlotVersion,
    request.acknowledgment ?? null,
    request.review ?? null,
    request.payload ?? null,
  ]);
const keyOf = (overlay: IntentOverlay, failure: IntentFailure) => {
  const prefix = PREFIX[overlay.kind];
  if (
    (failure === "timeout" && overlay.delivery !== "not-sent") ||
    failure === "connection-lost"
  )
    return `${prefix}Unconfirmed`;
  if (failure === "forbidden") return `${prefix}Refused`;
  return overlay.kind === "stop" && !overlay.ownRun
    ? "stopNotSentElsewhere"
    : `${prefix}NotSent`;
};
const ALERT: Record<
  IntentFailure,
  Extract<IntentAlert, { action: unknown }>["action"]
> = {
  timeout: "checkStatus",
  "connection-lost": "checkStatus",
  offline: "retry",
  "sign-in": "signIn",
  forbidden: "hostGuidance",
  "rate-limited": "wait",
};

export function createIntentMachine(context: IntentContext): IntentMachine {
  const clock = context.config.platform.clock;
  const allowed = (capability: string) =>
    context.client.getSnapshot().capabilities.includes(capability);
  const lives = new Map<string, Live>();
  const keepReviews = new WeakMap<
    object,
    { source: IntentSource; scope: ScopeSignal }
  >();
  let sequence = 0;
  let serial = 0;
  let alertCause: IntentFailure | undefined;
  const reads = new Map<string, () => void>();
  const publish = () => {
    const intentOverlays: Record<string, IntentOverlay> = {};
    for (const [planId, live] of lives)
      intentOverlays[planId] = { ...live.overlay };
    context.publish({ intentOverlays });
  };
  const settleAll = (waiters: (() => void)[]) => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  const retire = (planId: string, live: Live) => {
    if (live.attempt) {
      clock.clearTimeout(live.attempt.timer);
      settleAll(live.attempt.waiters);
      live.attempt = undefined;
    }
    if (live.retryTimer !== undefined) clock.clearTimeout(live.retryTimer);
    settleAll(live.waiting);
    if (lives.get(planId) === live) lives.delete(planId);
  };
  const alert = (failure: IntentFailure) => {
    if (alertCause === failure) return;
    alertCause = failure;
    context.publish({
      intentAlert: { serial: ++serial, action: ALERT[failure] },
    });
  };
  // The factual read after an outcome where the host may have acted: in the
  // background, with its own budget, never changing the overlay.
  // Owned by the scope that sent the intent: a retired scope's read reports
  // nothing, whether or not its promise ever settles.
  const factualRead = (planId: string, scope: ScopeSignal) => {
    reads.get(planId)?.();
    // Owned twice over: by the scope that sent the intent, and by the core's
    // read ownership, which a newer read or a publication supersedes. Either
    // ending retires the read silently. It may publish only inside its
    // absolute deadline; a result arriving later expires it instead.
    const [owner, reading, live] = context.read(planId);
    const deadline = clock.now() + INTENT_BUDGET_MS;
    let over = false;
    const end = () => {
      over = true;
      clock.clearTimeout(timer);
      if (reads.get(planId) === stop) reads.delete(planId);
    };
    const stop = () => {
      if (over) return;
      end();
      owner.abort();
    };
    const expire = () => {
      if (over) return;
      // Authority to report is read before the read is ended.
      const authorized = !scope.aborted && !owner.signal.aborted;
      end();
      owner.abort();
      if (authorized) context.report({ code: "unavailable", id: "plan-read" });
    };
    const timer = clock.setTimeout(expire, INTENT_BUDGET_MS);
    onAbort(scope, stop);
    onAbort(owner.signal, stop);
    reads.set(planId, stop);
    const settle = (apply: (owned: boolean) => unknown) => {
      if (!over && clock.now() >= deadline) expire();
      if (over) return live();
      end();
      apply(live());
    };
    reading.then(
      (record) => settle((owned) => owned && context.client.setPlan(record)),
      (error: unknown) =>
        settle(
          (owned) =>
            owned &&
            !scope.aborted &&
            context.report(readProblem(error, "plan-read")),
        ),
    );
  };
  const fail = (
    live: Live,
    failure: IntentFailure,
    delivery: IntentOverlay["delivery"],
  ) => {
    const overlay = { ...live.overlay, delivery };
    live.overlay = {
      ...overlay,
      lastProblem: { key: keyOf(overlay, failure), cause: failure },
    };
    alert(failure);
    publish();
  };
  const attempt = (planId: string, live: Live, deadlineAt: number) => {
    const waiters = live.waiting.splice(0);
    if (live.scope.aborted) {
      settleAll(waiters);
      retire(planId, live);
      publish();
      return;
    }
    if (live.capability && !allowed(live.capability)) {
      context.report({ code: "unavailable", id: live.capability });
      settleAll(waiters);
      retire(planId, live);
      publish();
      return;
    }
    live.overlay = { ...live.overlay, delivery: "sending" };
    // Proven not dispatched (offline, or the operation's budget already
    // spent): the port is not called.
    const spent = clock.now() >= deadlineAt;
    if (spent || !context.config.platform.online()) {
      fail(live, spent ? "timeout" : "offline", "not-sent");
      settleAll(waiters);
      return;
    }
    const id = ++sequence;
    const current: Attempt = { id, timer: undefined, waiters };
    live.attempt = current;
    publish();
    const expire = () => {
      end();
      fail(live, "timeout", "uncertain");
      factualRead(planId, live.scope);
      settleAll(waiters);
    };
    // An outcome counts only for the current attempt within its deadline;
    // one arriving after the deadline (before the timer ran) expires it.
    const isCurrent = () => {
      if (live.attempt !== current || lives.get(planId) !== live) return false;
      if (clock.now() < deadlineAt) return true;
      expire();
      return false;
    };
    const end = () => {
      clock.clearTimeout(current.timer);
      live.attempt = undefined;
    };
    current.timer = clock.setTimeout(() => {
      if (live.attempt === current && lives.get(planId) === live) expire();
    }, deadlineAt - clock.now());
    context.config.plans!.intent!(live.overlay.request).then(
      (reply) => {
        if (!isCurrent()) return;
        end();
        if (answers(reply, live.overlay.request)) {
          // Resolved: the notice copies the reply's own facts.
          const { slotVersion, ...facts } = reply;
          lives.delete(planId);
          if (alertCause !== undefined) {
            alertCause = undefined;
            context.publish({ intentAlert: { serial, restoreFocus: true } });
          }
          context.publish({
            intentNotice: { ...facts, resolvedSlotVersion: slotVersion },
          });
          publish();
        } else fail(live, "connection-lost", "uncertain");
        factualRead(planId, live.scope);
        settleAll(waiters);
      },
      (error: { status?: unknown; retryAfter?: unknown }) => {
        if (!isCurrent()) return;
        end();
        const status =
          typeof error === "object" && error ? error.status : undefined;
        if (status === 401) {
          fail(live, "sign-in", "not-sent");
          context.report({ code: "sign-in", id: "intent" });
        } else if (status === 403) fail(live, "forbidden", "not-sent");
        else if (status === 429) {
          const seconds =
            // Only a whole number of seconds, as the Retry-After header has.
            Number.isInteger(error.retryAfter) &&
            (error.retryAfter as number) >= 0
              ? (error.retryAfter as number)
              : 1;
          live.overlay = {
            ...live.overlay,
            retryAt: clock.now() + seconds * 1000,
          };
          fail(live, "rate-limited", "not-sent");
          live.retryTimer = clock.setTimeout(() => {
            live.retryTimer = undefined;
            // Retry becomes possible; nothing is sent.
            if (lives.get(planId) === live && alertCause === "rate-limited")
              context.publish({ intentAlert: { serial, action: "retry" } });
          }, seconds * 1000);
        } else {
          // The request may have left: the outcome is unknown.
          fail(live, "connection-lost", "uncertain");
          factualRead(planId, live.scope);
        }
        settleAll(waiters);
      },
    );
  };
  const deferredPlans = new Set<string>();
  const deadlines = new Map<string, number>();
  const flush = () => {
    for (const planId of deferredPlans) {
      const live = lives.get(planId);
      if (live && !live.attempt)
        attempt(
          planId,
          live,
          deadlines.get(planId) ?? clock.now() + INTENT_BUDGET_MS,
        );
    }
    deferredPlans.clear();
    deadlines.clear();
  };
  const press = (item: IntentPress, deferred = false) => {
    const planId = item.captured.record.id;
    if (item.scope.aborted) return item.done();
    if (item.capability && !allowed(item.capability)) {
      context.report({ code: "unavailable", id: item.capability });
      return item.done();
    }
    const request = buildIntent(captureFrom(item.captured), item.cause);
    const live = lives.get(planId);
    if (live && live.overlay.kind === request.kind) {
      if (semantic(live.overlay.request) !== semantic(request)) {
        context.report({ code: "refused", id: "intentPending" });
        return item.done();
      }
      // The same intent: join it.
      if (live.attempt) live.attempt.waiters.push(item.done);
      else if (deferredPlans.has(planId)) live.waiting.push(item.done);
      else item.done();
      return;
    }
    if (live && RANK[request.kind] <= RANK[live.overlay.kind]) {
      context.report({ code: "refused", id: "intentPending" });
      return item.done();
    }
    if (live) retire(planId, live);
    const next: Live = {
      overlay: {
        planId,
        kind: request.kind,
        request,
        producer: item.producer,
        delivery: "sending",
        ownRun: item.ownRun,
      },
      scope: item.scope,
      ...(item.capability ? { capability: item.capability } : {}),
      waiting: [item.done],
      autoRetried: false,
    };
    lives.set(planId, next);
    onScopeEnd(planId, next);
    if (deferred) {
      // The batch of presses made during the load is decided first; only
      // the surviving intent of each plan is delivered.
      if (!deferredPlans.size) void Promise.resolve().then(flush);
      deferredPlans.add(planId);
      deadlines.set(planId, item.startedAt + INTENT_BUDGET_MS);
      publish();
    } else attempt(planId, next, item.startedAt + INTENT_BUDGET_MS);
  };
  const onScopeEnd = (planId: string, live: Live) => {
    live.scope.addEventListener(
      "abort",
      () => {
        if (lives.get(planId) !== live) return;
        retire(planId, live);
        publish();
      },
      { once: true },
    );
  };
  return {
    press,
    submit: (record, kind, cause, ownRun, pressedAt) =>
      new Promise<void>((done) =>
        press(
          {
            captured: {
              record,
              kind,
              correlation: context.config.platform.ids(),
            },
            cause,
            producer: cause === "user" ? "user" : "automatic",
            scope: context.scope(),
            ...(kind === "leave" ? { capability: "plan-leave" } : {}),
            ownRun,
            startedAt: pressedAt ?? clock.now(),
            done,
          },
          pressedAt !== undefined,
        ),
      ),
    status(planId) {
      const live = lives.get(planId);
      if (!live) return Promise.resolve();
      return new Promise<void>((resolve) => {
        if (live.attempt) {
          live.attempt.waiters.push(resolve);
          return;
        }
        if (
          live.overlay.retryAt !== undefined &&
          live.overlay.lastProblem?.cause === "rate-limited" &&
          clock.now() < live.overlay.retryAt
        ) {
          context.report({
            code: "rate-limited",
            id: "intent",
            retryAfter: Math.ceil((live.overlay.retryAt - clock.now()) / 1000),
          });
          resolve();
          return;
        }
        live.waiting.push(resolve);
        attempt(planId, live, clock.now() + INTENT_BUDGET_MS);
      });
    },
    authenticated() {
      for (const [planId, live] of lives)
        if (signInRetryAllowed(live)) {
          live.autoRetried = true;
          attempt(planId, live, clock.now() + INTENT_BUDGET_MS);
        }
    },
    pending: (planId) => lives.has(planId),
    keepReview(record) {
      const view = record?.recovery;
      const phase = view?.phase;
      const capabilities = context.client.getSnapshot().capabilities;
      const disabled = !capabilities.includes("plan-keep")
        ? "capabilityMissing"
        : !view?.executionId || !capabilities.includes("plan-recovery")
          ? "keepNoDecision"
          : view.sealed
            ? "sealed"
            : phase === "forward-active"
              ? "keepBlockedActive"
              : (view.unknownCount ?? 0) > 0 ||
                  (phase !== "readback" &&
                    phase !== "completed" &&
                    phase !== "left-known")
                ? "keepBlockedUnknown"
                : undefined;
      if (disabled) return { disabled };
      const remaining = view!.remaining ?? 0;
      const review = {
        review:
          remaining > 0
            ? ("forward-only" as const)
            : ("end-retention" as const),
        remaining,
        acknowledgment: acknowledgmentOf(record!),
      };
      keepReviews.set(review, {
        source: {
          record: record!,
          kind: "keep",
          correlation: context.config.platform.ids(),
        },
        scope: context.scope(),
      });
      return review;
    },
    keepChanges(review) {
      // Only a review this machine issued, sent exactly as it was captured.
      const issued = keepReviews.get(review);
      if (!issued) {
        context.report({ code: "unavailable", id: "plan-keep" });
        return Promise.resolve();
      }
      return new Promise<void>((done) =>
        press({
          captured: issued.source,
          cause: "user",
          producer: "user",
          scope: issued.scope,
          capability: "plan-keep",
          ownRun: false,
          startedAt: clock.now(),
          done,
        }),
      );
    },
  };
}
