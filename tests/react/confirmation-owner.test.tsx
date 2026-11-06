// @vitest-environment jsdom
// A confirmation replaced in the same conversation is said once as changed;
// one shown for another conversation or client is a new confirmation.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import ConfirmationRecordView from "../../src/react/confirmation-view";
import { WaypointProvider } from "../../src/react/index";
import { addMessages, createFormatter } from "../../src/react/i18n";
import {
  confirmationEnglish,
  confirmationSimplifiedChinese,
} from "../../src/react/confirmation-messages";
import { createWaypointClient } from "../../src/core/client";
import type { ConfirmationRecord } from "../../src/protocol/generated";
import { config } from "../support/client";
import { TestChat } from "../support/chat-focus";

afterEach(cleanup);
addMessages(confirmationEnglish, confirmationSimplifiedChinese);
const changed = createFormatter("en")("chat.confirmation.changed" as never);
const record = (token: string, conversationId: string) =>
  ({
    token,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    planId: "plan-a",
    conversationId,
    revision: 1,
    heading: "Update 1 record in items",
    items: [{ label: "Item a: title", before: '"Before"', after: '"After"' }],
    irreversible: false,
    undo: "Undoing this change is not available in this version.",
  }) as unknown as ConfirmationRecord;

describe("CK-A-confirmation which confirmation a replacement belongs to", () => {
  const client = createWaypointClient(config());
  const at = (owner: string, token: string) => (
    <WaypointProvider client={client}>
      <TestChat conversationId={owner}>
        <ConfirmationRecordView
          record={record(token, owner)}
          planId="plan-a"
          onConfirm={() => {}}
          replaced={false}
        />
      </TestChat>
    </WaypointProvider>
  );
  it("a new record in the same conversation is said as changed", async () => {
    const view = render(at("c", "t1"));
    view.rerender(at("c", "t2"));
    await waitFor(() => expect(document.body.textContent).toContain(changed));
  });
  it("a record shown for another conversation is not a change", async () => {
    const view = render(at("c", "t1"));
    view.rerender(at("other", "t2"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.body.textContent).not.toContain(changed);
  });
});
