// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { ConfirmSheet, WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
import type { PlanRecord } from "../../src/protocol/generated";
afterEach(cleanup);
it("requires explanatory text and prevents double confirmation while busy", () => {
  let calls = 0;
  const view = render(
    <ConfirmSheet
      title="Confirm"
      body="A recorded request will run"
      busy={true}
      onProceed={() => {
        calls++;
      }}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(calls).toBe(0);
  view.rerender(
    <ConfirmSheet
      title="Confirm"
      body="A recorded request will run"
      onProceed={() => {
        calls++;
      }}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(calls).toBe(1);
});
it("unknown capabilities hide controls; repeated failures replace the assertive content", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      negotiate: async () => ({ protocol: "1.0", capabilities: ["future"] }),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  expect(screen.queryByLabelText("Saved requests")).toBeNull();
  client.report({ id: "p", code: "refused" });
  await waitFor(() =>
    expect(screen.getByRole("alert").firstChild).not.toBeNull(),
  );
  const first = screen.getByRole("alert").firstChild;
  client.report({ id: "p", code: "refused" });
  await waitFor(() =>
    expect(screen.getByRole("alert").firstChild).not.toBe(first),
  );
  client.dispose();
});
it("a timed plan without the host's confirmation record has no Confirm and says why", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  client.setPlan({
    protocol: "1.0",
    id: "timed-a",
    state: "awaiting-confirmation",
    outcomes: [],
    plan: {
      kind: "timed",
      id: "timed-a",
      values: { a: { title: "After" } },
      start: "2026-12-01T00:00:00Z",
      end: "2026-12-02T00:00:00Z",
    },
  });
  render(<WaypointChat client={client} />);
  await waitFor(() =>
    expect(
      screen.getByText(
        "This plan can't be confirmed in this app. Ask the site administrator to update it.",
      ),
    ).toBeTruthy(),
  );
  expect(document.querySelector('[data-action="confirm"]')).toBeNull();
  client.dispose();
});
it("Stop does not pass the presentation event as a plan id", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "running";
  client.setPlan(record);
  const calls: unknown[][] = [];
  client.stopPlan = (...args) => {
    calls.push(args);
  };
  render(<WaypointChat client={client} />);
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(calls).toEqual([[]]);
  client.dispose();
});
