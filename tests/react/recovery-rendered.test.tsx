// @vitest-environment jsdom
// Rendered checks of the recovery tables in both skins: what a user and a
// replacement part actually receive, not only the computed view.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  WaypointChat,
  WaypointProvider,
  RecoveryPanel,
  type PartProps,
} from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { planView, type PlanViewInput } from "../../src/react/plan-view";
import { english as baseMessages } from "../../src/react/i18n";
import { recoveryEnglish } from "../../src/react/recovery-messages";
import {
  createWaypointClient,
  type IntentOverlay,
} from "../../src/core/client";
import type { PlanRecord } from "../../src/protocol/generated";
import { config } from "../support/client";
import { acceptedReadback, protectedHost, until } from "../support/protected";
import {
  commit,
  completed,
  fresh,
  intent,
  noticeOf,
  recordOf,
  resolve,
  running,
  stoppedReadback,
} from "../support/host-plans";

afterEach(cleanup);
const english: Record<string, string> = { ...baseMessages, ...recoveryEnglish };
const text = (key: string, values: Record<string, string | number> = {}) =>
  Object.entries(values).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    english[`chat.recovery.${key}`] ?? english[key]!,
  );
const ALL = ["plan-recovery", "plan-leave", "plan-keep"];
const review = {
  review: "forward-only" as const,
  remaining: 1,
  acknowledgment: {} as never,
};
const base: PlanViewInput = {
  plan: recordOf(stoppedReadback()),
  capabilities: ALL,
  conversationUnavailable: false,
  overlay: undefined,
  notice: null,
  alert: null,
  keepReview: review,
  pending: [],
  now: 0,
  conversationId: "c",
};
const overlay = (extra: Partial<IntentOverlay>): IntentOverlay =>
  ({
    planId: "p",
    kind: "leave",
    request: {} as never,
    producer: "user",
    delivery: "uncertain",
    ownRun: false,
    ...extra,
  }) as IntentOverlay;
const fakeClient = () =>
  ({ subscribe: () => () => {}, getSnapshot: () => ({}) }) as never;
const sealedPlan = () => {
  const plan = stoppedReadback();
  return resolve(plan, intent(plan, "keep")).plan;
};
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
const control = (id: string) =>
  document.querySelector(`[data-action="${id}"]`) as HTMLElement | null;
const reasonOf = (element: HTMLElement) =>
  document.getElementById(element.getAttribute("aria-describedby") ?? "")
    ?.textContent;

describe.each(skins)("rendered recovery tables (%s)", (_, wrap) => {
  const show = async (over: Partial<PlanViewInput> = {}, onPress = vi.fn()) => {
    const view = planView({ ...base, ...over })!;
    const result = render(
      wrap(<RecoveryPanel view={view} onPress={onPress} />),
    );
    await waitFor(() => expect(panel()).not.toBeNull());
    return {
      onPress,
      update: async (next: Partial<PlanViewInput>) => {
        result.rerender(
          wrap(
            <RecoveryPanel
              view={planView({ ...base, ...next })!}
              onPress={onPress}
            />,
          ),
        );
      },
    };
  };

  it.each([
    ["S2 initial review", recordOf(fresh()), "initial-review", "heading"],
    [
      "S3 forward-active",
      recordOf(running()),
      "forward-active",
      "currentRunning",
    ],
    ["S4 readback", recordOf(stoppedReadback()), "readback", "heading"],
    ["S5 completed", recordOf(completed()), "completed", "statusCompleted"],
    [
      "S7 left-known after Keep, sealed (S10)",
      recordOf(sealedPlan()),
      "left-known",
      "keptKnown",
    ],
  ] as const)("CK-S-rendered %s", async (_, plan, status, label) => {
    await show({ plan });
    expect(panel()!.dataset.status).toBe(status);
    expect(panel()!.dataset.wireState).toBe(plan.state);
    expect(document.querySelector("h3")!.textContent).toBe(text(label));
  });

  it("CK-R-attr step rows carry data-status and the late-report marker", async () => {
    const plan = recordOf(stoppedReadback());
    await show({ plan });
    const rows = [
      ...document.querySelectorAll("li[data-status]"),
    ] as HTMLElement[];
    expect(rows.map((row) => row.dataset.status)).toEqual(
      plan.recovery!.steps!.map((step) => step.truth),
    );
    cleanup();
    const sealed = recordOf(sealedPlan());
    await show({
      plan: {
        ...sealed,
        recovery: { ...sealed.recovery!, contradictedAfterSeal: ["s1"] },
      } as PlanRecord,
    });
    const first = document.querySelector("li[data-status]") as HTMLElement;
    expect(first.dataset.late).toBe("contradicted");
    expect(first.textContent).toContain(text("reportedDifferently"));
  });

  it.each([
    ["omitted", undefined],
    ["empty", []],
  ])("CK-R5-rendered %s step evidence says not known yet", async (_, steps) => {
    const plan = recordOf(stoppedReadback());
    await show({
      plan: { ...plan, recovery: { ...plan.recovery!, steps } } as PlanRecord,
    });
    expect(document.querySelectorAll("li[data-status]")).toHaveLength(0);
    expect(panel()!.textContent).toContain(text("stepsNotKnownYet"));
  });

  it.each([
    [
      "A4 forward-active",
      {
        plan: recordOf(running()),
        keepReview: { disabled: "keepBlockedActive" },
      },
      { stop: null, leave: null, keep: "keepReasonActive" },
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
      "A7 completed",
      {
        plan: recordOf(completed()),
        keepReview: {
          review: "end-retention",
          remaining: 0,
          acknowledgment: {},
        },
      },
      { keep: null },
    ],
    [
      "A4b Leave without plan-leave",
      { capabilities: ["plan-recovery", "plan-keep"] },
      {
        leave: "capabilityMissing",
        keep: null,
        undoSelected: "notAvailableYet",
        continue: "notAvailableYet",
      },
    ],
  ] as const)(
    "CK-A-rendered %s renders exactly its controls and reasons",
    async (_, over, expected) => {
      await show(over as Partial<PlanViewInput>);
      const rendered = [
        ...document.querySelectorAll(
          "[data-part='recoveryActions'] [data-action]",
        ),
      ] as HTMLElement[];
      expect(
        Object.fromEntries(
          rendered.map((element) => [
            element.dataset.action,
            element.getAttribute("aria-disabled") === "true"
              ? "unavailable"
              : "available",
          ]),
        ),
      ).toEqual(
        Object.fromEntries(
          Object.entries(expected).map(([id, reason]) => [
            id,
            reason ? "unavailable" : "available",
          ]),
        ),
      );
      for (const [id, reason] of Object.entries(expected))
        if (reason) expect(reasonOf(control(id)!)).toBe(text(reason));
    },
  );

  it("CK-AM1-retry alert Retry is unavailable with the status check while the conversation is unavailable", async () => {
    const { onPress } = await show({
      conversationUnavailable: true,
      overlay: overlay({
        delivery: "not-sent",
        lastProblem: { key: "leaveNotSent", cause: "offline" },
      }),
      alert: { serial: 1, action: "retry" },
    });
    for (const id of ["retry", "status"]) {
      const element = control(id)!;
      expect(element.getAttribute("aria-disabled")).toBe("true");
      expect(reasonOf(element)).toBe(text("refreshConversation"));
      fireEvent.click(element);
      fireEvent.keyDown(element, { key: "Enter" });
      fireEvent.keyDown(element, { key: " " });
    }
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each([
    ["stop", recordOf(running()), "stopping"],
    ["cancel-initial", recordOf(fresh()), "cancelling"],
    ["leave", recordOf(stoppedReadback()), "leavePending"],
    ["keep", recordOf(stoppedReadback()), "keepPending"],
  ] as const)(
    "CK-I1-announced a %s that starts sending is announced politely",
    async (kind, plan, key) => {
      const { update } = await show({ plan });
      await update({ plan, overlay: overlay({ kind, delivery: "sending" }) });
      expect(document.querySelector('[role="status"]')!.textContent).toContain(
        text(key),
      );
    },
  );

  it.each([
    ["stop", recordOf(running()), "stopping"],
    ["cancel-initial", recordOf(fresh()), "cancelling"],
    ["leave", recordOf(stoppedReadback()), "leavePending"],
    ["keep", recordOf(stoppedReadback()), "keepPending"],
  ] as const)(
    "CK-I1-first a panel that first appears with a sending %s announces it once, politely, without moving focus",
    async (kind, plan, key) => {
      const before = document.activeElement;
      const sending = { plan, overlay: overlay({ kind, delivery: "sending" }) };
      const { update } = await show(sending);
      const live = () => document.querySelector('[role="status"]')!;
      await waitFor(() => expect(live().textContent).toBe(text(key)));
      const serial = live()
        .querySelector("[data-announcement]")!
        .getAttribute("data-announcement");
      await update(sending);
      expect(
        live()
          .querySelector("[data-announcement]")!
          .getAttribute("data-announcement"),
      ).toBe(serial);
      expect(document.activeElement).toBe(before);
    },
  );
  it("CK-I1-quiet a panel that first appears without a sending request announces nothing", async () => {
    await show();
    expect(document.querySelector('[role="status"]')!.textContent).toBe("");
  });
  it("CK-H-rendered a repeated Keep by the same caller claims no other window or device", async () => {
    const sealed = sealedPlan();
    const reply = resolve(
      sealed,
      intent(sealed, "keep", { capturedRound: 1 }),
    ).reply;
    const notice = noticeOf(reply);
    await show({ plan: recordOf(sealed), notice });
    const shown = document.querySelector("[data-notice]")?.textContent ?? "";
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).not.toMatch(/window|device|窗口|设备/);
  });

  it.each([
    [
      "first Keep",
      () => {
        const plan = stoppedReadback();
        return resolve(plan, intent(plan, "keep")).reply;
      },
      ["planClosedKept", "keptForwardClosed"],
    ],
    [
      "first Leave",
      () => {
        const plan = commit(commit(running(), "s1"), "s2");
        const halted = resolve(plan, intent(plan, "stop")).plan;
        return resolve(halted, intent(halted, "leave")).reply;
      },
      ["leftKnown"],
    ],
  ] as const)(
    "CK-H-rendered %s shows the host's own messages",
    async (_, make, keys) => {
      await show({ notice: noticeOf(make()) });
      for (const key of keys)
        expect(document.querySelector("[data-notice]")!.textContent).toContain(
          text(key),
        );
    },
  );
});

describe.each(skins)("the chat with a protected plan (%s)", (_, __, skin) => {
  it("CK-confirm-absent no Confirm control where the table has none", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      client.setPlan(await acceptedReadback(h));
      render(<WaypointChat client={client} {...skin} />);
      await waitFor(() => expect(panel()).not.toBeNull());
      expect(document.querySelector('[data-action="confirm"]')).toBeNull();
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-confirm-pending Confirm stays focusable, described and inert while a Cancel is pending", async () => {
    const h = await protectedHost();
    try {
      let hold!: () => void;
      const held = new Promise<void>((resolve) => (hold = resolve));
      const client = await h.open({
        intent: async (body) => {
          await held;
          return (await h.post(`/plans/${body.planId}/safety-control`, body))
            .body as never;
        },
      });
      render(<WaypointChat client={client} {...skin} />);
      await waitFor(() => expect(control("decline")).not.toBeNull());
      fireEvent.click(control("decline")!);
      await waitFor(() =>
        expect(control("confirm")!.getAttribute("aria-disabled")).toBe("true"),
      );
      const confirm = control("confirm")!;
      expect(confirm.hasAttribute("disabled")).toBe(false);
      expect(reasonOf(confirm)).toBe(text("intentPendingReason"));
      fireEvent.click(confirm);
      fireEvent.keyDown(confirm, { key: "Enter" });
      expect(
        h.calls.filter((call) => call.path.endsWith("/replies")),
      ).toHaveLength(0);
      hold();
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("messages and parts on the chat", () => {
  it("CK-role user, assistant and pending articles carry their role; bubble, composer and widget data are allowlisted", async () => {
    let fail!: (error: unknown) => void;
    const client = createWaypointClient(
      config({
        transport: {
          ...config().transport,
          read: async () =>
            ({
              protocol: "1.0",
              id: "conversation-a",
              title: "Chat",
              messages: [
                {
                  id: "m1",
                  role: "user",
                  content: "Hi",
                  blocks: [],
                  createdAt: 1,
                  secret: "x",
                },
                {
                  id: "m2",
                  role: "assistant",
                  content: "Hello",
                  createdAt: 2,
                  blocks: [
                    {
                      id: "b1",
                      type: "custom.thing",
                      body: { token: "t" },
                      hidden: "h",
                    },
                  ],
                },
              ],
            }) as never,
          send: () => new Promise((_, reject) => (fail = reject)),
        },
      }),
    );
    await client.ready;
    const seen: Record<string, unknown[]> = {};
    const capture = (name: string) => (props: PartProps) => {
      (seen[name] ??= []).push(props.data);
      return <>{props.children}</>;
    };
    render(
      <WaypointChat
        client={client}
        slots={{
          bubble: capture("bubble"),
          composer: capture("composer"),
          widgetFrame: capture("widgetFrame"),
        }}
      />,
    );
    await waitFor(() =>
      expect(
        document.querySelector('article[data-role="assistant"]'),
      ).not.toBeNull(),
    );
    await client.setDraft("Queued");
    void client.send();
    await waitFor(() =>
      expect(
        document.querySelector('article[data-role="pending"]'),
      ).not.toBeNull(),
    );
    expect(
      [...document.querySelectorAll("article[data-role]")].map((article) =>
        article.getAttribute("data-role"),
      ),
    ).toEqual(["user", "assistant", "pending"]);
    const json = JSON.stringify(seen);
    expect(json).not.toMatch(/secret|token|hidden/);
    expect(seen.widgetFrame!.at(-1)).toEqual({
      block: { id: "b1", type: "custom.thing", answered: false },
    });
    expect(
      seen.bubble!.some(
        (data) =>
          (data as { pending?: { content: string } })?.pending?.content ===
          "Queued",
      ),
    ).toBe(true);
    expect(seen.composer!.at(-1)).toEqual({ sending: true });
    fail(new Error("offline"));
    await until(() => client.getSnapshot().pending.some((row) => row.failure));
    await waitFor(() =>
      expect(
        seen.bubble!.some(
          (data) =>
            (data as { pending?: { failure: unknown } })?.pending?.failure,
        ),
      ).toBe(true),
    );
    client.dispose();
  });
});
