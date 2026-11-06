// @vitest-environment jsdom
// A host that draws the plan itself, from `/hooks`, gets the text of every
// button, status and reason from the `/messages` formatter and the locale
// entry it imports: no web chat is mounted, and `/hooks` holds no strings.
import { it, expect, afterEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as hooks from "../../src/hooks/index";
import { usePlanView } from "../../src/hooks/index";
import type { WaypointClient } from "../../src/hooks/index";
import { createFormatter } from "../../src/messages/index";
import en from "../../src/messages/en";
import zhHans from "../../src/messages/zh-Hans";
import { createWaypointClient } from "../../src/core/client";
import type { PlanRecord } from "../../src/protocol/generated";
import {
  recoveryEnglish,
  recoverySimplifiedChinese,
} from "../../src/react/recovery-messages";
import {
  confirmationEnglish,
  confirmationSimplifiedChinese,
} from "../../src/react/confirmation-messages";
import {
  blockEnglish,
  blockSimplifiedChinese,
} from "../../src/react/block-messages";
import {
  problemEnglish,
  problemSimplifiedChinese,
} from "../../src/react/problem-messages";
import { english, simplifiedChinese } from "../../src/react/i18n";
import {
  replyEnglish,
  replySimplifiedChinese,
} from "../../src/react/reply-messages";
import { config } from "../support/client";
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const plan = {
  protocol: "1.0",
  id: "plan-a",
  state: "awaiting-confirmation",
  outcomes: [],
  confirmation: {
    token: "token-a",
    expiresAt: "2999-01-01T00:00:00Z",
    planId: "plan-a",
    conversationId: "conversation-a",
    revision: 1,
    heading: "Update one record",
    items: [],
    irreversible: false,
    undo: "Can be undone.",
    verificationCount: 0,
  },
  plan: {
    kind: "immediate",
    stage: "final",
    id: "plan-a",
    digest: "d",
    stepUpCount: 0,
    steps: [],
  },
} as unknown as PlanRecord;

function NativeLikePlan({ client }: { client: WaypointClient }) {
  const t = createFormatter("en", en);
  const { view } = usePlanView(client);
  if (!view) return null;
  return (
    <div>
      {view.actions.map((entry) => (
        <button key={entry.id} type="button">
          {t(entry.labelKey, entry.labelValues)}
        </button>
      ))}
    </div>
  );
}

it("/hooks holds keys, not strings or a formatter", () => {
  expect(hooks).not.toHaveProperty("createFormatter");
});

it("the plan's buttons have their text from /hooks, /messages and /messages/en", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  render(<NativeLikePlan client={client} />);
  act(() => client.setPlan(plan));
  const buttons = await screen.findAllByRole("button");
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect(button.textContent).not.toBe("");
  expect(buttons.map((button) => button.textContent)).toContain(
    "Apply these changes",
  );
  client.dispose();
});

it("each locale entry has the text of every key the plan view, cards and problems name", () => {
  const keys = (...catalogues: object[]) =>
    catalogues.flatMap((catalogue) => Object.keys(catalogue));
  const cases = [
    [
      "en",
      en,
      keys(
        english,
        recoveryEnglish,
        confirmationEnglish,
        blockEnglish,
        problemEnglish,
        replyEnglish,
      ),
    ],
    [
      "zh-Hans",
      zhHans,
      keys(
        simplifiedChinese,
        recoverySimplifiedChinese,
        confirmationSimplifiedChinese,
        blockSimplifiedChinese,
        problemSimplifiedChinese,
        replySimplifiedChinese,
      ),
    ],
  ] as const;
  for (const [locale, catalogue, all] of cases) {
    const t = createFormatter(locale, catalogue) as (
      key: string,
      values?: Record<string, unknown>,
    ) => string;
    // Any placeholder a message names gets a value.
    const values = new Proxy({}, { get: () => 1, has: () => true });
    const empty = all.filter((key) => t(key, values) === "");
    expect([locale, empty]).toEqual([locale, []]);
    expect(Object.isFrozen(catalogue)).toBe(true);
  }
});

it("a missing key fails loudly in development and is the key itself in production", () => {
  const t = createFormatter("en", {}) as (key: string) => string;
  vi.stubEnv("NODE_ENV", "development");
  expect(() => t("chat.stop")).toThrow(/chat\.stop/);
  vi.stubEnv("NODE_ENV", "production");
  expect(t("chat.stop")).toBe("chat.stop");
});

// Confirm's label: `labelKey` alone is the plain words, so a UI that passes
// no values keeps working; `countedLabelKey` with `labelValues` counts.
for (const [locale, catalogue, plain, counted] of [
  ["en", en, "Apply these changes", "Apply 2 changes"],
  ["zh-Hans", zhHans, "应用这些修改", "应用 2 项修改"],
] as const)
  it(`Confirm is named without labelValues, and counted with them (${locale})`, () => {
    const t = createFormatter(locale, catalogue);
    const two = {
      ...plan,
      confirmation: {
        ...plan.confirmation!,
        items: [
          { label: "Order 1043: status", before: "Waiting", after: "Ready" },
          { label: "Order 1044: note", before: "", after: "Refunded" },
        ],
      },
    } as PlanRecord;
    const view = hooks.planView({
      plan: two,
      conversationId: "conversation-a",
      capabilities: ["plans"],
      now: 0,
    } as never);
    const confirm = view!.actions.find((entry) => entry.id === "confirm")!;
    expect(t(confirm.labelKey)).toBe(plain);
    expect(t(confirm.countedLabelKey!, confirm.labelValues)).toBe(counted);
  });
