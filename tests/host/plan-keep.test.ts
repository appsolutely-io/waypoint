import { it, expect, describe } from "vitest";
import {
  classificationJoin,
  completeExecution,
  keepBlocker,
  keepCompletesLeave,
  keepCoversLeave,
  confirm,
  createProtectedPlan,
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

const offered = { leave: true, keep: true, principal: "owner", now: 1000 };
const review = (id = "r1", digest = "d1") => ({
  id,
  revision: 1,
  digest,
  state: "current" as const,
});
const fresh = (steps = ["s1", "s2"]) =>
  createProtectedPlan({
    planId: "p",
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
      ? { type: "execution", id: plan.acceptance.executionId }
      : { type: "generation", id: plan.generation },
    capturedRound: view.round,
    expectedSlotVersion: view.slots[kind],
    correlation: `c-${++correlations}`,
    cause: "user",
    ...overrides,
  };
}
const ackOf = (plan: ProtectedPlan) => {
  const view = recoveryView(plan);
  return {
    sourceDecisionKey: view.decisionKey ?? "none",
    evidenceVersion: view.versions.evidence,
    winnerVersion: view.versions.winner,
    decisionResolutionVersion: view.versions.decisionResolution,
    evidenceDigest: view.evidenceDigest ?? "A".repeat(43),
    unknownCount: view.unknownCount ?? 0,
  };
};
function leave(
  plan: ProtectedPlan,
  ack: Partial<NonNullable<IntentRequest["acknowledgment"]>> = {},
  overrides: Partial<IntentRequest> = {},
) {
  return intent(plan, "leave", {
    acknowledgment: { ...ackOf(plan), ...ack },
    ...overrides,
  });
}
function keep(
  plan: ProtectedPlan,
  ack: Partial<NonNullable<IntentRequest["acknowledgment"]>> = {},
  overrides: Partial<IntentRequest> = {},
) {
  const view = recoveryView(plan);
  return intent(plan, "keep", {
    acknowledgment: { ...ackOf(plan), ...ack },
    review: (view.remaining ?? 0) > 0 ? "forward-only" : "end-retention",
    ...overrides,
  });
}
const resolve = (plan: ProtectedPlan, request: IntentRequest) =>
  resolveIntent(plan, request, offered);
// Readback after a connection-lost Stop of a two-step run whose first step
// committed: step two never ran (remaining forward work).
function stopped() {
  const plan = commit(running(), "s1");
  return resolve(plan, intent(plan, "stop", { cause: "connection-lost" })).plan;
}
// Readback with every step committed before the Stop: no remaining work.
function stoppedDone() {
  const plan = commit(commit(running(), "s1"), "s2");
  return resolve(plan, intent(plan, "stop", { cause: "connection-lost" })).plan;
}
const completed = () =>
  completeExecution(commit(commit(running(), "s1"), "s2"), 500);

describe("Keep request validation", () => {
  const base = {
    kind: "keep",
    planId: "p",
    target: { type: "execution", id: "e" },
    capturedRound: 1,
    expectedSlotVersion: 0,
    correlation: "c",
    cause: "user",
    review: "forward-only",
    acknowledgment: {
      sourceDecisionKey: "e",
      evidenceVersion: 1,
      winnerVersion: 1,
      decisionResolutionVersion: 0,
      evidenceDigest: "A".repeat(43),
      unknownCount: 0,
    },
  };
  it("a Keep needs its acknowledgment and one of the two review variants", () => {
    expect(parseIntentRequest(base)).toEqual(base);
    expect(
      parseIntentRequest({ ...base, review: "end-retention" }),
    ).toBeDefined();
    for (const review of [
      "keep-changes",
      "keep-changes-forward-closed",
      "other",
      undefined,
    ])
      expect(parseIntentRequest({ ...base, review }), String(review)).toBe(
        undefined,
      );
    const without: Record<string, unknown> = { ...base };
    delete without.acknowledgment;
    expect(parseIntentRequest(without)).toBeUndefined();
  });
  it("no other kind carries a review", () => {
    for (const kind of ["leave", "stop"]) {
      const body: Record<string, unknown> = { ...base, kind };
      if (kind === "stop") delete body.acknowledgment;
      expect(parseIntentRequest(body), kind).toBeUndefined();
    }
  });
});

describe("Keep boundary", () => {
  it("is unavailable when the host does not offer Keep", () => {
    const plan = stopped();
    const result = resolveIntent(plan, keep(plan), { leave: true });
    expect(result.reply).toMatchObject({
      result: "unavailable",
      keys: ["capabilityMissing"],
    });
    expect(result.plan).toBe(plan);
  });
  it("membership, no decision and target eligibility", () => {
    const plan = stopped();
    const foreign = resolve(
      plan,
      keep(plan, {}, { target: { type: "execution", id: "elsewhere" } }),
    );
    expect(foreign.reply.result).toBe("invalid-target");
    expect(foreign.plan).toBe(plan);
    const otherSource = resolve(
      plan,
      keep(plan, { sourceDecisionKey: stopped().acceptance!.executionId }),
    );
    expect(otherSource.reply.result).toBe("invalid-target");
    for (const initial of [
      createProtectedPlan({
        planId: "p",
        conversationId: "c",
        generation: "g1",
        steps: ["s1"],
      }),
      fresh(),
    ])
      expect(resolve(initial, keep(initial)).reply).toMatchObject({
        result: "unavailable",
        keys: ["keepNoDecision"],
      });
    const initial = fresh();
    const cancelled = resolve(initial, intent(initial, "cancel-initial")).plan;
    expect(resolve(cancelled, keep(cancelled)).reply).toMatchObject({
      result: "already-closed",
      winner: { kind: "cancel-initial" },
    });
    let replaced = replaceReview(fresh(), review("r2", "d2"));
    replaced = confirmed(replaced, "d2");
    replaced = resolve(replaced, intent(replaced, "stop")).plan;
    expect(
      resolve(
        replaced,
        keep(replaced, {}, { target: { type: "review", id: "r1" } }),
      ).reply.result,
    ).toBe("superseded");
    expect(
      resolve(
        replaced,
        keep(replaced, {}, { target: { type: "review", id: "r2" } }),
      ).reply.result,
    ).toBe("already-kept");
  });
  it("an acknowledged version above the host's is refused, also once sealed", () => {
    const plan = stopped();
    const sealed = resolve(plan, keep(plan)).plan;
    expect(sealed.sealed).toBe(true);
    for (const target of [plan, sealed])
      for (const ack of [
        { evidenceVersion: target.versions.evidence + 1 },
        { winnerVersion: target.versions.winner + 1 },
        { decisionResolutionVersion: 1 },
      ]) {
        const result = resolve(target, keep(target, ack));
        expect(result.reply).toMatchObject({
          result: "refused",
          keys: ["acknowledgmentAhead"],
        });
        expect(result.plan).toBe(target);
      }
  });
});

describe("Keep guards: safety, then higher winner, then freshness", () => {
  it("a live run refuses Keep without fencing it", () => {
    const live = commit(running(), "s1");
    const result = resolve(live, keep(live));
    expect(result.reply).toMatchObject({
      result: "needs-review",
      keys: ["keepBlockedActive"],
    });
    expect(runOf(result.plan).fenced).toBe(false);
    expect(result.plan.winner).toBeUndefined();
  });
  it("unknown evidence refuses Keep, including a completed plan that learned a contradiction", () => {
    let plan = admit(commit(running(["s1", "s2", "s3"]), "s1"), "s2").plan;
    plan = resolve(plan, intent(plan, "stop")).plan;
    expect(resolve(plan, keep(plan)).reply.keys).toEqual([
      "keepBlockedUnknown",
    ]);
    const done = completed();
    const contradicted = recordContradiction(done, runOf(done).id, "s1");
    expect(contradicted.phase).toBe("completed");
    expect(recoveryView(contradicted).unknownCount).toBe(1);
    const result = resolve(contradicted, keep(contradicted));
    expect(result.reply).toMatchObject({
      result: "needs-review",
      keys: ["keepBlockedUnknown"],
    });
    expect(result.plan.retention?.ended).toBeUndefined();
    expect(result.plan.receipt).toBeUndefined();
    expect(result.plan.winner).toBeUndefined();
    expect(result.plan.sealed).toBeFalsy();
  });
  it("the guards apply in order: live work before unknown before freshness", () => {
    const live = admit(running(), "s1").plan;
    expect(
      resolve(live, keep(live, { evidenceVersion: 0 })).reply.keys,
    ).toEqual(["keepBlockedActive"]);
  });
  for (const kind of ["stop", "cancel-initial", "cancel-review"] as const)
    it(`a Keep held from before a settled ${kind} is defeated by it; a fresh Keep then ends retention`, () => {
      const done = completed();
      const held = keep(done);
      const settled = resolve(
        done,
        intent(done, kind, {
          target:
            kind === "cancel-review"
              ? { type: "review", id: "r1" }
              : { type: "execution", id: runOf(done).id },
        }),
      ).plan;
      expect(settled.winner?.kind).toBe(kind);
      const result = resolve(settled, held);
      expect(result.reply).toMatchObject({
        result: "defeated",
        keys: ["keepDefeatedByWinner"],
        winner: { kind, cause: "user" },
      });
      expect(result.plan.retention?.ended).toBeUndefined();
      expect(result.plan.sealed).toBeFalsy();
      const current = resolve(result.plan, keep(result.plan));
      expect(current.reply).toMatchObject({
        result: "already-kept",
        keys: ["alreadyKept", "planClosedKept"],
        winner: { kind },
      });
      expect(current.plan.winner?.kind).toBe(kind);
      expect(current.plan.receipt).toMatchObject({
        keepEffect: "retention-ended",
        finalWinner: { kind },
      });
      expect(current.plan.sealed).toBe(true);
    });
  it("an uninformed Keep against an open Stop winner is defeated", () => {
    const halted = stopped();
    expect(
      resolve(halted, keep(halted, { winnerVersion: 0 })).reply,
    ).toMatchObject({
      result: "defeated",
      keys: ["keepDefeatedByWinner"],
      winner: { kind: "stop", cause: "connection-lost" },
    });
  });
  it("against a Leave safety fence a stale Keep has changed reasons; a new informed Keep closes", () => {
    const live = commit(running(), "s1");
    const captured = keep(live);
    const fenced = resolve(live, leave(live)).plan;
    expect(
      resolve(fenced, { ...captured, review: "forward-only" }).reply,
    ).toMatchObject({
      result: "needs-review",
      keys: ["keepReasonChanged"],
    });
    expect(resolve(fenced, keep(fenced)).reply).toMatchObject({
      result: "already-kept",
      keys: ["alreadyKept", "planClosedKept", "keptForwardClosed"],
    });
  });
  it("a review variant that no longer matches is refused as changed", () => {
    const halted = stopped();
    expect(
      resolve(halted, keep(halted, {}, { review: "end-retention" })).reply,
    ).toMatchObject({ result: "needs-review", keys: ["keepReasonChanged"] });
    const done = completed();
    expect(
      resolve(done, keep(done, {}, { review: "forward-only" })).reply.keys,
    ).toEqual(["keepReasonChanged"]);
  });
});

describe("Keep closures", () => {
  it("from readback with remaining work: closes it, opens a round and seals", () => {
    const halted = stopped();
    const result = resolve(halted, keep(halted));
    expect(result.reply).toMatchObject({
      result: "already-kept",
      keys: ["alreadyKept", "planClosedKept", "keptForwardClosed"],
      dispositionApplied: true,
      effectiveRound: halted.round + 1,
      winner: { kind: "keep", cause: "user" },
      phase: "left-known",
    });
    expect(result.plan.receipt).toMatchObject({
      keepEffect: "forward-closed",
      cause: "kept",
      result: "already-kept",
      actorOrigin: { cause: "user", principal: "owner" },
      finalWinner: { kind: "keep", cause: "user" },
      roundJoin: { fromRound: halted.round, toRound: halted.round + 1 },
    });
    expect(result.plan.retention?.ended).toBe("kept");
    expect(result.plan.sealed).toBe(true);
  });
  it("from readback with no remaining work: closes the decision", () => {
    const halted = stoppedDone();
    expect(recoveryView(halted).remaining).toBe(0);
    const result = resolve(halted, keep(halted));
    expect(result.reply.keys).toEqual(["alreadyKept", "planClosedKept"]);
    expect(result.plan.receipt?.keepEffect).toBe("decision-closed");
    expect(result.plan.sealed).toBe(true);
  });
  it("on a completed plan: ends own retention without a round", () => {
    const done = completed();
    expect(done.retention?.completedAt).toBe(500);
    const result = resolve(done, keep(done));
    expect(result.reply).toMatchObject({
      result: "already-kept",
      keys: ["alreadyKept", "planClosedKept"],
      effectiveRound: done.round,
      phase: "completed",
    });
    expect(result.plan.receipt?.keepEffect).toBe("retention-ended");
    expect(result.plan.round).toBe(done.round);
    expect(result.plan.sealed).toBe(true);
  });
  it("a compatible Keep joining a Leave closure completes it", () => {
    const halted = stopped();
    const a = leave(halted);
    const b = keep(halted);
    const closed = resolve(halted, a).plan;
    const result = resolve(closed, b);
    expect(result.reply).toMatchObject({
      result: "already-kept",
      keys: [
        "alreadyKept",
        "planClosedKept",
        "leaveCompletedByKeep",
        "keptForwardClosed",
      ],
      winner: { kind: "keep" },
    });
    expect(result.plan.receipt).toMatchObject({
      keepEffect: "leave-completed",
      priorLeaveApplied: { round: closed.round },
    });
    expect(result.plan.sealed).toBe(true);
  });
  it("a Keep that is not compatible with the Leave closure is refused", () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    expect(
      resolve(closed, keep(closed, { evidenceDigest: "B".repeat(43) })).reply,
    ).toMatchObject({ result: "needs-review", keys: ["keepReasonChanged"] });
  });
  it("double press is one semantic intent", () => {
    const halted = stopped();
    const once = keep(halted);
    const first = resolve(halted, once);
    const again = resolve(first.plan, { ...once, correlation: "again" });
    expect(again.plan).toBe(first.plan);
    expect(again.reply).toEqual({
      ...first.reply,
      correlation: "again",
      finalHistory: expect.any(Object),
    });
  });
  it("dedup before CAS, and a different Keep with a stale version is a conflict", () => {
    const done = completed();
    const request = keep(done, {}, { payload: "a" });
    const refused = resolve(done, { ...request, review: "forward-only" });
    expect(refused.reply.keys).toEqual(["keepReasonChanged"]);
    const replay = resolve(refused.plan, {
      ...request,
      review: "forward-only",
      expectedSlotVersion: 0,
    });
    expect(replay.plan).toBe(refused.plan);
    const conflict = resolve(refused.plan, keep(done, {}, { payload: "b" }));
    expect(conflict.reply).toMatchObject({
      result: "conflict",
      keys: ["intentConflict"],
    });
    expect(conflict.plan).toBe(refused.plan);
  });
});

describe("the final classifier on a sealed plan", () => {
  const sealedFrom = (plan: ProtectedPlan, request = keep(plan)) => {
    const result = resolve(plan, request);
    expect(result.plan.sealed).toBe(true);
    return { plan: result.plan, reply: result.reply, request };
  };
  it("the exact own Keep retry returns its stored bytes, also after a JSON restore", () => {
    const { plan, reply, request } = sealedFrom(stopped());
    const retry = resolve(plan, {
      ...request,
      correlation: "retry",
      cause: "connection-lost",
    });
    const { finalHistory, ...stored } = retry.reply;
    expect(stored).toEqual({ ...reply, correlation: "retry" });
    expect(finalHistory).toMatchObject({
      winner: { kind: "keep" },
      keptFact: { keepEffect: "forward-closed", actorCause: "user" },
    });
    expect(retry.plan).toBe(plan);
    const restored = JSON.parse(JSON.stringify(plan)) as ProtectedPlan;
    expect(
      resolve(restored, {
        ...request,
        correlation: "retry",
        cause: "connection-lost",
      }).reply,
    ).toEqual(retry.reply);
  });
  it("another Keep is already kept elsewhere", () => {
    const { plan } = sealedFrom(stopped());
    const result = resolve(plan, keep(plan, {}, { payload: "other" }));
    expect(result.reply).toMatchObject({
      result: "already-kept",
      keys: ["keptElsewhere"],
      finalHistory: { relation: "keptElsewhere", winner: { kind: "keep" } },
    });
    expect(result.plan).toBe(plan);
  });
  it("Leave first, Keep completes it: the Leave's retry gets its own original bytes and the completion", () => {
    const halted = stopped();
    const a = leave(halted);
    const closed = resolve(halted, a);
    const before = structuredClone(closed.reply);
    const sealed = resolve(closed.plan, keep(halted)).plan;
    for (const plan of [
      sealed,
      JSON.parse(JSON.stringify(sealed)) as ProtectedPlan,
    ]) {
      const retry = resolve(plan, { ...a, correlation: "late" });
      const { finalHistory, ...stored } = retry.reply;
      expect(stored).toEqual({ ...before, correlation: "late" });
      expect(finalHistory).toMatchObject({
        relation: "leaveCompletedByKeep",
        requestedTargetApplied: true,
        winner: { kind: "keep" },
      });
    }
  });
  it("Keep first: a delayed identical Leave is covered, not applied", () => {
    for (const source of [stopped(), stoppedDone()]) {
      const a = leave(source);
      const { plan } = sealedFrom(source);
      const result = resolve(plan, a);
      expect(result.reply).toMatchObject({
        result: "already-closed",
        keys: ["leaveCoveredByKeep"],
        finalHistory: {
          relation: "leaveCoveredByKeep",
          requestedTargetApplied: false,
          winner: { kind: "keep" },
        },
      });
      expect(result.plan).toBe(plan);
    }
  });
  it("after a retention-only Keep a Leave is answered with the sealed facts", () => {
    const done = completed();
    const { plan } = sealedFrom(done);
    expect(resolve(plan, leave(plan)).reply).toMatchObject({
      result: "sealed",
      keys: ["planSealed"],
    });
  });
  it("a predecessor Leave below the floor keeps its historical refusal before and after sealing", () => {
    const halted = stopped();
    const held = leave(halted, { winnerVersion: 0 });
    const closedByLeave = resolve(halted, leave(halted)).plan;
    const unsealed = resolve(closedByLeave, held).reply;
    const sealed = resolve(closedByLeave, keep(halted)).plan;
    expect(sealed.sealed).toBe(true);
    const after = resolve(sealed, held);
    expect(after.reply).toMatchObject({
      result: "defeated",
      keys: ["leaveDefeatedByWinner"],
      effectiveRound: halted.round,
      winner: { kind: "stop", cause: "connection-lost" },
    });
    expect(after.reply.result).toBe(unsealed.result);
    expect(after.plan).toBe(sealed);
  });
  it("older and future rounds are superseded on a sealed plan", () => {
    const { plan } = sealedFrom(stopped());
    for (const capturedRound of [0, plan.round + 1])
      expect(
        resolve(plan, leave(plan, {}, { capturedRound })).reply.result,
      ).toBe("superseded");
  });
  it("Stop and Cancel are answered with the sealed facts and the preserved winner", () => {
    const { plan } = sealedFrom(stopped());
    for (const request of [
      intent(plan, "stop"),
      intent(plan, "cancel-initial"),
      intent(plan, "cancel-review", { target: { type: "review", id: "r1" } }),
    ]) {
      const result = resolve(plan, request);
      expect(result.reply, request.kind).toMatchObject({
        result: "sealed",
        keys: ["planSealed"],
        finalHistory: { winner: { kind: "keep" } },
      });
      expect(result.plan).toBe(plan);
    }
    // A retention Keep after a settled Stop keeps the Stop as final winner.
    const done = completed();
    const settled = resolve(done, intent(done, "stop")).plan;
    const kept = resolve(
      settled,
      keep(settled, {}, { expectedSlotVersion: 0 }),
    ).plan;
    expect(kept.sealed).toBe(true);
    expect(resolve(kept, intent(kept, "cancel-initial")).reply).toMatchObject({
      result: "sealed",
      finalHistory: {
        winner: { kind: "stop" },
        keptFact: { keepEffect: "retention-ended" },
      },
    });
  });
});

describe("host writers on a sealed record", () => {
  const seals = () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    const own = (plan: ProtectedPlan) => resolve(plan, keep(plan)).plan;
    return [
      ["forward-closed", own(stopped())],
      ["decision-closed", own(stoppedDone())],
      ["retention-ended", own(completed())],
      ["leave-completed", resolve(closed, keep(halted)).plan],
    ] as const;
  };
  it("a late contradiction is kept beside the sealed history without reopening it", () => {
    for (const [name, plan] of seals()) {
      expect(plan.sealed, name).toBe(true);
      const id = runOf(plan).id;
      const late = recordContradiction(plan, id, "s1");
      expect(late.phase, name).toBe(plan.phase);
      expect(late.versions, name).toEqual(plan.versions);
      expect(late.receipt, name).toEqual(plan.receipt);
      expect(late.join, name).toEqual(plan.join);
      expect(late.sealed, name).toBe(true);
      expect(late.revision, name).toBe(plan.revision + 1);
      expect(readback(late, id, ["s1"]), name).toEqual(
        readback(plan, id, ["s1"]),
      );
      expect(recoveryView(late).contradictedAfterSeal, name).toEqual(["s1"]);
      expect(recordContradiction(late, id, "s1"), name).toBe(late);
    }
  });
  it("the exact Keep replay still returns its bytes after a late contradiction", () => {
    const halted = stopped();
    const request = keep(halted);
    const first = resolve(halted, request);
    const late = recordContradiction(first.plan, runOf(first.plan).id, "s1");
    const retry = resolve(late, { ...request, correlation: "x" });
    const { finalHistory, ...stored } = retry.reply;
    expect(stored).toEqual({ ...first.reply, correlation: "x" });
    expect(finalHistory?.contradictedAfterSeal).toEqual(["s1"]);
  });
  it("a committed operation's retry gets its original receipt and bytes; anything else is refused", () => {
    // Every step committed with distinctive response bytes, then each seal.
    const committedWith = (plan: ProtectedPlan, stepId: string) => {
      const admitted = admit(plan, stepId);
      return {
        plan: stepEvent(admitted.plan, {
          ...admitted.step,
          event: "commit",
          admission: admitted.admission,
          receipt: `${stepId}-receipt`,
          response: `{"title":"${stepId} done","n":1}`,
        }).plan,
        admitted,
      };
    };
    const one = committedWith(running(), "s1");
    const both = committedWith(one.plan, "s2");
    const halted = resolve(
      both.plan,
      intent(both.plan, "stop", { cause: "connection-lost" }),
    ).plan;
    const done = completeExecution(both.plan, 1);
    const leaveClosed = resolve(halted, leave(halted)).plan;
    // Only s1 committed, then the Stop: s2 is remaining forward work.
    const partial = resolve(
      one.plan,
      intent(one.plan, "stop", { cause: "connection-lost" }),
    ).plan;
    for (const [name, plan] of [
      ["forward-closed", resolve(partial, keep(partial)).plan],
      ["decision-closed", resolve(halted, keep(halted)).plan],
      ["retention-ended", resolve(done, keep(done)).plan],
      ["leave-completed", resolve(leaveClosed, keep(halted)).plan],
    ] as const) {
      expect(plan.sealed, name).toBe(true);
      if (name === "forward-closed")
        expect(plan.receipt?.keepEffect, name).toBe("forward-closed");
      const step = one.admitted.step;
      const expected = {
        result: "existing",
        rule: "existing",
        receipt: "s1-receipt",
        response: '{"title":"s1 done","n":1}',
      };
      const admission = stepEvent(plan, { ...step, event: "admission" });
      expect(admission.reply, name).toEqual(expected);
      expect(admission.plan, name).toBe(plan);
      const commitRetry = stepEvent(plan, {
        ...step,
        event: "commit",
        admission: one.admitted.admission,
      });
      expect(commitRetry.reply, name).toEqual(expected);
      expect(commitRetry.plan, name).toBe(plan);
      const sealedRefusal = {
        result: "refused",
        rule: "sealed",
        key: "sealed",
      };
      for (const [what, request] of [
        [
          "changed operation",
          { ...step, operationId: "other", event: "admission" },
        ],
        [
          "forged admission",
          { ...step, event: "commit", admission: {} as Admission },
        ],
        [
          "renewal",
          {
            executionId: step.executionId,
            fence: step.fence,
            event: "renewal",
          },
        ],
      ] as const) {
        const reply = stepEvent(
          plan,
          request as Parameters<typeof stepEvent>[1],
        );
        expect(reply.reply, `${name} ${what}`).toEqual(sealedRefusal);
        expect(reply.plan, `${name} ${what}`).toBe(plan);
      }
      expect(completeExecution(plan, 9), name).toBe(plan);
      expect(replaceReview(plan, review("r9", "d9")), name).toBe(plan);
      const replay = confirm(plan, {
        clientReplyId: "confirm-1",
        digest: "d1",
        protocol: "1.0",
      });
      expect(replay.reply, name).toMatchObject({ result: "replayed" });
      const other = confirm(plan, {
        clientReplyId: "confirm-2",
        digest: "d1",
        protocol: "1.0",
      });
      expect(other.reply, name).toMatchObject({
        result: "refused",
        key: "activationHistory",
      });
    }
  });
  it("an unsealed Leave closure still reopens on a contradiction", () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    expect(recordContradiction(closed, runOf(closed).id, "s1").phase).toBe(
      "left-reopened",
    );
  });
});

describe("completeness", () => {
  it("every reachable Keep closure seals in its own transition", () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    const done = completed();
    const settled = resolve(done, intent(done, "stop")).plan;
    const fenced = (() => {
      const live = commit(running(), "s1");
      return resolve(live, leave(live)).plan;
    })();
    for (const [name, plan, request] of [
      ["readback forward-only", stopped(), undefined],
      ["readback end-retention", stoppedDone(), undefined],
      ["completed", completed(), undefined],
      [
        "completed after settled Stop",
        settled,
        keep(settled, {}, { expectedSlotVersion: 0 }),
      ],
      ["Leave completion", closed, keep(halted)],
      ["after a Leave fence", fenced, undefined],
    ] as const) {
      const result = resolve(plan, request ?? keep(plan));
      expect(result.reply.result, name).toBe("already-kept");
      expect(result.plan.sealed, name).toBe(true);
    }
  });
  it("Keep cells: every phase × guard cell has one answer", () => {
    const proposal = createProtectedPlan({
      planId: "p",
      conversationId: "c",
      generation: "g1",
      steps: ["s1"],
    });
    const live = commit(running(), "s1");
    const unknownReadback = (() => {
      const plan = admit(commit(running(["s1", "s2"]), "s1"), "s2").plan;
      return resolve(plan, intent(plan, "stop")).plan;
    })();
    const unconfirmed = resolve(unknownReadback, leave(unknownReadback)).plan;
    const halted = stopped();
    const reopened = recordContradiction(
      resolve(halted, leave(halted)).plan,
      runOf(halted).id,
      "s1",
    );
    const cases: [string, ProtectedPlan, string, string[]][] = [
      ["proposal", proposal, "unavailable", ["keepNoDecision"]],
      ["initial-review", fresh(), "unavailable", ["keepNoDecision"]],
      ["forward-active", live, "needs-review", ["keepBlockedActive"]],
      [
        "readback, unknown",
        unknownReadback,
        "needs-review",
        ["keepBlockedUnknown"],
      ],
      [
        "readback",
        stopped(),
        "already-kept",
        ["alreadyKept", "planClosedKept", "keptForwardClosed"],
      ],
      [
        "completed",
        completed(),
        "already-kept",
        ["alreadyKept", "planClosedKept"],
      ],
      ["left-unconfirmed", unconfirmed, "needs-review", ["keepBlockedUnknown"]],
      ["left-reopened", reopened, "needs-review", ["keepBlockedUnknown"]],
    ];
    for (const [name, plan, result, keys] of cases) {
      const outcome = resolve(plan, keep(plan));
      expect(
        { result: outcome.reply.result, keys: outcome.reply.keys },
        name,
      ).toEqual({ result, keys });
      // A refusal opens no round and moves no version.
      if (result !== "already-kept") {
        expect(outcome.plan.round, name).toBe(plan.round);
        expect(outcome.plan.versions, name).toEqual(plan.versions);
        expect(outcome.plan.sealed, name).toBeFalsy();
      }
    }
  });
});

// Guarded twice: each rule below is also enforced by an earlier guard that
// today's writers always trigger first, so it is tested at its own boundary
// on a constructed state.
describe("second guards, tested at their own boundary", () => {
  it("a pending admission blocks Keep even where no step looks unresolved", () => {
    // Constructed in place (the admission index follows the record object):
    // a fenced run whose admitted step already has its receipt, with the
    // admission still pending.
    const admitted = admit(running(), "s1").plan;
    const run = runOf(admitted);
    run.fenced = true;
    run.result = "stopped";
    run.steps.s1!.applied = "s1-r";
    expect(recoveryView(admitted).unknownCount).toBe(0);
    expect(keepBlocker(admitted)).toBe("keepBlockedUnknown");
  });
  it("a sealed record classifies against its receipt's join, not a live one", () => {
    const halted = stopped();
    const sealed = resolve(halted, keep(halted)).plan;
    const constructed: ProtectedPlan = {
      ...structuredClone(sealed),
      join: { ...sealed.join!, semanticEvidenceDigest: "B".repeat(43) },
    };
    expect(classificationJoin(constructed)).toEqual(sealed.receipt!.roundJoin);
    expect(classificationJoin({ ...constructed, sealed: false })).toEqual(
      constructed.join,
    );
  });
  it("a retention-only Keep never covers a Leave, even one that joined", () => {
    const done = completed();
    const sealed = resolve(done, keep(done)).plan;
    expect(keepCoversLeave(sealed.receipt!, true)).toBe(false);
    expect(
      keepCoversLeave(
        { ...sealed.receipt!, keepEffect: "forward-closed" },
        true,
      ),
    ).toBe(true);
    expect(
      keepCoversLeave(
        { ...sealed.receipt!, keepEffect: "forward-closed" },
        false,
      ),
    ).toBe(false);
  });
  it("a Keep completes a Leave closure only when it joined that round", () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    expect(keepCompletesLeave(closed, true)).toBe(true);
    expect(keepCompletesLeave(closed, false)).toBe(false);
  });
});

describe("a sealed decision answers a current-round Leave it does not cover with its final facts", () => {
  it("a Leave with other evidence in the sealed round is not covered", () => {
    const halted = stopped();
    const sealed = resolve(halted, keep(halted)).plan;
    const result = resolve(
      sealed,
      leave(sealed, { evidenceDigest: "B".repeat(43) }),
    );
    expect(result.reply).toMatchObject({
      result: "sealed",
      keys: ["planSealed"],
      finalHistory: { winner: { kind: "keep" } },
    });
    expect(result.plan).toBe(sealed);
  });
});

describe("historical answers on a sealed plan carry its final facts", () => {
  const completedByKeep = () => {
    const halted = stopped();
    const closed = resolve(halted, leave(halted)).plan;
    return { halted, sealed: resolve(closed, keep(halted)).plan };
  };
  it("a predecessor Leave and Keep below the floor keep the historical Stop and add the final Keep facts", () => {
    const { halted, sealed } = completedByKeep();
    const late = recordContradiction(sealed, runOf(sealed).id, "s1");
    for (const [name, plan] of [
      ["sealed", sealed],
      ["after a late receipt", late],
      ["restored", JSON.parse(JSON.stringify(late)) as ProtectedPlan],
    ] as const)
      for (const request of [
        leave(halted, { winnerVersion: 0 }),
        keep(halted, { winnerVersion: 0 }),
      ]) {
        const result = resolve(plan, request);
        expect(result.reply, `${name} ${request.kind}`).toMatchObject({
          result: "defeated",
          keys: [
            request.kind === "keep"
              ? "keepDefeatedByWinner"
              : "leaveDefeatedByWinner",
          ],
          effectiveRound: halted.round,
          winner: { kind: "stop", cause: "connection-lost" },
          finalHistory: {
            winner: { kind: "keep" },
            keptFact: { keepEffect: "leave-completed" },
            ...(plan === sealed ? {} : { contradictedAfterSeal: ["s1"] }),
          },
        });
        expect(result.plan, name).toBe(plan);
      }
  });
  it("bounds, stale views and old rounds on a sealed plan carry the final facts too", () => {
    const { halted, sealed } = completedByKeep();
    for (const [name, request, result] of [
      ["ahead", keep(sealed, { winnerVersion: 99 }), "refused"],
      ["stale current view", keep(sealed, { winnerVersion: 0 }), "refused"],
      ["older round", keep(sealed, {}, { capturedRound: 0 }), "superseded"],
      [
        "future round",
        keep(sealed, {}, { capturedRound: sealed.round + 1 }),
        "superseded",
      ],
      ["old Stop", intent(halted, "stop"), "superseded"],
    ] as const) {
      const outcome = resolve(sealed, request);
      expect(outcome.reply.result, name).toBe(result);
      expect(outcome.reply.finalHistory?.winner, name).toEqual({
        kind: "keep",
        cause: "user",
      });
      expect(outcome.plan, name).toBe(sealed);
    }
  });
});

describe("remaining Keep cells", () => {
  it("both Cancel kinds never carry a review", () => {
    for (const kind of ["cancel-initial", "cancel-review"])
      expect(
        parseIntentRequest({
          kind,
          planId: "p",
          target: { type: "execution", id: "e" },
          capturedRound: 1,
          expectedSlotVersion: 0,
          correlation: "c",
          cause: "user",
          review: "forward-only",
        }),
        kind,
      ).toBeUndefined();
  });
  it("Keep from older and future rounds on a sealed plan is superseded", () => {
    const halted = stopped();
    const sealed = resolve(halted, keep(halted)).plan;
    for (const capturedRound of [0, sealed.round + 1]) {
      const result = resolve(sealed, keep(sealed, {}, { capturedRound }));
      expect(result.reply.result, String(capturedRound)).toBe("superseded");
      expect(result.plan).toBe(sealed);
    }
  });
  it("an uninformed Keep against an open Cancel winner is defeated", () => {
    const live = commit(running(), "s1");
    for (const kind of ["cancel-initial", "cancel-review"] as const) {
      const cancelled = resolve(
        live,
        intent(live, kind, {
          target:
            kind === "cancel-review"
              ? { type: "review", id: "r1" }
              : { type: "execution", id: runOf(live).id },
        }),
      ).plan;
      expect(cancelled.phase, kind).toBe("readback");
      expect(
        resolve(cancelled, keep(cancelled, { winnerVersion: 0 })).reply,
        kind,
      ).toMatchObject({
        result: "defeated",
        keys: ["keepDefeatedByWinner"],
        winner: { kind },
      });
    }
  });
  it("a retention Keep after a settled Cancel keeps that Cancel as final winner", () => {
    for (const kind of ["cancel-initial", "cancel-review"] as const) {
      const done = completed();
      const settled = resolve(
        done,
        intent(done, kind, {
          target:
            kind === "cancel-review"
              ? { type: "review", id: "r1" }
              : { type: "execution", id: runOf(done).id },
        }),
      ).plan;
      const kept = resolve(settled, keep(settled)).plan;
      expect(kept.sealed, kind).toBe(true);
      const restored = JSON.parse(JSON.stringify(kept)) as ProtectedPlan;
      for (const request of [
        intent(kept, "stop"),
        leave(kept),
        keep(kept, {}, { payload: "other" }),
      ]) {
        const reply = resolve(restored, request).reply;
        expect(reply.finalHistory, `${kind} × ${request.kind}`).toMatchObject({
          winner: { kind },
          keptFact: { keepEffect: "retention-ended" },
        });
      }
    }
  });
  it("every final answer is the same after a JSON restore", () => {
    const halted = stopped();
    const a = leave(halted);
    const sealed = resolve(halted, keep(halted)).plan;
    const restored = JSON.parse(JSON.stringify(sealed)) as ProtectedPlan;
    for (const request of [
      keep(sealed, {}, { payload: "other" }),
      a,
      leave(sealed, { evidenceDigest: "B".repeat(43) }),
      intent(sealed, "stop"),
      intent(sealed, "cancel-initial"),
      intent(sealed, "cancel-review", { target: { type: "review", id: "r1" } }),
    ])
      expect(resolve(restored, request).reply, request.kind).toEqual(
        resolve(sealed, request).reply,
      );
  });
});
