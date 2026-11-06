// @vitest-environment jsdom
import { it, expect } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
import type { PlanRecord } from "../../src/protocol/generated";
it("a changed plan explains the refusal and offers fresh confirmation", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  client.setPlan(record);
  client.report({ code: "plan-changed", id: record.id });
  try {
    const view = render(<WaypointChat client={client} />);
    expect(view.getByRole("alert").textContent).toBe(
      "The plan changed; confirm again.",
    );
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-action="confirm"]'),
      ).not.toBeNull(),
    );
    const confirm = view.container.querySelector('[data-action="confirm"]')!;
    expect(confirm.getAttribute("aria-disabled")).toBeNull();
  } finally {
    cleanup();
    client.dispose();
  }
});
