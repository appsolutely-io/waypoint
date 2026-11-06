import { describe, expect, it } from "vitest";
import {
  HOST_KEYS,
  OVERLAY_KEYS,
  keepSheet,
  noticeMessages,
  planView,
  type PlanViewInput,
} from "../../src/react/plan-view";
import type { IntentOverlay } from "../../src/core/client";
import type { IntentNotice } from "../../src/core/intent";
import type { PlanRecord, IntentKind } from "../../src/protocol/generated";
import {
  admit,
  commit,
  completed,
  contradict,
  fresh,
  intent,
  noticeOf,
  recordOf,
  resolve,
  running,
  stoppedReadback,
} from "../support/host-plans";

const sealedPlan = () => {
  const plan = stoppedReadback();
  return resolve(plan, intent(plan, "keep")).plan;
};
const ALL = ["plan-recovery", "plan-leave", "plan-keep"];
const review = {
  review: "end-retention" as const,
  remaining: 0,
  acknowledgment: {} as never,
};
// A constructed protected record: only what a cell needs differs.
function record(
  recovery: Partial<NonNullable<PlanRecord["recovery"]>> = {},
  over: Partial<PlanRecord> = {},
): PlanRecord {
  return {
    protocol: "1.0",
    id: "p",
    state: "needs-attention",
    plan: {
      kind: "immediate",
      stage: "final",
      digest: "d1",
      stepUpCount: 0,
      steps: [
        { id: "s1", view: "Update s1" },
        { id: "s2", view: "Update s2" },
      ],
    },
    outcomes: [],
    recovery: {
      profile: "plan-recovery-v1",
      phase: "readback",
      generation: "g1",
      round: 1,
      revision: 3,
      conversationId: "c",
      executionId: "e1",
      slots: {
        stop: 1,
        "cancel-initial": 0,
        "cancel-review": 0,
        leave: 0,
        keep: 0,
      },
      versions: { evidence: 1, winner: 1, decisionResolution: 0 },
      steps: [
        { stepId: "s1", truth: "done" },
        { stepId: "s2", truth: "not-done" },
      ],
      ...recovery,
    },
    ...over,
  } as unknown as PlanRecord;
}
function input(over: Partial<PlanViewInput> = {}): PlanViewInput {
  return {
    plan: record(),
    capabilities: ALL,
    conversationUnavailable: false,
    overlay: undefined,
    notice: null,
    alert: null,
    keepReview: review,
    pending: [],
    now: 0,
    conversationId: "c",
    ...over,
  };
}
const view = (over: Partial<PlanViewInput> = {}) => planView(input(over))!;
const action = (over: Partial<PlanViewInput>, id: string) =>
  view(over).actions.find((entry) => entry.id === id);
const ids = (over: Partial<PlanViewInput>) =>
  view(over).actions.map((entry) => entry.id);
const overlay = (
  kind: IntentKind,
  delivery: IntentOverlay["delivery"],
  extra: Partial<IntentOverlay> = {},
): IntentOverlay =>
  ({
    planId: "p",
    kind,
    request: {} as never,
    producer: "user",
    delivery,
    ownRun: false,
    ...extra,
  }) as IntentOverlay;

describe("Table S: panel status", () => {
  const cases: [string, PlanRecord, string, string, string, boolean][] = [
    [
      "CK-S1 proposal",
      record(
        { phase: "proposal", executionId: undefined, steps: undefined },
        { state: "proposed" },
      ),
      "proposal",
      "chat.recovery.statusProposal",
      "neutral",
      false,
    ],
    [
      "CK-S2 initial-review",
      recordOf(fresh()),
      "initial-review",
      "chat.recovery.heading",
      "neutral",
      false,
    ],
    [
      "CK-S3 forward-active",
      recordOf(running()),
      "forward-active",
      "chat.recovery.currentRunning",
      "progress",
      false,
    ],
    [
      "CK-S4 readback",
      recordOf(stoppedReadback()),
      "readback",
      "chat.recovery.heading",
      "warning",
      true,
    ],
    [
      "CK-S5 completed",
      recordOf(completed()),
      "completed",
      "chat.recovery.statusCompleted",
      "success",
      false,
    ],
    [
      "CK-S6 cancelled before any step",
      recordOf(resolve(fresh(), intent(fresh(), "cancel-initial")).plan),
      "cancelled",
      "chat.recovery.cancelledNoChanges",
      "neutral",
      false,
    ],
    [
      "CK-S7 left-known",
      record({ phase: "left-known", steps: [{ stepId: "s1", truth: "done" }] }),
      "left-known",
      "chat.recovery.leftKnown",
      "neutral",
      false,
    ],
    [
      "CK-S8 left-unconfirmed",
      record({
        phase: "left-unconfirmed",
        steps: [{ stepId: "s1", truth: "unknown" }],
      }),
      "left-unconfirmed",
      "chat.recovery.leftUnconfirmed",
      "warning",
      true,
    ],
    [
      "CK-S9 left-reopened",
      record({ phase: "left-reopened" }),
      "left-reopened",
      "chat.recovery.heading",
      "warning",
      true,
    ],
    [
      "CK-S10 sealed",
      record(
        {
          phase: "completed",
          sealed: true,
          steps: [{ stepId: "s1", truth: "done" }],
        },
        { state: "completed" },
      ),
      "completed",
      "chat.recovery.keptKnown",
      "neutral",
      false,
    ],
  ];
  it.each(cases)("%s", (_, plan, status, label, tone, attention) => {
    const result = view({ plan }).status!;
    expect(result.dataStatus).toBe(status);
    expect(result.label.key).toBe(label);
    expect(result.tone).toBe(tone);
    expect(result.attention).toBe(attention);
    expect(result.wireState).toBe(plan.state);
  });
  it("CK-S3b forward-active with a pending Stop says stopping", () => {
    expect(
      view({ plan: recordOf(running()), overlay: overlay("stop", "sending") })
        .status!.label.key,
    ).toBe("chat.recovery.stopping");
  });
  it("CK-S6b cancelled after a step was done says stopped, not no changes", () => {
    expect(
      view({
        plan: record(
          { phase: "cancelled", steps: [{ stepId: "s1", truth: "done" }] },
          { state: "cancelled" },
        ),
      }).status!.label.key,
    ).toBe("chat.recovery.currentStopped");
  });
  it("CK-S8b left-unconfirmed counts its unknown steps", () => {
    expect(
      view({
        plan: record({
          phase: "left-unconfirmed",
          steps: [
            { stepId: "s1", truth: "unknown" },
            { stepId: "s2", truth: "unknown" },
          ],
        }),
      }).status!.label.values,
    ).toEqual({ count: 2 });
  });
  it("CK-S11 intent attributes come from the overlay only and leave data-status alone", () => {
    const plan = recordOf(running());
    expect(view({ plan }).intent).toBeNull();
    const pending = view({ plan, overlay: overlay("stop", "uncertain") });
    expect(pending.intent).toEqual({ kind: "stop", status: "uncertain" });
    expect(pending.status!.dataStatus).toBe("forward-active");
    expect(
      view({ plan: record({ phase: "completed", sealed: true }) }).status!
        .result,
    ).toBe("kept");
  });
  it("CK-S12 a legacy plan has no recovery status", () => {
    expect(
      view({ plan: record({}, { recovery: undefined }) }).status,
    ).toBeNull();
  });
  it("CK-W5-view a protected plan this client cannot control is read-only", () => {
    for (const result of [
      view({ capabilities: [] }),
      view({ plan: record({ profile: "plan-recovery-v2" }) }),
      view({ plan: record({ phase: "manual-review" }) }),
    ]) {
      expect(result.readOnly).toBe(true);
      expect(result.actions).toEqual([]);
      expect(result.status!.label.key).toBe("chat.recovery.heading");
      expect(result.lines[0]!.key).toBe("chat.recovery.updateToControl");
    }
  });
});

describe("Table E: evidence reasons", () => {
  it("CK-E1 an unknown step adds its count and attention, the label stays", () => {
    const result = view({
      plan: record(
        { phase: "completed", steps: [{ stepId: "s1", truth: "unknown" }] },
        { state: "completed" },
      ),
    });
    expect(result.status!.label.key).toBe("chat.recovery.statusCompleted");
    expect(result.status!.attention).toBe(true);
    expect(result.lines).toContainEqual({
      key: "chat.recovery.stepsUnknown",
      values: { count: 1 },
    });
  });
  it("CK-E2 a completed plan with a not-done step needs attention", () => {
    const result = view({
      plan: record(
        {
          phase: "completed",
          steps: [
            { stepId: "s1", truth: "not-done" },
            { stepId: "s2", truth: "not-done" },
          ],
        },
        { state: "completed" },
      ),
    });
    expect(result.status!.attention).toBe(true);
    expect(result.lines).toContainEqual({
      key: "chat.recovery.stepsNotDone",
      values: { count: 2 },
    });
  });
  it("CK-E3 a sealed plan reports a later contradiction without rewriting history", () => {
    const sealed = sealedPlan();
    const plan = recordOf(contradict(sealed, "s1"));
    const result = view({ plan });
    expect(plan.recovery!.sealed).toBe(true);
    expect(result.status!.attention).toBe(true);
    expect(result.lines).toContainEqual({
      key: "chat.recovery.laterReportAfterKeep",
    });
    expect(result.steps.find((step) => step.stepId === "s1")).toEqual({
      stepId: "s1",
      index: 1,
      resource: "/items/s1",
      truth: plan.recovery!.steps!.find((step) => step.stepId === "s1")!.truth,
      textKey: expect.any(String),
      lateReport: "contradicted",
    });
  });
  it("CK-E4 a sealed plan without contradictions has no attention", () => {
    const plan = recordOf(sealedPlan());
    expect(view({ plan }).status!.attention).toBe(false);
  });
});

describe("Table R: step rows and the winner line", () => {
  it.each([
    ["CK-R1 done", "done"],
    ["CK-R2 not-done", "not-done"],
    ["CK-R3 unknown", "unknown"],
  ] as const)("%s", (_, truth) => {
    const result = view({ plan: record({ steps: [{ stepId: "s1", truth }] }) });
    expect(result.steps).toEqual([
      {
        stepId: "s1",
        index: 1,
        truth,
        textKey: `chat.recovery.${truth === "done" ? "done" : truth === "not-done" ? "notDone" : "unknown"}`,
      },
    ]);
  });
  it("CK-R3b while the plan runs an unknown step is not known yet and needs no attention", () => {
    const result = view({ plan: recordOf(running()) });
    expect(result.steps.length).toBeGreaterThan(0);
    for (const step of result.steps)
      if (step.truth === "unknown")
        expect(step.textKey).toBe("chat.recovery.stepNotKnownYet");
    expect(result.status!.attention).toBe(false);
    expect(result.lines.map((line) => line.key)).not.toContain(
      "chat.recovery.stepsUnknown",
    );
  });
  it.each([
    [
      "CK-R4a proposal",
      record({ phase: "proposal", executionId: undefined, steps: undefined }),
    ],
    ["CK-R4b initial-review", recordOf(fresh())],
    [
      "CK-R4c cancelled",
      recordOf(resolve(fresh(), intent(fresh(), "cancel-initial")).plan),
    ],
  ])(
    "%s without steps says nothing about steps and never stopped",
    (_, plan) => {
      const result = view({ plan });
      expect(result.steps).toEqual([]);
      const keys = result.lines.map((line) => line.key);
      expect(keys).not.toContain("chat.recovery.stepsNotKnownYet");
      expect(keys).not.toContain("chat.recovery.stopped");
    },
  );
  it("CK-R5 an accepted record without steps says not known yet", () => {
    const result = view({ plan: record({ steps: undefined }) });
    expect(result.lines).toContainEqual({
      key: "chat.recovery.stepsNotKnownYet",
    });
    expect(result.lines.map((line) => line.key)).not.toContain(
      "chat.recovery.stopped",
    );
  });
  const causes = [
    ["user", "winnerStopUser"],
    ["connection-lost", "winnerStopConnection"],
    ["renewal-refused", "winnerStopRenewal"],
    ["step-failed", "winnerStopStep"],
    ["step-up-failed", "winnerStopStepUp"],
    ["identity-lost", "winnerStopIdentity"],
    ["attribution-missing", "winnerStopAttribution"],
    ["plan-changed", "winnerStopChanged"],
    ["adapter-configuration", "winnerStopAdapter"],
  ] as const;
  it.each(causes)(
    "CK-R6 a Stop winner with cause %s has its origin-free line",
    (cause, key) => {
      const result = view({
        plan: record({ winner: { kind: "stop", cause } }),
      });
      expect(result.lines).toContainEqual({ key: `chat.recovery.${key}` });
      expect(result.lines).toContainEqual({ key: "chat.recovery.stopped" });
    },
  );
  it("CK-R6b a Stop winner on a closed phase does not say stopped", () => {
    const result = view({
      plan: record({
        phase: "left-known",
        winner: { kind: "stop", cause: "user" },
      }),
    });
    expect(result.lines.map((line) => line.key)).not.toContain(
      "chat.recovery.stopped",
    );
  });
  it.each([
    ["cancel-initial", "winnerCancel"],
    ["leave", "winnerLeave"],
    ["keep", "winnerKeep"],
  ] as const)("CK-R7 a %s winner has its origin-free line", (kind, key) => {
    expect(
      view({ plan: record({ winner: { kind, cause: "user" } }) }).lines,
    ).toContainEqual({ key: `chat.recovery.${key}` });
  });
  it("CK-R8 no line claims a window or device", () => {
    const result = view({
      plan: record({ winner: { kind: "stop", cause: "connection-lost" } }),
    });
    for (const line of result.lines)
      expect(line.key).not.toMatch(/Here|Elsewhere/);
  });
});

describe("Table A: actions", () => {
  const initial = recordOf(fresh());
  const proposal = record(
    { phase: "proposal", executionId: undefined, steps: undefined },
    { state: "proposed" },
  );
  const cases: [string, Partial<PlanViewInput>, string[]][] = [
    [
      "CK-A1 proposal",
      { plan: proposal, keepReview: { disabled: "keepNoDecision" } },
      ["stop", "decline"],
    ],
    [
      "CK-A2 initial review",
      { plan: initial, keepReview: { disabled: "keepNoDecision" } },
      ["confirm", "stop", "decline"],
    ],
    [
      "CK-A4 forward-active",
      {
        plan: recordOf(running()),
        keepReview: { disabled: "keepBlockedActive" },
      },
      ["stop", "leave", "keep"],
    ],
    [
      "CK-A5 readback",
      { plan: record() },
      ["leave", "keep", "undoSelected", "continue"],
    ],
    [
      "CK-A6 left-reopened",
      {
        plan: record({ phase: "left-reopened" }),
        keepReview: { disabled: "keepBlockedUnknown" },
      },
      ["leave", "keep", "undoSelected", "continue"],
    ],
    ["CK-A7 completed", { plan: recordOf(completed()) }, ["keep"]],
    ["CK-A8 left-known", { plan: record({ phase: "left-known" }) }, ["keep"]],
    [
      "CK-A9 left-unconfirmed",
      {
        plan: record({ phase: "left-unconfirmed" }),
        keepReview: { disabled: "keepBlockedUnknown" },
      },
      ["keep"],
    ],
    [
      "CK-A10a cancelled before execution",
      {
        plan: recordOf(
          resolve(fresh(), intent(fresh(), "cancel-initial")).plan,
        ),
        keepReview: { disabled: "keepNoDecision" },
      },
      [],
    ],
    [
      "CK-A10b cancelled after start (client has a decision)",
      {
        plan: record({ phase: "cancelled" }, { state: "cancelled" }),
        keepReview: { disabled: "keepBlockedUnknown" },
      },
      [],
    ],
  ];
  it.each(cases)("%s renders exactly its cells", (_, over, expected) => {
    expect(ids(over)).toEqual(expected);
  });
  it("CK-A2b Confirm, Stop and Decline are available on an initial review", () => {
    for (const id of ["confirm", "stop", "decline"])
      expect(action({ plan: initial }, id)).toMatchObject({ available: true });
  });
  it("CK-R-revision a record for another revision or conversation offers no Confirm; its own does", () => {
    const plan = recordOf(fresh());
    expect(view({ plan }).actions.map((entry) => entry.id)).toContain(
      "confirm",
    );
    const older = structuredClone(plan);
    older.confirmation!.revision += 1;
    expect(
      view({ plan: older }).actions.map((entry) => entry.id),
    ).not.toContain("confirm");
    expect(
      view({ plan, conversationId: "d" }).actions.map((entry) => entry.id),
    ).not.toContain("confirm");
  });
  it("CK-A3 a scheduled record names the action Schedule; without a record there is no Confirm", () => {
    const scheduled = {
      ...initial,
      confirmation: {
        ...initial.confirmation!,
        schedule: {
          start: null,
          end: null,
          startText: "Now",
          endText: "No end date",
        },
      },
    } as PlanRecord;
    expect(action({ plan: scheduled }, "confirm")).toMatchObject({
      available: true,
      schedule: true,
      labelKey: "chat.confirmation.schedule",
    });
    expect(action({ plan: initial }, "confirm")).toMatchObject({
      labelKey: "chat.confirmation.apply",
      labelValues: { count: initial.confirmation!.items.length },
    });
    const bare = { ...initial } as PlanRecord;
    delete bare.confirmation;
    expect(action({ plan: bare }, "confirm")).toBeUndefined();
  });
  it("CK-A4b Leave without plan-leave is explained", () => {
    expect(
      action({ capabilities: ["plan-recovery", "plan-keep"] }, "leave"),
    ).toMatchObject({
      available: false,
      reasonKey: "chat.recovery.capabilityMissing",
    });
  });
  it("CK-A5b deferred actions explain what to do instead", () => {
    for (const id of ["undoSelected", "continue"])
      expect(action({}, id)).toMatchObject({
        available: false,
        reasonKey: "chat.recovery.notAvailableYet",
      });
  });
  const reasons = [
    ["CK-AK1 a review", review, { available: true }],
    [
      "CK-AK5 active",
      { disabled: "keepBlockedActive" },
      { available: false, reasonKey: "chat.recovery.keepReasonActive" },
    ],
    [
      "CK-AK6 unknown",
      { disabled: "keepBlockedUnknown" },
      { available: false, reasonKey: "chat.recovery.keepReasonUnknown" },
    ],
    [
      "CK-AK7 loading",
      { disabled: "loading" },
      { available: false, reasonKey: "chat.recovery.actionLoading" },
    ],
    [
      "CK-AK8 unavailable",
      { disabled: "intentUnavailable" },
      { available: false, reasonKey: "chat.recovery.keepReasonUnavailable" },
    ],
  ] as const;
  it.each(reasons)("%s", (_, keepReview, expected) => {
    expect(action({ keepReview: keepReview as never }, "keep")).toMatchObject(
      expected,
    );
  });
  it.each([
    ["CK-AK2 capabilityMissing", "capabilityMissing"],
    ["CK-AK3 keepNoDecision", "keepNoDecision"],
    ["CK-AK4 sealed", "sealed"],
  ])("%s renders no Keep", (_, disabled) => {
    expect(
      action({ keepReview: { disabled } as never }, "keep"),
    ).toBeUndefined();
  });
  describe("legacy plans", () => {
    const issued = {
      token: "t",
      expiresAt: new Date(10_000).toISOString(),
      planId: "p",
      conversationId: "c",
      revision: 1,
      heading: "Update 1 record",
      items: [],
      irreversible: false,
      undo: "No Undo in this version.",
      verificationCount: 0,
    };
    const legacy = (over: Partial<PlanRecord>) =>
      record({}, { recovery: undefined, ...over });
    it("CK-AL1 a plan awaiting confirmation with the host's record can be confirmed; no Cancel", () => {
      expect(
        ids({
          plan: legacy({
            state: "awaiting-confirmation",
            confirmation: issued,
          }),
        }),
      ).toEqual(["confirm"]);
      expect(
        action({ plan: legacy({ state: "awaiting-confirmation" }) }, "confirm"),
      ).toBeUndefined();
      expect(
        action(
          { plan: legacy({ state: "running", confirmation: issued }) },
          "confirm",
        ),
      ).toBeUndefined();
    });
    it("CK-AL2a an expired record makes Confirm unavailable with its reason", () => {
      const plan = legacy({
        state: "awaiting-confirmation",
        confirmation: issued,
      });
      expect(action({ plan, now: 9_999 }, "confirm")).toMatchObject({
        available: true,
      });
      expect(action({ plan, now: 10_000 }, "confirm")).toMatchObject({
        available: false,
        reasonKey: "chat.confirmation.expired",
      });
    });
    it("CK-AL2b a record issued for another plan is ignored", () => {
      const plan = legacy({
        state: "awaiting-confirmation",
        confirmation: { ...issued, planId: "other" },
      });
      expect(action({ plan }, "confirm")).toBeUndefined();
    });
    it("CK-AL3 Stop only while running; no Decline, Leave or Keep", () => {
      expect(ids({ plan: legacy({ state: "running" }) })).toEqual(["stop"]);
      expect(ids({ plan: legacy({ state: "completed" }) })).toEqual([]);
    });
  });
});

describe("Table A modifiers", () => {
  it("CK-AM1 an unavailable conversation explains every entry, also over an overlay", () => {
    const result = view({
      conversationUnavailable: true,
      overlay: overlay("leave", "uncertain"),
    });
    for (const entry of result.actions)
      expect(entry).toMatchObject({
        available: false,
        reasonKey: "chat.recovery.refreshConversation",
      });
    expect(result.actions.map((entry) => entry.id)).toContain("status");
  });
  const kinds: [
    IntentKind,
    Partial<PlanViewInput>,
    string,
    string[],
    string[],
  ][] = [
    [
      "stop",
      {
        plan: recordOf(running()),
        keepReview: { disabled: "keepBlockedActive" },
      },
      "checkIntentStatus",
      ["leave", "keep"],
      [],
    ],
    [
      "cancel-initial",
      { plan: recordOf(fresh()), keepReview: { disabled: "keepNoDecision" } },
      "checkIntentStatus",
      ["confirm"],
      ["stop"],
    ],
    ["leave", { plan: record() }, "checkSavedChoice", [], ["keep"]],
    ["keep", { plan: record() }, "checkKeepStatus", ["leave"], []],
  ];
  for (const [kind, over, label, blocked, open] of kinds)
    for (const delivery of ["sending", "not-sent", "uncertain"] as const)
      it(`CK-AM2 ${kind} ${delivery}: status entry, lower ranks blocked, higher ranks open`, () => {
        const result = view({ ...over, overlay: overlay(kind, delivery) });
        expect(
          result.actions.find((entry) => entry.id === "status"),
        ).toMatchObject({
          labelKey: `chat.recovery.${label}`,
          available: true,
          busy: delivery === "sending",
        });
        for (const id of blocked)
          expect(result.actions.find((entry) => entry.id === id)).toMatchObject(
            {
              available: false,
              reasonKey: "chat.recovery.intentPendingReason",
            },
          );
        for (const id of open)
          expect(result.actions.find((entry) => entry.id === id)).toMatchObject(
            { available: true },
          );
      });
  it("CK-AM2c Confirm is blocked by a pending Stop and by a pending Decline", () => {
    for (const kind of ["stop", "cancel-initial"] as const)
      expect(
        action(
          { plan: recordOf(fresh()), overlay: overlay(kind, "uncertain") },
          "confirm",
        ),
      ).toMatchObject({
        available: false,
        reasonKey: "chat.recovery.intentPendingReason",
      });
  });
  it("CK-AM2w the wait guard covers the status entry and the alert's Retry until retryAt", () => {
    const limited = overlay("leave", "not-sent", {
      retryAt: 5000,
      lastProblem: { key: "leaveNotSent", cause: "rate-limited" },
    });
    const before = view({
      overlay: limited,
      now: 3000,
      alert: { serial: 1, action: "wait" },
    });
    expect(before.actions.find((entry) => entry.id === "status")).toMatchObject(
      {
        available: false,
        reasonKey: "chat.recovery.retryAfterSeconds",
        reasonValues: { seconds: 2 },
      },
    );
    expect(before.alert).toMatchObject({
      action: "wait",
      retryAvailable: false,
      retryValues: { seconds: 2 },
    });
    const at = view({
      overlay: limited,
      now: 5000,
      alert: { serial: 1, action: "retry" },
    });
    expect(at.actions.find((entry) => entry.id === "status")).toMatchObject({
      available: true,
    });
    expect(at.alert).toMatchObject({ retryAvailable: true });
  });
  it("CK-AM3 a press by this view with no overlay yet blocks its own and lower ranks", () => {
    const result = view({
      plan: recordOf(fresh()),
      pending: ["cancel-initial"],
      keepReview: { disabled: "keepNoDecision" },
    });
    expect(
      result.actions.find((entry) => entry.id === "decline"),
    ).toMatchObject({
      available: false,
      reasonKey: "chat.recovery.intentPendingReason",
      busy: true,
    });
    expect(
      result.actions.find((entry) => entry.id === "confirm"),
    ).toMatchObject({ available: false });
    expect(result.actions.find((entry) => entry.id === "stop")).toMatchObject({
      available: true,
    });
    expect(result.actions.map((entry) => entry.id)).not.toContain("status");
  });
  it("CK-AM3s a pending Stop press blocks everything below it", () => {
    const result = view({
      plan: recordOf(fresh()),
      pending: ["stop"],
      keepReview: { disabled: "keepNoDecision" },
    });
    for (const id of ["confirm", "decline", "stop"])
      expect(result.actions.find((entry) => entry.id === id)).toMatchObject({
        available: false,
      });
  });
  it("CK-AM4 another plan's overlay changes nothing", () => {
    expect(
      view({ overlay: { ...overlay("stop", "uncertain"), planId: "other" } })
        .actions,
    ).toEqual(view().actions);
  });
  it.each([
    [
      "CK-AM5a Stop uncertain after the record became cancelled",
      "stop",
      record({ phase: "cancelled" }, { state: "cancelled" }),
      { disabled: "keepNoDecision" },
      "checkIntentStatus",
    ],
    [
      "CK-AM5b Keep uncertain after the plan was sealed",
      "keep",
      record({ phase: "completed", sealed: true }),
      { disabled: "sealed" },
      "checkKeepStatus",
    ],
    [
      "CK-AM5c Leave uncertain after left-known",
      "leave",
      record({ phase: "left-known" }),
      review,
      "checkSavedChoice",
    ],
  ] as const)(
    "%s still offers its status check",
    (_, kind, plan, keepReview, label) => {
      const result = view({
        plan,
        keepReview: keepReview as never,
        overlay: overlay(kind, "uncertain"),
      });
      expect(
        result.actions.find((entry) => entry.id === "status"),
      ).toMatchObject({ labelKey: `chat.recovery.${label}`, available: true });
    },
  );
  it("CK-AM5d a pending Leave after losing plan-leave still offers its status check", () => {
    const result = view({
      capabilities: ["plan-recovery", "plan-keep"],
      overlay: overlay("leave", "uncertain"),
    });
    expect(result.actions.find((entry) => entry.id === "status")).toMatchObject(
      { available: true },
    );
  });
});

describe("Table H: notice messages from the host's facts", () => {
  const keysOf = (notice: IntentNotice) =>
    noticeMessages(notice).map((m) => m.key);
  it("CK-H-first-leave renders the host's key with its top-level count", () => {
    const plan = stoppedReadback();
    const reply = noticeOf(resolve(plan, intent(plan, "leave")).reply);
    expect(reply.savedDisposition).toBeUndefined();
    const messages = noticeMessages(reply);
    const expected = reply.keys.includes("leftUnconfirmed")
      ? { key: "chat.recovery.leftUnconfirmed", values: { count: reply.count } }
      : { key: "chat.recovery.leftKnown" };
    expect(messages).toContainEqual(expected);
  });
  it("CK-H-first-leave-unknown counts the unknown steps from the reply itself", () => {
    const plan = admit(running(), "s1");
    const halted = resolve(
      plan,
      intent(plan, "stop", { cause: "connection-lost" }),
    ).plan;
    const reply = noticeOf(resolve(halted, intent(halted, "leave")).reply);
    expect(reply.keys).toContain("leftUnconfirmed");
    expect(reply.savedDisposition).toBeUndefined();
    expect(noticeMessages(reply)).toContainEqual({
      key: "chat.recovery.leftUnconfirmed",
      values: { count: 1 },
    });
  });
  it("CK-H-keep-refusal names the Keep reason and never a Leave choice", () => {
    const plan = completed();
    const request = intent(plan, "keep");
    const reply = noticeOf(resolve(contradict(plan, "s1"), request).reply);
    const keys = keysOf(reply);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).not.toMatch(/leave|Leave|left/);
  });
  it("CK-H-first-keep says the plan was closed and remaining steps will not run", () => {
    const plan = stoppedReadback();
    const reply = noticeOf(resolve(plan, intent(plan, "keep")).reply);
    expect(keysOf(reply)).toEqual(
      expect.arrayContaining([
        "chat.recovery.planClosedKept",
        "chat.recovery.keptForwardClosed",
      ]),
    );
  });
  it("CK-H-stop-on-sealed renders the host's key and the final history", () => {
    const sealed = sealedPlan();
    const reply = noticeOf(resolve(sealed, intent(sealed, "stop")).reply);
    expect(reply.finalHistory).toBeDefined();
    expect(keysOf(reply)).toContain("chat.recovery.alreadyKept");
  });
  it("CK-H-cancel-after-complete says the original action had finished", () => {
    const plan = completed();
    const reply = noticeOf(
      resolve(
        plan,
        intent(plan, "cancel-initial", {
          target: { type: "generation", id: "g1" },
        }),
      ).reply,
    );
    const keys = keysOf(reply);
    expect(keys).not.toContain("chat.recovery.cancelStarted");
    expect(reply.keys.map((key) => HOST_KEYS[key])).toEqual(
      keys.slice(0, reply.keys.length),
    );
  });
  it("CK-H-stop-after-safety-leave keeps the decision open", () => {
    const plan = commit(running(), "s1");
    const left = resolve(plan, intent(plan, "leave")).plan;
    const reply = noticeOf(resolve(left, intent(left, "stop")).reply);
    expect(keysOf(reply)).not.toContain("chat.recovery.alreadyClosedByWinner");
  });
  it("CK-H-superseded adds whether the earlier request was applied", () => {
    const notice = {
      keys: ["intentSuperseded"],
      requestedTargetApplied: false,
    } as unknown as IntentNotice;
    expect(keysOf(notice)).toEqual([
      "chat.recovery.intentSuperseded",
      "chat.recovery.requestedIntentNotApplied",
    ]);
  });
  it("CK-H-alias an automatic Stop then a human alias claims no window", () => {
    const plan = commit(running(), "s1");
    const first = resolve(
      plan,
      intent(plan, "stop", { cause: "connection-lost" }),
    );
    const again = noticeOf(resolve(first.plan, intent(plan, "stop")).reply);
    for (const key of keysOf(again)) expect(key).not.toMatch(/Here|Elsewhere/);
  });
  it("CK-H1 host keys in the host's order, each once", () => {
    const notice = {
      keys: ["planClosedKept", "keptForwardClosed", "planClosedKept"],
    } as unknown as IntentNotice;
    expect(keysOf(notice)).toEqual([
      "chat.recovery.planClosedKept",
      "chat.recovery.keptForwardClosed",
    ]);
  });
  it("CK-H2 the request key follows", () => {
    expect(
      keysOf({
        keys: [],
        requestKey: "requestTargetStopped",
      } as unknown as IntentNotice),
    ).toEqual(["chat.recovery.requestTargetStopped"]);
  });
  it("CK-H3 historical application", () => {
    expect(
      keysOf({
        keys: [],
        requestedTargetApplied: true,
      } as unknown as IntentNotice),
    ).toEqual(["chat.recovery.requestedIntentApplied"]);
  });
  it("CK-H4 a saved disposition adds its line once", () => {
    expect(
      noticeMessages({
        keys: ["alreadyClosedByWinner"],
        savedDisposition: { phase: "left-unconfirmed", count: 3 },
      } as unknown as IntentNotice),
    ).toEqual([
      { key: "chat.recovery.alreadyClosedByWinner" },
      { key: "chat.recovery.leftUnconfirmed", values: { count: 3 } },
    ]);
    expect(
      keysOf({
        keys: ["leftKnown"],
        savedDisposition: { phase: "left-known", count: 0 },
      } as unknown as IntentNotice),
    ).toEqual(["chat.recovery.leftKnown"]);
  });
  it.each([
    ["leaveCompletedByKeep", "leaveCompletedByKeep"],
    ["leaveCoveredByKeep", "leaveCoveredByKeep"],
    ["keptElsewhere", "keptAlready"],
  ])("CK-H5 final history relation %s", (relation, key) => {
    const notice = {
      keys: [],
      finalHistory: {
        relation,
        winner: { kind: "keep", cause: "user" },
        keptFact: { keepEffect: "decision-closed" },
      },
    } as unknown as IntentNotice;
    expect(keysOf(notice)).toEqual([`chat.recovery.${key}`]);
  });
  it("CK-H5b final history forward closure, applied flag and late report", () => {
    const notice = {
      keys: ["planSealed"],
      finalHistory: {
        winner: { kind: "keep", cause: "user" },
        keptFact: { keepEffect: "forward-closed" },
        requestedTargetApplied: false,
        contradictedAfterSeal: ["s1"],
      },
    } as unknown as IntentNotice;
    expect(keysOf(notice)).toEqual([
      "chat.recovery.alreadyKept",
      "chat.recovery.keptForwardClosed",
      "chat.recovery.requestedIntentNotApplied",
      "chat.recovery.laterReportAfterKeep",
    ]);
  });
  it("CK-H6 an unmapped host key shows nothing", () => {
    expect(
      keysOf({ keys: ["somethingNew"] } as unknown as IntentNotice),
    ).toEqual([]);
  });
  it("CK-H7 a notice for another plan is not shown", () => {
    const notice = {
      planId: "other",
      keys: ["planClosedKept"],
    } as unknown as IntentNotice;
    expect(view({ notice }).notice).toEqual([]);
  });
});

describe("Table O: overlay keys", () => {
  it.each([
    ["stopNotSent", "stopNotSent"],
    ["stopNotSentElsewhere", "stopNotSentElsewhere"],
    ["stopUnconfirmed", "stopUnconfirmed"],
    ["cancelInitialNotSent", "cancelNotSent"],
    ["cancelInitialUnconfirmed", "cancelUnconfirmed"],
    ["cancelReviewNotSent", "reviewCancelNotSent"],
    ["cancelReviewUnconfirmed", "reviewCancelUnconfirmed"],
    ["leaveNotSent", "leaveNotSent"],
    ["leaveUnconfirmed", "leaveUnconfirmed"],
    ["keepNotSent", "keepNotSent"],
    ["keepUnconfirmed", "keepUnconfirmed"],
    ["stopRefused", "requestRefused"],
    ["cancelInitialRefused", "requestRefused"],
    ["cancelReviewRefused", "requestRefused"],
    ["leaveRefused", "requestRefused"],
    ["keepRefused", "requestRefused"],
  ])("CK-O %s", (client, catalogue) => {
    expect(OVERLAY_KEYS[client]).toBe(`chat.recovery.${catalogue}`);
    const result = view({
      overlay: overlay("leave", "not-sent", {
        lastProblem: { key: client, cause: "offline" },
      }),
      alert: { serial: 4, action: "retry" },
    });
    expect(result.alert).toMatchObject({
      serial: 4,
      action: "retry",
      message: { key: `chat.recovery.${catalogue}` },
    });
  });
  it("CK-O2 an unmapped overlay key shows no message", () => {
    const result = view({
      overlay: overlay("leave", "not-sent", {
        lastProblem: { key: "unknownKey", cause: "offline" },
      }),
      alert: { serial: 1, action: "retry" },
    });
    expect(result.alert?.message).toBeUndefined();
  });
});

describe("Table P: part data", () => {
  it("CK-P8 action entries carry no functions or private fields", () => {
    for (const entry of view().actions)
      for (const value of Object.values(entry))
        expect(typeof value).not.toBe("function");
    expect(
      JSON.stringify(view({ overlay: overlay("leave", "uncertain") })),
    ).not.toMatch(/correlation|acknowledgment|request|fence|executionId/);
  });
});

describe("Table K: Keep confirmation", () => {
  it("CK-K1 forward-only says remaining planned steps will not run, with the count", () => {
    expect(
      keepSheet({ review: "forward-only", remaining: 2 }, view()).messages,
    ).toEqual([
      { key: "chat.recovery.confirmKeepForwardOnly" },
      { key: "chat.recovery.keepRemainingSteps", values: { count: 2 } },
    ]);
  });
  it("CK-K2 end-retention says no planned steps remain", () => {
    expect(keepSheet(review, view()).messages).toEqual([
      { key: "chat.recovery.confirmEndRetention" },
    ]);
  });
  it("CK-K4a sealed while open: Proceed is unavailable", () => {
    expect(
      keepSheet(
        review,
        view({ plan: record({ phase: "completed", sealed: true }) }),
      ).proceed,
    ).toEqual({ available: false, reasonKey: "chat.recovery.alreadyKept" });
  });
  it("CK-K4b another intent pending while open: Proceed is unavailable", () => {
    expect(
      keepSheet(review, view({ overlay: overlay("stop", "uncertain") }))
        .proceed,
    ).toEqual({
      available: false,
      reasonKey: "chat.recovery.intentPendingReason",
    });
    expect(keepSheet(review, view({ pending: ["leave"] })).proceed).toEqual({
      available: false,
      reasonKey: "chat.recovery.intentPendingReason",
    });
  });
  it("CK-K4c an unavailable conversation: Proceed is unavailable", () => {
    expect(
      keepSheet(review, view({ conversationUnavailable: true })).proceed,
    ).toEqual({
      available: false,
      reasonKey: "chat.recovery.refreshConversation",
    });
  });
  it("CK-K5 otherwise Proceed is available", () => {
    expect(keepSheet(review, view()).proceed).toEqual({ available: true });
  });
});
