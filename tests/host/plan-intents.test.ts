import { it, expect, describe } from "vitest";
import {
  confirm,
  parseIntentRequest,
  pendingAdmissions,
  releasePlan,
  MAX_INTENT_BODY_BYTES,
  completeExecution,
  createProtectedPlan,
  mapTarget,
  readback,
  recoveryView,
  replaceReview,
  resolveIntent,
  stepEvent,
  stepTruth,
  type Admission,
  type IntentKind,
  type IntentRequest,
  type ProtectedPlan,
  type RecoveryPhase,
} from "../../src/host/plan-intents";

const review = (id = "r1", revision = 1, digest = "d1") => ({
  id,
  revision,
  digest,
  state: "current" as const,
});
const fresh = () =>
  createProtectedPlan({
    planId: "p",
    conversationId: "c",
    generation: "g1",
    review: review(),
  });
const command = (overrides = {}) => ({
  clientReplyId: "confirm-1",
  digest: "d1",
  protocol: "1.0",
  ...overrides,
});
const accepted = () => confirm(fresh(), command()).plan;
const executionOf = (plan: ProtectedPlan) => plan.acceptance!.executionId;
const request = (
  plan: ProtectedPlan,
  kind: IntentKind,
  target: IntentRequest["target"],
  overrides: Partial<IntentRequest> = {},
): IntentRequest => ({
  kind,
  planId: plan.planId,
  target,
  capturedRound: plan.round,
  expectedSlotVersion: plan.slots[kind].version,
  correlation: `${kind}-1`,
  cause: "user",
  ...overrides,
});
const generation = (plan: ProtectedPlan) => ({
  type: "generation" as const,
  id: plan.generation,
});
const execution = (plan: ProtectedPlan) => ({
  type: "execution" as const,
  id: executionOf(plan),
});
const reviewTarget = (id: string) => ({ type: "review" as const, id });

// A seed of every stored phase reachable in this phase, with the winner the
// phase carries when it is reached through real transitions.
function seed(phase: RecoveryPhase): ProtectedPlan {
  if (phase === "proposal")
    return createProtectedPlan({
      planId: "p",
      conversationId: "c",
      generation: "g1",
    });
  if (phase === "initial-review") return fresh();
  if (phase === "forward-active") return accepted();
  if (phase === "readback") {
    // Fenced by an interruption seed without an intent winner.
    const plan = structuredClone(accepted());
    const run = plan.executions[executionOf(plan)]!;
    run.fenced = true;
    run.result = "stopped";
    plan.phase = "readback";
    return plan;
  }
  if (phase === "completed") return completeExecution(accepted());
  if (phase === "cancelled") {
    const plan = fresh();
    return resolveIntent(
      plan,
      request(plan, "cancel-initial", generation(plan)),
    ).plan;
  }
  // The left phases are seeded with their genuine prior closure: a retired
  // fenced execution and an applied Leave winner.
  const plan = structuredClone(seed("readback"));
  plan.phase = phase;
  plan.winner = {
    kind: "leave",
    round: plan.round,
    target: executionOf(plan),
    payload: "",
    cause: "user",
    effect: "close",
    reply: {
      planId: "p",
      kind: "stop",
      capturedRound: plan.round,
      correlation: "leave-seed",
      effectiveRound: plan.round,
      slotVersion: 0,
      result: "applied",
      keys: ["leftKnown"],
      phase,
    },
  };
  return plan;
}

describe("target mapping", () => {
  it("refuses a token this plan never issued, changing nothing", () => {
    const plan = accepted();
    expect(mapTarget(plan, { type: "execution", id: "other.e1" }).rule).toBe(
      "foreign",
    );
    const result = resolveIntent(
      plan,
      request(plan, "stop", { type: "execution", id: "other.e1" }),
    );
    expect(result.reply.result).toBe("invalid-target");
    expect(result.plan).toBe(plan);
  });
  it("treats an earlier generation's token as unrelated", () => {
    const plan = { ...accepted(), earlierTokens: ["g0"] };
    expect(mapTarget(plan, { type: "generation", id: "g0" }).rule).toBe(
      "earlier-generation",
    );
    expect(
      resolveIntent(
        plan,
        request(plan, "stop", { type: "generation", id: "g0" }),
      ).reply.result,
    ).toBe("superseded");
  });
  it("maps an unaccepted generation to itself", () => {
    const plan = fresh();
    expect(mapTarget(plan, generation(plan)).rule).toBe(
      "unaccepted-generation",
    );
  });
  it("maps an accepted generation to its first acceptance", () => {
    const plan = accepted();
    expect(mapTarget(plan, generation(plan))).toEqual({
      rule: "first-acceptance",
      kind: "execution",
      execution: executionOf(plan),
    });
  });
  it("maps the current unaccepted review to itself", () => {
    expect(mapTarget(fresh(), reviewTarget("r1")).rule).toBe("current-review");
  });
  it("treats a review replaced before acceptance as obsolete", () => {
    const plan = replaceReview(fresh(), review("r2", 1, "d2"));
    expect(mapTarget(plan, reviewTarget("r1")).rule).toBe("replaced-review");
  });
  it("keeps a closed unaccepted review as its closed decision", () => {
    const plan = seed("cancelled");
    expect(mapTarget(plan, reviewTarget("r1")).rule).toBe("closed-review");
  });
  it("maps an accepted review to its execution", () => {
    const plan = accepted();
    expect(mapTarget(plan, reviewTarget("r1"))).toEqual({
      rule: "accepted-review",
      kind: "execution",
      execution: executionOf(plan),
    });
  });
  it("maps an execution of this plan to itself", () => {
    const plan = accepted();
    expect(mapTarget(plan, execution(plan)).rule).toBe("execution");
  });
  it("the initial Cancel follows the generation from a replaced review", () => {
    const plan = confirm(
      replaceReview(fresh(), review("r2", 1, "d2")),
      command({ digest: "d2" }),
    ).plan;
    const result = resolveIntent(
      plan,
      request(plan, "cancel-initial", reviewTarget("r1")),
    );
    expect(result.reply.resolvedTarget).toBe(executionOf(plan));
    expect(result.reply.keys).toEqual(["cancelStarted"]);
  });
  it("a Stop captured on a replaced review does not retarget", () => {
    const plan = confirm(
      replaceReview(fresh(), review("r2", 1, "d2")),
      command({ digest: "d2" }),
    ).plan;
    const result = resolveIntent(
      plan,
      request(plan, "stop", reviewTarget("r1")),
    );
    expect(result.reply.result).toBe("superseded");
    expect(result.plan.executions[executionOf(plan)]!.fenced).toBe(false);
  });
});

describe("confirmation writer", () => {
  it("refuses after the generation was inhibited", () => {
    expect(confirm(seed("cancelled"), command()).reply).toMatchObject({
      rule: "inhibited",
      result: "refused",
    });
  });
  it("replays the same command without new authority", () => {
    const plan = accepted();
    const replay = confirm(plan, command());
    expect(replay.reply).toEqual({
      result: "replayed",
      rule: "replay",
      executionId: executionOf(plan),
    });
    expect(replay.plan).toBe(plan);
  });
  it("refuses another command after activation, even with the same digest", () => {
    expect(
      confirm(accepted(), command({ clientReplyId: "confirm-2" })).reply,
    ).toMatchObject({ rule: "activation-history", key: "activationHistory" });
  });
  it("refuses outside initial review", () => {
    expect(confirm(seed("proposal"), command()).reply).toMatchObject({
      rule: "not-initial-review",
      key: "reviewMissing",
    });
  });
  it("refuses a review replaced before acceptance", () => {
    const plan = replaceReview(fresh(), review("r2", 1, "d2"));
    expect(confirm(plan, command()).reply).toMatchObject({
      rule: "stale-review",
    });
  });
  it("refuses a digest mismatch", () => {
    expect(confirm(fresh(), command({ digest: "other" })).reply).toMatchObject({
      rule: "digest-mismatch",
    });
  });
  it("accepts the first matching confirmation and records the generation's first acceptance", () => {
    const result = confirm(fresh(), command());
    expect(result.reply).toMatchObject({
      rule: "first-acceptance",
      result: "accepted",
    });
    expect(result.plan.phase).toBe("forward-active");
    expect(result.plan.acceptance?.executionId).toBe(
      (result.reply as { executionId: string }).executionId,
    );
  });
  it("a genuinely new generation is accepted again", () => {
    const next = createProtectedPlan({
      planId: "p2",
      conversationId: "c",
      generation: "g2",
      review: review(),
    });
    expect(confirm(next, command()).reply.rule).toBe("first-acceptance");
  });
  it("completeness: every starting state × command class has exactly one row", () => {
    const states: [string, () => ProtectedPlan][] = [
      ["inhibited", () => seed("cancelled")],
      ["accepted", accepted],
      ["proposal", () => seed("proposal")],
      ["stale review", () => replaceReview(fresh(), review("r2", 1, "d2"))],
      [
        "digest mismatch",
        () =>
          createProtectedPlan({
            planId: "p",
            conversationId: "c",
            generation: "g1",
            review: review("r1", 1, "other"),
          }),
      ],
      ["current", fresh],
    ];
    const expected: Record<string, [string, string]> = {
      inhibited: ["inhibited", "inhibited"],
      accepted: ["replay", "activation-history"],
      proposal: ["not-initial-review", "not-initial-review"],
      "stale review": ["stale-review", "stale-review"],
      "digest mismatch": ["digest-mismatch", "digest-mismatch"],
      current: ["first-acceptance", "first-acceptance"],
    };
    for (const [name, make] of states) {
      const same = confirm(make(), command()).reply.rule;
      const other = confirm(make(), command({ clientReplyId: "x" })).reply.rule;
      expect([same, other], name).toEqual(expected[name]);
    }
  });
});

describe("request steps", () => {
  it("refuses a phase this host cannot represent at the boundary", () => {
    const plan = { ...accepted(), phase: "manual-review" as RecoveryPhase };
    const result = resolveIntent(plan, request(plan, "stop", execution(plan)));
    expect(result.reply.result).toBe("unavailable");
    expect(result.plan).toBe(plan);
  });
  it("supersedes another round with nothing changed", () => {
    const plan = accepted();
    const result = resolveIntent(
      plan,
      request(plan, "stop", execution(plan), { capturedRound: 0 }),
    );
    expect(result.reply.result).toBe("superseded");
    expect(result.plan).toBe(plan);
  });
  it("deduplicates the same semantic intent before the version check", () => {
    const plan = accepted();
    const first = resolveIntent(plan, request(plan, "stop", execution(plan)));
    const again = resolveIntent(
      first.plan,
      request(first.plan, "stop", generation(first.plan), {
        expectedSlotVersion: 0,
        correlation: "stop-2",
      }),
    );
    expect(again.plan).toBe(first.plan);
    // The stored resolution, with this requester's own acknowledgment key.
    expect(again.reply).toEqual({
      ...first.reply,
      correlation: "stop-2",
      requestKey: "requestAlreadyStopped",
    });
  });
  it("refuses a stale slot version for a different intent", () => {
    const plan = accepted();
    const first = resolveIntent(plan, request(plan, "stop", execution(plan)));
    const other = resolveIntent(
      first.plan,
      request(first.plan, "stop", execution(first.plan), {
        expectedSlotVersion: 0,
        payload: "different",
      }),
    );
    expect(other.reply.result).toBe("conflict");
    expect(other.plan).toBe(first.plan);
  });
  it("persist the slot, winner and fence together and echo the request", () => {
    const plan = accepted();
    const { plan: next, reply } = resolveIntent(
      plan,
      request(plan, "stop", execution(plan), { correlation: "abc" }),
    );
    expect(reply).toMatchObject({
      capturedRound: 1,
      correlation: "abc",
      effectiveRound: 1,
      slotVersion: 1,
      resolvedTarget: executionOf(plan),
      result: "applied",
    });
    expect(next.slots.stop.version).toBe(1);
    expect(next.slots.stop.lastApplied?.kind).toBe("stop");
    expect(next.winner?.kind).toBe("stop");
    expect(next.executions[executionOf(plan)]!.fenced).toBe(true);
    expect(next.revision).toBeGreaterThan(plan.revision);
  });
});

// Every phase × kind cell, from its real (or seeded) starting state.
describe("resolution cells", () => {
  const target = (
    plan: ProtectedPlan,
    kind: IntentKind,
  ): IntentRequest["target"] =>
    kind === "cancel-review"
      ? reviewTarget("r1")
      : plan.acceptance
        ? execution(plan)
        : generation(plan);
  const cells: Record<
    RecoveryPhase,
    Record<
      Exclude<IntentKind, "leave" | "keep">,
      { result: string; keys: string[]; phase: RecoveryPhase }
    >
  > = {
    proposal: {
      stop: {
        result: "applied",
        keys: ["stoppedNoChanges"],
        phase: "cancelled",
      },
      "cancel-initial": {
        result: "applied",
        keys: ["cancelledNoChanges"],
        phase: "cancelled",
      },
      "cancel-review": {
        result: "invalid-target",
        keys: ["invalidTarget"],
        phase: "proposal",
      },
    },
    "initial-review": {
      stop: {
        result: "applied",
        keys: ["stoppedNoChanges"],
        phase: "cancelled",
      },
      "cancel-initial": {
        result: "applied",
        keys: ["cancelledNoChanges"],
        phase: "cancelled",
      },
      "cancel-review": {
        result: "superseded",
        keys: ["intentSuperseded"],
        phase: "initial-review",
      },
    },
    "forward-active": {
      stop: { result: "applied", keys: ["stopped"], phase: "readback" },
      "cancel-initial": {
        result: "applied",
        keys: ["cancelStarted"],
        phase: "readback",
      },
      "cancel-review": {
        result: "applied",
        keys: ["reviewTargetStopped"],
        phase: "readback",
      },
    },
    readback: {
      stop: {
        result: "applied",
        keys: ["initialTargetStopped"],
        phase: "readback",
      },
      "cancel-initial": {
        result: "applied",
        keys: ["initialTargetStopped"],
        phase: "readback",
      },
      "cancel-review": {
        result: "applied",
        keys: ["reviewTargetStopped"],
        phase: "readback",
      },
    },
    completed: {
      stop: {
        result: "applied",
        keys: ["initialTargetSettled"],
        phase: "completed",
      },
      "cancel-initial": {
        result: "applied",
        keys: ["initialTargetSettled"],
        phase: "completed",
      },
      "cancel-review": {
        result: "applied",
        keys: ["reviewTargetSettled"],
        phase: "completed",
      },
    },
    cancelled: {
      stop: {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "cancelled",
      },
      "cancel-initial": {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "cancelled",
      },
      "cancel-review": {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "cancelled",
      },
    },
    "left-known": {
      stop: {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "left-known",
      },
      "cancel-initial": {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "left-known",
      },
      "cancel-review": {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "left-known",
      },
    },
    "left-unconfirmed": {
      stop: {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "left-unconfirmed",
      },
      "cancel-initial": {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "left-unconfirmed",
      },
      "cancel-review": {
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        phase: "left-unconfirmed",
      },
    },
    "left-reopened": {
      stop: {
        result: "already-closed",
        keys: ["alreadyClosedByWinner", "reopenedEvidence"],
        phase: "left-reopened",
      },
      "cancel-initial": {
        result: "already-closed",
        keys: ["alreadyClosedByWinner", "reopenedEvidence"],
        phase: "left-reopened",
      },
      "cancel-review": {
        result: "already-closed",
        keys: ["alreadyClosedByWinner", "reopenedEvidence"],
        phase: "left-reopened",
      },
    },
  };
  for (const [phase, kinds] of Object.entries(cells) as [
    RecoveryPhase,
    (typeof cells)[RecoveryPhase],
  ][])
    for (const [kind, expected] of Object.entries(kinds) as [
      Exclude<IntentKind, "leave" | "keep">,
      (typeof kinds)[Exclude<IntentKind, "leave" | "keep">],
    ][])
      it(`${phase} × ${kind}`, () => {
        const plan = seed(phase);
        const result = resolveIntent(
          plan,
          // A payload of its own, so no seed's intent deduplicates it.
          request(plan, kind, target(plan, kind), { payload: "cell" }),
        );
        expect({
          result: result.reply.result,
          keys: result.reply.keys,
          phase: result.plan.phase,
        }).toEqual(expected);
        // Settled and closed cells never add a fence or change facts.
        if (
          expected.result !== "applied" ||
          !["stopped", "cancelStarted", "reviewTargetStopped"].includes(
            expected.keys[0]!,
          ) ||
          phase !== "forward-active"
        )
          for (const id of Object.keys(plan.executions))
            expect(result.plan.executions[id]!.fenced).toBe(
              plan.executions[id]!.fenced,
            );
      });
  it("inventory (table shape only): every reachable phase × kind has a cell", () => {
    for (const phase of Object.keys(cells))
      expect(Object.keys(cells[phase as RecoveryPhase]).sort()).toEqual([
        "cancel-initial",
        "cancel-review",
        "stop",
      ]);
    expect(Object.keys(cells)).toHaveLength(9);
  });
});

describe("precedence", () => {
  // A synthetic plan with a live execution and the given winner, used for
  // the combinations no real transition reaches in this phase.
  const withWinner = (
    plan: ProtectedPlan,
    kind: "stop" | "cancel-initial" | "leave",
  ): ProtectedPlan => ({
    ...structuredClone(plan),
    winner: {
      kind,
      round: plan.round,
      target: "seed",
      payload: "seed",
      cause: "user",
      effect: "close",
      reply: seed("left-known").winner!.reply,
    },
  });
  const run = (plan: ProtectedPlan, kind: IntentKind) =>
    resolveIntent(
      plan,
      request(
        plan,
        kind,
        kind === "cancel-review"
          ? reviewTarget("r1")
          : plan.acceptance
            ? execution(plan)
            : generation(plan),
      ),
    );
  it("lets the first valid outcome win", () => {
    const result = run(accepted(), "cancel-initial");
    expect(result.plan.winner?.kind).toBe("cancel-initial");
  });
  it("lets a Stop that adds a fence replace a Cancel winner", () => {
    const result = run(withWinner(accepted(), "cancel-initial"), "stop");
    expect(result.reply.result).toBe("replaced");
    expect(result.reply.keys[0]).toBe("choiceReplacedByStop");
    expect(result.plan.winner?.kind).toBe("stop");
  });
  it("answers a Stop after a fencing Cancel with an open decision", () => {
    const cancelled = run(accepted(), "cancel-initial").plan;
    const result = run(cancelled, "stop");
    expect(result.reply).toMatchObject({
      result: "already-stopped",
      keys: ["currentStopped", "alreadyStoppedNeedsDecision"],
      winner: { kind: "cancel-initial" },
    });
  });
  it("answers a Stop after a Cancel on a closed or settled target as already closed", () => {
    for (const plan of [
      seed("cancelled"),
      run(seed("completed"), "cancel-initial").plan,
    ]) {
      const result = run(plan, "stop");
      expect(result.reply.result).toBe("already-closed");
      expect(result.reply.keys).not.toContain("alreadyStoppedNeedsDecision");
      expect(result.plan.winner?.kind).toBe("cancel-initial");
    }
  });
  it("defeats a Cancel under a Stop winner", () => {
    const stopped = run(accepted(), "stop").plan;
    expect(run(stopped, "cancel-initial").reply).toMatchObject({
      result: "defeated",
      keys: ["cancelDefeatedByStop"],
    });
    const closed = run(fresh(), "stop").plan;
    expect(run(closed, "cancel-initial").reply).toMatchObject({
      result: "defeated",
      keys: ["cancelCoveredByStopNoChanges"],
    });
  });
  it("adds a second Stop's fence without replacing the first Stop", () => {
    const result = run(withWinner(accepted(), "stop"), "stop");
    expect(result.reply.result).toBe("applied");
    expect(result.plan.winner?.target).toBe("seed");
  });
  it("answers a different Stop in an open decision as already stopped", () => {
    const stopped = run(accepted(), "stop").plan;
    const result = resolveIntent(
      stopped,
      request(stopped, "stop", execution(stopped), { payload: "again" }),
    );
    expect(result.reply.result).toBe("already-stopped");
  });
  it("answers a different Stop on a closed decision as already closed", () => {
    const closed = run(fresh(), "stop").plan;
    const result = resolveIntent(
      closed,
      request(closed, "stop", generation(closed), { payload: "again" }),
    );
    expect(result.reply.result).toBe("already-closed");
  });
  it("adds a Cancel's fence under a Cancel winner without replacing it", () => {
    const result = run(
      withWinner(accepted(), "cancel-initial"),
      "cancel-review",
    );
    expect(result.reply.result).toBe("applied");
    expect(result.plan.winner?.target).toBe("seed");
  });
  it("answers a second Cancel in an open decision as already stopped", () => {
    const cancelled = run(accepted(), "cancel-initial").plan;
    expect(run(cancelled, "cancel-review").reply.result).toBe(
      "already-stopped",
    );
  });
  it("answers a second Cancel on a closed decision as already closed", () => {
    expect(run(seed("cancelled"), "cancel-review").reply.result).toBe(
      "already-closed",
    );
  });
  it("keeps a seeded Leave winner, disposition and evidence", () => {
    for (const phase of [
      "left-known",
      "left-unconfirmed",
      "left-reopened",
    ] as const)
      for (const kind of ["stop", "cancel-initial", "cancel-review"] as const) {
        const plan = seed(phase);
        const result = run(plan, kind);
        expect(result.reply.result).toBe("already-closed");
        expect(result.plan.winner).toEqual(plan.winner);
        expect(result.plan.phase).toBe(phase);
        expect(result.plan.executions).toEqual(plan.executions);
      }
  });
  it("completeness: winner × incoming × safety × decision state has one row each", () => {
    const open = () => run(accepted(), "cancel-initial").plan; // Cancel winner, open
    const stopOpen = () => run(accepted(), "stop").plan; // Stop winner, open
    const matrix: [string, () => ProtectedPlan, IntentKind, string][] = [
      ["none / Stop", accepted, "stop", "applied"],
      ["none / Cancel", accepted, "cancel-initial", "applied"],
      [
        "Cancel / Stop safety",
        () => withWinner(accepted(), "cancel-initial"),
        "stop",
        "replaced",
      ],
      ["Cancel / Stop open", open, "stop", "already-stopped"],
      [
        "Cancel / Stop closed",
        () => seed("cancelled"),
        "stop",
        "already-closed",
      ],
      [
        "Cancel / Cancel safety",
        () => withWinner(accepted(), "cancel-initial"),
        "cancel-review",
        "applied",
      ],
      ["Cancel / Cancel open", open, "cancel-review", "already-stopped"],
      [
        "Cancel / Cancel closed",
        () => seed("cancelled"),
        "cancel-review",
        "already-closed",
      ],
      [
        "Stop / Stop safety",
        () => withWinner(accepted(), "stop"),
        "stop",
        "applied",
      ],
      ["Stop / Cancel any", stopOpen, "cancel-initial", "defeated"],
      ["Leave / Stop", () => seed("left-known"), "stop", "already-closed"],
      [
        "Leave / Cancel",
        () => seed("left-known"),
        "cancel-initial",
        "already-closed",
      ],
    ];
    for (const [name, make, kind, expected] of matrix)
      expect(run(make(), kind).reply.result, name).toBe(expected);
  });
});

describe("fences", () => {
  const live = () => accepted();
  const token = (plan: ProtectedPlan) => {
    const run = plan.executions[executionOf(plan)]!;
    return { executionId: run.id, fence: run.fence };
  };
  // The admission issued for the plan built most recently.
  let issued: Admission | undefined;
  const admit = (plan: ProtectedPlan) => {
    const result = stepEvent(plan, {
      ...token(plan),
      event: "admission",
      stepId: "s1",
      operationId: "op1",
    });
    issued = (result.reply as { admission?: Admission }).admission;
    return result.plan;
  };
  const commit = (plan: ProtectedPlan) =>
    stepEvent(plan, {
      ...token(plan),
      event: "commit",
      stepId: "s1",
      operationId: "op1",
      admission: issued!,
      receipt: "applied-1",
    }).plan;
  const any = (
    event: "admission" | "commit" | "renewal",
    plan: ProtectedPlan,
    fence?: number,
  ) =>
    stepEvent(
      plan,
      event === "renewal"
        ? {
            executionId: executionOf(plan),
            fence: fence ?? token(plan).fence,
            event,
          }
        : event === "admission"
          ? {
              executionId: executionOf(plan),
              fence: fence ?? token(plan).fence,
              event,
              stepId: "s1",
              operationId: "op1",
            }
          : {
              executionId: executionOf(plan),
              fence: fence ?? token(plan).fence,
              event,
              stepId: "s1",
              operationId: "op1",
              admission: issued ?? ({} as Admission),
            },
    );
  const fence = (plan: ProtectedPlan) =>
    resolveIntent(plan, request(plan, "stop", execution(plan))).plan;
  it("refuses a stale token", () => {
    const plan = live();
    expect(
      stepEvent(plan, {
        executionId: executionOf(plan),
        fence: 99,
        event: "renewal",
      }).reply,
    ).toMatchObject({ rule: "stale-token", key: "staleFence" });
  });
  it("refuses every event after a fence and keeps the step's record", () => {
    for (const before of [
      live,
      () => admit(live()),
      () => commit(admit(live())),
    ]) {
      issued = undefined;
      const plan = fence(before());
      for (const event of ["admission", "commit", "renewal"] as const) {
        const result = any(event, plan);
        expect(result.reply).toMatchObject({ rule: "fenced", key: "fenced" });
        expect(result.plan).toBe(plan);
      }
    }
  });
  it("returns the existing record for a duplicate admission or commit", () => {
    const admitted = admit(live());
    expect(
      stepEvent(admitted, {
        ...token(admitted),
        event: "admission",
        stepId: "s1",
        operationId: "op1",
      }).reply.rule,
    ).toBe("existing");
    const committed = commit(admitted);
    const again = any("commit", committed);
    expect(again.reply).toEqual({
      result: "existing",
      rule: "existing",
      receipt: "applied-1",
    });
    expect(again.plan).toBe(committed);
  });
  it("allows live admission, commit after admission and renewal; refuses commit without admission", () => {
    const plan = live();
    expect(
      stepEvent(plan, { ...token(plan), event: "renewal" }).reply.rule,
    ).toBe("live");
    issued = undefined;
    expect(any("commit", plan).reply).toMatchObject({
      rule: "live",
      key: "notAdmitted",
    });
    expect(
      commit(admit(plan)).executions[executionOf(plan)]!.steps.s1!.applied,
    ).toBe("applied-1");
  });
  it("completeness: token × E state × step state × event points to one row", () => {
    const states: [string, () => ProtectedPlan, Record<string, string>][] = [
      [
        "fenced never admitted",
        () => fence(live()),
        { admission: "fenced", commit: "fenced", renewal: "fenced" },
      ],
      [
        "fenced admitted",
        () => fence(admit(live())),
        { admission: "fenced", commit: "fenced", renewal: "fenced" },
      ],
      [
        "fenced committed",
        () => fence(commit(admit(live()))),
        { admission: "fenced", commit: "fenced", renewal: "fenced" },
      ],
      [
        "live never admitted",
        live,
        { admission: "live", commit: "live", renewal: "live" },
      ],
      [
        "live admitted",
        () => admit(live()),
        { admission: "existing", commit: "live", renewal: "live" },
      ],
      [
        "live committed",
        () => commit(admit(live())),
        { admission: "existing", commit: "existing", renewal: "live" },
      ],
    ];
    for (const [name, make, expected] of states)
      for (const event of ["admission", "commit", "renewal"] as const) {
        issued = undefined;
        const plan = make();
        expect(any(event, plan).reply.rule, `${name} ${event}`).toBe(
          expected[event],
        );
        expect(any(event, plan, 0).reply.rule, `${name} ${event} stale`).toBe(
          "stale-token",
        );
      }
  });
});

describe("readback truth", () => {
  const cases: [
    string,
    Parameters<typeof stepTruth>[0],
    boolean,
    string,
    string,
  ][] = [
    [
      "applied and contradictory",
      { admitted: true, applied: "a", contradictory: true },
      true,
      "unknown",
      "contradiction",
    ],
    [
      "applied and no-effect",
      { admitted: true, applied: "a", noEffect: "n" },
      true,
      "unknown",
      "contradiction",
    ],
    [
      "consistent applied",
      { admitted: true, applied: "a" },
      false,
      "done",
      "applied",
    ],
    [
      "admitted, definitive no-effect, excluded",
      { admitted: true, noEffect: "n" },
      true,
      "not-done",
      "no-effect-excluded",
    ],
    [
      "never admitted, excluded",
      undefined,
      true,
      "not-done",
      "never-admitted-excluded",
    ],
    [
      "admitted, lost response, excluded",
      { admitted: true },
      true,
      "unknown",
      "unproven",
    ],
    [
      "no-effect without exclusion",
      { admitted: true, noEffect: "n" },
      false,
      "unknown",
      "unproven",
    ],
    ["no record, not excluded", undefined, false, "unknown", "unproven"],
  ];
  for (const [name, step, excluded, truth, row] of cases)
    it(name, () => {
      expect(stepTruth(step, excluded)).toEqual({ truth, rule: row });
    });
  it("readback reports done / not done / unknown for a fenced execution", () => {
    let plan = accepted();
    const run = plan.executions[executionOf(plan)]!;
    const admitted = stepEvent(plan, {
      executionId: run.id,
      fence: run.fence,
      event: "admission",
      stepId: "a",
      operationId: "a",
    });
    plan = stepEvent(admitted.plan, {
      executionId: run.id,
      fence: run.fence,
      event: "commit",
      stepId: "a",
      operationId: "a",
      admission: (admitted.reply as { admission: Admission }).admission,
    }).plan;
    plan = stepEvent(plan, {
      executionId: run.id,
      fence: run.fence,
      event: "admission",
      stepId: "b",
      operationId: "b",
    }).plan;
    plan = resolveIntent(plan, request(plan, "stop", execution(plan))).plan;
    expect(readback(plan, run.id, ["a", "b", "c"])).toEqual([
      { stepId: "a", truth: "done" },
      { stepId: "b", truth: "unknown" },
      { stepId: "c", truth: "not-done" },
    ]);
  });
});

describe("host-issued tokens are own records only", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"])
    it(`the inherited name ${name} is not a member and changes nothing`, () => {
      const plan = accepted();
      for (const type of ["execution", "review", "generation"] as const) {
        expect(mapTarget(plan, { type, id: name }).rule).toBe("foreign");
        for (const kind of [
          "stop",
          "cancel-initial",
          "cancel-review",
        ] as const) {
          const result = resolveIntent(
            plan,
            request(plan, kind, { type, id: name }),
          );
          expect(result.reply.result).toBe("invalid-target");
          expect(result.plan).toBe(plan);
        }
      }
      expect(
        stepEvent(plan, { executionId: name, fence: 1, event: "renewal" }).reply
          .rule,
      ).toBe("stale-token");
      const run = plan.executions[executionOf(plan)]!;
      expect(
        stepEvent(plan, {
          executionId: run.id,
          fence: run.fence,
          event: "commit",
          stepId: name,
          operationId: name,
          admission: {} as Admission,
        }).reply,
      ).toMatchObject({ key: "notAdmitted" });
    });
});

describe("intent request validation", () => {
  const valid = {
    kind: "stop",
    planId: "p",
    target: { type: "execution", id: "p.e1" },
    capturedRound: 1,
    expectedSlotVersion: 0,
    correlation: "c-1",
    cause: "user",
  };
  it("accepts a well formed request and normalizes its payload", () => {
    expect(parseIntentRequest(valid)).toEqual(valid);
    expect(parseIntentRequest({ ...valid, payload: "e\u0301" })?.payload).toBe(
      "\u00e9",
    );
  });
  for (const [name, change] of [
    ["not an object", null],
    ["array", []],
    ["unknown field", { extra: 1 }],
    ["unknown kind", { kind: "keep" }],
    ["missing target", { target: undefined }],
    ["target extra field", { target: { type: "execution", id: "x", y: 1 } }],
    ["bad target type", { target: { type: "plan", id: "x" } }],
    ["long token", { correlation: "x".repeat(129) }],
    ["negative version", { expectedSlotVersion: -1 }],
    ["unsafe integer", { capturedRound: 2 ** 53 }],
    ["unknown cause", { cause: "other" }],
    ["payload over 4096 bytes", { payload: "é".repeat(2049) }],
    ["payload not a string", { payload: 1 }],
  ] as const)
    it(`refuses ${name}`, () => {
      const body =
        change === null || Array.isArray(change)
          ? change
          : { ...valid, ...change };
      expect(parseIntentRequest(body)).toBeUndefined();
    });
  it("accepts a payload of exactly 4096 bytes and declares the body bound", () => {
    expect(
      parseIntentRequest({ ...valid, payload: "é".repeat(2048) }),
    ).toBeDefined();
    expect(MAX_INTENT_BODY_BYTES).toBe(8192);
  });
});

describe("superseded replies carry historical facts and the replacement", () => {
  it("a request on a replaced review names the current review and was never applied", () => {
    const plan = replaceReview(fresh(), review("r2", 1, "d2"));
    const reply = resolveIntent(
      plan,
      request(plan, "stop", reviewTarget("r1")),
    ).reply;
    expect(reply).toMatchObject({
      result: "superseded",
      requestedTargetApplied: false,
      replacement: { type: "review", id: "r2" },
    });
  });
  it("a request from an earlier round reports whether it was applied and names the current target", () => {
    const base = accepted();
    const stopped = resolveIntent(
      base,
      request(base, "stop", execution(base)),
    ).plan;
    const later = { ...structuredClone(stopped), round: 2 };
    const reply = resolveIntent(
      later,
      request(later, "stop", execution(later), { capturedRound: 1 }),
    ).reply;
    expect(reply).toMatchObject({
      result: "superseded",
      requestedTargetApplied: true,
      replacement: { type: "execution", id: executionOf(later) },
    });
    const never = resolveIntent(
      later,
      request(later, "cancel-review", reviewTarget("r1"), { capturedRound: 1 }),
    ).reply;
    expect(never.requestedTargetApplied).toBe(false);
  });
});

describe("confirmation after the run ended", () => {
  for (const phase of ["readback", "completed"] as const)
    it(`${phase}: the same command replays, another meets activation history`, () => {
      const plan =
        phase === "completed"
          ? completeExecution(accepted())
          : resolveIntent(
              accepted(),
              request(accepted(), "stop", execution(accepted())),
            ).plan;
      expect(confirm(plan, command()).reply.rule).toBe("replay");
      expect(confirm(plan, command({ clientReplyId: "x" })).reply.rule).toBe(
        "activation-history",
      );
    });
});

describe("commit needs its own admission", () => {
  it("a commit of an operation other than the admitted one is refused and leaves the evidence", () => {
    const plan = accepted();
    const run = plan.executions[executionOf(plan)]!;
    const token = { executionId: run.id, fence: run.fence };
    const admitted = stepEvent(plan, {
      ...token,
      event: "admission",
      stepId: "s",
      operationId: "op-a",
    });
    expect(admitted.reply.result).toBe("allowed");
    const admission = (admitted.reply as { admission?: unknown }).admission;
    expect(admission).toBeDefined();
    // Another operation re-admitted on the same step is refused too.
    const other = stepEvent(admitted.plan, {
      ...token,
      event: "admission",
      stepId: "s",
      operationId: "op-b",
    });
    expect(other.reply).toMatchObject({
      result: "refused",
      key: "notAdmitted",
    });
    expect(other.plan).toBe(admitted.plan);
    // A forged admission object, or the right one for another operation.
    for (const forged of [{ ...(admission as object) }, admission]) {
      const result = stepEvent(admitted.plan, {
        ...token,
        event: "commit",
        stepId: "s",
        operationId: forged === admission ? "op-b" : "op-a",
        admission: forged as never,
      });
      expect(result.reply).toMatchObject({
        result: "refused",
        key: "notAdmitted",
      });
      expect(readback(result.plan, run.id, ["s"])).toEqual([
        { stepId: "s", truth: "unknown" },
      ]);
    }
    const committed = stepEvent(admitted.plan, {
      ...token,
      event: "commit",
      stepId: "s",
      operationId: "op-a",
      admission: admission as never,
    });
    expect(committed.reply.result).toBe("allowed");
    expect(readback(committed.plan, run.id, ["s"])).toEqual([
      { stepId: "s", truth: "done" },
    ]);
  });
});

describe("superseded replies resolve aliases to the applied target", () => {
  for (const alias of ["generation", "review", "execution"] as const)
    it(`a ${alias}-captured Stop applied earlier is reported as applied`, () => {
      const plan = accepted();
      const target =
        alias === "generation"
          ? generation(plan)
          : alias === "review"
            ? reviewTarget("r1")
            : execution(plan);
      const stopped = resolveIntent(plan, request(plan, "stop", target)).plan;
      const later = { ...structuredClone(stopped), round: 2 };
      const reply = resolveIntent(
        later,
        request(later, "stop", target, { capturedRound: 1 }),
      ).reply;
      expect(reply.requestedTargetApplied).toBe(true);
    });
  it("a never-applied alias is reported as not applied", () => {
    const plan = { ...structuredClone(accepted()), round: 2 };
    for (const target of [
      generation(plan),
      reviewTarget("r1"),
      execution(plan),
    ])
      expect(
        resolveIntent(plan, request(plan, "stop", target, { capturedRound: 1 }))
          .reply.requestedTargetApplied,
      ).toBe(false);
  });
});

describe("historical facts use the canonical, membership-checked target", () => {
  it("an applied initial Cancel captured on a replaced review is reported as applied", () => {
    const plan = confirm(
      replaceReview(fresh(), review("r2", 1, "d2")),
      command({ digest: "d2" }),
    ).plan;
    const cancelled = resolveIntent(
      plan,
      request(plan, "cancel-initial", reviewTarget("r1")),
    ).plan;
    const later = { ...structuredClone(cancelled), round: 2 };
    const result = resolveIntent(
      later,
      request(later, "cancel-initial", reviewTarget("r1"), {
        capturedRound: 1,
      }),
    );
    expect(result.reply.requestedTargetApplied).toBe(true);
    expect(result.plan).toBe(later);
  });
  it("a foreign target is refused, never reported, even for an earlier round", () => {
    const stopped = resolveIntent(
      fresh(),
      request(fresh(), "stop", generation(fresh())),
    ).plan;
    const later = { ...structuredClone(stopped), round: 2 };
    const result = resolveIntent(
      later,
      request(
        later,
        "stop",
        // The generation's id spelled as an execution this host never issued.
        { type: "execution", id: later.generation },
        { capturedRound: 1 },
      ),
    );
    expect(result.reply.result).toBe("invalid-target");
    expect(result.reply.requestedTargetApplied).toBeUndefined();
    expect(result.plan).toBe(later);
  });
});

describe("admissions are bound to their own plan record", () => {
  const admitIn = (plan: ProtectedPlan) => {
    const run = plan.executions[executionOf(plan)]!;
    const result = stepEvent(plan, {
      executionId: run.id,
      fence: run.fence,
      event: "admission",
      stepId: "s",
      operationId: "op",
    });
    return {
      plan: result.plan,
      run,
      admission: (result.reply as { admission: Admission }).admission,
    };
  };
  it("two plans with the same local ids never accept each other's admission", () => {
    // Another record holding the same execution id, as a store restored
    // under another conversation and generation would.
    const base = accepted();
    const one = admitIn(base);
    const other = admitIn({
      ...structuredClone(base),
      recordId: crypto.randomUUID(),
      conversationId: "other-conversation",
      generation: "g9",
    });
    expect(one.run.id).toBe(other.run.id);
    const crossed = stepEvent(other.plan, {
      executionId: other.run.id,
      fence: other.run.fence,
      event: "commit",
      stepId: "s",
      operationId: "op",
      admission: one.admission,
    });
    expect(crossed.reply).toMatchObject({
      result: "refused",
      key: "notAdmitted",
    });
    expect(readback(crossed.plan, other.run.id, ["s"])).toEqual([
      { stepId: "s", truth: "unknown" },
    ]);
    // Its own admission still commits, and a retry of the same admission
    // gets the same proof back.
    const retried = stepEvent(other.plan, {
      executionId: other.run.id,
      fence: other.run.fence,
      event: "admission",
      stepId: "s",
      operationId: "op",
    });
    expect((retried.reply as { admission?: Admission }).admission).toBe(
      other.admission,
    );
    expect(
      stepEvent(other.plan, {
        executionId: other.run.id,
        fence: other.run.fence,
        event: "commit",
        stepId: "s",
        operationId: "op",
        admission: other.admission,
      }).reply.result,
    ).toBe("allowed");
  });
  it("an independently created record with identical ids is still another record", () => {
    // Same plan, conversation, generation, execution and fence: only the
    // record differs, as with two hosts or a restored store.
    const base = accepted();
    const one = admitIn(base);
    const twin = admitIn({
      ...structuredClone(base),
      recordId: crypto.randomUUID(),
    });
    expect([
      twin.plan.conversationId,
      twin.plan.generation,
      twin.run.id,
    ]).toEqual([one.plan.conversationId, one.plan.generation, one.run.id]);
    expect(
      stepEvent(twin.plan, {
        executionId: twin.run.id,
        fence: twin.run.fence,
        event: "commit",
        stepId: "s",
        operationId: "op",
        admission: one.admission,
      }).reply,
    ).toMatchObject({ result: "refused", key: "notAdmitted" });
  });
  it("the retry index is per plan record and empties on commit, fence and release", () => {
    const committed = admitIn(accepted());
    expect(pendingAdmissions(committed.plan)).toBe(1);
    const after = stepEvent(committed.plan, {
      executionId: committed.run.id,
      fence: committed.run.fence,
      event: "commit",
      stepId: "s",
      operationId: "op",
      admission: committed.admission,
    }).plan;
    expect(pendingAdmissions(after)).toBe(0);
    const fenced = admitIn(accepted());
    const stopped = resolveIntent(
      fenced.plan,
      request(fenced.plan, "stop", execution(fenced.plan)),
    ).plan;
    expect(pendingAdmissions(stopped)).toBe(0);
    const released = admitIn(accepted());
    const live = admitIn(accepted());
    releasePlan(released.plan);
    expect(pendingAdmissions(released.plan)).toBe(0);
    // Another live record's retries still work.
    expect(pendingAdmissions(live.plan)).toBe(1);
  });
});

describe("the retry index follows the stored record, never a discarded candidate", () => {
  const admitted = () => {
    const plan = accepted();
    const run = plan.executions[executionOf(plan)]!;
    const step = {
      executionId: run.id,
      fence: run.fence,
      stepId: "s",
      operationId: "op",
    };
    const result = stepEvent(plan, { ...step, event: "admission" });
    return {
      stored: result.plan,
      step,
      admission: (result.reply as { admission: Admission }).admission,
    };
  };
  const retry = (
    stored: ProtectedPlan,
    step: ReturnType<typeof admitted>["step"],
  ) => stepEvent(stored, { ...step, event: "admission" });
  it("a discarded admission leaves the stored record without an entry", () => {
    const stored = accepted();
    const run = stored.executions[executionOf(stored)]!;
    stepEvent(stored, {
      executionId: run.id,
      fence: run.fence,
      event: "admission",
      stepId: "s",
      operationId: "op",
    });
    expect(pendingAdmissions(stored)).toBe(0);
  });
  it("a discarded commit leaves the stored admission retryable", () => {
    const { stored, step, admission } = admitted();
    stepEvent(stored, { ...step, event: "commit", admission });
    expect(pendingAdmissions(stored)).toBe(1);
    expect(retry(stored, step).reply).toMatchObject({
      result: "existing",
      admission,
    });
    expect(
      stepEvent(stored, { ...step, event: "commit", admission }).reply.result,
    ).toBe("allowed");
  });
  it("a discarded fence leaves the stored admission retryable and committable", () => {
    const { stored, step, admission } = admitted();
    resolveIntent(stored, request(stored, "stop", execution(stored)));
    expect(stored.executions[step.executionId]!.fenced).toBeFalsy();
    expect(pendingAdmissions(stored)).toBe(1);
    expect(retry(stored, step).reply).toMatchObject({
      result: "existing",
      admission,
    });
    expect(
      stepEvent(stored, { ...step, event: "commit", admission }).reply.result,
    ).toBe("allowed");
  });
  it("a stored successor keeps the earlier admissions of its source", () => {
    const { stored, step, admission } = admitted();
    const next = stepEvent(stored, {
      ...step,
      event: "admission",
      stepId: "t",
      operationId: "op-t",
    }).plan;
    expect(pendingAdmissions(next)).toBe(2);
    expect(retry(next, step).reply).toMatchObject({
      result: "existing",
      admission,
    });
    expect(
      stepEvent(next, { ...step, event: "commit", admission }).reply.result,
    ).toBe("allowed");
  });
  it("an exact retry after the commit returns the receipt from the record", () => {
    const { stored, step, admission } = admitted();
    const committed = stepEvent(stored, {
      ...step,
      event: "commit",
      admission,
      receipt: "r-1",
    }).plan;
    expect(pendingAdmissions(committed)).toBe(0);
    const again = retry(committed, step);
    expect(again.reply).toMatchObject({ result: "existing", receipt: "r-1" });
    expect(again.plan).toBe(committed);
  });
});

describe("committed responses and execution authority", () => {
  it("a commit stores its response and an exact retry returns it", () => {
    const plan = accepted();
    const run = plan.executions[executionOf(plan)]!;
    const step = {
      executionId: run.id,
      fence: run.fence,
      stepId: "s",
      operationId: "op",
    };
    const admitted = stepEvent(plan, { ...step, event: "admission" });
    const admission = (admitted.reply as { admission: Admission }).admission;
    const committed = stepEvent(admitted.plan, {
      ...step,
      event: "commit",
      admission,
      receipt: "r",
      response: '{"title":"After"}',
    }).plan;
    expect(
      stepEvent(committed, { ...step, event: "admission" }).reply,
    ).toMatchObject({
      result: "existing",
      receipt: "r",
      response: '{"title":"After"}',
    });
  });
  it("independently created records issue distinct execution ids", () => {
    expect(executionOf(accepted())).not.toBe(executionOf(accepted()));
  });
});

describe("issued execution ids stay within the wire token bound", () => {
  it("the longest supported plan id gets an execution id a Stop can name", () => {
    const planId = "p".repeat(128);
    const plan = confirm(
      createProtectedPlan({
        planId,
        conversationId: "c",
        generation: "g".repeat(128),
        review: review("r".repeat(128)),
      }),
      command(),
    ).plan;
    const id = executionOf(plan);
    expect(id).toMatch(/^[A-Za-z0-9._~-]{1,128}$/);
    expect(recoveryView(plan).executionId).toBe(id);
    const stop = request(plan, "stop", execution(plan));
    expect(parseIntentRequest(stop)).toBeDefined();
    expect(resolveIntent(plan, stop).reply).toMatchObject({
      result: "applied",
    });
  });
});
