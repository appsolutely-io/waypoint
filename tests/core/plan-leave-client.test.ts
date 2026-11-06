import { it, expect, describe, vi, afterEach } from "vitest";
import { protectedHost, until } from "../support/protected";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import type { IntentRequest, PlanRecord } from "../../src/protocol/generated";
import { negotiate } from "../../src/protocol/index";

type Host = Awaited<ReturnType<typeof protectedHost>>;
const stopBody = (record: PlanRecord) => ({
  kind: "stop",
  planId: record.id,
  target: { type: "execution", id: record.recovery!.executionId },
  capturedRound: record.recovery!.round,
  expectedSlotVersion: record.recovery!.slots.stop,
  correlation: "stop-1",
  cause: "connection-lost",
});
async function readback(h: Host) {
  const client = await h.open();
  await h.control({ operation: "hold", boundary: "commit:plan-p" });
  const confirming = client.confirmPlan();
  await until(
    async () =>
      (
        (await h.control({ operation: "admitted", stepId: "step-a" })).body as {
          admitted: boolean;
        }
      ).admitted,
  );
  await h.post("/plans/plan-p/safety-control", stopBody(await h.read()));
  await h.control({ operation: "release", boundary: "commit:plan-p" });
  await confirming.catch(() => undefined);
  client.dispose();
  return h.read();
}
const leaveBodies = (h: Host) =>
  h.calls
    .filter((call) => call.path.endsWith("/safety-control") && call.body)
    .map((call) => JSON.parse(call.body!) as IntentRequest)
    .filter((body) => body.kind === "leave");

describe("Leave from the client", () => {
  it("sends Leave with the acknowledgment of the adopted record and closes the decision", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      expect(record.recovery?.phase).toBe("readback");
      const client = await h.open();
      client.setPlan(record);
      await client.leavePlan();
      const view = record.recovery!;
      expect(leaveBodies(h)).toEqual([
        expect.objectContaining({
          kind: "leave",
          planId: "plan-p",
          target: { type: "execution", id: view.executionId },
          capturedRound: view.round,
          expectedSlotVersion: view.slots.leave,
          cause: "user",
          acknowledgment: {
            sourceDecisionKey: view.decisionKey,
            evidenceVersion: view.versions.evidence,
            winnerVersion: view.versions.winner,
            decisionResolutionVersion: view.versions.decisionResolution,
            evidenceDigest: view.evidenceDigest,
            unknownCount: view.unknownCount,
          },
        }),
      ]);
      await until(
        () => client.getSnapshot().plan?.recovery?.phase === "left-unconfirmed",
      );
      expect((await h.read()).recovery?.winner?.kind).toBe("leave");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("captures the acknowledgment before any await, from the adopted record", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      const client = await h.open();
      client.setPlan(record);
      const leaving = client.leavePlan();
      // A newer record adopted while the Leave is in flight changes nothing
      // it already captured.
      client.setPlan({
        ...record,
        recovery: {
          ...record.recovery!,
          revision: record.recovery!.revision + 1,
          versions: { ...record.recovery!.versions, winner: 99 },
        },
      });
      await leaving;
      expect(leaveBodies(h)[0]!.acknowledgment!.winnerVersion).toBe(
        record.recovery!.versions.winner,
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a running execution owned by this window is inhibited at once, then fenced by the Leave", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await h.control({ operation: "hold", boundary: "commit:plan-p" });
      const confirming = client.confirmPlan();
      await until(
        async () =>
          (
            (await h.control({ operation: "admitted", stepId: "step-a" }))
              .body as { admitted: boolean }
          ).admitted,
      );
      client.setPlan(await h.read());
      const leaving = client.leavePlan();
      await h.control({ operation: "release", boundary: "commit:plan-p" });
      await leaving;
      await confirming.catch(() => undefined);
      const record = await h.read();
      expect(record.recovery).toMatchObject({
        phase: "readback",
        winner: { kind: "leave", cause: "user" },
      });
      // The second step never ran.
      expect(
        h.calls.filter((call) => call.path === "/protected-items/b"),
      ).toHaveLength(0);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  for (const phase of ["initial-review", "completed"] as const)
    it(`in ${phase} no Leave is sent`, async () => {
      const h = await protectedHost();
      try {
        const client = await h.open();
        if (phase === "completed") {
          await client.confirmPlan();
          client.setPlan(await h.read());
        }
        expect(client.getSnapshot().plan?.recovery?.phase).toBe(phase);
        await client.leavePlan();
        expect(leaveBodies(h)).toEqual([]);
        expect(client.getSnapshot().problem).toEqual({
          code: "unavailable",
          id: "plan-leave",
        });
        client.dispose();
      } finally {
        await h.close();
      }
    });
  it("without an agreed Leave capability no Leave is sent", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      const base = config();
      let intents = 0;
      const client = createWaypointClient({
        ...base,
        conversationId: record.recovery!.conversationId,
        transport: {
          ...base.transport,
          negotiate: async () => ({
            protocol: "1.0",
            capabilities: ["plans", "plan-recovery"],
          }),
        },
        plans: {
          read: async () => record,
          heartbeat: async () => {},
          request: async () => {},
          intent: async () => {
            intents++;
            throw new Error("unexpected");
          },
        },
      });
      await client.ready;
      expect(client.getSnapshot().capabilities).toContain("plan-recovery");
      expect(client.getSnapshot().capabilities).not.toContain("plan-leave");
      client.setPlan(record);
      await client.leavePlan();
      expect(intents).toBe(0);
      expect(client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "plan-leave",
      });
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("Leave is offered only together with plan recovery", async () => {
    const base = config();
    const client = createWaypointClient({
      ...base,
      plans: {
        read: async () => {
          throw new Error("unexpected");
        },
        heartbeat: async () => {},
        request: async () => {},
        intent: async () => {
          throw new Error("unexpected");
        },
      },
      transport: {
        ...base.transport,
        negotiate: async () => ({
          protocol: "1.0",
          capabilities: ["plans", "plan-leave"],
        }),
      },
    });
    await client.ready;
    expect(client.getSnapshot().capabilities).toEqual(["plans"]);
    client.dispose();
  });
});

describe("negotiating Leave", () => {
  it("a host chooses plan-leave only together with plan-recovery", () => {
    expect(
      negotiate(["1.0"], ["plans", "plan-leave"], {
        capabilities: ["plans", "plan-leave", "plan-recovery"],
      }).capabilities,
    ).toEqual(["plans"]);
    expect(
      negotiate(["1.0"], ["plans", "plan-recovery", "plan-leave"], {
        capabilities: ["plans", "plan-recovery", "plan-leave"],
      }).capabilities,
    ).toEqual(["plans", "plan-recovery", "plan-leave"]);
  });
});

describe("Leave when the intent chunk cannot load", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("reports the fixed retryable problem and sends nothing", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      vi.resetModules();
      vi.doMock("../../src/core/intent", () => {
        throw new Error("chunk unavailable");
      });
      const { createWaypointClient: create } =
        await import("../../src/core/client");
      const { createSseTransport } = await import("../../src/core/transports");
      const { platform } = await import("../support/client");
      let intents = 0;
      const client = create({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: createSseTransport(h.request, { subscribe: () => () => {} }),
        plans: {
          read: () => h.read(),
          heartbeat: async () => {},
          request: async () => {},
          intent: async () => {
            intents++;
            throw new Error("unexpected");
          },
        },
      });
      await client.ready;
      client.setPlan(record);
      await client.leavePlan();
      expect(client.getSnapshot().problem).toEqual({
        code: "retryable",
        id: "intent-load",
      });
      expect(intents).toBe(0);
      expect((await h.read()).recovery?.phase).toBe("readback");
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("a Leave belongs to the conversation it was pressed in", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("navigating away while the intent chunk loads sends nothing", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      vi.resetModules();
      vi.doMock("../../src/core/intent", async () => {
        await gate;
        return vi.importActual("../../src/core/intent");
      });
      const { createWaypointClient: create } =
        await import("../../src/core/client");
      const { createSseTransport } = await import("../../src/core/transports");
      const { platform } = await import("../support/client");
      const client = create({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: createSseTransport(h.request, { subscribe: () => () => {} }),
        plans: {
          read: () => h.read(),
          heartbeat: async () => {},
          request: async () => {},
          intent: async (intent) =>
            (await h.post(`/plans/${intent.planId}/safety-control`, intent))
              .body as never,
        },
      });
      await client.ready;
      client.setPlan(record);
      const leaving = client.leavePlan();
      const other = (
        (await h.post("/conversations", { protocol: "1.0", title: "Other" }))
          .body as { id: string }
      ).id;
      await client.switchConversation(other);
      release();
      await leaving;
      expect(leaveBodies(h)).toEqual([]);
      expect((await h.read()).recovery?.phase).toBe("readback");
      client.dispose();
    } finally {
      await h.close();
    }
  });
});
