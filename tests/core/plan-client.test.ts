import { it, expect } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
import type { PlanRecord } from "../../src/protocol/generated";
it("the public plan API confirms then runs through server-recorded outcomes", async () => {
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  let writes = 0;
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async () => {
        record.state = "running";
        return { id: "confirm-a" };
      },
    },
    plans: {
      read: async () => record,
      heartbeat: async () => {},
      stop: async () => record,
      request: async () => {
        writes++;
        record.outcomes = [{ stepId: "step-a", status: 200, attributed: true }];
        record.state = "completed";
      },
    },
  });
  await client.ready;
  client.setPlan(record);
  await client.confirmPlan();
  expect(writes).toBe(1);
  expect(client.getSnapshot().plan?.state).toBe("completed");
  client.dispose();
});
it("confirmation echoes the digest stored in the displayed snapshot", async () => {
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  let digest = "";
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        if (reply.kind === "confirm") digest = reply.digest ?? "";
        return { id: "a" };
      },
    },
  });
  await client.ready;
  client.setPlan(record);
  if (record.plan.kind === "immediate" && record.plan.stage === "final")
    record.plan.digest = "new-digest";
  await client.confirmPlan();
  expect(digest).toBe("plan-digest");
  client.dispose();
});
it("double confirmation shares its promise and stable plan reply key", async () => {
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  const base = config();
  const keys: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        keys.push(reply.clientReplyId);
        entered();
        await gate;
        return { id: "confirm-a" };
      },
    },
  });
  await client.ready;
  client.setPlan(record);
  const first = client.confirmPlan();
  const second = client.confirmPlan();
  try {
    expect(second).toBe(first);
  } finally {
    await started;
    release();
    await Promise.all([first, second]);
    client.dispose();
  }
  expect(keys).toHaveLength(1);
});
it("confirmation refuses unknown plans and uses the negotiated protocol after loading", async () => {
  const base = config();
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const protocols: string[] = [];
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      negotiate: async () => {
        await gate;
        return { protocol: "1.0", capabilities: ["plans"] };
      },
      send: async (reply) => {
        protocols.push(reply.protocol);
        return { id: reply.clientReplyId };
      },
    },
  });
  client.setPlan(record);
  const confirmation = client.confirmPlan();
  expect(protocols).toEqual([]);
  release();
  await confirmation;
  await client.ready;
  expect(protocols).toEqual([]);
  expect(client.getSnapshot().plan).toBeNull();
  client.setPlan(record);
  await client.confirmPlan();
  expect(protocols).toEqual(["1.0"]);
  client.dispose();
});
it("confirmation identities follow the issued confirmation and survive failed retries", async () => {
  const base = config();
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  const keys: string[] = [];
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        keys.push(reply.clientReplyId);
        throw { code: "refused" };
      },
    },
  });
  await client.ready;
  client.setPlan(record);
  await client.confirmPlan();
  await client.confirmPlan();
  // A revised plan comes with a new confirmation record and token.
  if (record.plan.kind === "immediate" && record.plan.stage === "final")
    record.plan.digest = "revised-digest";
  record.confirmation = { ...record.confirmation!, token: "revised-token" };
  client.setPlan(record);
  await client.confirmPlan();
  await client.confirmPlan();
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[0]);
  expect(keys[3]).toBe(keys[2]);
  client.dispose();
});
it("a permanently stopped plan reports through the normal problem channel", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const events: string[] = [];
  client.on((event) => events.push(event.type));
  client.stopPlan("plan-a");
  await client.runPlan("plan-a", "plan-digest");
  expect(client.getSnapshot().problem).toEqual({
    code: "stopped",
    id: "plan-a",
  });
  expect(events).toEqual(["problem"]);
  client.dispose();
});
