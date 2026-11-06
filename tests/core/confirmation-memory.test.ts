import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  createMemoryStorage,
  type ClientConfig,
} from "../../src/core/client";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
import type { PlanRecord } from "../../src/protocol/generated";
function fixture() {
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  const base = config();
  let writes = 0;
  const clientConfig: ClientConfig = {
    ...base,
    storage: createMemoryStorage(),
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
        record.state = "needs-attention";
        record.outcomes = [{ stepId: "step-a", status: 200, attributed: true }];
      },
      resume: async () => {
        record.state = "running";
        record.outcomes = [];
        return record;
      },
    },
  };
  const client = createWaypointClient(clientConfig);
  return { record, client, clientConfig, writes: () => writes };
}
it("a direct run never records a user confirmation for later resume", async () => {
  const { client, record, writes } = fixture();
  await client.ready;
  record.state = "running";
  client.setPlan(record);
  await client.runPlan(record.id, "plan-digest");
  expect(writes()).toBe(1);
  record.state = "needs-attention";
  client.setPlan(record);
  await client.resumePlan();
  expect(writes()).toBe(1);
  expect(client.getSnapshot().problem?.code).toBe("plan-changed");
  client.dispose();
});
for (const action of [
  "completed",
  "undone",
  "cancelled",
  "submitted",
  "stop",
  "switch",
  "dispose",
] as const)
  it(`releases both confirmation caches on ${action}`, async () => {
    const { client, record } = fixture();
    const caches = new Set<Map<unknown, unknown>>();
    const nativeSet = Map.prototype.set;
    const capture = vi.spyOn(Map.prototype, "set").mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
      value: unknown,
    ) {
      if (
        value === "plan-digest" ||
        (typeof value === "object" &&
          value !== null &&
          "id" in value &&
          typeof value.id === "string" &&
          value.id.startsWith("id-"))
      )
        caches.add(this);
      return nativeSet.call(this, key, value);
    });
    try {
      await client.ready;
      client.setPlan(record);
      await client.confirmPlan();
      expect(caches.size).toBe(2);
      expect([...caches].every((cache) => cache.size > 0)).toBe(true);
      if (action === "stop") client.stopPlan(record.id);
      else if (action === "switch")
        await client.switchConversation("conversation-b");
      else if (action === "dispose") client.dispose();
      else client.setPlan({ ...record, state: action });
      expect([...caches].map((cache) => cache.size)).toEqual([0, 0]);
    } finally {
      capture.mockRestore();
      client.dispose();
    }
  });
it("a late accepted confirmation cannot restore caches after Stop", async () => {
  const base = config();
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  const caches = new Set<Map<unknown, unknown>>();
  const nativeSet = Map.prototype.set;
  const capture = vi.spyOn(Map.prototype, "set").mockImplementation(function (
    this: Map<unknown, unknown>,
    key: unknown,
    value: unknown,
  ) {
    if (
      value === "plan-digest" ||
      (typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string" &&
        value.id.startsWith("id-"))
    )
      caches.add(this);
    return nativeSet.call(this, key, value);
  });
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        entered();
        await gate;
        return { id: reply.clientReplyId };
      },
    },
  });
  try {
    await client.ready;
    client.setPlan(record);
    const confirming = client.confirmPlan();
    await started;
    client.stopPlan(record.id);
    release();
    await confirming;
    expect([...caches].every((cache) => cache.size === 0)).toBe(true);
  } finally {
    release();
    capture.mockRestore();
    client.dispose();
  }
});
it("remembered digests include the conversation in their scope", async () => {
  const { client, record } = fixture();
  const keys: unknown[] = [];
  const nativeSet = Map.prototype.set;
  const capture = vi.spyOn(Map.prototype, "set").mockImplementation(function (
    this: Map<unknown, unknown>,
    key: unknown,
    value: unknown,
  ) {
    if (value === "plan-digest") keys.push(key);
    return nativeSet.call(this, key, value);
  });
  try {
    await client.ready;
    client.setPlan(record);
    await client.confirmPlan();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("conversation-a");
    expect(keys[0]).toContain("plan-a");
  } finally {
    capture.mockRestore();
    client.dispose();
  }
});

it("a fresh client sharing storage still asks for confirmation after reload", async () => {
  const { client, record, clientConfig, writes } = fixture();
  await client.ready;
  client.setPlan(record);
  await client.confirmPlan();
  await client.setDraft("Retained draft");
  client.dispose();
  const reloaded = createWaypointClient(clientConfig);
  try {
    await reloaded.ready;
    reloaded.setPlan(record);
    expect(reloaded.getSnapshot().draft).toBe("Retained draft");
    await reloaded.resumePlan();
    expect(writes()).toBe(1);
    expect(reloaded.getSnapshot().problem?.code).toBe("plan-changed");
  } finally {
    reloaded.dispose();
  }
});
it("Stop during recovery notification cannot restore approval memory", async () => {
  const { client, record } = fixture();
  const caches = new Set<Map<unknown, unknown>>();
  const nativeSet = Map.prototype.set;
  const capture = vi.spyOn(Map.prototype, "set").mockImplementation(function (
    this: Map<unknown, unknown>,
    key: unknown,
    value: unknown,
  ) {
    if (
      value === "plan-digest" ||
      (typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string" &&
        value.id.startsWith("id-"))
    )
      caches.add(this);
    return nativeSet.call(this, key, value);
  });
  try {
    await client.ready;
    client.setPlan(record);
    client.report({ code: "plan-changed", id: record.id });
    client.subscribe(() => {
      if (client.getSnapshot().problem === null) client.stopPlan(record.id);
    });
    await client.confirmPlan();
    expect(client.getSnapshot().problem?.code).toBe("stopped");
    expect([...caches].every((cache) => cache.size === 0)).toBe(true);
  } finally {
    capture.mockRestore();
    client.dispose();
  }
});
