import { describe, expect, it } from "vitest";
import type { PlanRecord } from "../../src/protocol/generated";
import { flush } from "../support/client";
import { renegotiationHost as host } from "../support/renegotiation";

describe("controls across a renegotiation", () => {
  it("CK-W5-transition (b) an agreement without plan recovery makes the plan read-only", async () => {
    const h = host({ recovery: true });
    await h.client.ready;
    h.client.setPlan(structuredClone(h.plan) as PlanRecord);
    await h.renegotiate({ recovery: false });
    expect(h.client.getSnapshot().capabilities).not.toContain("plan-recovery");
    expect(h.client.getSnapshot().planReadOnly).toBe(true);
    await h.client.confirmPlan();
    await flush();
    expect(h.sends).not.toContain("confirm");
    h.client.dispose();
  });

  it("CK-W5-transition (c) an agreement with plan recovery gives controls back only after one fresh read", async () => {
    const h = host({ recovery: false });
    await h.client.ready;
    h.client.setPlan(structuredClone(h.plan) as PlanRecord);
    let release!: () => void;
    h.reads.hold = new Promise<void>((resolve) => (release = resolve));
    const before = h.reads.count;
    await h.renegotiate({ recovery: true });
    expect(h.client.getSnapshot().capabilities).toContain("plan-recovery");
    // The fresh read is still on its way: still read-only, and the
    // snapshot says so, so no view offers a control the client refuses.
    expect(h.client.getSnapshot().planReadOnly).toBe(true);
    await h.client.confirmPlan();
    await flush();
    expect(h.sends).not.toContain("confirm");
    release();
    await flush(20);
    expect(h.reads.count - before).toBe(1);
    expect(h.client.getSnapshot().planReadOnly).toBe(false);
    // The confirmation's code loads on first use: wait for the call itself.
    await h.client.confirmPlan();
    await flush();
    expect(h.sends).toContain("confirm");
    h.client.dispose();
  });
});
