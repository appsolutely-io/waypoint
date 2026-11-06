import { describe, expect, it } from "vitest";
import { flush } from "../support/client";
import { atRevision, recordOf, running } from "../support/host-plans";
import { offersConfirm } from "../support/plan-offers";
import { until } from "../support/protected";
import { renegotiationHost } from "../support/renegotiation";

// The host accepts confirmations with the running execution, and its plan
// read then says the plan runs, at a revision past every shown one.
function accepting(h: ReturnType<typeof renegotiationHost>, revision: number) {
  const run = running();
  h.confirms.acceptance = {
    planId: run.planId,
    executionId: run.acceptance!.executionId,
    fence: run.executions[run.acceptance!.executionId]!.fence,
  };
  h.reads.record = atRevision(recordOf(run), revision);
}
const held = () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  return { wait, release };
};

describe("an acceptance that lands while the plan is read-only", () => {
  it("CK-W5-4d across a higher revision under another profile: discarded, then a new confirm on the controllable revision starts the run", async () => {
    const h = renegotiationHost({ recovery: true });
    await h.client.ready;
    const revision = h.plan.recovery!.revision;
    h.client.setPlan(structuredClone(h.plan));
    accepting(h, revision + 9);
    const response = held();
    h.confirms.hold = response.wait;
    const first = h.client.confirmPlan();
    await until(() => h.sends.includes("confirm"));
    h.client.setPlan(
      atRevision(h.plan, revision + 1, { profile: "plan-recovery-v2" }),
    );
    expect(offersConfirm(h.client)).toBe(false);
    const reads = h.reads.count;
    response.release();
    await first;
    await flush(20);
    // Discarded: the runner never read the plan, nothing started.
    expect(h.reads.count).toBe(reads);
    expect(h.client.getSnapshot().plan?.state).toBe("awaiting-confirmation");
    // Controls return at a higher revision that still awaits confirmation.
    h.client.setPlan(atRevision(h.plan, revision + 2));
    expect(offersConfirm(h.client)).toBe(true);
    h.confirms.hold = undefined;
    await h.client.confirmPlan();
    await flush(20);
    expect(h.sends.filter((kind) => kind === "confirm")).toHaveLength(2);
    expect(h.reads.count).toBeGreaterThan(reads);
    expect(h.client.getSnapshot().plan?.state).toBe("running");
    h.client.dispose();
  });

  it("CK-W5-4d across an agreement without plan recovery: discarded, then the fresh read gives controls back and a new confirm starts the run", async () => {
    const h = renegotiationHost({ recovery: true });
    await h.client.ready;
    const revision = h.plan.recovery!.revision;
    h.client.setPlan(structuredClone(h.plan));
    accepting(h, revision + 9);
    const response = held();
    h.confirms.hold = response.wait;
    const first = h.client.confirmPlan();
    await until(() => h.sends.includes("confirm"));
    const record = h.reads.record;
    // The renegotiation's own read still sees the plan awaiting.
    h.reads.record = atRevision(h.plan, revision + 1);
    await h.renegotiate({ recovery: false });
    expect(offersConfirm(h.client)).toBe(false);
    const reads = h.reads.count;
    response.release();
    await first;
    await flush(20);
    expect(h.client.getSnapshot().plan?.state).toBe("awaiting-confirmation");
    expect(h.reads.count).toBe(reads);
    // A new agreement with plan recovery: its fresh read awaits
    // confirmation at a higher revision.
    h.reads.record = atRevision(h.plan, revision + 2);
    await h.renegotiate({ recovery: true });
    expect(h.client.getSnapshot().planReadOnly).toBe(false);
    expect(offersConfirm(h.client)).toBe(true);
    h.confirms.hold = undefined;
    h.reads.record = record;
    await h.client.confirmPlan();
    await flush(20);
    expect(h.client.getSnapshot().plan?.state).toBe("running");
    h.client.dispose();
  });
});

describe("a plan this client could not control", () => {
  it("CK-W5-transition an unknown profile that arrives as plan-recovery-v1 at a higher revision gets controls", async () => {
    const h = renegotiationHost({ recovery: true });
    await h.client.ready;
    const revision = h.plan.recovery!.revision;
    h.client.setPlan(
      atRevision(h.plan, revision, { profile: "plan-recovery-v2" }),
    );
    expect(h.client.getSnapshot().planReadOnly).toBe(true);
    expect(offersConfirm(h.client)).toBe(false);
    h.client.setPlan(atRevision(h.plan, revision + 1));
    expect(h.client.getSnapshot().problem).toBeNull();
    expect(h.client.getSnapshot().planReadOnly).toBe(false);
    expect(offersConfirm(h.client)).toBe(true);
    await h.client.confirmPlan();
    await flush();
    expect(h.sends).toContain("confirm");
    h.client.dispose();
  });
});
