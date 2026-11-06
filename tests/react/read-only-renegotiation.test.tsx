// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/ui";
import type { PlanRecord } from "../../src/protocol/generated";
import { renegotiationHost } from "../support/renegotiation";
afterEach(cleanup);

const confirm = "Apply these changes";
const why =
  "Update the app to control this plan. Its recorded status is shown here.";

describe("the plan view across a renegotiation", () => {
  it("CK-W5-transition (c) offers no control while the fresh read is due, then offers it", async () => {
    const h = renegotiationHost({ recovery: false });
    await h.client.ready;
    h.client.setPlan(structuredClone(h.plan) as PlanRecord);
    render(<WaypointChat client={h.client} />);
    const plan = screen.getByRole("complementary");
    await within(plan).findByText(why);
    let release!: () => void;
    h.reads.hold = new Promise<void>((resolve) => (release = resolve));
    await h.renegotiate({ recovery: true });
    expect(h.client.getSnapshot().capabilities).toContain("plan-recovery");
    // The core refuses every control until the read passes: so does the view.
    expect(within(plan).getByText(why)).toBeDefined();
    expect(within(plan).queryAllByRole("button")).toEqual([]);
    release();
    await waitFor(() =>
      expect(within(plan).getByRole("button", { name: confirm })).toBeDefined(),
    );
    expect(within(plan).queryByText(why)).toBeNull();
    h.client.dispose();
  });
});
