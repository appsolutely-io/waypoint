import { it, expect, describe, vi, afterEach } from "vitest";
import { protectedHost, until } from "../support/protected";
import type { PlanRecord } from "../../src/protocol/generated";

const truth = (record: PlanRecord) =>
  Object.fromEntries(
    (record.recovery?.steps ?? []).map((step) => [step.stepId, step.truth]),
  );

describe("client delivery of terminal intents", () => {
  it("a confirmed protected plan runs under its private acceptance to completion", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await client.confirmPlan();
      const record = await h.read();
      expect(record.recovery?.phase).toBe("completed");
      expect(truth(record)).toEqual({ "step-a": "done", "step-b": "done" });
      // The private acceptance never reaches the public snapshot.
      expect(JSON.stringify(client.getSnapshot())).not.toContain("fence");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("Stop while the acceptance response is held targets the generation and nothing runs", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await h.control({
        operation: "hold",
        boundary: "confirm-response:plan-p",
      });
      const confirming = client.confirmPlan();
      await until(
        async () => (await h.read()).recovery?.phase === "forward-active",
      );
      client.stopPlan();
      await until(async () => (await h.read()).recovery?.phase === "readback");
      await h.control({
        operation: "release",
        boundary: "confirm-response:plan-p",
      });
      await confirming;
      const record = await h.read();
      expect(record.recovery?.winner).toEqual({ kind: "stop", cause: "user" });
      // The handoff was inhibited: the runner never started (no renewal)
      // and no step was ever admitted.
      expect(h.calls.some((call) => call.path.endsWith("/heartbeat"))).toBe(
        false,
      );
      expect(truth(record)).toEqual({
        "step-a": "not-done",
        "step-b": "not-done",
      });
      expect(
        h.calls.some((call) => call.path.startsWith("/protected-items")),
      ).toBe(false);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a Stop still on its way keeps the arriving acceptance from starting the run", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await h.control({
        operation: "hold",
        boundary: "confirm-response:plan-p",
      });
      await h.control({ operation: "hold", boundary: "intent:plan-p" });
      const confirming = client.confirmPlan();
      await until(
        async () => (await h.read()).recovery?.phase === "forward-active",
      );
      // Stop is pressed; its intent is held before the host sees it.
      client.stopPlan();
      await h.control({
        operation: "release",
        boundary: "confirm-response:plan-p",
      });
      await confirming;
      // The execution is live on the host, but this window never runs it.
      expect((await h.read()).recovery?.phase).toBe("forward-active");
      expect(h.calls.some((call) => call.path.endsWith("/heartbeat"))).toBe(
        false,
      );
      expect(
        h.calls.some((call) => call.path.startsWith("/protected-items")),
      ).toBe(false);
      await h.control({ operation: "release", boundary: "intent:plan-p" });
      await until(async () => (await h.read()).recovery?.phase === "readback");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("Stop before a held confirmation closes the generation and the confirmation is refused", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await h.control({ operation: "hold", boundary: "confirm:plan-p" });
      const confirming = client.confirmPlan();
      client.stopPlan();
      await until(async () => (await h.read()).recovery?.phase === "cancelled");
      await h.control({ operation: "release", boundary: "confirm:plan-p" });
      await confirming;
      const record = await h.read();
      expect(record.recovery?.phase).toBe("cancelled");
      expect(record.recovery?.executionId).toBeUndefined();
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("Stop during a held step commit fences the execution; the step stays unknown, the next not done", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await h.control({ operation: "hold", boundary: "commit:plan-p" });
      const running = client.confirmPlan();
      await until(
        async () =>
          (
            (await h.control({ operation: "admitted", stepId: "step-a" }))
              .body as { admitted: boolean }
          ).admitted,
      );
      client.setPlan(await h.read());
      client.stopPlan();
      await until(async () => (await h.read()).recovery?.phase === "readback");
      await h.control({ operation: "release", boundary: "commit:plan-p" });
      await running;
      const record = await h.read();
      expect(truth(record)).toEqual({
        "step-a": "unknown",
        "step-b": "not-done",
      });
      expect(record.recovery?.winner?.kind).toBe("stop");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("an observer window stops another window's run without any acceptance of its own", async () => {
    const h = await protectedHost();
    try {
      const owner = await h.open();
      await h.control({ operation: "hold", boundary: "commit:plan-p" });
      const running = owner.confirmPlan();
      await until(
        async () =>
          (
            (await h.control({ operation: "admitted", stepId: "step-a" }))
              .body as { admitted: boolean }
          ).admitted,
      );
      const observer = await h.open();
      expect(observer.getSnapshot().plan?.recovery?.phase).toBe(
        "forward-active",
      );
      observer.stopPlan();
      await until(async () => (await h.read()).recovery?.phase === "readback");
      await h.control({ operation: "release", boundary: "commit:plan-p" });
      await running;
      expect(truth(await h.read())["step-b"]).toBe("not-done");
      owner.dispose();
      observer.dispose();
    } finally {
      await h.close();
    }
  });
  it("Stop on a completed plan resolves the settled target and changes no facts", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await client.confirmPlan();
      client.setPlan(await h.read());
      const before = await h.read();
      client.stopPlan();
      await until(async () => (await h.read()).recovery?.winner !== undefined);
      const after = await h.read();
      expect(after.recovery?.phase).toBe("completed");
      expect(truth(after)).toEqual(truth(before));
      expect(h.calls.filter((call) => call.path.endsWith("/stop"))).toEqual([]);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a step failure submits the automatic Stop with its cause before reading every step", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open({
        request: async () => {
          throw new Error("refused");
        },
      });
      await client.confirmPlan();
      const record = await h.read();
      expect(record.recovery?.winner).toEqual({
        kind: "stop",
        cause: "step-failed",
      });
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("readback");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("Decline is an initial Cancel on the intent route, never a normal reply", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await client.declinePlan();
      const record = await h.read();
      expect(record.recovery?.phase).toBe("cancelled");
      expect(record.recovery?.winner?.kind).toBe("cancel-initial");
      expect(
        h.calls.some(
          (call) =>
            call.path.endsWith("/replies") && call.body?.includes("decline"),
        ),
      ).toBe(false);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("Stop on each seeded left phase keeps the Leave winner", async () => {
    for (const phase of ["left-known", "left-unconfirmed", "left-reopened"]) {
      const h = await protectedHost();
      try {
        await h.control({ operation: "seed-left", phase });
        const client = await h.open();
        client.stopPlan();
        await until(async () => (await h.read()).recovery!.slots.stop > 0);
        const record = await h.read();
        expect(record.recovery?.phase).toBe(phase);
        expect(record.recovery?.winner?.kind).toBe("leave");
        client.dispose();
      } finally {
        await h.close();
      }
    }
  });
});

describe("acceptance handoff", () => {
  it("a confirmation acknowledged without a private acceptance starts no protected run", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open({}, { stripAcceptance: true });
      await client.confirmPlan();
      expect((await h.read()).recovery?.phase).toBe("forward-active");
      expect(
        h.calls.some((call) => call.path.startsWith("/protected-items")),
      ).toBe(false);
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("the intent chunk", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("a failed load reports a fixed retryable problem, keeps the local Stop and sends no intent", async () => {
    const h = await protectedHost();
    try {
      vi.resetModules();
      vi.doMock("../../src/core/intent", () => {
        throw new Error("chunk unavailable");
      });
      const { createWaypointClient } = await import("../../src/core/client");
      const { createSseTransport } = await import("../../src/core/transports");
      const { platform } = await import("../support/client");
      let intents = 0;
      const client = createWaypointClient({
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
      client.setPlan(await h.read());
      client.stopPlan();
      await until(() => client.getSnapshot().problem?.id === "intent-load");
      expect(client.getSnapshot().problem).toEqual({
        code: "retryable",
        id: "intent-load",
      });
      expect(intents).toBe(0);
      // The local Stop holds: confirmation is refused locally.
      await client.confirmPlan();
      expect((await h.read()).recovery?.phase).toBe("initial-review");
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("legacy plans", () => {
  it("a plan without a recovery record stops locally and sends no intent", async () => {
    const h = await protectedHost();
    try {
      let intents = 0;
      const client = await h.open({
        intent: async () => {
          intents++;
          throw new Error("unexpected");
        },
      });
      client.setPlan({
        protocol: "1.0",
        id: "plan-legacy",
        state: "awaiting-confirmation",
        outcomes: [],
        plan: (await h.read()).plan,
      });
      client.stopPlan();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(intents).toBe(0);
      await client.declinePlan();
      expect(client.getSnapshot().problem?.id).toBe("plan-decline");
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("the recovery record gate", () => {
  it("adopts higher revisions, ignores lower and identical ones, and refuses conflicting or foreign records", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      const current = client.getSnapshot().plan!;
      const at = (
        change: Partial<NonNullable<PlanRecord["recovery"]>>,
        extra: Partial<PlanRecord> = {},
      ) => ({
        ...structuredClone(current),
        ...extra,
        recovery: { ...current.recovery!, ...change },
      });
      // Equal revision, same bytes: no-op.
      client.setPlan(structuredClone(current));
      expect(client.getSnapshot().problem).toBeNull();
      // Lower revision: ignored.
      client.setPlan(
        at({ revision: current.recovery!.revision - 1, phase: "cancelled" }),
      );
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("initial-review");
      expect(client.getSnapshot().problem).toBeNull();
      // Equal revision, different record: peer error, stored kept.
      client.setPlan(at({ phase: "cancelled" }));
      expect(client.getSnapshot().problem).toEqual({
        code: "invalid-plan",
        id: "plan-p",
      });
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("initial-review");
      // Another conversation or generation: peer error. (A phase or
      // profile this client lacks is shown read-only instead.)
      for (const change of [
        { revision: 99, conversationId: "other" },
        { revision: 99, generation: "other" },
      ]) {
        client.report({ code: "refused", id: "reset" });
        client.setPlan(at(change));
        expect(client.getSnapshot().problem, JSON.stringify(change)).toEqual({
          code: "invalid-plan",
          id: "plan-p",
        });
        expect(client.getSnapshot().plan?.recovery?.revision).toBe(
          current.recovery!.revision,
        );
      }
      // Higher revision: adopted.
      client.setPlan(
        at({ revision: current.recovery!.revision + 1, phase: "cancelled" }),
      );
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("cancelled");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a recovery record without the negotiated capability is shown read-only", async () => {
    const h = await protectedHost();
    try {
      // No intent port: plan recovery is not offered, so not negotiated.
      const client = await h.open({ intent: undefined });
      expect(client.getSnapshot().plan?.id).toBe("plan-p");
      expect(client.getSnapshot().problem).toBeNull();
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("the safety-control route", () => {
  it("needs authentication and CSRF but not an agreement, and refuses a foreign target with nothing changed", async () => {
    const h = await protectedHost();
    try {
      const record = await h.read();
      const intent = {
        kind: "stop",
        planId: "plan-p",
        target: { type: "generation", id: record.recovery!.generation },
        capturedRound: record.recovery!.round,
        expectedSlotVersion: 0,
        correlation: "route-1",
        cause: "user",
      };
      const raw = await fetch(`${h.host.url}/plans/plan-p/safety-control`, {
        method: "POST",
        body: JSON.stringify(intent),
      });
      expect(raw.status).toBe(401);
      const foreign = await h.post("/plans/plan-p/safety-control", {
        ...intent,
        target: { type: "execution", id: "other.e1" },
      });
      expect((foreign.body as { result: string }).result).toBe(
        "invalid-target",
      );
      expect((await h.read()).recovery?.revision).toBe(
        record.recovery!.revision,
      );
      const expired = await h.request("/plans/plan-p/safety-control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Waypoint-Agreement": "gone",
        },
        body: JSON.stringify(intent),
      });
      expect((expired.body as { result: string }).result).toBe("applied");
      expect((await h.post("/plans/plan-p/stop", {})).status).toBe(409);
    } finally {
      await h.close();
    }
  });
  it("two intents arriving together are serialized: one winner, the other resolved against it", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await client.confirmPlan();
      const record = await h.read();
      const base = {
        planId: "plan-p",
        target: { type: "generation", id: record.recovery!.generation },
        capturedRound: record.recovery!.round,
        expectedSlotVersion: 0,
        cause: "user",
      };
      const [stop, cancel] = await Promise.all([
        h.post("/plans/plan-p/safety-control", {
          ...base,
          kind: "stop",
          correlation: "s",
        }),
        h.post("/plans/plan-p/safety-control", {
          ...base,
          kind: "cancel-initial",
          correlation: "c",
        }),
      ]);
      const results = [stop.body, cancel.body] as { result: string }[];
      expect(results.filter((r) => r.result === "applied")).toHaveLength(1);
      expect((await h.read()).recovery?.winner).toBeDefined();
      client.dispose();
    } finally {
      await h.close();
    }
  });
});
