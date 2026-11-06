// @vitest-environment jsdom
// The host-issued confirmation in the chat, in both skins: the record shown
// verbatim, the one action that sends its token, the host's refusals, and
// the per-problem text.
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
import { WaypointChat, type PartProps } from "../../src/react/index";
import { defaultProblemText } from "../../src/react/ui";
import { antdPrimitives } from "../../src/skin-antd/index";
import { addMessages, createFormatter } from "../../src/react/i18n";
import {
  confirmationEnglish,
  confirmationSimplifiedChinese,
} from "../../src/react/confirmation-messages";
import {
  problemEnglish,
  problemSimplifiedChinese,
} from "../../src/react/problem-messages";
import {
  ConversationReadError,
  createWaypointClient,
} from "../../src/core/client";
import type {
  ConfirmationRecord,
  PlanRecord,
  Problem,
  Reply,
} from "../../src/protocol/generated";
import samples from "../protocol/samples.json";
import { config } from "../support/client";
import { protectedHost, until } from "../support/protected";
import { outsideTargets } from "../support/chat-focus";
import { deepActiveElement } from "../../src/react/focus";
import userEvent from "@testing-library/user-event";
import { createSseTransport } from "../../src/core/transports";
import { platform } from "../support/client";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
addMessages(confirmationEnglish, confirmationSimplifiedChinese);
addMessages(problemEnglish, problemSimplifiedChinese);
const en = createFormatter("en");
const zh = createFormatter("zh-CN");
// A key without a message would make every text check vacuous.
const t = (key: string, values?: Record<string, string | number>) => {
  const text = en(key as never, values);
  if (!text) throw new Error(`no message for ${key}`);
  return text;
};
const later = () => new Date(Date.now() + 600_000).toISOString();
const confirmation = (
  over: Partial<ConfirmationRecord> = {},
): ConfirmationRecord => ({
  ...(structuredClone(samples.ConfirmationRecord) as ConfirmationRecord),
  expiresAt: later(),
  ...over,
});
const awaiting = (
  over: Partial<ConfirmationRecord> | null = {},
): PlanRecord => {
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  if (over === null) delete record.confirmation;
  else record.confirmation = confirmation(over);
  return record;
};
const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
async function chat(
  plan: PlanRecord | null,
  skin: object,
  answer: (reply: Reply) => unknown = () => ({ id: "x" }),
  extra: object = {},
) {
  const sent: Reply[] = [];
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        sent.push(reply);
        const result = await answer(reply);
        if ((result as { code?: string })?.code) throw result;
        return result as never;
      },
    },
  });
  await client.ready;
  if (plan) client.setPlan(plan);
  render(<WaypointChat client={client} {...skin} {...extra} />);
  return { client, sent };
}
const region = () =>
  document.querySelector("[data-confirmation]") as HTMLElement | null;
const apply = () =>
  (region()?.querySelector('[data-action="confirm"]') ??
    null) as HTMLElement | null;

describe.each(skins)("the host's confirmation (%s)", (_, skin) => {
  it("CK-V1 shows every field of the record in order, with the expiry", async () => {
    const record = confirmation({
      heading: "Update 2 records in Products",
      items: [
        {
          label: "Product 7: price",
          before: "€10.00",
          after: "€12.50",
          note: "Rounded by the shop",
        },
        { label: "Product 9: title", after: "“Lamp”" },
      ],
      schedule: {
        start: "2026-12-01T10:30:00.000Z",
        end: null,
        startText: "1 Dec 2026, 10:30 UTC",
        endText: "No end date",
      },
      irreversible: true,
      undo: "This cannot be undone here.",
      verificationCount: 2,
      actionLabel: "Schedule 2 changes",
    });
    await chat(awaiting(record), skin);
    await waitFor(() => expect(region()).not.toBeNull());
    const text = region()!.textContent!;
    const order = [
      "Update 2 records in Products",
      "Product 7: price",
      "€10.00",
      "€12.50",
      "Rounded by the shop",
      "Product 9: title",
      "“Lamp”",
      "1 Dec 2026, 10:30 UTC",
      "No end date",
      t("chat.confirmation.irreversible"),
      "This cannot be undone here.",
      t("chat.confirmation.verifications", { count: 2 }),
    ];
    let at = -1;
    for (const part of order) {
      const index = text.indexOf(part, at + 1);
      expect([part, index > at]).toEqual([part, true]);
      at = index;
    }
    expect(
      region()!.querySelector("[data-expires]")?.getAttribute("datetime"),
    ).toBe(record.expiresAt);
    expect(apply()!.textContent).toBe("Schedule 2 changes");
  });
  // A tag Intl refuses (extended language, grandfathered, malformed) still
  // shows the expiry, dated under the locale Intl accepts for it.
  it.each(["zh-cmn-Hans-CN", "zh-guoyu", "zh_SG", "x-private"])(
    "the expiry is dated under the locale %s",
    async (locale) => {
      await chat(awaiting(), skin, undefined, { locale });
      await waitFor(() => expect(region()).not.toBeNull());
      expect(
        region()!.querySelector("[data-expires]")?.textContent,
      ).toBeTruthy();
    },
  );
  it("CK-V1b a record without verifications says nothing about them", async () => {
    await chat(awaiting({ verificationCount: 0 }), skin);
    await waitFor(() => expect(region()).not.toBeNull());
    expect(region()!.textContent).not.toContain(
      t("chat.confirmation.verifications", { count: 0 }),
    );
  });
  it("CK-V2 hostile host text stays text", async () => {
    await chat(
      awaiting({
        heading: "<img src=x onerror=alert(1)>",
        items: [{ label: "<b>x</b>", after: "<script>1</script>" }],
      }),
      skin,
    );
    await waitFor(() => expect(region()).not.toBeNull());
    expect(region()!.querySelector("img, script, b")).toBeNull();
    expect(region()!.textContent).toContain("<img src=x onerror=alert(1)>");
  });
  it("CK-V3 a long list is expandable, never cut", async () => {
    const items = Array.from({ length: 14 }, (_, index) => ({
      label: `Row ${index + 1}`,
      after: String(index),
    }));
    await chat(awaiting({ items }), skin);
    await waitFor(() => expect(region()).not.toBeNull());
    const more = within(region()!).getByRole("button", {
      name: t("chat.confirmation.showAll", { count: 14 }),
    });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(region()!.textContent).not.toContain("Row 14");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(more.getAttribute("aria-controls")!)?.textContent,
    ).toContain("Row 14");
  });
  it("CK-V4 custom parts get the record as part data, unchanged", async () => {
    const seen: unknown[] = [];
    const record = awaiting();
    await chat(record, skin, undefined, {
      slots: {
        confirmation: (props: PartProps) => {
          seen.push(props.data);
          return <>{props.children}</>;
        },
      },
    });
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect((seen.at(-1) as { confirmation: unknown }).confirmation).toEqual(
      record.confirmation,
    );
  });
  it("CK-V5 the host's wording is shown unchanged", async () => {
    await chat(
      awaiting({
        items: [{ label: "odd  spacing", before: "1,0000", after: "TRUE" }],
      }),
      skin,
    );
    await waitFor(() => expect(region()).not.toBeNull());
    const values = [...region()!.querySelectorAll("dd")].map(
      (element) => element.textContent,
    );
    expect(values).toEqual(["1,0000", "TRUE"]);
  });
  it("CK-V-absent CK-A3 a plan without a record has no Apply or Schedule and says what to do", async () => {
    const { client, sent } = await chat(awaiting(null), skin);
    await waitFor(() =>
      expect(
        screen.getByText(t("chat.confirmation.unavailable")),
      ).not.toBeNull(),
    );
    expect(document.querySelector('[data-action="confirm"]')).toBeNull();
    await client.confirmPlan();
    expect(sent).toEqual([]);
  });
  it("CK-A1 Apply sends the record's token, named by the host", async () => {
    const { sent } = await chat(awaiting(), skin);
    await waitFor(() => expect(apply()).not.toBeNull());
    expect(apply()!.textContent).toBe("Apply 1 change");
    fireEvent.click(apply()!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      kind: "confirm",
      confirmationToken: "confirmation-token",
    });
  });
  it("CK-A1b without a host label the action has the client's name", async () => {
    await chat(awaiting({ actionLabel: undefined }), skin);
    await waitFor(() => expect(apply()).not.toBeNull());
    expect(apply()!.textContent).toBe(t("chat.confirmation.apply"));
  });
  it("CK-A2 CK-sched-same a scheduled record uses the same token path", async () => {
    const record = awaiting({
      actionLabel: undefined,
      schedule: {
        start: null,
        end: null,
        startText: "When you confirm",
        endText: "No end date",
      },
    });
    record.plan = structuredClone(samples.TimedPlan) as PlanRecord["plan"];
    const { sent } = await chat(record, skin);
    await waitFor(() => expect(apply()).not.toBeNull());
    expect(apply()!.textContent).toBe(t("chat.confirmation.schedule"));
    fireEvent.click(apply()!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      kind: "confirm",
      confirmationToken: "confirmation-token",
    });
    expect(
      document.querySelector('input[type="datetime-local"], .ant-picker'),
    ).toBeNull();
  });
  it("CK-A4 CK-expiry the action becomes unavailable at its expiry without a press", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { client, sent } = await chat(awaiting(), skin);
    await vi.waitFor(() => expect(apply()).not.toBeNull());
    // Set once the record is shown, since waiting moves the fake clock, and
    // shorter than any other timer in the chat, so only the expiry itself
    // can re-render the view.
    act(() =>
      client.setPlan(
        awaiting({ expiresAt: new Date(Date.now() + 200).toISOString() }),
      ),
    );
    expect(apply()!.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => {
      vi.advanceTimersByTime(199);
    });
    expect(apply()!.getAttribute("aria-disabled")).not.toBe("true");
    // Only the expiry's own timer is due in this window.
    await act(async () => {
      vi.advanceTimersByTime(3);
    });
    expect(apply()!.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(apply()!.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe(t("chat.confirmation.expired"));
    fireEvent.click(apply()!);
    expect(sent).toEqual([]);
  });
  it("CK-A5 a double press sends one confirmation", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { sent } = await chat(awaiting(), skin, async () => {
      await held;
      return { id: "x" };
    });
    await waitFor(() => expect(apply()).not.toBeNull());
    const user = userEvent.setup();
    apply()!.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(sent).toHaveLength(1));
    await user.keyboard("{Enter}");
    fireEvent.click(apply()!);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);
  });
  it("CK-A6 a legacy plan has no Cancel (the protocol has no decline reply for it)", async () => {
    await chat(awaiting(), skin);
    await waitFor(() => expect(apply()).not.toBeNull());
    expect(document.querySelector('[data-action="decline"]')).toBeNull();
  });
  it("CK-R2 a plan replaced after it was shown sends nothing and asks for a new review", async () => {
    const { client, sent } = await chat(awaiting(), skin);
    await waitFor(() => expect(apply()).not.toBeNull());
    const button = apply()!;
    // The replacement is adopted before the shown confirmation re-renders.
    act(() => {
      client.setPlan(awaiting({ token: "newer-token", revision: 3 }));
      fireEvent.click(button);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent).toEqual([]);
    await waitFor(() =>
      expect(region()!.textContent).toContain(t("chat.confirmation.changed")),
    );
  });
  it("CK-R1 the press sends the rendered record's token at once", async () => {
    const { client, sent } = await chat(awaiting(), skin);
    await waitFor(() => expect(apply()).not.toBeNull());
    act(() => {
      fireEvent.click(apply()!);
      // A replacement right after the press (R4) cannot change what was sent.
      client.setPlan(awaiting({ token: "newer-token", revision: 3 }));
    });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ confirmationToken: "confirmation-token" });
  });
  it("CK-R3 another plan shown at the press sends nothing", async () => {
    const { client, sent } = await chat(awaiting(), skin);
    await waitFor(() => expect(apply()).not.toBeNull());
    const button = apply()!;
    act(() => {
      const other = awaiting({ planId: "plan-b", token: "other-token" });
      other.id = "plan-b";
      client.setPlan(other);
      fireEvent.click(button);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent).toEqual([]);
  });
  it.each([
    ["expired", "chat.confirmation.expired"],
    ["used", "chat.confirmation.used"],
    ["stale", "chat.confirmation.changed"],
    ["mismatch", "chat.confirmation.mismatch"],
    ["missing", "chat.problem.refused"],
  ] as const)(
    "CK-H-%s a %s refusal is shown with its next step",
    async (reason, key) => {
      await chat(awaiting(), skin, () => ({
        code: "refused",
        id: "r",
        confirmation: { reason },
      }));
      await waitFor(() => expect(apply()).not.toBeNull());
      fireEvent.click(apply()!);
      await waitFor(() => expect(region()!.textContent).toContain(t(key)));
      if (reason !== "expired" && reason !== "missing")
        expect(
          within(region()!).getByRole("button", {
            name: t("chat.confirmation.refresh"),
          }),
        ).toBeTruthy();
      else
        expect(
          within(region()!).queryByRole("button", {
            name: t("chat.confirmation.refresh"),
          }),
        ).toBeNull();
      // The refusal is said once, with the confirmation, not in the chat alert.
      expect(document.querySelector("main [role=alert]")!.textContent).toBe("");
    },
  );
  it("CK-H-late a refusal for a confirmation that is no longer shown is not shown", async () => {
    let refuse!: () => void;
    const answer = new Promise<void>((resolve) => (refuse = resolve));
    const { client } = await chat(awaiting(), skin, async () => {
      await answer;
      return { code: "refused", id: "r", confirmation: { reason: "used" } };
    });
    await waitFor(() => expect(apply()).not.toBeNull());
    fireEvent.click(apply()!);
    act(() => client.setPlan(awaiting({ token: "newer-token" })));
    refuse();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(region()!.textContent).not.toContain(t("chat.confirmation.used"));
  });
  it("CK-X1 CK-X2 the confirmation is a named region; each item has visible Before and After labels", async () => {
    await chat(awaiting(), skin);
    await waitFor(() => expect(region()).not.toBeNull());
    const heading = region()!.querySelector("h3")!;
    expect(heading.textContent).toBe(t("chat.confirmation.heading"));
    expect(region()!.getAttribute("aria-labelledby")).toBe(heading.id);
    const described = region()!
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((ref) => document.getElementById(ref)?.textContent ?? "")
      .join(" ");
    expect(described).toContain("Update 1 record in items");
    expect(
      [...region()!.querySelectorAll("dt")].map(
        (element) => element.textContent,
      ),
    ).toEqual([t("chat.confirmation.before"), t("chat.confirmation.after")]);
  });
  it("CK-X5 the confirmation does not take focus when it appears", async () => {
    await chat(awaiting(), skin);
    await waitFor(() => expect(region()).not.toBeNull());
    expect(region()!.contains(document.activeElement)).toBe(false);
  });
});

describe.each(skins)("problem text and startup (%s)", (_, skin) => {
  const problem = async (value: Problem, extra: object = {}) => {
    const { client } = await chat(null, skin, undefined, extra);
    act(() => client.report(value));
    return client;
  };
  it.each([
    ["sign-in", "chat.problem.signIn", null],
    ["retryable", "chat.problem.retryable", "chat.retry"],
    ["rate-limited", "chat.problem.rateLimited", "chat.retry"],
    ["refused", "chat.problem.refused", null],
    ["closed", "chat.problem.closed", null],
    ["full", "chat.problem.full", null],
    ["declined", "chat.problem.declined", null],
    ["unavailable", "chat.problem.unavailable", "chat.retry"],
    ["step-up-cancelled", "chat.problem.stepUp", null],
    ["invalid-read", "chat.problem.invalid", null],
    ["invalid-plan", "chat.problem.invalid", null],
    ["plan-changed", "chat.planChanged", null],
    ["update-required", "chat.update", null],
    ["mismatch", "chat.problem.mismatch", null],
    ["agreement-expired", "chat.problem.agreement", "chat.retry"],
    ["in-doubt", "chat.problem.inDoubt", null],
    ["replaced", "chat.problem.replaced", "chat.confirmation.refresh"],
    ["needs-attention", "chat.problem.needsAttention", null],
    ["stopped", "chat.stopped", null],
  ] as const)(
    "CK-P %s shows its text and its one action",
    async (code, key, action) => {
      await problem({ code, id: "x" });
      const alert = screen.getByRole("alert");
      await waitFor(() => expect(alert.textContent).toContain(t(key)));
      const buttons = within(alert).queryAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual(
        action ? [t(action)] : [],
      );
    },
  );
  it("CK-P-loading until the problem messages load, a problem reads as the generic failure", () => {
    const loading = ((key: string) =>
      key === "chat.failure" ? t("chat.failure") : "") as never;
    expect(defaultProblemText({ code: "closed", id: "x" }, loading).text).toBe(
      t("chat.failure"),
    );
  });
  it("CK-P-rate a rate-limited problem waits before Retry", async () => {
    await problem({ code: "rate-limited", id: "x", retryAfter: 3 });
    const alert = screen.getByRole("alert");
    await waitFor(() =>
      expect(alert.textContent).toContain(t("chat.problem.rateLimited")),
    );
    const retry = within(alert).getByRole("button", { name: t("chat.retry") });
    expect(retry.getAttribute("aria-disabled")).toBe("true");
  });
  it("CK-P1 a host override wins for any code", async () => {
    await problem(
      { code: "refused", id: "x" },
      {
        problemText: () => ({
          text: "Ask your shop admin.",
          action: <button>Open help</button>,
        }),
      },
    );
    const alert = screen.getByRole("alert");
    await waitFor(() =>
      expect(alert.textContent).toContain("Ask your shop admin."),
    );
    expect(
      within(alert).getByRole("button", { name: "Open help" }),
    ).toBeTruthy();
    expect(alert.textContent).not.toContain(t("chat.problem.refused"));
  });
  it("CK-S1 a conversation still loading says so", async () => {
    const base = config();
    let finish!: () => void;
    const reading = new Promise<void>((resolve) => (finish = resolve));
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (...args) => {
          await reading;
          return base.transport.read(...args);
        },
      },
    });
    render(<WaypointChat client={client} {...skin} />);
    await waitFor(() =>
      expect(screen.getByText(t("chat.startupLoading"))).toBeTruthy(),
    );
    finish();
    await waitFor(() =>
      expect(screen.queryByText(t("chat.startupLoading"))).toBeNull(),
    );
  });
  it.each([404, 410])(
    "CK-P0b a %s read shows only the missing-conversation message and Reload",
    async (status) => {
      const base = config();
      const client = createWaypointClient({
        ...base,
        transport: {
          ...base.transport,
          read: async (id) => {
            throw new ConversationReadError(id, status);
          },
        },
      });
      render(<WaypointChat client={client} {...skin} />);
      const alert = () => document.querySelector("main [role=alert]")!;
      await waitFor(() =>
        expect(alert().textContent).toContain(
          t("chat.conversationUnavailable"),
        ),
      );
      expect(alert().textContent).not.toContain(t("chat.problem.unavailable"));
      expect(
        within(alert() as HTMLElement)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual([t("chat.reload")]);
      expect(screen.queryByText(t("chat.startupLoading"))).toBeNull();
      client.dispose();
    },
  );
});

const status = () =>
  region()!.querySelector("[role=status]")!.textContent ?? "";
const refusal = (reason: string) => ({
  code: "refused",
  id: "r",
  confirmation: { reason },
});
describe.each(skins)(
  "whose confirmation, which attempt, and how it is announced (%s)",
  (_, skin) => {
    it.each([
      ["another conversation", { conversationId: "conversation-b" }],
      ["another plan", { planId: "plan-b" }],
    ])(
      "CK-R3-identity a record issued for %s is not shown and sends nothing",
      async (_, over) => {
        const { sent } = await chat(awaiting(over), skin);
        await waitFor(() =>
          expect(region()!.textContent).toContain(
            t("chat.confirmation.unavailable"),
          ),
        );
        expect(apply()).toBeNull();
        expect(region()!.textContent).not.toContain("Update 1 record in items");
        expect(sent).toEqual([]);
      },
    );
    it("CK-R1-identity the press sends only while the shown record is bound to the current conversation", async () => {
      const { client, sent } = await chat(awaiting(), skin);
      await waitFor(() => expect(apply()).not.toBeNull());
      const button = apply()!;
      // The record moves to another conversation between render and press.
      const moved = awaiting({ conversationId: "conversation-b" });
      vi.spyOn(client, "getSnapshot").mockReturnValue({
        ...client.getSnapshot(),
        plan: moved,
      });
      fireEvent.click(button);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sent).toEqual([]);
    });
    it("CK-H-attempt an earlier refusal is never shown for a newly pressed confirmation", async () => {
      let release!: () => void;
      const { client, sent } = await chat(awaiting(), skin, async () => {
        if (sent.length === 1) return refusal("used");
        await new Promise<void>((resolve) => (release = resolve));
        return { id: "x" };
      });
      await waitFor(() => expect(apply()).not.toBeNull());
      fireEvent.click(apply()!);
      await waitFor(() =>
        expect(status()).toContain(t("chat.confirmation.used")),
      );
      act(() => client.setPlan(awaiting({ token: "token-b" })));
      await waitFor(() =>
        expect(apply()!.getAttribute("aria-busy")).toBeNull(),
      );
      fireEvent.click(apply()!);
      await waitFor(() => expect(sent).toHaveLength(2));
      expect(region()!.textContent).not.toContain(t("chat.confirmation.used"));
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(region()!.textContent).not.toContain(t("chat.confirmation.used"));
    });
    it("CK-H-attempt-own a newly pressed confirmation shows its own refusal", async () => {
      const { client, sent } = await chat(awaiting(), skin, async () =>
        sent.length === 1 ? refusal("used") : refusal("stale"),
      );
      await waitFor(() => expect(apply()).not.toBeNull());
      fireEvent.click(apply()!);
      await waitFor(() =>
        expect(status()).toContain(t("chat.confirmation.used")),
      );
      act(() => client.setPlan(awaiting({ token: "token-b" })));
      await waitFor(() =>
        expect(apply()!.getAttribute("aria-busy")).toBeNull(),
      );
      fireEvent.click(apply()!);
      await waitFor(() =>
        expect(status()).toContain(t("chat.confirmation.changed")),
      );
      expect(status()).not.toContain(t("chat.confirmation.used"));
    });
    it.each(["used", "stale", "expired"])(
      "CK-P1-typed a host override wins for a %s refusal, shown once with its action",
      async (reason) => {
        await chat(awaiting(), skin, () => refusal(reason), {
          problemText: () => ({
            text: "Contact the shop admin now.",
            action: <button>Open help</button>,
          }),
        });
        await waitFor(() => expect(apply()).not.toBeNull());
        fireEvent.click(apply()!);
        await waitFor(() =>
          expect(region()!.textContent).toContain(
            "Contact the shop admin now.",
          ),
        );
        expect(
          within(region()!).getByRole("button", { name: "Open help" }),
        ).toBeTruthy();
        for (const key of [
          "chat.confirmation.used",
          "chat.confirmation.changed",
          "chat.confirmation.expired",
        ])
          expect(status()).not.toContain(t(key));
        expect(
          document.body.textContent!.split("Contact the shop admin now.")
            .length,
        ).toBe(2);
      },
    );
    it("CK-P-rate-reply a refused reply's wait holds Retry until it ends", async () => {
      await chat(awaiting(), skin, () => ({
        code: "rate-limited",
        id: "r",
        retryAfter: 1,
      }));
      await waitFor(() => expect(apply()).not.toBeNull());
      fireEvent.click(apply()!);
      const alert = screen.getByRole("alert");
      const retry = await within(alert).findByRole("button", {
        name: t("chat.retry"),
      });
      expect(retry.getAttribute("aria-disabled")).toBe("true");
      await waitFor(
        () =>
          expect(
            within(alert)
              .getByRole("button", { name: t("chat.retry") })
              .getAttribute("aria-disabled"),
          ).toBeNull(),
        { timeout: 3000 },
      );
    });
    it("CK-P-rate-clock a wait whose timer fires before the wall clock reaches its end still ends", async () => {
      const { client } = await chat(null, skin);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        act(() =>
          client.report({ code: "rate-limited", id: "w", retryAfter: 1 }),
        );
        const alert = screen.getByRole("alert");
        const retry = () =>
          within(alert).getByRole("button", { name: t("chat.retry") });
        expect(retry().getAttribute("aria-disabled")).toBe("true");
        // Timers run on a monotonic clock, Date on the wall clock: here the
        // wall clock reads a little behind when the timer fires.
        vi.setSystemTime(Date.now() - 5);
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
        await act(async () => {
          vi.advanceTimersByTime(50);
        });
        expect(retry().getAttribute("aria-disabled")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
    it("CK-P-rate-new each received problem sets its own wait", async () => {
      const { client } = await chat(null, skin);
      act(() => client.report({ code: "rate-limited", id: "a" }));
      const alert = screen.getByRole("alert");
      const retry = () =>
        within(alert).getByRole("button", { name: t("chat.retry") });
      await waitFor(() =>
        expect(retry().getAttribute("aria-disabled")).toBeNull(),
      );
      act(() =>
        client.report({ code: "rate-limited", id: "b", retryAfter: 30 }),
      );
      await waitFor(() =>
        expect(retry().getAttribute("aria-disabled")).toBe("true"),
      );
    });
    it.each(["resolves", "rejects"] as const)(
      "CK-S3 a startup Retry is busy and inert while its refresh runs, and free again when it %s",
      async (outcome) => {
        const base = config();
        const client = createWaypointClient({
          ...base,
          transport: {
            ...base.transport,
            negotiate: async () => {
              throw new TypeError("offline");
            },
          },
        });
        render(<WaypointChat client={client} {...skin} />);
        const alert = screen.getByRole("alert");
        const retry = () =>
          within(alert).getByRole("button", { name: t("chat.retry") });
        await waitFor(() => expect(retry()).toBeTruthy(), { timeout: 3000 });
        let settle!: () => void;
        const refresh = vi.spyOn(client, "refresh").mockImplementation(
          () =>
            new Promise((resolve, reject) => {
              settle = () =>
                outcome === "resolves"
                  ? resolve({
                      kind: "unavailable",
                      conversationId: "x",
                    } as never)
                  : reject(new Error("offline"));
            }),
        );
        const pressed = retry();
        fireEvent.click(pressed);
        expect(retry().getAttribute("aria-busy")).toBe("true");
        expect(retry().getAttribute("aria-disabled")).toBe("true");
        fireEvent.click(retry());
        expect(refresh).toHaveBeenCalledTimes(1);
        await act(async () => settle());
        await waitFor(() =>
          expect(retry().getAttribute("aria-busy")).toBeNull(),
        );
        expect(retry().getAttribute("aria-disabled")).toBeNull();
        // The same button, freed by its own settlement, not a new one.
        expect(retry()).toBe(pressed);
        client.dispose();
      },
    );
    it("CK-S3-reload Reload is busy and inert while its refresh runs", async () => {
      const base = config();
      const client = createWaypointClient({
        ...base,
        transport: {
          ...base.transport,
          read: async (id) => {
            throw new ConversationReadError(id, 404);
          },
        },
      });
      render(<WaypointChat client={client} {...skin} />);
      const alert = () => document.querySelector("main [role=alert]")!;
      const reload = () =>
        within(alert() as HTMLElement).getByRole("button", {
          name: t("chat.reload"),
        });
      await waitFor(() => expect(reload()).toBeTruthy());
      let settle!: () => void;
      const refresh = vi.spyOn(client, "refresh").mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = () => resolve({ kind: "missing" } as never);
          }),
      );
      const pressed = reload();
      fireEvent.click(pressed);
      expect(reload().getAttribute("aria-busy")).toBe("true");
      expect(reload().getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(reload());
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => settle());
      await waitFor(() =>
        expect(reload().getAttribute("aria-busy")).toBeNull(),
      );
      expect(reload()).toBe(pressed);
      client.dispose();
    });
    it("CK-H-refresh a refusal's Refresh is busy and inert while its refresh runs", async () => {
      const { client } = await chat(awaiting(), skin, () => refusal("used"));
      await waitFor(() => expect(apply()).not.toBeNull());
      fireEvent.click(apply()!);
      const button = () =>
        within(region()!).getByRole("button", {
          name: t("chat.confirmation.refresh"),
        });
      await waitFor(() => expect(button()).toBeTruthy());
      let settle!: () => void;
      const refresh = vi.spyOn(client, "refresh").mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = () => resolve({ kind: "missing" } as never);
          }),
      );
      fireEvent.click(button());
      expect(button().getAttribute("aria-busy")).toBe("true");
      fireEvent.click(button());
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => settle());
      await waitFor(() =>
        expect(button().getAttribute("aria-busy")).toBeNull(),
      );
    });
    it("CK-H-overlap another confirmation's refusal is never shown for the attempt pressed here", async () => {
      let release!: () => void;
      const { client } = await chat(awaiting(), skin, async (reply) => {
        if (reply.clientReplyId === "unrelated") return refusal("used");
        await new Promise<void>((resolve) => (release = resolve));
        return { id: "x" };
      });
      await waitFor(() => expect(apply()).not.toBeNull());
      fireEvent.click(apply()!);
      await until(() => release !== undefined);
      await act(async () => {
        await client.reply({
          kind: "confirm",
          clientReplyId: "unrelated",
          planId: "plan-a",
          confirmationToken: "confirmation-token",
        } as never);
      });
      await act(async () => release());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(client.getSnapshot().problem?.id).toBe("unrelated");
      expect(status()).not.toContain(t("chat.confirmation.used"));
    });
    it("CK-H-overlap-after a later reply's refusal does not replace this attempt's own", async () => {
      const { client } = await chat(awaiting(), skin, (reply) =>
        reply.clientReplyId === "unrelated"
          ? refusal("stale")
          : refusal("used"),
      );
      await waitFor(() => expect(apply()).not.toBeNull());
      fireEvent.click(apply()!);
      await waitFor(() =>
        expect(status()).toContain(t("chat.confirmation.used")),
      );
      await act(async () => {
        await client.reply({
          kind: "confirm",
          clientReplyId: "unrelated",
          planId: "plan-a",
          confirmationToken: "confirmation-token",
        } as never);
      });
      expect(client.getSnapshot().problem?.id).toBe("unrelated");
      expect(status()).not.toContain(t("chat.confirmation.changed"));
    });
    it("CK-S3-remount a new problem during a Retry keeps it busy and reserved", async () => {
      const { client } = await chat(null, skin);
      act(() => client.report({ code: "unavailable", id: "a" }));
      const alert = screen.getByRole("alert");
      const retry = () =>
        within(alert).getByRole("button", { name: t("chat.retry") });
      await waitFor(() => expect(retry()).toBeTruthy());
      let settle!: () => void;
      const refresh = vi.spyOn(client, "refresh").mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = () => resolve({ kind: "missing" } as never);
          }),
      );
      const user = userEvent.setup();
      retry().focus();
      await user.keyboard("{Enter}");
      act(() => client.report({ code: "unavailable", id: "b" }));
      await waitFor(() =>
        expect(retry().getAttribute("aria-busy")).toBe("true"),
      );
      fireEvent.click(retry());
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => settle());
      await waitFor(() => expect(retry().getAttribute("aria-busy")).toBeNull());
    });
    it("CK-X6-replace a record replaced or removed without a press is announced once", async () => {
      const { client } = await chat(awaiting(), skin);
      await waitFor(() => expect(apply()).not.toBeNull());
      expect(status()).toBe("");
      act(() =>
        client.setPlan(
          awaiting({ token: "token-b", heading: "Update 3 records in items" }),
        ),
      );
      await waitFor(() =>
        expect(status()).toContain(t("chat.confirmation.changed")),
      );
      // An unrelated update does not announce it again.
      act(() => client.report({ code: "closed", id: "x" }));
      expect(status().split(t("chat.confirmation.changed")).length).toBe(2);
      act(() => client.setPlan(awaiting(null)));
      await waitFor(() =>
        expect(status()).toContain(t("chat.confirmation.changed")),
      );
    });
    it("CK-P-rate-read-render a refused read holds Retry until the host's wait ends", async () => {
      const base = config();
      let failRead = false;
      const client = createWaypointClient({
        ...base,
        transport: {
          ...base.transport,
          read: async (...args) => {
            if (failRead)
              throw new ConversationReadError("conversation-a", 429, {
                code: "rate-limited",
                id: "host",
                retryAfter: 1,
              });
            return base.transport.read(...args);
          },
        },
      });
      render(<WaypointChat client={client} {...skin} />);
      await client.ready;
      failRead = true;
      await act(async () => {
        await client.refresh();
      });
      const alert = screen.getByRole("alert");
      const retry = await within(alert).findByRole("button", {
        name: t("chat.retry"),
      });
      expect(retry.getAttribute("aria-disabled")).toBe("true");
      await waitFor(
        () =>
          expect(
            within(alert)
              .getByRole("button", { name: t("chat.retry") })
              .getAttribute("aria-disabled"),
          ).toBeNull(),
        { timeout: 3000 },
      );
      client.dispose();
    });
    it("CK-V4-exact the confirmation part gets exactly the record; the confirm bar gets no record", async () => {
      const seen: Record<string, unknown> = {};
      const capture = (name: string) => (props: PartProps) => {
        seen[name] = props.data;
        return <>{props.children}</>;
      };
      const record = awaiting();
      await chat(record, skin, undefined, {
        slots: {
          confirmation: capture("confirmation"),
          confirmBar: capture("confirmBar"),
        },
      });
      await waitFor(() => expect(seen.confirmation).toBeDefined());
      expect(seen.confirmation).toEqual({ confirmation: record.confirmation });
      expect(Object.keys(seen.confirmBar as object).sort()).toEqual([
        "actions",
        "view",
      ]);
    });
    it("CK-X5-replace a replaced record keeps focus on Apply; a removed one moves it to the heading", async () => {
      const { client } = await chat(awaiting(), skin);
      await waitFor(() => expect(apply()).not.toBeNull());
      apply()!.focus();
      act(() => client.setPlan(awaiting({ token: "token-b" })));
      expect(document.activeElement).toBe(apply());
      act(() => client.setPlan(awaiting(null)));
      await waitFor(() =>
        expect(document.activeElement).toBe(region()!.querySelector("h3")),
      );
      expect(region()!.textContent).toContain(
        t("chat.confirmation.unavailable"),
      );
    });
    it.each(outsideTargets)(
      "CK-C3 a record removed after focus moved from Apply to a %s moves no focus",
      async (_, focusOutside) => {
        const { client } = await chat(awaiting(), skin);
        await waitFor(() => expect(apply()).not.toBeNull());
        apply()!.focus();
        const focused = focusOutside();
        act(() => client.setPlan(awaiting(null)));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(deepActiveElement(document)).toBe(focused);
      },
    );
    it("CK-C3-host-body (probe) a record removed after focus moved from Apply to a focused host body moves no focus", async () => {
      const { client } = await chat(awaiting(), skin);
      await waitFor(() => expect(apply()).not.toBeNull());
      apply()!.focus();
      document.body.tabIndex = -1;
      document.body.focus();
      act(() => client.setPlan(awaiting(null)));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.activeElement).toBe(document.body);
      expect(region()!.contains(document.activeElement)).toBe(false);
      document.body.removeAttribute("tabindex");
    });
    it("CK-C3-chat a record removed after focus moved to another chat control moves no focus", async () => {
      const { client } = await chat(awaiting(), skin);
      await waitFor(() => expect(apply()).not.toBeNull());
      apply()!.focus();
      const composer = screen.getByRole("textbox", { name: "Message" });
      composer.focus();
      act(() => client.setPlan(awaiting(null)));
      expect(document.activeElement).toBe(composer);
    });
    it("CK-C3-plan Apply removed because another plan is shown moves no focus into the confirmation", async () => {
      const { client } = await chat(awaiting(), skin);
      await waitFor(() => expect(apply()).not.toBeNull());
      apply()!.focus();
      const other = awaiting(null);
      other.id = "plan-other";
      act(() => client.setPlan(other));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(region()?.contains(document.activeElement) ?? false).toBe(false);
    });
    it("CK-X6-expiry an expiry by the clock is announced in the confirmation's status", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const { client } = await chat(awaiting(), skin);
      await vi.waitFor(() => expect(apply()).not.toBeNull());
      act(() =>
        client.setPlan(
          awaiting({ expiresAt: new Date(Date.now() + 200).toISOString() }),
        ),
      );
      expect(status()).toBe("");
      await act(async () => {
        vi.advanceTimersByTime(202);
      });
      expect(status()).toContain(t("chat.confirmation.expired"));
    });
    it("CK-X3-keys the list disclosure opens with Enter and closes with Space", async () => {
      const items = Array.from({ length: 12 }, (_, index) => ({
        label: `Item ${index}: title`,
        after: `"${index}"`,
      }));
      await chat(awaiting({ items }), skin);
      const toggle = await waitFor(() => {
        const found = region()!.querySelector("[aria-expanded]");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      const user = userEvent.setup();
      toggle.focus();
      await user.keyboard("{Enter}");
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(region()!.textContent).toContain("Item 11: title");
      await user.keyboard(" ");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(region()!.textContent).not.toContain("Item 11: title");
    });
  },
);

describe("client messages in both languages", () => {
  it("CK-L every confirmation and problem key reads in English and natural Chinese", () => {
    for (const key of [
      "heading",
      "apply",
      "schedule",
      "unavailable",
      "expired",
      "used",
      "changed",
      "mismatch",
      "irreversible",
      "before",
      "after",
      "refresh",
    ])
      expect([key, zh(`chat.confirmation.${key}` as never)]).toEqual([
        key,
        expect.stringMatching(/[一-鿿]/),
      ]);
    expect(
      zh("chat.confirmation.verifications" as never, { count: 2 }),
    ).toContain("2");
    expect(
      en("chat.confirmation.verifications" as never, { count: 1 }),
    ).toMatch(/1 verification\b/);
    expect(zh("chat.confirmation.used" as never)).toContain("检查");
  });
});
// The reference host's own records, rendered.
describe("the reference host's record in the chat", () => {
  it("CK-M1-render after a lost acceptance the retry says used with Refresh, never applied, and Refresh reads the plan's factual state", async () => {
    const h = await protectedHost(["a"]);
    try {
      let drop = true;
      const lossy: typeof h.request = async (path, init) => {
        const result = await h.request(path, init);
        if (path.endsWith("/replies") && drop) {
          drop = false;
          throw new Error("connection lost after the host committed");
        }
        return result;
      };
      const steps: string[] = [];
      const client = createWaypointClient({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: createSseTransport(lossy, { subscribe: () => () => {} }),
        plans: {
          read: () => h.read(),
          heartbeat: async () => {},
          request: async (canonical) => {
            steps.push(canonical.path);
          },
          intent: async (body) =>
            (await h.post(`/plans/${body.planId}/safety-control`, body))
              .body as never,
        },
      });
      await client.ready;
      client.setPlan(await h.read());
      render(<WaypointChat client={client} />);
      await waitFor(() => expect(apply()).not.toBeNull());
      fireEvent.click(apply()!);
      await until(
        async () => (await h.read()).recovery?.phase === "forward-active",
      );
      await waitFor(() =>
        expect(apply()?.getAttribute("aria-busy")).toBeNull(),
      );
      fireEvent.click(apply()!);
      await waitFor(() =>
        expect(status()).toContain(t("chat.confirmation.used")),
      );
      expect(region()!.textContent).not.toContain(t("chat.failure"));
      fireEvent.click(
        within(region()!).getByRole("button", {
          name: t("chat.confirmation.refresh"),
        }),
      );
      await waitFor(() => expect(region()).toBeNull());
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("forward-active");
      // The recovery panel is its own chunk: wait for it, not for the
      // confirmation to go.
      await waitFor(() =>
        expect(
          document.querySelector('[data-part="recoveryPanel"]'),
        ).not.toBeNull(),
      );
      expect(steps).toEqual([]);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-I-render the protected host's record renders and confirms through its token", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      render(<WaypointChat client={client} />);
      await waitFor(() => expect(apply()).not.toBeNull());
      expect(region()!.textContent).toContain("Update 2 records in items");
      fireEvent.click(apply()!);
      await until(
        async () => (await h.read()).recovery?.phase === "forward-active",
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("the confirmation inside a shadow root", () => {
  it("CK-C2-shadow removing the focused Apply hands focus to the heading inside the shadow tree", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    shadow.append(container);
    const client = createWaypointClient(config());
    await client.ready;
    client.setPlan(awaiting());
    render(<WaypointChat client={client} />, { container });
    const inShadow = () =>
      shadow.querySelector<HTMLElement>(
        '[data-confirmation] [data-action="confirm"]',
      );
    await waitFor(() => expect(inShadow()).not.toBeNull());
    inShadow()!.focus();
    expect(deepActiveElement(document)).toBe(inShadow());
    act(() => client.setPlan(awaiting(null)));
    await waitFor(() =>
      expect(deepActiveElement(document)).toBe(
        shadow.querySelector("[data-confirmation] h3"),
      ),
    );
    client.dispose();
    host.remove();
  });
});
