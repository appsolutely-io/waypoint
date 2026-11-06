// @vitest-environment jsdom
// A proposed plan shows each change once: the host's confirmation lists
// what will change, and the step list beside it does not list it again.
// Steps and fields are named by the host's labels, never by their internal
// names; without a label they get a neutral name.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { createWaypointClient } from "../../src/core/client";
import type { PlanRecord, PlanState } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

const record = (state: PlanState, confirmed: boolean) =>
  ({
    protocol: "1.0",
    id: "plan-a",
    state,
    outcomes: [],
    ...(confirmed && {
      confirmation: {
        token: "t",
        expiresAt: "2999-01-01T00:00:00Z",
        planId: "plan-a",
        conversationId: "conversation-a",
        revision: 1,
        heading: "Update 2 records",
        items: [
          { label: "Item a: title", before: "Quarterly plan", after: "Draft" },
          { label: "Item b: status", before: "open", after: "closed" },
        ],
        irreversible: false,
        undo: "You can undo these changes.",
        verificationCount: 0,
        actionLabel: "Apply 2 changes",
      },
    }),
    plan: {
      kind: "immediate",
      stage: "final",
      id: "plan-a",
      digest: "d",
      stepUpCount: 0,
      steps: ["a", "b"].map((row, index) => ({
        id: `step-${row}`,
        operation: "items.update",
        resource: "items",
        rows: [row],
        fields: [index ? "status" : "title"],
        view: `/items/${row}`,
        tier: "low",
        undo: "compare-and-set",
        stepUp: false,
        before: index ? { status: "open" } : { title: "Quarterly plan" },
        after: index ? { status: "closed" } : { title: "Draft" },
      })),
    },
  }) as unknown as PlanRecord;

async function show(plan: PlanRecord, extra: object) {
  const client = createWaypointClient(config());
  render(<WaypointChat client={client} {...extra} />);
  await act(async () => {
    await client.ready;
    client.setPlan(plan);
  });
  await waitFor(() =>
    expect(document.querySelectorAll('[data-part="stepRow"]')).toHaveLength(2),
  );
  return client;
}
const rows = () => [...document.querySelectorAll('[data-part="stepRow"]')];
const steps = () => rows().map((row) => row.textContent ?? "");
// The words of each text node apart, so adjacent elements never run
// together into one word.
const words = (row: Element) => {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  while (walker.nextNode())
    found.push(...(walker.currentNode.textContent!.match(/[A-Za-z]+/g) ?? []));
  return found;
};

describe.each([
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
] as const)("a plan's changes (%s)", (_, skin) => {
  it("with the confirmation shown, the steps do not list its changes again", async () => {
    const client = await show(record("awaiting-confirmation", true), skin);
    await waitFor(() =>
      expect(document.querySelector("[data-confirmation]")).not.toBeNull(),
    );
    for (const text of steps()) {
      expect(text).not.toContain("Quarterly plan");
      expect(text).not.toContain("closed");
    }
    const aside = document.querySelector("aside")!.textContent!;
    expect(aside.split("Quarterly plan")).toHaveLength(2);
    client.dispose();
  });
  it("steps and fields are named by the host's labels", async () => {
    const client = await show(record("running", false), {
      ...skin,
      planLabels: {
        resource: (resource: string) =>
          resource === "items" ? "Tasks" : undefined,
        field: (resource: string, field: string) =>
          resource === "items" && field === "title" ? "Title" : undefined,
      },
    });
    const [first, second] = rows();
    expect(words(first!)).toEqual(expect.arrayContaining(["Tasks", "Title"]));
    expect(first!.textContent).toContain("Quarterly plan");
    // No label for this field: a neutral name, not the internal one.
    expect(words(second!)).not.toContain("status");
    expect(words(first!)).not.toContain("items");
    client.dispose();
  });
  it("without labels no internal name is shown", async () => {
    const client = await show(record("running", false), skin);
    for (const row of rows())
      for (const name of ["items", "title", "status"])
        expect(words(row)).not.toContain(name);
    client.dispose();
  });
});
