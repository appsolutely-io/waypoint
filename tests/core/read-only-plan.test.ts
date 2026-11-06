import { describe, expect, it, vi } from "vitest";
import { offersConfirm } from "../support/plan-offers";
import { protectedHost, until } from "../support/protected";
import { withRecovery } from "../support/host-plans";

const sent = (h: Awaited<ReturnType<typeof protectedHost>>) =>
  h.calls.filter(
    (call) =>
      call.path.endsWith("/replies") ||
      call.path.endsWith("/safety-control") ||
      call.path.endsWith("/heartbeat") ||
      call.path.startsWith("/protected-items"),
  ).length;

describe("a protected plan this client cannot control", () => {
  it("CK-W5-adopt a client without the intent port shows it read-only", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open({ intent: undefined });
      expect(client.getSnapshot().plan?.id).toBe("plan-p");
      expect(client.getSnapshot().problem).toBeNull();
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it("CK-W5-adopt an unknown profile or phase is shown read-only, under the monotone rules", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      const current = client.getSnapshot().plan!;
      const revision = current.recovery!.revision;
      client.setPlan(
        withRecovery(current, {
          revision: revision + 1,
          profile: "plan-recovery-v2",
        }),
      );
      expect(client.getSnapshot().problem).toBeNull();
      expect(client.getSnapshot().plan?.recovery?.profile).toBe(
        "plan-recovery-v2",
      );
      client.setPlan(
        withRecovery(current, {
          revision: revision + 2,
          phase: "manual-review",
        }),
      );
      expect(client.getSnapshot().problem).toBeNull();
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("manual-review");
      const shown = structuredClone(client.getSnapshot().plan);
      client.setPlan(
        withRecovery(current, {
          revision: revision + 1,
          profile: "plan-recovery-v2",
          phase: "older-review",
        }),
      );
      expect(client.getSnapshot().plan).toEqual(shown);
      expect(client.getSnapshot().problem).toBeNull();
      // Equal revision with other bytes, another conversation or generation.
      for (const change of [
        { revision: revision + 2, phase: "cancelled" },
        { revision: revision + 9, conversationId: "other" },
        { revision: revision + 9, generation: "other" },
      ]) {
        client.report({ code: "refused", id: "reset" });
        client.setPlan(withRecovery(current, change));
        expect(client.getSnapshot().problem?.code, JSON.stringify(change)).toBe(
          "invalid-plan",
        );
      }
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it.each(["plan-recovery-v1", "plan-recovery-v2"])(
    "a %s record without well-typed monotone fields is refused",
    async (profile) => {
      const h = await protectedHost();
      try {
        for (const change of [
          { revision: undefined },
          { revision: "3" },
          { revision: -1 },
          { generation: 7 },
          { conversationId: 7 },
        ]) {
          const client = await h.open({ intent: undefined });
          const current = await h.read();
          client.setPlan(
            withRecovery(current, { ...change, profile }, { id: "plan-q" }),
          );
          expect(
            client.getSnapshot().problem?.code,
            JSON.stringify(change),
          ).toBe("invalid-plan");
          client.dispose();
        }
      } finally {
        await h.close();
      }
    },
  );

  it("CK-W5-guard every control refuses locally and sends nothing", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      const current = client.getSnapshot().plan!;
      client.setPlan(
        withRecovery(current, {
          revision: current.recovery!.revision + 1,
          profile: "plan-recovery-v2",
        }),
      );
      const before = sent(h);
      const actions = [
        () => client.confirmPlan(),
        () => client.runPlan(current.id, "digest"),
        () => client.stopPlan(),
        () => client.declinePlan(),
        () => client.leavePlan(),
        () => client.keepChanges(client.keepChangesReview()),
        () => client.checkIntentStatus(),
      ];
      for (const action of actions) {
        client.report({ code: "retryable", id: "reset" });
        await action();
        expect(client.getSnapshot().problem?.code).toBe("refused");
        expect(sent(h)).toBe(before);
      }
      expect(client.canKeepChanges()).toBe(false);
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it("CK-W5-guard resume and retry undo refuse locally and call nothing on the host", async () => {
    const h = await protectedHost();
    try {
      const resume = vi.fn(async () => h.read());
      const retryUndo = vi.fn(async () => h.read());
      const client = await h.open({ resume, retryUndo });
      const current = client.getSnapshot().plan!;
      client.setPlan(
        withRecovery(current, {
          revision: current.recovery!.revision + 1,
          profile: "plan-recovery-v2",
        }),
      );
      const before = sent(h);
      await client.resumePlan();
      expect(client.getSnapshot().problem?.code).toBe("refused");
      client.report({ code: "retryable", id: "reset" });
      await client.retryUndo();
      expect(client.getSnapshot().problem?.code).toBe("refused");
      expect(resume).not.toHaveBeenCalled();
      expect(retryUndo).not.toHaveBeenCalled();
      expect(sent(h)).toBe(before);
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it("CK-W5-guard a confirm pressed while controllable is dropped when the plan turns read-only before it is sent", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      const current = client.getSnapshot().plan!;
      const before = h.calls.filter((call) =>
        call.path.endsWith("/replies"),
      ).length;
      // The press captures the controllable plan; the send waits for the
      // client actions' code, and the plan turns read-only meanwhile.
      const confirming = client.confirmPlan();
      client.setPlan(
        withRecovery(current, {
          revision: current.recovery!.revision + 1,
          profile: "plan-recovery-v2",
        }),
      );
      await confirming;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        h.calls.filter((call) => call.path.endsWith("/replies")).length,
      ).toBe(before);
      expect(client.getSnapshot().problem?.code).toBe("refused");
      expect((await h.read()).recovery?.phase).toBe("initial-review");
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it("a confirm keeps its own controllable epoch when another plan turns read-only", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      const current = client.getSnapshot().plan!;
      const before = h.calls.filter((call) =>
        call.path.endsWith("/replies"),
      ).length;
      const confirming = client.confirmPlan();
      client.setPlan(
        withRecovery(
          current,
          { profile: "plan-recovery-v2" },
          { id: "other-plan" },
        ),
      );
      await confirming;
      expect(
        h.calls.filter((call) => call.path.endsWith("/replies")),
      ).toHaveLength(before + 1);
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it("CK-W5-guard a client without plan recovery never confirms a protected plan", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open({ intent: undefined });
      const before = sent(h);
      await client.confirmPlan();
      client.stopPlan();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sent(h)).toBe(before);
      expect((await h.read()).recovery?.phase).toBe("initial-review");
      expect(client.getSnapshot().problem?.code).toBe("refused");
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it("CK-W5-transition a run stops sending once its plan turns read-only", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      await h.control({ operation: "hold", boundary: "commit:plan-p" });
      const confirming = client.confirmPlan();
      await until(
        async () => (await h.read()).recovery?.phase === "forward-active",
      );
      await until(() =>
        h.calls.some((call) => call.path.startsWith("/protected-items")),
      );
      // Same phase, under a profile this client lacks.
      const shown = await h.read();
      client.setPlan(
        withRecovery(shown, {
          revision: shown.recovery!.revision + 5,
          profile: "plan-recovery-v2",
        }),
      );
      const before = sent(h);
      await h.control({ operation: "release", boundary: "commit:plan-p" });
      await confirming;
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Nothing more: no further step, renewal or intent.
      expect(sent(h)).toBe(before);
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it("CK-W5-4d an acceptance that lands while read-only starts nothing, and controls return only from a fresh read", async () => {
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
      const accepted = await h.read();
      client.setPlan(
        withRecovery(accepted, {
          revision: accepted.recovery!.revision + 5,
          profile: "plan-recovery-v2",
        }),
      );
      await h.control({
        operation: "release",
        boundary: "confirm-response:plan-p",
      });
      await confirming;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        h.calls.some(
          (call) =>
            call.path.endsWith("/heartbeat") ||
            call.path.startsWith("/protected-items"),
        ),
      ).toBe(false);
      // Controls return at a higher revision, at a known phase: a plan the
      // fresh read says is running offers no Confirm and starts nothing.
      client.setPlan(
        withRecovery(accepted, { revision: accepted.recovery!.revision + 6 }),
      );
      expect(client.getSnapshot().plan?.recovery?.profile).toBe(
        "plan-recovery-v1",
      );
      expect(client.getSnapshot().plan?.state).toBe("running");
      expect(client.getSnapshot().planReadOnly).toBe(false);
      expect(offersConfirm(client)).toBe(false);
      await client.confirmPlan();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        h.calls.some(
          (call) =>
            call.path.endsWith("/heartbeat") ||
            call.path.startsWith("/protected-items"),
        ),
      ).toBe(false);
      client.dispose();
    } finally {
      await h.close();
    }
  });

  it("CK-W5-4d an acceptance held across read-only and back never starts a run", async () => {
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
      const accepted = await h.read();
      const revision = accepted.recovery!.revision;
      client.setPlan(
        withRecovery(accepted, {
          revision: revision + 5,
          profile: "plan-recovery-v2",
        }),
      );
      // Controls come back before the response lands.
      client.setPlan(withRecovery(accepted, { revision: revision + 6 }));
      await h.control({
        operation: "release",
        boundary: "confirm-response:plan-p",
      });
      await confirming;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        h.calls.some(
          (call) =>
            call.path.endsWith("/heartbeat") ||
            call.path.startsWith("/protected-items"),
        ),
      ).toBe(false);
      client.dispose();
    } finally {
      await h.close();
    }
  });
});
