// @vitest-environment jsdom
// The rendered inventory of the recovery tables: one rendered case per
// status row, action cell, modifier, Keep sheet state and part boundary,
// in both skins.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  WaypointChat,
  WaypointProvider,
  RecoveryPanel,
  partNames,
  type PartProps,
} from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { TestChat } from "../support/chat-focus";
import {
  keepSheet,
  planView,
  type PlanViewInput,
} from "../../src/react/plan-view";
import { addMessages, createFormatter } from "../../src/react/i18n";
import {
  recoveryEnglish,
  recoverySimplifiedChinese,
} from "../../src/react/recovery-messages";
import {
  confirmationEnglish,
  confirmationSimplifiedChinese,
} from "../../src/react/confirmation-messages";
import {
  createWaypointClient,
  type IntentOverlay,
} from "../../src/core/client";
import type { IntentKind, PlanRecord } from "../../src/protocol/generated";
import { config } from "../support/client";
import { acceptedReadback, protectedHost } from "../support/protected";
import {
  completed,
  fresh,
  intent,
  recordOf,
  resolve,
  running,
  stoppedReadback,
} from "../support/host-plans";

afterEach(cleanup);
addMessages(recoveryEnglish, recoverySimplifiedChinese);
addMessages(confirmationEnglish, confirmationSimplifiedChinese);
const format = createFormatter("en");
const text = (key: string, values?: Record<string, string | number>) =>
  format(key as never, values);
const ALL = ["plan-recovery", "plan-leave", "plan-keep"];
const forward = {
  review: "forward-only" as const,
  remaining: 1,
  acknowledgment: {} as never,
};
const retention = {
  review: "end-retention" as const,
  remaining: 0,
  acknowledgment: {} as never,
};
const constructed = (
  recovery: Partial<NonNullable<PlanRecord["recovery"]>>,
  state: PlanRecord["state"] = "needs-attention",
) => {
  const base = recordOf(stoppedReadback());
  return {
    ...base,
    state,
    recovery: { ...base.recovery!, ...recovery },
  } as PlanRecord;
};
const base: PlanViewInput = {
  plan: recordOf(stoppedReadback()),
  capabilities: ALL,
  conversationUnavailable: false,
  overlay: undefined,
  notice: null,
  alert: null,
  keepReview: forward,
  pending: [],
  now: 0,
  conversationId: "c",
};
const overlay = (
  kind: IntentKind,
  delivery: IntentOverlay["delivery"],
  extra: Partial<IntentOverlay> = {},
) =>
  ({
    planId: "p",
    kind,
    request: {} as never,
    producer: "user",
    delivery,
    ownRun: false,
    ...extra,
  }) as IntentOverlay;
const fakeClient = () =>
  ({ subscribe: () => () => {}, getSnapshot: () => ({}) }) as never;
const sealedPlan = () => {
  const plan = stoppedReadback();
  return resolve(plan, intent(plan, "keep")).plan;
};
const cancelled = () =>
  resolve(fresh(), intent(fresh(), "cancel-initial")).plan;
const skins: [string, (children: ReactNode) => ReactNode, object][] = [
  [
    "neutral",
    (children) => (
      <WaypointProvider client={fakeClient()}>{children}</WaypointProvider>
    ),
    {},
  ],
  [
    "antd",
    (children) => (
      <WaypointProvider client={fakeClient()} primitives={antdPrimitives}>
        {children}
      </WaypointProvider>
    ),
    { primitives: antdPrimitives },
  ],
];
const panel = () =>
  document.querySelector("[data-wire-state]") as HTMLElement | null;
const rendered = () =>
  Object.fromEntries(
    ([...document.querySelectorAll("[data-action]")] as HTMLElement[]).map(
      (element) => [
        element.dataset.action,
        element.getAttribute("aria-disabled") === "true"
          ? (document.getElementById(
              element.getAttribute("aria-describedby") ?? "",
            )?.textContent ?? "unavailable")
          : "available",
      ],
    ),
  );
const expected = (cells: Record<string, string | null>) =>
  Object.fromEntries(
    Object.entries(cells).map(([id, reason]) => [
      id,
      reason ? text(`chat.recovery.${reason}`) : "available",
    ]),
  );

describe.each(skins)("rendered inventory (%s)", (_, wrap, skin) => {
  const show = async (
    over: Partial<PlanViewInput> = {},
    extra: { sheet?: unknown; onPress?: () => void } = {},
  ) => {
    const view = planView({ ...base, ...over })!;
    render(
      wrap(
        <RecoveryPanel
          view={view}
          onPress={extra.onPress ?? (() => {})}
          sheet={extra.sheet as never}
        />,
      ),
    );
    await waitFor(() => expect(panel()).not.toBeNull());
    return view;
  };

  const statusRows: [
    string,
    PlanRecord,
    string,
    string,
    Record<string, number>?,
  ][] = [
    [
      "S1 proposal",
      constructed(
        { phase: "proposal", executionId: undefined, steps: undefined },
        "proposed",
      ),
      "proposal",
      "statusProposal",
    ],
    ["S2 initial-review", recordOf(fresh()), "initial-review", "heading"],
    [
      "S3 forward-active",
      recordOf(running()),
      "forward-active",
      "currentRunning",
    ],
    ["S4 readback", recordOf(stoppedReadback()), "readback", "heading"],
    ["S5 completed", recordOf(completed()), "completed", "statusCompleted"],
    ["S6 cancelled", recordOf(cancelled()), "cancelled", "cancelledNoChanges"],
    [
      "S6b cancelled after a done step",
      constructed(
        { phase: "cancelled", steps: [{ stepId: "s1", truth: "done" }] },
        "cancelled",
      ),
      "cancelled",
      "currentStopped",
    ],
    [
      "S7 left-known",
      constructed({
        phase: "left-known",
        steps: [{ stepId: "s1", truth: "done" }],
      }),
      "left-known",
      "leftKnown",
    ],
    [
      "S8 left-unconfirmed",
      constructed({
        phase: "left-unconfirmed",
        steps: [
          { stepId: "s1", truth: "unknown" },
          { stepId: "s2", truth: "unknown" },
        ],
      }),
      "left-unconfirmed",
      "leftUnconfirmed",
      { count: 2 },
    ],
    [
      "S9 left-reopened",
      constructed({ phase: "left-reopened" }),
      "left-reopened",
      "heading",
    ],
    ["S10 sealed", recordOf(sealedPlan()), "left-known", "keptKnown"],
  ];
  it.each(statusRows)("CK-inv-%s", async (_, plan, status, label, values) => {
    await show({ plan });
    expect(panel()!.dataset.status).toBe(status);
    expect(panel()!.dataset.wireState).toBe(plan.state);
    expect(document.querySelector("h3")!.textContent).toBe(
      text(`chat.recovery.${label}`, values),
    );
  });

  const actionCells: [
    string,
    Partial<PlanViewInput>,
    Record<string, string | null>,
  ][] = [
    [
      "A1 proposal",
      { plan: statusRows[0]![1], keepReview: { disabled: "keepNoDecision" } },
      { stop: null, decline: null },
    ],
    [
      "A2 initial review",
      { plan: recordOf(fresh()), keepReview: { disabled: "keepNoDecision" } },
      { confirm: null, stop: null, decline: null },
    ],
    [
      "A3 initial review without the host's confirmation record",
      {
        plan: { ...recordOf(fresh()), confirmation: undefined } as PlanRecord,
        keepReview: { disabled: "keepNoDecision" },
      },
      { stop: null, decline: null },
    ],
    [
      "A4 forward-active",
      {
        plan: recordOf(running()),
        keepReview: { disabled: "keepBlockedActive" },
      },
      { stop: null, leave: null, keep: "keepReasonActive" },
    ],
    [
      "A4b forward-active without plan-leave",
      {
        plan: recordOf(running()),
        capabilities: ["plan-recovery", "plan-keep"],
        keepReview: { disabled: "keepBlockedActive" },
      },
      { stop: null, leave: "capabilityMissing", keep: "keepReasonActive" },
    ],
    [
      "A5 readback",
      {},
      {
        leave: null,
        keep: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "A6 left-reopened",
      {
        plan: statusRows[9]![1],
        keepReview: { disabled: "keepBlockedUnknown" },
      },
      {
        leave: null,
        keep: "keepReasonUnknown",
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "A7 completed",
      { plan: recordOf(completed()), keepReview: retention },
      { keep: null },
    ],
    [
      "A8 left-known",
      { plan: statusRows[7]![1], keepReview: retention },
      { keep: null },
    ],
    [
      "A9 left-unconfirmed",
      {
        plan: statusRows[8]![1],
        keepReview: { disabled: "keepBlockedUnknown" },
      },
      { keep: "keepReasonUnknown" },
    ],
    [
      "A10 cancelled",
      {
        plan: recordOf(cancelled()),
        keepReview: { disabled: "keepNoDecision" },
      },
      {},
    ],
    [
      "AK2 capability missing",
      { keepReview: { disabled: "capabilityMissing" } },
      {
        leave: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "AK3 no decision",
      { keepReview: { disabled: "keepNoDecision" } },
      {
        leave: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "AK4 sealed",
      { keepReview: { disabled: "sealed" } },
      {
        leave: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "AK7 loading",
      { keepReview: { disabled: "loading" } },
      {
        leave: null,
        keep: "actionLoading",
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "AK8 intent client unavailable",
      { keepReview: { disabled: "intentUnavailable" } },
      {
        leave: null,
        keep: "keepReasonUnavailable",
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "AM1 conversation unavailable",
      { conversationUnavailable: true },
      {
        leave: "refreshConversation",
        keep: "refreshConversation",
        undoSelected: "refreshConversation",
        continue: "refreshConversation",
      },
    ],
    [
      "AM2 Stop pending",
      {
        plan: recordOf(running()),
        overlay: overlay("stop", "uncertain"),
        keepReview: { disabled: "keepBlockedActive" },
      },
      {
        status: null,
        leave: "intentPendingReason",
        keep: "intentPendingReason",
      },
    ],
    [
      "AM2 Cancel pending",
      {
        plan: recordOf(fresh()),
        overlay: overlay("cancel-initial", "uncertain"),
        keepReview: { disabled: "keepNoDecision" },
      },
      { confirm: "intentPendingReason", stop: null, status: null },
    ],
    [
      "AM2 Leave pending",
      { overlay: overlay("leave", "uncertain") },
      {
        status: null,
        keep: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "AM2 Keep pending",
      { overlay: overlay("keep", "uncertain") },
      {
        leave: "intentPendingReason",
        status: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "AM3 Cancel pressed before the chunk",
      {
        plan: recordOf(fresh()),
        pending: ["cancel-initial"],
        keepReview: { disabled: "keepNoDecision" },
      },
      {
        confirm: "intentPendingReason",
        stop: null,
        decline: "intentPendingReason",
      },
    ],
    [
      "AM4 another plan's overlay",
      { overlay: { ...overlay("stop", "uncertain"), planId: "other" } },
      {
        leave: null,
        keep: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
    [
      "AM5a Stop pending after the record became cancelled",
      {
        plan: recordOf(cancelled()),
        overlay: overlay("stop", "uncertain"),
        keepReview: { disabled: "keepNoDecision" },
      },
      { status: null },
    ],
    [
      "AM5b Keep pending after the seal",
      {
        plan: recordOf(sealedPlan()),
        overlay: overlay("keep", "uncertain"),
        keepReview: { disabled: "sealed" },
      },
      { status: null },
    ],
    [
      "AM5c Leave pending after left-known",
      {
        plan: statusRows[7]![1],
        overlay: overlay("leave", "uncertain"),
        keepReview: retention,
      },
      { keep: null, status: null },
    ],
    [
      "AM5d Leave pending after losing plan-leave",
      {
        capabilities: ["plan-recovery", "plan-keep"],
        overlay: overlay("leave", "uncertain"),
      },
      {
        status: null,
        keep: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
  ];
  it.each(actionCells)(
    "CK-inv-%s renders exactly its controls and reasons",
    async (_, over, cells) => {
      await show(over);
      expect(rendered()).toEqual(expected(cells));
    },
  );
  it("CK-inv-AM2w a rate-limited status check and Retry wait, then become available", async () => {
    const limited = overlay("leave", "not-sent", {
      retryAt: 5000,
      lastProblem: { key: "leaveNotSent", cause: "rate-limited" },
    });
    await show({
      overlay: limited,
      now: 3000,
      alert: { serial: 1, action: "wait" },
    });
    const wait = "You can try again in 2 seconds.";
    expect(rendered()).toMatchObject({ status: wait, retry: wait });
    cleanup();
    await show({
      overlay: limited,
      now: 5000,
      alert: { serial: 1, action: "retry" },
    });
    expect(rendered()).toMatchObject({
      status: "available",
      retry: "available",
    });
  });

  it("CK-A-recovery another plan or conversation shown in the panel is a first appearance, not an update", async () => {
    const first = planView(base)!;
    const other = planView({ ...base, plan: recordOf(completed()) })!;
    const at = (conversationId: string, view: typeof first) =>
      wrap(
        <TestChat conversationId={conversationId}>
          <RecoveryPanel view={view} onPress={() => {}} />
        </TestChat>,
      );
    const said = () =>
      document.querySelector('[role="status"][aria-live="polite"]')
        ?.textContent ?? "";
    const screen = render(at("c", first));
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(said()).toBe("");
    screen.rerender(at("other", { ...other, planId: "another-plan" }));
    await waitFor(() =>
      expect(panel()?.textContent).toContain(
        text(other.status!.label.key, other.status!.label.values),
      ),
    );
    expect(said()).toBe("");
  });
  describe("the Keep sheet", () => {
    const sheetOf = (
      review: typeof forward | typeof retention,
      over: Partial<PlanViewInput> = {},
    ) => {
      const view = planView({ ...base, ...over })!;
      return {
        ...keepSheet(review, view),
        onProceed: vi.fn(),
        onCancel: vi.fn(),
      };
    };
    const dialog = () =>
      document.querySelector('[role="dialog"]') as HTMLElement;
    const proceed = () =>
      dialog().querySelector('[data-action="keep"]') as HTMLElement;
    it("CK-inv-K1 forward-only states what ends and what stays", async () => {
      const sheet = sheetOf(forward);
      await show({}, { sheet });
      await waitFor(() => expect(dialog()).not.toBeNull());
      expect(dialog().textContent).toContain(
        text("chat.recovery.confirmKeepForwardOnly"),
      );
      expect(dialog().textContent).toContain("1 planned step will not run.");
      fireEvent.click(proceed());
      expect(sheet.onProceed).toHaveBeenCalledTimes(1);
    });
    it("CK-R10-keep the open sheet closes once when the chat shows another conversation", async () => {
      const sheet = sheetOf(forward);
      const view = planView(base)!;
      const at = (conversationId: string) =>
        wrap(
          <TestChat conversationId={conversationId}>
            <RecoveryPanel view={view} onPress={() => {}} sheet={sheet} />
          </TestChat>,
        );
      const screen = render(at("c"));
      await waitFor(() => expect(dialog()).not.toBeNull());
      screen.rerender(at("other"));
      await waitFor(() => expect(dialog()).toBeNull());
      expect(sheet.onCancel).toHaveBeenCalledTimes(1);
      expect(sheet.onProceed).not.toHaveBeenCalled();
    });
    it("CK-inv-K2 end-retention states that no planned steps remain", async () => {
      await show({}, { sheet: sheetOf(retention) });
      await waitFor(() => expect(dialog()).not.toBeNull());
      expect(dialog().textContent).toContain(
        text("chat.recovery.confirmEndRetention"),
      );
    });
    it.each([
      [
        "K4a sealed while open",
        { plan: recordOf(sealedPlan()) },
        "alreadyKept",
      ],
      [
        "K4b another intent pending while open",
        { overlay: overlay("stop", "uncertain") },
        "intentPendingReason",
      ],
      [
        "K4c conversation unavailable",
        { conversationUnavailable: true },
        "refreshConversation",
      ],
    ] as const)(
      "CK-inv-%s: Proceed is described and inert",
      async (_, over, reason) => {
        const sheet = sheetOf(forward, over);
        await show(over, { sheet });
        await waitFor(() => expect(dialog()).not.toBeNull());
        expect(proceed().getAttribute("aria-disabled")).toBe("true");
        expect(
          document.getElementById(proceed().getAttribute("aria-describedby")!)
            ?.textContent,
        ).toBe(text(`chat.recovery.${reason}`));
        fireEvent.click(proceed());
        fireEvent.keyDown(proceed(), { key: "Enter" });
        expect(sheet.onProceed).not.toHaveBeenCalled();
      },
    );
    it("CK-inv-K-cancel Cancel closes without proceeding", async () => {
      const sheet = sheetOf(forward);
      await show({}, { sheet });
      await waitFor(() => expect(dialog()).not.toBeNull());
      const buttons = [...dialog().querySelectorAll("button")];
      fireEvent.click(
        buttons.find((button) => button.textContent === text("chat.cancel"))!,
      );
      expect(sheet.onCancel).toHaveBeenCalledTimes(1);
      expect(sheet.onProceed).not.toHaveBeenCalled();
    });
  });

  describe("legacy plans in the chat", () => {
    const legacy = (
      state: PlanRecord["state"],
      kind: "immediate" | "timed" = "immediate",
    ) => {
      const record = recordOf(stoppedReadback());
      return {
        ...record,
        state,
        recovery: undefined,
        plan: { ...record.plan, kind },
      } as unknown as PlanRecord;
    };
    const chat = async (plan: PlanRecord, extra: object = {}) => {
      const client = createWaypointClient(config());
      await client.ready;
      client.setPlan(plan);
      render(<WaypointChat client={client} {...skin} {...extra} />);
      await waitFor(() =>
        expect(document.querySelector("aside")).not.toBeNull(),
      );
      return client;
    };
    const issued = (expiresIn: number) => ({
      token: "t",
      expiresAt: new Date(Date.now() + expiresIn).toISOString(),
      planId: "p",
      // Issued for the conversation the client is in.
      conversationId: "conversation-a",
      revision: 1,
      heading: "Update 1 record in items",
      items: [],
      irreversible: false,
      undo: "Undoing this change is not available in this version.",
      verificationCount: 0,
    });
    it("CK-inv-AL1 an awaiting plan with the host's record has an available Confirm", async () => {
      const client = await chat({
        ...legacy("awaiting-confirmation"),
        confirmation: issued(600_000),
      } as PlanRecord);
      await waitFor(() => expect(rendered()).toEqual({ confirm: "available" }));
      client.dispose();
    });
    it("CK-inv-AL2a an expired record's Confirm is described and unavailable", async () => {
      const client = await chat({
        ...legacy("awaiting-confirmation", "timed"),
        confirmation: issued(-1),
      } as PlanRecord);
      await waitFor(() =>
        expect(rendered()).toEqual({
          confirm: text("chat.confirmation.expired"),
        }),
      );
      client.dispose();
    });
    it("CK-inv-AL2b a plan without a record has no Confirm and says why", async () => {
      const client = await chat(legacy("awaiting-confirmation"));
      await waitFor(() => expect(rendered()).toEqual({}));
      expect(document.querySelector("aside")!.textContent).toContain(
        text("chat.confirmation.unavailable"),
      );
      client.dispose();
    });
    it("CK-inv-AL3 a running plan has Stop only", async () => {
      const client = await chat(legacy("running"));
      expect(rendered()).toEqual({ stop: "available" });
      client.dispose();
    });
  });
});

describe("every part boundary on the chat", () => {
  const NO_DATA = [
    "transcript",
    "replyRow",
    "topBar",
    "rail",
    "flowTabs",
    "quotaStrip",
    "emptyState",
    "messageActions",
    "extraPanels",
    "actionBar",
    "fieldAdornment",
    "textarea",
  ];
  const KEYS: Record<string, string[][]> = {
    bubble: [["message"], ["pending"]],
    widgetFrame: [["block"]],
    stepRow: [["step"]],
    planNode: [["view"]],
    confirmBar: [["actions", "view"]],
    confirmation: [["confirmation"]],
    recoveryPanel: [["view"]],
    stepStatusRow: [["step"]],
    recoveryActions: [["actions"]],
    failedSendControls: [["pending"]],
    composer: [["sending"]],
    stepUpPrompt: [["stepUpCount"]],
  };
  it("CK-inv-P every data-bearing part receives only its allowlisted keys and no-data parts receive none", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      client.setPlan(await acceptedReadback(h));
      const seen: Record<string, unknown[]> = {};
      const capture = (name: string) => (props: PartProps) => {
        (seen[name] ??= []).push(props.data);
        return <>{props.children}</>;
      };
      render(
        <WaypointChat
          client={client}
          slots={Object.fromEntries(
            partNames.map((name) => [name, capture(name)]),
          )}
        />,
      );
      await waitFor(() =>
        expect(seen.recoveryPanel?.length).toBeGreaterThan(0),
      );
      await waitFor(() =>
        expect(seen.stepStatusRow?.length).toBeGreaterThan(0),
      );
      // The plan's steps render from their own chunk.
      await waitFor(() => expect(seen.stepRow?.length).toBeGreaterThan(0));
      for (const name of Object.keys(seen)) {
        if (NO_DATA.includes(name)) {
          expect([
            name,
            seen[name]!.every((data) => data === undefined),
          ]).toEqual([name, true]);
          continue;
        }
        expect(KEYS[name]).toBeDefined();
        for (const data of seen[name]!)
          if (data !== undefined)
            expect([
              name,
              KEYS[name]!.some(
                (keys) =>
                  keys.join() ===
                  Object.keys(data as object)
                    .sort()
                    .join(),
              ),
            ]).toEqual([name, true]);
      }
      const step = (seen.stepRow![0] as { step: object }).step;
      expect(Object.keys(step).sort()).toEqual([
        "id",
        "operation",
        "resource",
        "stepUp",
        "tier",
        "undo",
        "view",
      ]);
      const row = (seen.stepStatusRow![0] as { step: object }).step;
      expect(Object.keys(row).sort()).toEqual([
        "index",
        "resource",
        "stepId",
        "textKey",
        "truth",
      ]);
      expect(JSON.stringify(seen)).not.toMatch(
        /correlation|acknowledgment|"request"|fence|planningRead|executionId/,
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-inv-P9 failed-send controls receive the pending summary only", async () => {
    const client = createWaypointClient(
      config({
        transport: {
          ...config().transport,
          send: async () => {
            throw Object.assign(new Error("x"), { extra: "hidden" });
          },
        },
      }),
    );
    await client.ready;
    const seen: unknown[] = [];
    render(
      <WaypointChat
        client={client}
        slots={{
          failedSendControls: (props: PartProps) => {
            seen.push(props.data);
            return <>{props.children}</>;
          },
        }}
      />,
    );
    await client.setDraft("Queued");
    await client.send();
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const last = seen.at(-1) as { pending: Record<string, unknown> };
    expect(Object.keys(last)).toEqual(["pending"]);
    expect(Object.keys(last.pending).sort()).toEqual([
      "content",
      "failure",
      "id",
    ]);
    expect(Object.keys(last.pending.failure as object)).toEqual(["code"]);
    client.dispose();
  });
});
