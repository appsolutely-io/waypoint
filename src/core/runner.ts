import type {
  CanonicalRequest,
  ExecutionAcceptance,
  IntentCause,
  IntentRequest,
  PlanIntentReply,
  PlanRecord,
  PlanState,
  ImmediatePlan,
} from "../protocol/generated";
import type { PlatformPorts, ReaderRequestContext } from "./client";
import { createScope, onAbort, type Scope, type ScopeSignal } from "./scope";
export interface StepContext {
  planId: string;
  stepId: string;
  headers: Record<string, string>;
  stepUpCode?: string;
  /**
   * Aborted when the run is retired, stopped by dispose or interrupted; an
   * adapter may pass it to its request. It is a standard AbortSignal.
   */
  signal?: ScopeSignal;
}
export interface RunnerPorts {
  /** `context` carries the client's current agreement when one exists. */
  read(id: string, context?: ReaderRequestContext): Promise<PlanRecord>;
  request(request: CanonicalRequest, context: StepContext): Promise<void>;
  /** `acceptance` is the accepted execution's identity, when one exists. */
  heartbeat(id: string, acceptance?: ExecutionAcceptance): Promise<void>;
  /**
   * @deprecated The runner never asks the host to stop or undo a plan: a
   * stopped or interrupted run only stops dispatching and reads its facts.
   */
  stop?(id: string): Promise<PlanRecord>;
  /**
   * Called once when a run is interrupted by a failure, with its cause,
   * before the runner reads every step again. A client submits its Stop
   * intent here; legacy runs leave it unset.
   */
  interrupted?(id: string, cause: IntentCause): Promise<void>;
  /**
   * Delivers a terminal intent (Stop or Cancel) for a protected plan through
   * the host's safety-control route. A client offers `plan-recovery` only
   * when this is present.
   */
  intent?(request: IntentRequest): Promise<PlanIntentReply>;
  stepUp?(planId: string, stepId: string): Promise<string | null>;
  clock?: PlatformPorts["clock"];
  /** Aborting it disposes the runner, as `dispose()` does. */
  signal?: ScopeSignal;
  heartbeatMs?: number;
  onRecord?(record: PlanRecord): void;
}
export interface PlanRunner {
  run(
    id: string,
    confirmedDigest: string,
    acceptance?: ExecutionAcceptance,
  ): Promise<void>;
  stop(id?: string): void;
  /**
   * Retires the active invocation locally: it dispatches nothing more and
   * keeps no step-up code, and no remote stop or undo is requested. A later
   * explicit run starts a fresh invocation.
   */
  interrupt?(): void;
  dispose(): void;
}
/**
 * Thrown by a plan port's read when the client's record gate refused the
 * record; the run ends as an interruption with cause `plan-changed`.
 */
export class PlanReadRefused extends Error {
  constructor() {
    super("plan-read-refused");
    this.name = "PlanReadRefused";
  }
}
const readCause = (error: unknown): IntentCause =>
  error instanceof PlanReadRefused ? "plan-changed" : "connection-lost";
export function canTransition(from: PlanState, to: PlanState): boolean {
  const allowed: Record<PlanState, readonly PlanState[]> = {
    proposed: ["awaiting-confirmation", "cancelled"],
    "awaiting-confirmation": ["running", "submitted", "cancelled"],
    running: ["undoing", "completed", "needs-attention"],
    undoing: ["undone", "needs-attention"],
    completed: ["undoing"],
    submitted: [],
    undone: [],
    "needs-attention": ["running", "undoing"],
    cancelled: [],
  };
  return allowed[from].includes(to);
}
const retired = new Error("retired");
export function createPlanRunner(ports: RunnerPorts): PlanRunner {
  let active: Promise<void> | null = null;
  const stoppedPlans = new Set<string>();
  let activeId: string | undefined;
  // The runner's scope is aborted on dispose; each invocation's scope is its
  // child and is also aborted by interrupt. Every effect of a run checks its
  // invocation signal where it lands.
  const runnerScope = createScope("runner", ports.signal);
  let heartbeatFailed = false;
  interface Invocation {
    scope: Scope;
    signal: ScopeSignal;
    context?: StepContext;
    acceptance?: ExecutionAcceptance;
  }
  let current: Invocation | undefined;
  const read = async (id: string, invocation: Invocation) => {
    // A retired invocation dispatches no further read.
    if (invocation.signal.aborted) throw retired;
    const record = await ports.read(id);
    // A retired invocation's read never publishes.
    if (!invocation.signal.aborted) ports.onRecord?.(record);
    return record;
  };
  const execute = async (
    id: string,
    confirmedDigest: string,
    invocation: Invocation,
  ): Promise<void> => {
    let record: PlanRecord;
    try {
      record = await read(id, invocation);
    } catch (error) {
      // An accepted execution whose read fails is interrupted at once.
      if (
        error !== retired &&
        !invocation.signal.aborted &&
        invocation.acceptance &&
        ports.interrupted
      )
        await ports.interrupted(id, readCause(error));
      throw error;
    }
    if (invocation.signal.aborted) return;
    // A protected plan runs only under its own private acceptance; any other
    // entry point is refused before renewal or dispatch.
    if (
      record.recovery &&
      (invocation.acceptance?.planId !== id ||
        invocation.acceptance.executionId !== record.recovery.executionId)
    )
      throw new Error("unauthorized-run");
    if (
      record.plan.kind !== "immediate" ||
      record.plan.stage !== "final" ||
      record.state !== "running"
    )
      return;
    if (!confirmedDigest || record.plan.digest !== confirmedDigest)
      throw new Error("invalid-plan");
    const confirmed = {
      ...record.plan,
      steps: record.plan.steps.map((step) => ({
        ...step,
        request: step.request
          ? { ...step.request, headers: { ...step.request.headers } }
          : undefined,
      })),
    } as ImmediatePlan;
    const steps = confirmed.steps;
    const irreversible = steps.filter((step) => step.undo === "none");
    if (
      irreversible.length > 1 ||
      (irreversible.length === 1 && steps.at(-1)?.undo !== "none") ||
      steps.some(
        (step) =>
          !step.request ||
          !["POST", "PUT", "PATCH"].includes(step.request.method),
      )
    )
      throw new Error("invalid-plan");
    let timer: unknown;
    let finished = false;
    const endHeartbeat = () => {
      finished = true;
      if (timer !== undefined) ports.clock?.clearTimeout(timer);
      timer = undefined;
    };
    const releaseHeartbeat = onAbort(invocation.signal, endHeartbeat);
    // A stopped or interrupted run dispatches nothing more and asks for no
    // remote stop or undo: it submits the interruption's cause, if the
    // client takes one, and then reads every step again.
    const halt = async (cause?: IntentCause) => {
      endHeartbeat();
      if (invocation.context) delete invocation.context.stepUpCode;
      if (invocation.signal.aborted) return;
      if (cause && ports.interrupted) await ports.interrupted(id, cause);
      // A failing read-back never stops again.
      if (!invocation.signal.aborted)
        await read(id, invocation).catch(() => undefined);
    };
    // Every read during the run is an interruption point when it fails.
    const guardedRead = async () => {
      try {
        return await read(id, invocation);
      } catch (error) {
        if (error !== retired) await halt(readCause(error));
        throw error;
      }
    };
    const tick = async () => {
      if (finished || invocation.signal.aborted) return;
      try {
        await ports.heartbeat(id, invocation.acceptance);
      } catch {
        if (!invocation.signal.aborted) heartbeatFailed = true;
      }
      if (!finished && !invocation.signal.aborted && ports.clock)
        timer = ports.clock.setTimeout(() => {
          timer = undefined;
          void tick();
        }, ports.heartbeatMs ?? 10000);
    };
    await tick();
    try {
      for (const [position, step] of steps.entries()) {
        if (invocation.signal.aborted) return;
        if (heartbeatFailed) return halt("renewal-refused");
        if (stoppedPlans.has(id)) return halt();
        record = await guardedRead();
        if (invocation.signal.aborted) return;
        if (heartbeatFailed) return halt("renewal-refused");
        if (stoppedPlans.has(id)) return halt();
        if (record.state !== "running") return;
        if (
          record.outcomes.some(
            (outcome) =>
              outcome.stepId === step.id &&
              outcome.attributed &&
              outcome.status >= 200 &&
              outcome.status < 300,
          )
        )
          continue;
        const latest = record.plan;
        if (
          latest.kind !== "immediate" ||
          latest.stage !== "final" ||
          latest.digest !== confirmed.digest ||
          JSON.stringify(latest.steps[position]?.request) !==
            JSON.stringify(step.request)
        ) {
          await halt("plan-changed");
          throw new Error("invalid-plan");
        }
        const request = step.request!;
        const context: StepContext = {
          signal: invocation.signal,
          planId: id,
          stepId: step.id,
          headers: {
            ...request.headers,
            "Waypoint-Step": `${id}.${position}`,
            ...(invocation.acceptance
              ? {
                  "Waypoint-Execution": invocation.acceptance.executionId,
                  "Waypoint-Fence": String(invocation.acceptance.fence),
                }
              : {}),
          },
        };
        if (step.stepUp) {
          const code = await ports.stepUp?.(id, step.id);
          if (!code) return halt("step-up-failed");
          if (invocation.signal.aborted) return;
          if (heartbeatFailed) return halt("renewal-refused");
          if (stoppedPlans.has(id)) return halt();
          record = await guardedRead();
          if (record.state !== "running") return;
          if (
            record.plan.kind !== "immediate" ||
            record.plan.stage !== "final" ||
            record.plan.digest !== confirmed.digest ||
            JSON.stringify(record.plan.steps[position]?.request) !==
              JSON.stringify(request)
          ) {
            await halt("plan-changed");
            throw new Error("invalid-plan");
          }
          if (
            record.outcomes.some(
              (outcome) =>
                outcome.stepId === step.id &&
                outcome.attributed &&
                outcome.status >= 200 &&
                outcome.status < 300,
            )
          )
            continue;
          context.stepUpCode = code;
        }
        if (invocation.signal.aborted) return;
        if (heartbeatFailed) return halt("renewal-refused");
        if (stoppedPlans.has(id)) return halt();
        try {
          invocation.context = context;
          await ports.request(
            { ...request, headers: { ...request.headers } },
            context,
          );
        } catch {
          delete context.stepUpCode;
          if (invocation.context === context) invocation.context = undefined;
          return halt("step-failed");
        } finally {
          delete context.stepUpCode;
          if (invocation.context === context) invocation.context = undefined;
        }
        record = await guardedRead();
        if (
          !record.outcomes.some(
            (outcome) =>
              outcome.stepId === step.id &&
              outcome.attributed &&
              outcome.status >= 200 &&
              outcome.status < 300,
          )
        )
          return halt("attribution-missing");
        if (stoppedPlans.has(id)) return halt();
      }
    } finally {
      endHeartbeat();
      releaseHeartbeat();
    }
  };
  return {
    run(id, confirmedDigest, acceptance) {
      if (active)
        return activeId === id
          ? active
          : Promise.reject(new Error("active-plan"));
      if (stoppedPlans.has(id) || runnerScope.signal.aborted)
        return Promise.resolve();
      activeId = id;
      heartbeatFailed = false;
      const scope = createScope("invocation", runnerScope.signal);
      const invocation: Invocation = {
        scope,
        signal: scope.signal,
        ...(acceptance ? { acceptance } : {}),
      };
      // Retiring the invocation also takes back the live step's code.
      onAbort(invocation.signal, () => {
        if (invocation.context) delete invocation.context.stepUpCode;
      });
      current = invocation;
      active = execute(id, confirmedDigest, invocation)
        .catch((error: unknown) => {
          if (error !== retired) throw error;
        })
        .finally(() => {
          scope.end();
          if (current === invocation) current = undefined;
          active = null;
          activeId = undefined;
        });
      return active;
    },
    stop(id = activeId) {
      if (id) stoppedPlans.add(id);
    },
    interrupt() {
      current?.scope.abort();
    },
    dispose() {
      runnerScope.abort();
    },
  };
}
