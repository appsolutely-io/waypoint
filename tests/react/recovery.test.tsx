// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  WaypointChat,
  WaypointProvider,
  RecoveryPanel,
  type PartProps,
} from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { TestChat, outsideTargets } from "../support/chat-focus";
import { deepActiveElement, keptOrigins } from "../../src/react/focus";
import { planView, type PlanViewInput } from "../../src/react/plan-view";
import { english as baseMessages } from "../../src/react/i18n";
import { recoveryEnglish } from "../../src/react/recovery-messages";

const english = { ...baseMessages, ...recoveryEnglish };
import type { IntentOverlay } from "../../src/core/client";
import type { PlanRecord } from "../../src/protocol/generated";
import { acceptedReadback, protectedHost, until } from "../support/protected";
import {
  recordOf,
  running,
  stoppedReadback,
  fresh,
} from "../support/host-plans";

afterEach(cleanup);
const en = (key: string, values: Record<string, string | number> = {}) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    english[key as keyof typeof english] as string,
  );
const base: PlanViewInput = {
  plan: recordOf(stoppedReadback()),
  capabilities: ["plan-recovery", "plan-leave", "plan-keep"],
  conversationUnavailable: false,
  overlay: undefined,
  notice: null,
  alert: null,
  keepReview: {
    review: "forward-only",
    remaining: 1,
    acknowledgment: {} as never,
  },
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

const skins: [string, (children: ReactNode) => ReactNode][] = [
  [
    "neutral",
    (children) => (
      <WaypointProvider client={fakeClient()}>
        <TestChat>{children}</TestChat>
      </WaypointProvider>
    ),
  ],
  [
    "antd",
    (children) => (
      <WaypointProvider client={fakeClient()} primitives={antdPrimitives}>
        <TestChat>{children}</TestChat>
      </WaypointProvider>
    ),
  ],
];

describe.each(skins)("the recovery panel (%s)", (_, wrap) => {
  const show = async (over: Partial<PlanViewInput> = {}, onPress = vi.fn()) => {
    const view = planView({ ...base, ...over })!;
    const result = render(
      wrap(<RecoveryPanel view={view} onPress={onPress} />),
    );
    // The panel is a lazy chunk.
    await waitFor(() => expect(panel()).not.toBeNull());
    return {
      ...result,
      onPress,
      view,
      update: (next: Partial<PlanViewInput>) =>
        result.rerender(
          wrap(
            <RecoveryPanel
              view={planView({ ...base, ...next })!}
              onPress={onPress}
            />,
          ),
        ),
    };
  };
  const panel = () =>
    document.querySelector("[data-wire-state]") as HTMLElement;
  const button = (id: string) =>
    document.querySelector(`[data-action="${id}"]`) as HTMLElement;

  it("CK-UI-panel carries the derived attributes and no intent attributes without an overlay", async () => {
    await show();
    expect(panel().dataset).toMatchObject({
      status: "readback",
      wireState: "needs-attention",
      attention: "true",
    });
    expect(panel().dataset.intentKind).toBeUndefined();
    cleanup();
    await show({ overlay: overlay({ delivery: "sending" }) });
    expect(panel().dataset).toMatchObject({
      status: "readback",
      intentKind: "leave",
      intentStatus: "sending",
    });
  });
  it("CK-UI-steps one row per step with its truth", async () => {
    await show();
    const rows = [
      ...document.querySelectorAll("li[data-status]"),
    ] as HTMLElement[];
    expect(rows.map((row) => row.dataset.status)).toEqual(
      base.plan!.recovery!.steps!.map((step) => step.truth),
    );
    // Named like the step list: never its link or its id.
    expect(rows[0]!.textContent).toContain(
      english["chat.stepName"].replace("{index}", "1"),
    );
    expect(rows[0]!.textContent).not.toContain("Update s1");
    expect(rows[0]!.textContent).not.toContain("s1:");
  });
  it("CK-AX an unavailable action is described and sends nothing by click, Enter or Space", async () => {
    const { onPress } = await show({
      capabilities: ["plan-recovery", "plan-keep"],
    });
    const leave = button("leave");
    expect(leave.getAttribute("aria-disabled")).toBe("true");
    expect(leave.hasAttribute("disabled")).toBe(false);
    const reason = document.getElementById(
      leave.getAttribute("aria-describedby")!,
    );
    expect(reason?.textContent).toBe(en("chat.recovery.capabilityMissing"));
    fireEvent.click(leave);
    fireEvent.keyDown(leave, { key: "Enter" });
    fireEvent.keyDown(leave, { key: " " });
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.click(button("keep"));
    expect(onPress).toHaveBeenCalledWith("keep");
  });
  it.each([
    ["stop", "chat.recovery.stopping", recordOf(running())],
    ["cancel-initial", "chat.recovery.cancelling", recordOf(fresh())],
    ["leave", "chat.recovery.leavePending", recordOf(stoppedReadback())],
    ["keep", "chat.recovery.keepPending", recordOf(stoppedReadback())],
  ] as const)(
    "CK-I1 a sending %s is described politely without moving focus",
    async (kind, key, plan) => {
      const before = document.activeElement;
      await show({ plan, overlay: overlay({ kind, delivery: "sending" }) });
      expect(document.querySelector("[data-intent-line]")?.textContent).toBe(
        en(key),
      );
      expect(document.activeElement).toBe(before);
    },
  );
  // A press on Leave in the panel, then its alert arrives: the move is the
  // answer to that press (R1).
  const pressLeave = async () => {
    const shown = await show();
    button("leave").focus();
    fireEvent.click(button("leave"));
    return shown;
  };
  const unconfirmed = () =>
    overlay({ lastProblem: { key: "leaveUnconfirmed", cause: "timeout" } });
  const statusAlert = (serial: number) => ({
    overlay: unconfirmed(),
    alert: { serial, action: "checkStatus" as const },
  });
  const heading = () => panel().querySelector("h3")!;
  // A press on the status check, then focus on the transcript (inside the
  // chat, outside the panel) when the alert arrives: R1 saves it.
  const pressThenTranscript = async (serial: number) => {
    const shown = await show({ overlay: unconfirmed() });
    button("status").focus();
    fireEvent.click(button("status"));
    const transcript = screen.getByTestId("transcript");
    transcript.focus();
    shown.update(statusAlert(serial));
    expect(document.activeElement).toBe(button("status"));
    return { ...shown, transcript };
  };
  it("CK-I3 (R1) an unconfirmed request pressed here focuses its status check once", async () => {
    const { update } = await pressLeave();
    update(statusAlert(1));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      en("chat.recovery.leaveUnconfirmed"),
    );
    expect(document.activeElement).toBe(button("status"));
    expect(document.activeElement?.textContent).toBe(
      en("chat.recovery.checkSavedChoice"),
    );
    (document.activeElement as HTMLElement).blur();
    update(statusAlert(1));
    expect(document.activeElement).toBe(document.body);
  });
  it("CK-I4 (R1) a request pressed here that was not sent focuses Retry", async () => {
    const { update, onPress } = await pressLeave();
    update({
      overlay: overlay({
        delivery: "not-sent",
        lastProblem: { key: "leaveNotSent", cause: "offline" },
      }),
      alert: { serial: 2, action: "retry" },
    });
    expect(document.activeElement).toBe(button("retry"));
    fireEvent.click(button("retry"));
    expect(onPress).toHaveBeenCalledWith("retry");
  });
  it.each([
    ["CK-I5 (R1) sign-in", "signIn", "chat.recovery.signInRequired"],
    ["CK-I6 (R1) host guidance", "hostGuidance", "chat.recovery.hostGuidance"],
  ] as const)("%s focuses its guidance text", async (_, action, key) => {
    const { update } = await pressLeave();
    update({
      overlay: overlay({
        delivery: "not-sent",
        lastProblem: { key: "leaveRefused", cause: "forbidden" },
      }),
      alert: { serial: 3, action },
    });
    expect(document.activeElement?.textContent).toBe(en(key));
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });
  it("CK-I7 (R1) waiting focuses a Retry that cannot be used before retryAt, and the status check waits too", async () => {
    const limited = overlay({
      delivery: "not-sent",
      retryAt: 4000,
      lastProblem: { key: "leaveNotSent", cause: "rate-limited" },
    });
    const { update, onPress } = await pressLeave();
    onPress.mockClear();
    update({
      overlay: limited,
      alert: { serial: 4, action: "wait" },
      now: 1000,
    });
    expect(document.activeElement).toBe(button("retry"));
    expect(button("retry").getAttribute("aria-disabled")).toBe("true");
    expect(button("status").getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(button("retry").getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("You can try again in 3 seconds.");
    fireEvent.click(button("retry"));
    fireEvent.click(button("status"));
    expect(onPress).not.toHaveBeenCalled();
  });
  it("CK-R1a an alert no press here answers moves no focus, though focus rests in the panel", async () => {
    const { update } = await show();
    heading().focus();
    update(statusAlert(11));
    expect(document.activeElement).toBe(heading());
  });
  it("CK-R1a-automatic an alert of another kind than the press moves no focus", async () => {
    const { update } = await pressLeave();
    heading().focus();
    update({
      overlay: overlay({
        kind: "stop",
        producer: "automatic",
        lastProblem: { key: "stopUnconfirmed", cause: "timeout" },
      }),
      alert: { serial: 12, action: "checkStatus" },
    });
    expect(document.activeElement).toBe(heading());
  });
  it("CK-R1a-invalidated a press whose focus left the chat before its alert moves no focus", async () => {
    const { update } = await pressLeave();
    const host = document.createElement("button");
    document.body.append(host);
    host.focus();
    heading().focus();
    update(statusAlert(13));
    expect(document.activeElement).toBe(heading());
    host.remove();
  });
  it.each(outsideTargets)(
    "CK-R2 an alert arriving while focus is on a %s moves no focus, and its actions stay reachable",
    async (_, focusOutside) => {
      const { update } = await pressLeave();
      const focused = focusOutside();
      update({
        overlay: overlay({
          delivery: "not-sent",
          lastProblem: { key: "leaveNotSent", cause: "offline" },
        }),
        alert: { serial: 14, action: "retry" },
      });
      expect(deepActiveElement(document)).toBe(focused);
      expect(button("retry").getAttribute("tabindex")).not.toBe("-1");
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        en("chat.retry"),
      );
    },
  );
  it("CK-R2-host-button (probe) a new alert with no press does not take focus from a host button", async () => {
    const host = document.createElement("button");
    document.body.append(host);
    host.focus();
    await show({
      overlay: overlay({
        delivery: "not-sent",
        lastProblem: { key: "leaveRefused", cause: "forbidden" },
      }),
      alert: { serial: 15, action: "signIn" },
    });
    expect(document.activeElement).toBe(host);
    host.remove();
  });
  it("CK-I8 (R3) the same alert changing from wait to retry moves no focus", async () => {
    const limited = overlay({
      delivery: "not-sent",
      retryAt: 4000,
      lastProblem: { key: "leaveNotSent", cause: "rate-limited" },
    });
    const { update } = await pressLeave();
    update({
      overlay: limited,
      alert: { serial: 5, action: "wait" },
      now: 1000,
    });
    (document.activeElement as HTMLElement).blur();
    update({
      overlay: limited,
      alert: { serial: 5, action: "retry" },
      now: 4000,
    });
    expect(document.activeElement).toBe(document.body);
    expect(button("retry").getAttribute("aria-disabled")).not.toBe("true");
  });
  it("CK-I9 (R3) an alert does not take focus from an editable field, even after a press", async () => {
    const result = render(
      wrap(
        <>
          <input aria-label="draft" />
          <RecoveryPanel view={planView({ ...base })!} onPress={() => {}} />
        </>,
      ),
    );
    await waitFor(() => expect(panel()).not.toBeNull());
    button("leave").focus();
    fireEvent.click(button("leave"));
    screen.getByLabelText("draft").focus();
    result.rerender(
      wrap(
        <>
          <input aria-label="draft" />
          <RecoveryPanel
            view={planView({ ...base, ...statusAlert(6) })!}
            onPress={() => {}}
          />
        </>,
      ),
    );
    expect(document.activeElement).toBe(screen.getByLabelText("draft"));
  });
  it("CK-I10a (R4) a resolved request returns focus to where it was, while focus is still on the alert's target", async () => {
    const { update, transcript } = await pressThenTranscript(7);
    update({ alert: { serial: 7, restoreFocus: true } });
    expect(document.activeElement).toBe(transcript);
  });
  it("CK-I10b (R4) with the previous element gone, focus goes to the panel heading, while focus is in the panel", async () => {
    const { update, transcript } = await pressThenTranscript(8);
    transcript.remove();
    update({ alert: { serial: 8, restoreFocus: true } });
    expect(document.activeElement?.tagName).toBe("H3");
  });
  it.each(outsideTargets)(
    "CK-R5 a resolved request after the user moved to a %s moves no focus",
    async (_, focusOutside) => {
      const { update } = await pressThenTranscript(9);
      const focused = focusOutside();
      update({ alert: { serial: 9, restoreFocus: true } });
      expect(deepActiveElement(document)).toBe(focused);
    },
  );
  it("CK-R5-host-input (probe) restoration after the user left for a host input, with the saved element gone, does not take focus into the heading", async () => {
    const { update, transcript } = await pressThenTranscript(16);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    transcript.remove();
    update({ alert: { serial: 16, restoreFocus: true } });
    expect(document.activeElement).toBe(input);
    input.remove();
  });
  it("CK-R5-inside a resolved request while focus is elsewhere in the chat, outside the panel, moves no focus", async () => {
    const { update } = await pressThenTranscript(10);
    const other = document.createElement("button");
    screen.getByTestId("chat").append(other);
    other.focus();
    update({ alert: { serial: 10, restoreFocus: true } });
    expect(document.activeElement).toBe(other);
  });
  it("CK-R4-moved a saved element moved out of the chat is not restored to; the heading is", async () => {
    const { update, transcript } = await pressThenTranscript(18);
    document.body.append(transcript);
    update({ alert: { serial: 18, restoreFocus: true } });
    expect(document.activeElement?.tagName).toBe("H3");
    transcript.remove();
  });
  it("CK-FU3 a panel removed, or showing another plan, after its alert move keeps no origin", async () => {
    const before = keptOrigins(document);
    const first = await pressLeave();
    first.update(statusAlert(40));
    expect(document.activeElement).toBe(button("status"));
    expect(keptOrigins(document)).toBeGreaterThan(before);
    first.rerender(wrap(<></>));
    expect(keptOrigins(document)).toBe(before);
    cleanup();
    const second = await pressLeave();
    second.update(statusAlert(41));
    expect(keptOrigins(document)).toBeGreaterThan(before);
    second.update({ plan: { ...base.plan!, id: "another-plan" } });
    expect(keptOrigins(document)).toBe(before);
  });
  it("CK-R1-once a press answers only its first alert", async () => {
    const { update } = await pressLeave();
    update(statusAlert(19));
    expect(document.activeElement).toBe(button("status"));
    heading().focus();
    update(statusAlert(20));
    expect(document.activeElement).toBe(heading());
  });
  it("CK-R1a-settled a press whose intent settled without an alert answers no later alert", async () => {
    const { update } = await pressLeave();
    update({ overlay: overlay({ delivery: "sending" }) });
    update({});
    heading().focus();
    update(statusAlert(21));
    expect(document.activeElement).toBe(heading());
  });
  it("CK-R5-never a resolved request whose alert moved no focus moves none", async () => {
    const { update } = await show();
    heading().focus();
    update(statusAlert(17));
    update({ alert: { serial: 17, restoreFocus: true } });
    expect(document.activeElement).toBe(heading());
  });
  it("CK-I11 another plan's overlay and alert are not rendered", async () => {
    await show({
      overlay: {
        ...overlay({
          lastProblem: { key: "leaveUnconfirmed", cause: "timeout" },
        }),
        planId: "other",
      },
      alert: { serial: 9, action: "checkStatus" },
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("");
    expect(button("status")).toBeNull();
  });
  it("CK-V1 a step status change is announced once, an unchanged render is not", async () => {
    const plan = recordOf(stoppedReadback());
    const { update } = await show({ plan });
    const live = () => document.querySelector('[role="status"]')!.textContent;
    expect(live()).toBe("");
    const changed = {
      ...plan,
      recovery: {
        ...plan.recovery!,
        steps: plan.recovery!.steps!.map((step) => ({
          ...step,
          truth: "done" as const,
        })),
      },
    } as PlanRecord;
    update({ plan: changed });
    expect(live()).toContain(en("chat.recovery.stepStatusChanged"));
    const first = document
      .querySelector('[role="status"] [data-announcement]')!
      .getAttribute("data-announcement");
    update({ plan: changed });
    expect(
      document
        .querySelector('[role="status"] [data-announcement]')!
        .getAttribute("data-announcement"),
    ).toBe(first);
  });
  it("CK-V3 a notice is announced with all its messages", async () => {
    const { update } = await show();
    update({
      notice: {
        planId: "p",
        keys: ["planClosedKept", "keptForwardClosed"],
      } as never,
    });
    const live = document.querySelector('[role="status"]')!.textContent!;
    expect(live).toContain(en("chat.recovery.planClosedKept"));
    expect(live).toContain(en("chat.recovery.keptForwardClosed"));
  });
  it("CK-V7 a newly reported evidence reason is announced", async () => {
    const plan = recordOf(stoppedReadback());
    const sealed = {
      ...plan,
      recovery: { ...plan.recovery!, phase: "left-known", sealed: true },
    } as PlanRecord;
    const { update } = await show({ plan: sealed });
    update({
      plan: {
        ...sealed,
        recovery: { ...sealed.recovery!, contradictedAfterSeal: ["s1"] },
      } as PlanRecord,
    });
    expect(document.querySelector('[role="status"]')!.textContent).toContain(
      en("chat.recovery.laterReportAfterKeep"),
    );
  });
});

describe("the recovery UI on a real client", () => {
  const keepBodies = (h: Awaited<ReturnType<typeof protectedHost>>) =>
    h.calls.filter(
      (call) =>
        call.path.endsWith("/safety-control") &&
        call.body &&
        JSON.parse(call.body).kind === "keep",
    );
  const ready = (client: { keepChangesReview(): unknown }) =>
    until(() => {
      const review = client.keepChangesReview() as { disabled?: string };
      return review.disabled !== "loading";
    });
  it("CK-K1 forward-only Keep says what ends and what stays; CK-K-cancel sends nothing", async () => {
    const h = await protectedHost();
    try {
      const record = await acceptedReadback(h);
      const client = await h.open();
      client.setPlan(record);
      await ready(client);
      render(<WaypointChat client={client} />);
      fireEvent.click(
        await screen.findByRole("button", {
          name: en("chat.recovery.keepChanges"),
        }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain(
        en("chat.recovery.confirmKeepForwardOnly"),
      );
      expect(dialog.textContent).toContain("1 planned step will not run.");
      fireEvent.click(screen.getByRole("button", { name: en("chat.cancel") }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(keepBodies(h)).toEqual([]);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-K3 Proceed sends the review captured at opening, even after a newer record", async () => {
    const h = await protectedHost();
    try {
      const record = await acceptedReadback(h);
      const client = await h.open();
      client.setPlan(record);
      await ready(client);
      const captured = client.keepChangesReview() as { acknowledgment: object };
      render(<WaypointChat client={client} />);
      fireEvent.click(
        await screen.findByRole("button", {
          name: en("chat.recovery.keepChanges"),
        }),
      );
      await screen.findByRole("dialog");
      act(() =>
        client.setPlan({
          ...record,
          recovery: {
            ...record.recovery!,
            revision: record.recovery!.revision + 1,
            versions: {
              ...record.recovery!.versions,
              evidence: record.recovery!.versions.evidence + 1,
            },
          },
        }),
      );
      // The newer record would give a different review.
      expect(
        (client.keepChangesReview() as { acknowledgment: object })
          .acknowledgment,
      ).not.toEqual(captured.acknowledgment);
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: en("chat.recovery.keepChanges"),
        }),
      );
      await until(() => keepBodies(h).length === 1);
      expect(JSON.parse(keepBodies(h)[0]!.body!).acknowledgment).toEqual(
        captured.acknowledgment,
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-C3 a double Confirm sends one reply", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      render(<WaypointChat client={client} />);
      await waitFor(() =>
        expect(
          document.querySelector('[data-action="confirm"]'),
        ).not.toBeNull(),
      );
      const confirm = document.querySelector('[data-action="confirm"]')!;
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      await until(() => h.calls.some((call) => call.path.endsWith("/replies")));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(
        h.calls.filter(
          (call) =>
            call.path.endsWith("/replies") &&
            JSON.parse(call.body!).kind === "confirm",
        ),
      ).toHaveLength(1);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-V5 a stopped report for a protected plan does not add the generic stopped alert", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      render(<WaypointChat client={client} />);
      act(() => client.report({ code: "stopped", id: "plan-p" }));
      expect(screen.queryByText(en("chat.stopped"))).toBeNull();
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-role and part data: messages carry their role; parts get the allowlisted data", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      const seen: Record<string, unknown> = {};
      const capture = (name: string) => (props: PartProps) => {
        seen[name] = props.data;
        return <>{props.children}</>;
      };
      render(
        <WaypointChat
          client={client}
          slots={{
            recoveryPanel: capture("recoveryPanel"),
            recoveryActions: capture("recoveryActions"),
            confirmBar: capture("confirmBar"),
            planNode: capture("planNode"),
            stepRow: capture("stepRow"),
          }}
        />,
      );
      await waitFor(() => expect(seen.recoveryPanel).toBeDefined());
      // The plan's steps render from their own chunk.
      await waitFor(() => expect(seen.stepRow).toBeDefined());
      expect(Object.keys(seen.recoveryPanel as object)).toEqual(["view"]);
      expect(Object.keys(seen.recoveryActions as object)).toEqual(["actions"]);
      expect(Object.keys(seen.confirmBar as object).sort()).toEqual([
        "actions",
        "view",
      ]);
      const step = (seen.stepRow as { step: object }).step;
      expect(Object.keys(step).sort()).toEqual([
        "id",
        "operation",
        "resource",
        "stepUp",
        "tier",
        "undo",
        "view",
      ]);
      expect(JSON.stringify(seen)).not.toMatch(
        /correlation|acknowledgment|"request"|fence|planningRead/,
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("a Stop pressed before the intent chunk loads", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("CK-AM3s-ui keeps Confirm pending through the client's reservation and sends one Stop", async () => {
    const h = await protectedHost();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      vi.resetModules();
      vi.doMock("../../src/core/intent", async () => {
        await gate;
        return vi.importActual("../../src/core/intent");
      });
      const { createWaypointClient } = await import("../../src/core/client");
      const { createSseTransport } = await import("../../src/core/transports");
      const react = await import("../../src/react/index");
      const { platform } = await import("../support/client");
      const intents: string[] = [];
      const client = createWaypointClient({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: createSseTransport(h.request, { subscribe: () => () => {} }),
        plans: {
          read: () => h.read(),
          heartbeat: async () => {},
          request: async () => {},
          intent: async (body) => {
            intents.push(body.kind);
            return (await h.post(`/plans/${body.planId}/safety-control`, body))
              .body as never;
          },
        },
      });
      await client.ready;
      client.setPlan(await h.read());
      render(<react.WaypointChat client={client} />);
      const stop = await screen.findByRole("button", { name: en("chat.stop") });
      fireEvent.click(stop);
      await waitFor(() =>
        expect(
          document
            .querySelector('[data-action="confirm"]')!
            .getAttribute("aria-disabled"),
        ).toBe("true"),
      );
      expect(intents).toEqual([]);
      release();
      await until(() => intents.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(intents).toEqual(["stop"]);
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

it("CK-UI-steps a step row takes the host's label, numbered", async () => {
  const view = planView(base)!;
  render(
    <WaypointProvider
      client={fakeClient()}
      planLabels={{
        resource: (resource) =>
          resource.startsWith("/items/") ? "Tasks" : undefined,
      }}
    >
      <TestChat>
        <RecoveryPanel view={view} onPress={vi.fn()} />
      </TestChat>
    </WaypointProvider>,
  );
  await waitFor(() =>
    expect(document.querySelectorAll("li[data-status]").length).toBe(2),
  );
  const rows = [...document.querySelectorAll("li[data-status]")];
  expect(rows[0]!.textContent).toContain("Tasks 1");
  expect(rows[1]!.textContent).toContain("Tasks 2");
});
