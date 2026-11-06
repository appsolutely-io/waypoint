// @vitest-environment jsdom
// A host that draws the plan itself, from `/hooks` alone, gets the text of
// every button, status and reason: no web chat is mounted, and no chunk of
// it registers the messages first.
import { it, expect, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createFormatter, usePlanView } from "../../src/hooks/index";
import type { WaypointClient } from "../../src/hooks/index";
import { createWaypointClient } from "../../src/core/client";
import type { PlanRecord } from "../../src/protocol/generated";
import { recoveryEnglish } from "../../src/react/recovery-messages";
import { confirmationEnglish } from "../../src/react/confirmation-messages";
import { blockEnglish } from "../../src/react/block-messages";
import { problemEnglish } from "../../src/react/problem-messages";
import { formEnglish } from "../../src/react/form-messages";
import { english } from "../../src/react/i18n";
import { config } from "../support/client";
afterEach(cleanup);

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
  const t = createFormatter("en");
  const { view } = usePlanView(client);
  if (!view) return null;
  return (
    <div>
      {view.actions.map((entry) => (
        <button key={entry.id} type="button">
          {t(entry.labelKey)}
        </button>
      ))}
    </div>
  );
}

it("the plan's buttons have their text with nothing but /hooks", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  render(<NativeLikePlan client={client} />);
  act(() => client.setPlan(plan));
  const buttons = await screen.findAllByRole("button");
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect(button.textContent).not.toBe("");
  expect(buttons.map((button) => button.textContent)).toContain(
    confirmationEnglish["chat.confirmation.apply"],
  );
  client.dispose();
});

it("every message the plan view, cards and problems name has text, in both languages", () => {
  const keys = [
    ...Object.keys(english),
    ...Object.keys(recoveryEnglish),
    ...Object.keys(confirmationEnglish),
    ...Object.keys(blockEnglish),
    ...Object.keys(problemEnglish),
    ...Object.keys(formEnglish),
  ];
  for (const locale of ["en", "zh-CN"]) {
    const t = createFormatter(locale) as (
      key: string,
      values?: Record<string, unknown>,
    ) => string;
    // Any placeholder a message names gets a value.
    const values = new Proxy({}, { get: () => 1, has: () => true });
    const empty = keys.filter((key) => t(key, values) === "");
    expect([locale, empty]).toEqual([locale, []]);
  }
});
