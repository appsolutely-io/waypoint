import { it, expect, describe } from "vitest";
import { createHash } from "node:crypto";
import {
  completeExecution,
  confirm,
  createProtectedPlan,
  MAX_INTENT_BODY_BYTES,
  newerThanBaseline,
  parseIntentRequest,
  readback,
  recordContradiction,
  recoveryView,
  replaceReview,
  resolveIntent,
  stepEvent,
  type IntentKind,
  type IntentRequest,
  type ProtectedPlan,
} from "../../src/host/plan-intents";
import type { Admission } from "../../src/host/plan-intents";

const leaveOffered = { leave: true };
const review = (id = "r1", digest = "d1") => ({
  id,
  revision: 1,
  digest,
  state: "current" as const,
});
const fresh = (steps = ["s1", "s2"], planId = "p") =>
  createProtectedPlan({
    planId,
    conversationId: "c",
    generation: "g1",
    review: review(),
    steps,
  });
const confirmed = (plan: ProtectedPlan, digest = "d1") =>
  confirm(plan, { clientReplyId: "confirm-1", digest, protocol: "1.0" }).plan;
const running = (steps?: string[]) => confirmed(fresh(steps));
const runOf = (plan: ProtectedPlan) =>
  plan.executions[plan.acceptance!.executionId]!;
function admit(plan: ProtectedPlan, stepId: string) {
  const run = runOf(plan);
  const step = {
    executionId: run.id,
    fence: run.fence,
    stepId,
    operationId: stepId,
  };
  const admitted = stepEvent(plan, { ...step, event: "admission" });
  return {
    plan: admitted.plan,
    step,
    admission: (admitted.reply as { admission: Admission }).admission,
  };
}
function commit(plan: ProtectedPlan, stepId: string) {
  const admitted = admit(plan, stepId);
  return stepEvent(admitted.plan, {
    ...admitted.step,
    event: "commit",
    admission: admitted.admission,
    receipt: `${stepId}-r`,
  }).plan;
}
const target = (plan: ProtectedPlan) => ({
  type: "execution" as const,
  id: plan.acceptance!.executionId,
});
let correlations = 0;
function intent(
  plan: ProtectedPlan,
  kind: IntentKind,
  overrides: Partial<IntentRequest> = {},
): IntentRequest {
  const view = recoveryView(plan);
  return {
    kind,
    planId: plan.planId,
    target: plan.acceptance
      ? target(plan)
      : { type: "generation", id: plan.generation },
    capturedRound: view.round,
    expectedSlotVersion: view.slots[kind],
    correlation: `c-${++correlations}`,
    cause: "user",
    ...overrides,
  };
}
// A Leave built from what a window rendered of `plan`.
function leave(
  plan: ProtectedPlan,
  ack: Partial<NonNullable<IntentRequest["acknowledgment"]>> = {},
  overrides: Partial<IntentRequest> = {},
): IntentRequest {
  const view = recoveryView(plan);
  return intent(plan, "leave", {
    acknowledgment: {
      sourceDecisionKey: view.decisionKey ?? "none",
      evidenceVersion: view.versions.evidence,
      winnerVersion: view.versions.winner,
      decisionResolutionVersion: view.versions.decisionResolution,
      evidenceDigest: view.evidenceDigest ?? "A".repeat(43),
      unknownCount: view.unknownCount ?? 0,
      ...ack,
    },
    ...overrides,
  });
}
const resolve = (plan: ProtectedPlan, request: IntentRequest) =>
  resolveIntent(plan, request, leaveOffered);
// Readback after a connection-lost Stop of a two-step run whose first step
// committed: step two was never admitted, so every truth is definitive.
function stopped(cause: IntentRequest["cause"] = "connection-lost") {
  const plan = commit(running(), "s1");
  return resolve(plan, intent(plan, "stop", { cause })).plan;
}

describe("Leave request validation", () => {
  const base = {
    kind: "leave",
    planId: "p",
    target: { type: "execution", id: "e" },
    capturedRound: 1,
    expectedSlotVersion: 0,
    correlation: "c",
    cause: "user",
    acknowledgment: {
      sourceDecisionKey: "e",
      evidenceVersion: 1,
      winnerVersion: 1,
      decisionResolutionVersion: 0,
      evidenceDigest: "A".repeat(43),
      unknownCount: 0,
    },
  };
  it("Stop and both Cancel kinds never carry an acknowledgment", () => {
    for (const kind of ["stop", "cancel-initial", "cancel-review"])
      expect(parseIntentRequest({ ...base, kind }), kind).toBeUndefined();
    const plain: Record<string, unknown> = { ...base, kind: "stop" };
    delete plain.acknowledgment;
    expect(parseIntentRequest(plain)).toBeDefined();
  });
  it("a Leave needs a complete, well formed acknowledgment", () => {
    const without: Record<string, unknown> = { ...base };
    delete without.acknowledgment;
    expect(parseIntentRequest(without)).toBeUndefined();
    const ack = base.acknowledgment;
    for (const bad of [
      { ...ack, extra: 1 },
      { ...ack, evidenceDigest: "short" },
      { ...ack, evidenceDigest: "+".repeat(43) },
      { ...ack, winnerVersion: 2 ** 53 },
      { ...ack, unknownCount: -1 },
      { ...ack, sourceDecisionKey: "" },
      (({ unknownCount: _u, ...rest }) => rest)(ack),
    ])
      expect(
        parseIntentRequest({ ...base, acknowledgment: bad }),
      ).toBeUndefined();
  });
  it("a valid Leave is parsed with its acknowledgment", () => {
    expect(parseIntentRequest(base)).toEqual(base);
  });
  it("the largest Leave body fits the route bound", () => {
    const token = "t".repeat(128);
    const largest = {
      ...base,
      planId: token,
      target: { type: "execution", id: token },
      correlation: token,
      capturedRound: Number.MAX_SAFE_INTEGER,
      expectedSlotVersion: Number.MAX_SAFE_INTEGER,
      cause: "attribution-missing",
      payload: "x".repeat(4096),
      acknowledgment: {
        sourceDecisionKey: token,
        evidenceVersion: Number.MAX_SAFE_INTEGER,
        winnerVersion: Number.MAX_SAFE_INTEGER,
        decisionResolutionVersion: Number.MAX_SAFE_INTEGER,
        evidenceDigest: "A".repeat(43),
        unknownCount: Number.MAX_SAFE_INTEGER,
      },
    };
    expect(parseIntentRequest(largest)).toBeDefined();
    expect(
      new TextEncoder().encode(JSON.stringify(largest)).length,
    ).toBeLessThan(MAX_INTENT_BODY_BYTES);
  });
});

describe("decision versions and the evidence digest", () => {
  it("acceptance, commits, fences and closures move the right versions", () => {
    const start = recoveryView(fresh());
    expect(start.versions).toEqual({
      evidence: 0,
      winner: 0,
      decisionResolution: 0,
    });
    expect(start.decisionKey).toBeUndefined();
    const accepted = running();
    const view = recoveryView(accepted);
    expect(view.decisionKey).toBe(accepted.acceptance!.executionId);
    expect(view.evidenceDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(view.unknownCount).toBe(2);
    const committed = commit(accepted, "s1");
    expect(recoveryView(committed).versions.evidence).toBe(
      view.versions.evidence + 1,
    );
    expect(recoveryView(committed).unknownCount).toBe(1);
    // An admission alone changes no truth.
    expect(recoveryView(admit(committed, "s2").plan).versions.evidence).toBe(
      recoveryView(committed).versions.evidence,
    );
    const halted = resolve(committed, intent(committed, "stop")).plan;
    expect(recoveryView(halted).versions).toEqual({
      evidence: recoveryView(committed).versions.evidence + 1,
      winner: 1,
      decisionResolution: 0,
    });
    expect(recoveryView(halted).unknownCount).toBe(0);
  });
});

describe("Leave boundary: capability, membership and target eligibility", () => {
  it("is unavailable when the host does not offer Leave", () => {
    const plan = stopped();
    const reply = resolveIntent(plan, leave(plan)).reply;
    expect(reply).toMatchObject({
      result: "unavailable",
      keys: ["capabilityMissing"],
    });
  });
  it("a foreign target is refused at every captured round, with nothing changed", () => {
    const plan = stopped();
    for (const capturedRound of [
      0,
      plan.round - 1,
      plan.round,
      plan.round + 1,
    ]) {
      const result = resolve(
        plan,
        leave(
          plan,
          {},
          {
            capturedRound,
            target: { type: "execution", id: "elsewhere.e1" },
          },
        ),
      );
      expect(result.reply.result, String(capturedRound)).toBe("invalid-target");
      expect(result.plan).toBe(plan);
    }
  });
  it("a source key that is not this record's decision is refused, with nothing changed", () => {
    const plan = stopped();
    const other = stopped();
    for (const capturedRound of [plan.round - 1, plan.round]) {
      const result = resolve(
        plan,
        leave(
          plan,
          { sourceDecisionKey: other.acceptance!.executionId },
          { capturedRound },
        ),
      );
      expect(result.reply.result).toBe("invalid-target");
      expect(result.plan).toBe(plan);
    }
  });
  it("without an accepted decision a Leave is answered without comparing its source", () => {
    const proposal = createProtectedPlan({
      planId: "p",
      conversationId: "c",
      generation: "g1",
      steps: ["s1"],
    });
    for (const plan of [proposal, fresh()]) {
      const result = resolve(plan, leave(plan, { sourceDecisionKey: "x" }));
      expect(result.reply).toMatchObject({
        result: "unavailable",
        keys: ["leaveNoDecision"],
      });
      expect(result.plan).toBe(plan);
    }
    const initial = fresh();
    const cancelled = resolve(initial, intent(initial, "cancel-initial")).plan;
    const result = resolve(
      cancelled,
      leave(cancelled, { sourceDecisionKey: "x" }),
    );
    expect(result.reply).toMatchObject({
      result: "already-closed",
      phase: "cancelled",
      winner: { kind: "cancel-initial" },
    });
    expect(result.plan).toBe(cancelled);
  });
  it("a Leave on a replaced review is superseded even with the current acknowledgment", () => {
    let plan = replaceReview(fresh(), review("r2", "d2"));
    plan = confirmed(plan, "d2");
    plan = resolve(plan, intent(plan, "stop")).plan;
    const result = resolve(
      plan,
      leave(plan, {}, { target: { type: "review", id: "r1" } }),
    );
    expect(result.reply).toMatchObject({
      result: "superseded",
      keys: ["intentSuperseded"],
    });
    expect(result.plan).toBe(plan);
    // The generation, the accepted review and the execution all reach E.
    for (const aliased of [
      { type: "generation" as const, id: "g1" },
      { type: "review" as const, id: "r2" },
      target(plan),
    ])
      expect(
        resolve(plan, leave(plan, {}, { target: aliased })).reply.result,
      ).toBe("applied");
  });
  it("a Leave on an earlier generation's token is superseded", () => {
    const plan = stopped();
    plan.earlierTokens.push("g0");
    const result = resolve(
      plan,
      leave(plan, {}, { target: { type: "generation", id: "g0" } }),
    );
    expect(result.reply.result).toBe("superseded");
    expect(result.plan).toBe(plan);
  });
  it("a Leave on a review closed unaccepted is already closed", () => {
    const plan = stopped();
    plan.reviews.push({ ...review("r9", "d9"), state: "closed" });
    const result = resolve(
      plan,
      leave(plan, {}, { target: { type: "review", id: "r9" } }),
    );
    expect(result.reply.result).toBe("already-closed");
    expect(result.plan).toBe(plan);
  });
  it("an acknowledged version above the host's is refused", () => {
    const plan = stopped();
    const view = recoveryView(plan);
    for (const ack of [
      { evidenceVersion: view.versions.evidence + 1 },
      { winnerVersion: view.versions.winner + 1 },
      { decisionResolutionVersion: 1 },
    ]) {
      const result = resolve(plan, leave(plan, ack));
      expect(result.reply).toMatchObject({
        result: "refused",
        keys: ["acknowledgmentAhead"],
      });
      expect(result.plan).toBe(plan);
    }
  });
});

describe("opening a round needs every current version", () => {
  it("an informed Leave from readback opens the next round and closes the decision", () => {
    const plan = stopped();
    const result = resolve(plan, leave(plan));
    expect(result.reply).toMatchObject({
      result: "applied",
      keys: ["leftKnown"],
      effectiveRound: plan.round + 1,
      count: 2,
      forwardClosed: true,
      dispositionApplied: true,
      safetyApplied: false,
      winner: { kind: "leave", cause: "user" },
      phase: "left-known",
    });
    expect(result.plan.round).toBe(plan.round + 1);
    expect(result.plan.join).toMatchObject({
      fromRound: plan.round,
      toRound: plan.round + 1,
      sourceDecisionKey: plan.acceptance!.executionId,
      acknowledgedEvidenceVersion: plan.versions.evidence,
      openingWinnerVersion: plan.versions.winner,
      openingDecisionResolutionVersion: 0,
      semanticEvidenceDigest: plan.evidenceDigest,
      openingWinnerSnapshot: { kind: "stop", cause: "connection-lost" },
    });
    expect(result.plan.baseline).toEqual(plan.versions);
    // The prior winner is still shown with its applied fact.
    expect(recoveryView(result.plan).winner).toEqual({
      kind: "leave",
      cause: "user",
    });
    expect(result.plan.priorWinner).toMatchObject({ kind: "stop" });
  });
  it("named unknown steps close as left-unconfirmed with their count", () => {
    let plan = admit(commit(running(["s1", "s2", "s3"]), "s1"), "s2").plan;
    plan = resolve(plan, intent(plan, "stop")).plan;
    expect(recoveryView(plan).unknownCount).toBe(1);
    expect(resolve(plan, leave(plan)).reply).toMatchObject({
      result: "applied",
      keys: ["leftUnconfirmed"],
      count: 1,
      phase: "left-unconfirmed",
    });
  });
  it("each stale or mismatching component keeps the Leave in its round", () => {
    const plan = stopped();
    const view = recoveryView(plan);
    for (const [name, ack] of [
      ["stale evidence", { evidenceVersion: view.versions.evidence - 1 }],
      ["stale winner", { winnerVersion: 0 }],
      ["other digest", { evidenceDigest: "B".repeat(43) }],
      ["other unknown count", { unknownCount: 1 }],
    ] as const) {
      const result = resolve(plan, leave(plan, ack));
      expect(result.reply, name).toMatchObject({
        result: "defeated",
        keys: ["leaveDefeatedByWinner"],
        effectiveRound: plan.round,
      });
      expect(result.plan.round, name).toBe(plan.round);
      expect(result.plan.join, name).toBeUndefined();
      expect(result.plan.winner, name).toEqual(plan.winner);
      expect(result.plan.phase, name).toBe("readback");
    }
  });
});

describe("the one current join", () => {
  it("a second window's identical Leave joins the opened round and gets the stored closure", () => {
    const plan = stopped();
    const a = leave(plan);
    const b = leave(plan);
    const first = resolve(plan, a);
    const joined = resolve(first.plan, b);
    expect(joined.plan).toBe(first.plan);
    expect(joined.reply).toEqual({
      ...first.reply,
      capturedRound: b.capturedRound,
      correlation: b.correlation,
    });
    // Reversed arrival order ends in the same state.
    const reversed = resolve(resolve(plan, b).plan, a);
    expect(reversed.plan.phase).toBe("left-known");
    expect(reversed.plan.round).toBe(first.plan.round);
  });
  it("a view read after the closure stays in that round, and the delayed and retried Leaves still get the closure", () => {
    const plan = stopped();
    const a = leave(plan);
    const b = leave(plan);
    const closed = resolve(plan, a);
    // A window reads the closed round and presses Leave again.
    const later = resolve(closed.plan, leave(closed.plan));
    expect(later.reply).toMatchObject({
      result: "already-closed",
      effectiveRound: closed.plan.round,
    });
    expect(later.plan.round).toBe(closed.plan.round);
    expect(later.plan.join).toEqual(closed.plan.join);
    for (const request of [b, { ...a }]) {
      const delayed = resolve(later.plan, request);
      expect(delayed.reply).toEqual({
        ...closed.reply,
        capturedRound: request.capturedRound,
        correlation: request.correlation,
      });
      expect(delayed.plan).toBe(later.plan);
    }
  });
  it("a copied acknowledgment with an earlier winner version is refused against the original winner", () => {
    const plan = stopped();
    const closed = resolve(plan, leave(plan)).plan;
    const held = leave(plan, { winnerVersion: 0 });
    const result = resolve(closed, held);
    expect(result.reply).toMatchObject({
      result: "defeated",
      keys: ["leaveDefeatedByWinner"],
      winner: { kind: "stop", cause: "connection-lost" },
    });
    expect(result.plan).toBe(closed);
  });
  it("a view of the current round below its own floors is refused as stale", () => {
    const plan = stopped();
    const closed = resolve(plan, leave(plan)).plan;
    const result = resolve(
      closed,
      leave(closed, {
        winnerVersion: plan.versions.winner - 1,
        evidenceVersion: plan.versions.evidence,
      }),
    );
    expect(result.reply).toMatchObject({
      result: "refused",
      keys: ["acknowledgmentStale"],
    });
    expect(result.plan).toBe(closed);
  });
  it("an evidence change clears the join; the delayed Leave is then superseded", () => {
    const plan = stopped();
    const b = leave(plan);
    const closed = resolve(plan, leave(plan)).plan;
    const reopened = recordContradiction(
      closed,
      closed.acceptance!.executionId,
      "s1",
    );
    expect(reopened.join).toBeUndefined();
    expect(reopened.phase).toBe("left-reopened");
    expect(recoveryView(reopened).versions.evidence).toBe(
      closed.versions.evidence + 1,
    );
    const result = resolve(reopened, b);
    expect(result.reply.result).toBe("superseded");
    expect(result.plan).toBe(reopened);
  });
  it("a winner advance without an evidence change keeps the join", () => {
    const plan = stopped();
    const closed = resolve(plan, leave(plan)).plan;
    expect(closed.versions.winner).toBe(plan.versions.winner + 1);
    expect(closed.join).toBeDefined();
  });
  it("older and future captured rounds are superseded", () => {
    const plan = stopped();
    const closed = resolve(plan, leave(plan)).plan;
    const reopened = recordContradiction(
      closed,
      closed.acceptance!.executionId,
      "s1",
    );
    const third = resolve(reopened, leave(reopened)).plan;
    expect(third.round).toBe(plan.round + 2);
    for (const capturedRound of [plan.round, third.round + 1]) {
      const result = resolve(third, leave(third, {}, { capturedRound }));
      expect(result.reply.result, String(capturedRound)).toBe("superseded");
      expect(result.plan).toBe(third);
    }
  });
  it("an old Stop replay after the closure is superseded and cannot replace it", () => {
    const committed = commit(running(), "s1");
    const first = intent(committed, "stop", { cause: "connection-lost" });
    const halted = resolve(committed, first).plan;
    const closed = resolve(halted, leave(halted)).plan;
    const result = resolve(closed, first);
    expect(result.reply).toMatchObject({
      result: "superseded",
      requestedTargetApplied: true,
      winner: { kind: "leave" },
    });
    expect(result.plan).toBe(closed);
  });
});

describe("Leave cells and precedence", () => {
  it("against a live execution Leave fences it in the same round and saves no disposition", () => {
    const plan = admit(commit(running(), "s1"), "s2");
    const result = resolve(plan.plan, leave(plan.plan));
    expect(result.reply).toMatchObject({
      result: "needs-review",
      keys: ["leaveSafetyNeedsReview"],
      safetyApplied: true,
      dispositionApplied: false,
      effectiveRound: plan.plan.round,
      winner: { kind: "leave" },
      phase: "readback",
    });
    expect(result.plan.round).toBe(plan.plan.round);
    expect(result.plan.join).toBeUndefined();
    expect(
      stepEvent(result.plan, {
        ...plan.step,
        event: "commit",
        admission: plan.admission,
      }).reply,
    ).toMatchObject({ result: "refused", key: "fenced" });
    // Its lost-response retry gets the stored resolution.
    const request = leave(plan.plan);
    const once = resolve(plan.plan, request);
    expect(resolve(once.plan, { ...request }).reply).toEqual(once.reply);
  });
  it("Stop, Cancel and an uninformed Leave after the Leave fence are already stopped by it", () => {
    const live = commit(running(), "s1");
    const fenced = resolve(live, leave(live)).plan;
    const expected = {
      result: "already-stopped",
      safetyApplied: true,
      dispositionApplied: false,
      winner: { kind: "leave" },
    };
    expect(resolve(fenced, intent(live, "stop")).reply).toMatchObject({
      ...expected,
      keys: [
        "currentStopped",
        "alreadyStoppedNeedsDecision",
        "leaveSafetyAlreadyStopped",
      ],
    });
    for (const kind of ["cancel-initial", "cancel-review"] as const)
      expect(
        resolve(
          fenced,
          intent(fenced, kind, {
            target:
              kind === "cancel-review"
                ? { type: "review", id: "r1" }
                : target(fenced),
          }),
        ).reply,
      ).toMatchObject({
        ...expected,
        keys: [
          "currentStopped",
          "alreadyStoppedNeedsDecision",
          "cancelCoveredByLeaveSafety",
        ],
      });
    expect(
      resolve(
        fenced,
        leave(live, {}, { expectedSlotVersion: 1, payload: "another" }),
      ).reply,
    ).toMatchObject({
      ...expected,
      keys: [
        "currentStopped",
        "alreadyStoppedNeedsDecision",
        "leaveSafetyAlreadyStopped",
      ],
    });
    // A new informed Leave from the resulting readback closes the decision.
    expect(resolve(fenced, leave(fenced)).reply).toMatchObject({
      result: "applied",
      keys: ["leftKnown"],
      effectiveRound: fenced.round + 1,
    });
  });
  it("Stop first, then the captured Leave is defeated; a new Leave then closes", () => {
    const live = commit(running(), "s1");
    const captured = leave(live);
    const halted = resolve(live, intent(live, "stop")).plan;
    expect(resolve(halted, captured).reply).toMatchObject({
      result: "defeated",
      keys: ["leaveDefeatedByWinner"],
      winner: { kind: "stop" },
    });
    expect(resolve(halted, leave(halted)).reply.result).toBe("applied");
  });
  it("a Leave that applies nothing creates no winner and moves no version", () => {
    const done = completeExecution(commit(commit(running(), "s1"), "s2"));
    const result = resolve(done, leave(done));
    expect(result.reply).toMatchObject({
      result: "already-closed",
      phase: "completed",
    });
    expect(result.reply.winner).toBeUndefined();
    expect(result.plan.winner).toBeUndefined();
    expect(result.plan.versions).toEqual(done.versions);
    expect(result.plan.round).toBe(done.round);
    // Every terminal kind still resolves by its own rules afterwards.
    for (const kind of ["stop", "cancel-initial"] as const)
      expect(
        resolve(result.plan, intent(result.plan, kind)).reply,
      ).toMatchObject({
        result: "applied",
        keys: ["initialTargetSettled"],
      });
    expect(
      resolve(
        result.plan,
        intent(result.plan, "cancel-review", {
          target: { type: "review", id: "r1" },
        }),
      ).reply,
    ).toMatchObject({ result: "applied", keys: ["reviewTargetSettled"] });
    expect(
      resolve(result.plan, leave(result.plan, {}, { expectedSlotVersion: 1 }))
        .reply.result,
    ).toBe("already-closed");
  });
  it("with a Stop winner on a settled plan Leave is already closed", () => {
    const done = completeExecution(commit(commit(running(), "s1"), "s2"));
    const settled = resolve(done, intent(done, "stop")).plan;
    expect(settled.winner?.kind).toBe("stop");
    expect(resolve(settled, leave(settled)).reply).toMatchObject({
      result: "already-closed",
      keys: ["alreadyClosedByWinner"],
      winner: { kind: "stop" },
    });
  });
  it("after a closure every kind is already closed by the Leave winner", () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    for (const request of [
      intent(closed, "stop"),
      intent(closed, "cancel-initial"),
      intent(closed, "cancel-review", { target: { type: "review", id: "r1" } }),
    ]) {
      const result = resolve(closed, request);
      expect(result.reply, request.kind).toMatchObject({
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        winner: { kind: "leave" },
        phase: "left-known",
      });
      expect(result.plan.phase).toBe("left-known");
      expect(result.plan.winner).toEqual(closed.winner);
    }
  });
  it("reopened evidence: an uninformed Leave reports it, an informed one closes again", () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    const captured = leave(closed);
    const reopened = recordContradiction(
      closed,
      closed.acceptance!.executionId,
      "s1",
    );
    expect(resolve(reopened, intent(reopened, "stop")).reply).toMatchObject({
      result: "already-closed",
      keys: ["alreadyClosedByWinner", "reopenedEvidence"],
    });
    // Captured before the reopening, in the same round: not informed.
    expect(resolve(reopened, captured).reply).toMatchObject({
      result: "already-closed",
      keys: ["alreadyClosedByWinner", "reopenedEvidence"],
    });
    expect(resolve(reopened, leave(reopened)).reply).toMatchObject({
      result: "applied",
      keys: ["leftUnconfirmed"],
      count: 1,
    });
  });
});

describe("the per-request Stop acknowledgment key", () => {
  const coalesced = (
    first: IntentRequest["cause"],
    second: IntentRequest["cause"],
  ) => {
    const live = commit(running(), "s1");
    const one = intent(live, "stop", { cause: first });
    const halted = resolve(live, one);
    const two = intent(live, "stop", { cause: second });
    return { halted, again: resolve(halted.plan, two), one, two };
  };
  it("a user's coalesced Stop says already stopped; an automatic one says the target stopped", () => {
    const { halted, again, one } = coalesced("user", "connection-lost");
    expect(halted.reply.requestKey).toBeUndefined();
    expect(again.reply.requestKey).toBe("requestTargetStopped");
    expect(again.plan).toBe(halted.plan);
    const user = resolve(halted.plan, { ...one, correlation: "another" });
    expect(user.reply.requestKey).toBe("requestAlreadyStopped");
    // The stored resolution is the same for every requester.
    const strip = ({
      requestKey: _a,
      correlation: _b,
      ...rest
    }: typeof again.reply) => rest;
    expect(strip(again.reply)).toEqual(strip(user.reply));
    expect(strip(again.reply)).toEqual(strip(halted.reply));
    const reverse = coalesced("connection-lost", "user");
    expect(reverse.again.reply.requestKey).toBe("requestAlreadyStopped");
  });
  it("the same request retried gets the same key each time", () => {
    const { halted, two } = coalesced("user", "user");
    const first = resolve(halted.plan, two);
    const second = resolve(first.plan, { ...two });
    expect(first.reply.requestKey).toBe("requestAlreadyStopped");
    expect(second.reply).toEqual(first.reply);
  });
});

// Real-writer fixtures shared by the completeness checks.
function fixtures() {
  const live = commit(running(), "s1");
  const halted = stopped();
  const done = completeExecution(commit(commit(running(), "s1"), "s2"));
  const closed = resolve(halted, leave(halted)).plan;
  const unconfirmedSource = (() => {
    let plan = admit(commit(running(["s1", "s2", "s3"]), "s1"), "s2").plan;
    plan = resolve(plan, intent(plan, "stop")).plan;
    return plan;
  })();
  const unconfirmed = resolve(unconfirmedSource, leave(unconfirmedSource)).plan;
  const reopened = recordContradiction(
    closed,
    closed.acceptance!.executionId,
    "s1",
  );
  const third = resolve(reopened, leave(reopened)).plan;
  const fenced = resolve(live, leave(live)).plan;
  const cancelOpen = resolve(live, intent(live, "cancel-initial")).plan;
  const stopSettled = resolve(done, intent(done, "stop")).plan;
  const cancelSettled = resolve(done, intent(done, "cancel-initial")).plan;
  const initial = fresh();
  const cancelledUnaccepted = resolve(
    initial,
    intent(initial, "cancel-initial"),
  ).plan;
  return {
    live,
    halted,
    done,
    closed,
    unconfirmed,
    reopened,
    third,
    fenced,
    cancelOpen,
    stopSettled,
    cancelSettled,
    cancelledUnaccepted,
  };
}

describe("completeness", () => {
  it("round classification: every captured round × acknowledgment cell has one outcome", () => {
    const { halted, closed, reopened, third } = fixtures();
    // Round 2 (closed) for the current / predecessor rows; round 3 (third,
    // with its join from round 2) for the older row.
    const cRound = closed.round;
    const met = leave(closed);
    const floorFail = leave(closed, {
      winnerVersion: halted.versions.winner - 1,
    });
    const other = leave(closed, { evidenceDigest: "B".repeat(43) });
    const cells: [string, ProtectedPlan, IntentRequest, number, string][] = [
      ["current, J met", closed, met, cRound, "already-closed"],
      ["current, J floor fails", closed, floorFail, cRound, "refused"],
      ["current, not J", closed, other, cRound, "already-closed"],
      ["predecessor, J met", closed, met, cRound - 1, "already-closed"],
      ["predecessor, J floor fails", closed, floorFail, cRound - 1, "defeated"],
      ["predecessor, not J", closed, other, cRound - 1, "superseded"],
      ["future, J met", closed, met, cRound + 1, "superseded"],
      ["future, J floor fails", closed, floorFail, cRound + 1, "superseded"],
      ["future, not J", closed, other, cRound + 1, "superseded"],
    ];
    // Older than the predecessor: round 1 against round 3.
    const thirdMet = leave(third);
    const thirdFloor = leave(third, {
      winnerVersion: reopened.versions.winner - 1,
    });
    const thirdOther = leave(third, { evidenceDigest: "B".repeat(43) });
    for (const [name, request] of [
      ["older, J met", thirdMet],
      ["older, J floor fails", thirdFloor],
      ["older, not J", thirdOther],
    ] as const)
      cells.push([name, third, request, third.round - 2, "superseded"]);
    for (const [name, plan, request, capturedRound, result] of cells) {
      const outcome = resolve(plan, { ...request, capturedRound });
      expect(outcome.reply.result, name).toBe(result);
      // Final answers before the slot step change nothing.
      if (["refused", "superseded", "defeated"].includes(result))
        expect(outcome.plan, name).toBe(plan);
    }
  });
  it("precedence: every winner × incoming × decision state cell selects one row", () => {
    const f = fixtures();
    // Leave requests that do not open a round (an earlier winner version).
    const stale = (plan: ProtectedPlan) =>
      leave(plan, { winnerVersion: 0 }, { payload: "matrix" });
    const review = (plan: ProtectedPlan) =>
      intent(plan, "cancel-review", { target: { type: "review", id: "r1" } });
    const cases: [string, ProtectedPlan, IntentRequest, string, string[]][] = [
      // No winner.
      [
        "none × Leave, open",
        f.live,
        leave(f.live),
        "needs-review",
        ["leaveSafetyNeedsReview"],
      ],
      [
        "none × Leave, settled",
        f.done,
        leave(f.done),
        "already-closed",
        ["alreadyClosed"],
      ],
      [
        "none × Stop, open",
        f.live,
        intent(f.live, "stop"),
        "applied",
        ["stopped"],
      ],
      [
        "none × Stop, settled",
        f.done,
        intent(f.done, "stop"),
        "applied",
        ["initialTargetSettled"],
      ],
      [
        "none × Cancel, open",
        f.live,
        intent(f.live, "cancel-initial"),
        "applied",
        ["cancelStarted"],
      ],
      [
        "none × Cancel, settled",
        f.done,
        intent(f.done, "cancel-initial"),
        "applied",
        ["initialTargetSettled"],
      ],
      // Stop winner.
      [
        "Stop × Leave, open",
        f.halted,
        stale(f.halted),
        "defeated",
        ["leaveDefeatedByWinner"],
      ],
      [
        "Stop × Leave, settled",
        f.stopSettled,
        stale(f.stopSettled),
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      [
        "Stop × Stop, open",
        f.halted,
        intent(f.halted, "stop", { payload: "x" }),
        "already-stopped",
        ["currentStopped", "alreadyStoppedNeedsDecision"],
      ],
      [
        "Stop × Stop, settled",
        f.stopSettled,
        intent(f.stopSettled, "stop", { payload: "x" }),
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      [
        "Stop × Cancel, open",
        f.halted,
        intent(f.halted, "cancel-initial"),
        "defeated",
        ["cancelDefeatedByStop"],
      ],
      [
        "Stop × Cancel, settled",
        f.stopSettled,
        intent(f.stopSettled, "cancel-initial"),
        "defeated",
        ["cancelDefeatedByStop"],
      ],
      // Cancel winner.
      [
        "Cancel × Leave, open",
        f.cancelOpen,
        stale(f.cancelOpen),
        "defeated",
        ["leaveDefeatedByWinner"],
      ],
      [
        "Cancel × Leave, settled",
        f.cancelSettled,
        stale(f.cancelSettled),
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      [
        "Cancel × Stop, open",
        f.cancelOpen,
        intent(f.cancelOpen, "stop"),
        "already-stopped",
        ["currentStopped", "alreadyStoppedNeedsDecision"],
      ],
      [
        "Cancel × Stop, settled",
        f.cancelSettled,
        intent(f.cancelSettled, "stop"),
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      [
        "Cancel × Cancel, open",
        f.cancelOpen,
        review(f.cancelOpen),
        "already-stopped",
        ["currentStopped", "alreadyStoppedNeedsDecision"],
      ],
      [
        "Cancel × Cancel, settled",
        f.cancelSettled,
        review(f.cancelSettled),
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      // Leave safety winner (the decision stays open in readback).
      [
        "Leave safety × Leave",
        f.fenced,
        stale(f.fenced),
        "already-stopped",
        [
          "currentStopped",
          "alreadyStoppedNeedsDecision",
          "leaveSafetyAlreadyStopped",
        ],
      ],
      [
        "Leave safety × Stop",
        f.fenced,
        intent(f.fenced, "stop"),
        "already-stopped",
        [
          "currentStopped",
          "alreadyStoppedNeedsDecision",
          "leaveSafetyAlreadyStopped",
        ],
      ],
      [
        "Leave safety × Cancel",
        f.fenced,
        intent(f.fenced, "cancel-initial"),
        "already-stopped",
        [
          "currentStopped",
          "alreadyStoppedNeedsDecision",
          "cancelCoveredByLeaveSafety",
        ],
      ],
      // Leave closed winner (closed).
      [
        "Leave closed × Leave",
        f.closed,
        leave(f.closed),
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      [
        "Leave closed × Stop",
        f.closed,
        intent(f.closed, "stop"),
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      [
        "Leave closed × Cancel",
        f.closed,
        review(f.closed),
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
    ];
    for (const [name, plan, request, result, keys] of cases) {
      const reply = resolve(plan, request).reply;
      expect({ result: reply.result, keys: reply.keys }, name).toEqual({
        result,
        keys,
      });
    }
  });
  it("Leave cells: every stored phase has its answer", () => {
    const f = fixtures();
    const proposal = createProtectedPlan({
      planId: "p",
      conversationId: "c",
      generation: "g1",
      steps: ["s1"],
    });
    const cases: [string, ProtectedPlan, string, string[]][] = [
      ["proposal", proposal, "unavailable", ["leaveNoDecision"]],
      ["initial-review", fresh(), "unavailable", ["leaveNoDecision"]],
      ["forward-active", f.live, "needs-review", ["leaveSafetyNeedsReview"]],
      ["readback", f.halted, "applied", ["leftKnown"]],
      ["completed", f.done, "already-closed", ["alreadyClosed"]],
      [
        "cancelled",
        f.cancelledUnaccepted,
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      ["left-known", f.closed, "already-closed", ["alreadyClosedByWinner"]],
      [
        "left-unconfirmed",
        f.unconfirmed,
        "already-closed",
        ["alreadyClosedByWinner"],
      ],
      ["left-reopened, informed", f.reopened, "applied", ["leftUnconfirmed"]],
    ];
    for (const [phase, plan, result, keys] of cases) {
      const reply = resolve(plan, leave(plan)).reply;
      expect({ result: reply.result, keys: reply.keys }, phase).toEqual({
        result,
        keys,
      });
    }
    // Not informed after reopening: the reopened evidence is reported.
    const captured = leave(f.closed);
    expect(resolve(f.reopened, captured).reply.keys).toEqual([
      "alreadyClosedByWinner",
      "reopenedEvidence",
    ]);
  });
});

describe("findings of the Leave review", () => {
  it("a reused correlation never replaces the applied closure a retry gets back", () => {
    const halted = stopped();
    const a = leave(halted, {}, { correlation: "collision" });
    const closed = resolve(halted, a);
    const stored = structuredClone(closed.plan.slots.leave.lastApplied);
    const later = resolve(
      closed.plan,
      leave(closed.plan, {}, { correlation: "collision" }),
    );
    expect(later.reply.result).toBe("already-closed");
    expect(later.plan.slots.leave.lastApplied).toEqual(stored);
    expect(resolve(later.plan, a).reply).toEqual(closed.reply);
  });
  it("a reused correlation never replaces an applied Stop a retry gets back", () => {
    const live = commit(running(), "s1");
    const first = intent(live, "stop", { correlation: "collision" });
    const halted = resolve(live, first);
    const stored = structuredClone(halted.plan.slots.stop.lastApplied);
    const later = resolve(
      halted.plan,
      intent(halted.plan, "stop", { correlation: "collision", payload: "x" }),
    );
    expect(later.reply.result).toBe("already-stopped");
    expect(later.plan.slots.stop.lastApplied).toEqual(stored);
    const retry = resolve(later.plan, first).reply;
    expect(retry).toEqual({
      ...halted.reply,
      requestKey: "requestAlreadyStopped",
    });
  });
  it("a below-floor predecessor is judged against a Leave safety winner as already stopped by it", () => {
    const live = commit(running(), "s1");
    const fenced = resolve(live, leave(live)).plan;
    const closed = resolve(fenced, leave(fenced)).plan;
    const held = leave(fenced, { winnerVersion: 0 });
    const result = resolve(closed, held);
    expect(result.reply).toMatchObject({
      result: "already-stopped",
      keys: [
        "currentStopped",
        "alreadyStoppedNeedsDecision",
        "leaveSafetyAlreadyStopped",
      ],
      safetyApplied: true,
      dispositionApplied: false,
      effectiveRound: fenced.round,
      winner: { kind: "leave", cause: "user" },
    });
    expect(result.plan).toBe(closed);
  });
  it("a below-floor predecessor is judged against a Leave closure as already closed with its saved disposition", () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    const reopened = recordContradiction(
      closed,
      closed.acceptance!.executionId,
      "s1",
    );
    const third = resolve(reopened, leave(reopened)).plan;
    const held = leave(reopened, { winnerVersion: 0 });
    const result = resolve(third, held);
    expect(result.reply).toMatchObject({
      result: "already-closed",
      keys: ["alreadyClosedByWinner"],
      effectiveRound: reopened.round,
      savedDisposition: { phase: "left-known", count: 2 },
    });
    expect(result.plan).toBe(third);
  });
  it("a repeated contradiction changes nothing; one on an unknown step is kept without reopening", () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    const id = closed.acceptance!.executionId;
    const reopened = recordContradiction(closed, id, "s1");
    const reclosed = resolve(reopened, leave(reopened)).plan;
    expect(reclosed.phase).toBe("left-unconfirmed");
    expect(recordContradiction(reclosed, id, "s1")).toBe(reclosed);
    // An admitted step without proof is already unknown.
    let plan = admit(commit(running(["s1", "s2", "s3"]), "s1"), "s2").plan;
    plan = resolve(plan, intent(plan, "stop")).plan;
    const unconfirmed = resolve(plan, leave(plan)).plan;
    const kept = recordContradiction(
      unconfirmed,
      unconfirmed.acceptance!.executionId,
      "s2",
    );
    expect(
      kept.executions[kept.acceptance!.executionId]!.steps.s2,
    ).toMatchObject({ contradictory: true });
    expect(kept.phase).toBe("left-unconfirmed");
    expect(kept.versions).toEqual(unconfirmed.versions);
    expect(kept.join).toEqual(unconfirmed.join);
    expect(kept.revision).toBe(unconfirmed.revision + 1);
  });
  it("a contradiction on a step already unknown is kept, and still decides its truth later", () => {
    // Admitted without proof (unknown), then a contradictory receipt, then
    // the operation's commit: the contradiction still wins.
    const admitted = admit(running(), "s1");
    const id = admitted.plan.acceptance!.executionId;
    const contradicted = recordContradiction(admitted.plan, id, "s1");
    expect(contradicted).not.toBe(admitted.plan);
    expect(contradicted.versions).toEqual(admitted.plan.versions);
    const committed = stepEvent(contradicted, {
      ...admitted.step,
      event: "commit",
      admission: admitted.admission,
    }).plan;
    expect(recoveryView(committed).unknownCount).toBe(2);
    expect(readback(committed, id, ["s1"])).toEqual([
      { stepId: "s1", truth: "unknown" },
    ]);
    // Never admitted (unknown while live), an unreadable receipt, then a
    // fence: the receipt keeps it unknown, so Leave closes as unconfirmed.
    const live = running();
    const unreadable = recordContradiction(
      live,
      live.acceptance!.executionId,
      "s2",
    );
    const halted = resolve(unreadable, intent(unreadable, "stop")).plan;
    expect(readback(halted, halted.acceptance!.executionId, ["s2"])).toEqual([
      { stepId: "s2", truth: "unknown" },
    ]);
    expect(resolve(halted, leave(halted)).reply).toMatchObject({
      keys: ["leftUnconfirmed"],
    });
  });
  it("already-closed answers carry the Leave winner's saved disposition and count", () => {
    const f = fixtures();
    const kinds = (plan: ProtectedPlan) => [
      intent(plan, "stop"),
      intent(plan, "cancel-initial"),
      intent(plan, "cancel-review", { target: { type: "review", id: "r1" } }),
      leave(plan, {}, { payload: "again" }),
    ];
    for (const [name, plan, saved] of [
      ["left-known", f.closed, { phase: "left-known", count: 2 }],
      [
        "left-unconfirmed",
        f.unconfirmed,
        { phase: "left-unconfirmed", count: 1 },
      ],
      ["left-reopened", f.reopened, { phase: "left-known", count: 2 }],
    ] as const)
      for (const request of kinds(plan)) {
        const reply = resolve(plan, request).reply;
        // In left-reopened an informed Leave recloses (tested elsewhere);
        // the uninformed one is checked below.
        if (name === "left-reopened" && request.kind === "leave") continue;
        expect(reply.savedDisposition, `${name} × ${request.kind}`).toEqual(
          saved,
        );
      }
    // A Leave captured before the reopening reports the saved closure and
    // the reopened evidence together.
    const uninformed = resolve(f.reopened, leave(f.closed)).reply;
    expect(uninformed).toMatchObject({
      result: "already-closed",
      keys: ["alreadyClosedByWinner", "reopenedEvidence"],
      savedDisposition: { phase: "left-known", count: 2 },
      phase: "left-reopened",
    });
  });
  it("the evidence digest hashes the ordered step truths; a result change alone still moves the version", () => {
    const accepted = running();
    const halted = resolve(accepted, intent(accepted, "stop")).plan;
    expect(halted.evidenceDigest).toBe(
      "iSrgvJw2H8ChE-5MkCAoM71GYdft8m1y6vcy2XjucZQ",
    );
    const both = commit(commit(running(), "s1"), "s2");
    expect(both.evidenceDigest).toBe(
      createHash("sha256")
        .update('[["s1","done"],["s2","done"]]')
        .digest("base64url"),
    );
    const done = completeExecution(both);
    expect(done.evidenceDigest).toBe(both.evidenceDigest);
    expect(done.versions.evidence).toBe(both.versions.evidence + 1);
  });
  it("a round opens only with a version newer than its baseline", () => {
    const baseline = { evidence: 2, winner: 1, decisionResolution: 0 };
    expect(newerThanBaseline(baseline, baseline)).toBe(false);
    for (const newer of [
      { ...baseline, evidence: 3 },
      { ...baseline, winner: 2 },
      { ...baseline, decisionResolution: 1 },
    ])
      expect(newerThanBaseline(newer, baseline)).toBe(true);
  });
  it("a stale Leave slot version is a conflict and changes nothing", () => {
    const halted = stopped();
    const result = resolve(
      halted,
      leave(halted, { winnerVersion: 0 }, { expectedSlotVersion: 5 }),
    );
    expect(result.reply).toMatchObject({
      result: "conflict",
      keys: ["intentConflict"],
    });
    expect(result.plan).toBe(halted);
  });
});
