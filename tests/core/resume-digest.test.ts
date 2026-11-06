import { it, expect } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
import type { PlanRecord } from "../../src/protocol/generated";
for (const changed of [false, true])
  it(`resume ${changed ? "requests fresh confirmation for a changed" : "runs the previously confirmed"} digest`, async () => {
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    record.state = "awaiting-confirmation";
    let writes = 0;
    let firstExecution = true;
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        send: async (reply) => {
          if (reply.kind === "confirm") record.state = "running";
          return { id: reply.clientReplyId };
        },
      },
      plans: {
        read: async () => record,
        heartbeat: async () => {},
        stop: async () => record,
        request: async () => {
          writes++;
          record.outcomes = [
            { stepId: "step-a", status: 200, attributed: true },
          ];
          record.state = firstExecution ? "needs-attention" : "completed";
          firstExecution = false;
        },
        resume: async () => {
          record.state = "running";
          record.outcomes = [];
          if (
            changed &&
            record.plan.kind === "immediate" &&
            record.plan.stage === "final"
          )
            record.plan.digest = "revised-digest";
          return record;
        },
      },
    });
    await client.ready;
    client.setPlan(record);
    await client.confirmPlan();
    record.state = "needs-attention";
    client.setPlan(record);
    writes = 0;
    await client.resumePlan();
    expect(writes).toBe(changed ? 0 : 1);
    if (changed) {
      expect(client.getSnapshot().problem?.code).toBe("plan-changed");
      expect(client.getSnapshot().plan?.state).toBe("awaiting-confirmation");
      await client.confirmPlan();
      expect(writes).toBe(1);
      expect(client.getSnapshot().problem).toBeNull();
    } else expect(client.getSnapshot().plan?.state).toBe("completed");
    client.dispose();
  });
it("resume refuses an unfinished immediate proposal without inventing a confirmation state", async () => {
  const initial = structuredClone(samples.PlanRecord) as PlanRecord;
  const invalid = {
    ...initial,
    state: "proposed",
    plan: structuredClone(samples.ImmediateDraft),
  } as PlanRecord;
  let writes = 0;
  const client = createWaypointClient({
    ...config(),
    plans: {
      read: async () => invalid,
      resume: async () => invalid,
      heartbeat: async () => {},
      stop: async () => invalid,
      request: async () => {
        writes++;
      },
    },
  });
  await client.ready;
  client.setPlan(initial);
  await client.resumePlan();
  expect(client.getSnapshot().problem?.code).toBe("invalid-plan");
  expect(client.getSnapshot().plan?.state).toBe("proposed");
  expect(writes).toBe(0);
  client.dispose();
});
it("resume restores a timed plan waiting for scheduling without reporting a problem", async () => {
  const record = {
    ...structuredClone(samples.PlanRecord),
    id: "timed-a",
    state: "awaiting-confirmation",
    plan: structuredClone(samples.TimedPlan),
  } as PlanRecord;
  let writes = 0;
  const client = createWaypointClient({
    ...config(),
    plans: {
      read: async () => record,
      resume: async () => record,
      heartbeat: async () => {},
      stop: async () => record,
      request: async () => {
        writes++;
      },
    },
  });
  await client.ready;
  client.setPlan({ ...record, state: "needs-attention" });
  await client.resumePlan();
  expect(client.getSnapshot().plan).toEqual(record);
  expect(client.getSnapshot().problem).toBeNull();
  expect(writes).toBe(0);
  client.dispose();
});
it("resume checks a returned plan identity before handling its timed kind", async () => {
  const initial = structuredClone(samples.PlanRecord) as PlanRecord;
  const record = {
    ...initial,
    id: "timed-b",
    state: "awaiting-confirmation",
    plan: { ...structuredClone(samples.TimedPlan), id: "timed-b" },
  } as PlanRecord;
  let writes = 0;
  const client = createWaypointClient({
    ...config(),
    plans: {
      read: async () => record,
      resume: async () => record,
      heartbeat: async () => {},
      stop: async () => record,
      request: async () => {
        writes++;
      },
    },
  });
  await client.ready;
  client.setPlan(initial);
  await client.resumePlan();
  expect(client.getSnapshot().problem?.code).toBe("plan-changed");
  expect(writes).toBe(0);
  client.dispose();
});
