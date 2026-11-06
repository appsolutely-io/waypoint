import { it, expect, describe, vi, afterEach } from "vitest";
import {
  acceptedReadback as readback,
  stopBody,
  protectedHost,
  until,
} from "../support/protected";
import {
  ConversationReadError,
  createWaypointClient,
} from "../../src/core/client";
import { createSseTransport } from "../../src/core/transports";
import { config, flush, platform } from "../support/client";
import type { IntentRequest } from "../../src/protocol/generated";

type Host = Awaited<ReturnType<typeof protectedHost>>;
const admitted = async (h: Host, stepId: string) =>
  (
    (await h.control({ operation: "admitted", stepId })).body as {
      admitted: boolean;
    }
  ).admitted;
// The Keep review is answered by the intent chunk a protected plan
// preloads; wait for it to arrive.
async function reviewOf(client: {
  keepChangesReview(): ReturnType<
    ReturnType<typeof createWaypointClient>["keepChangesReview"]
  >;
}) {
  await until(() => {
    const review = client.keepChangesReview();
    return !("disabled" in review) || review.disabled !== "loading";
  });
  return client.keepChangesReview();
}
const keepBodies = (h: Host) =>
  h.calls
    .filter((call) => call.path.endsWith("/safety-control") && call.body)
    .map((call) => JSON.parse(call.body!) as IntentRequest)
    .filter((body) => body.kind === "keep");

describe("Keep from the client", () => {
  it("reviews the adopted record and sends exactly that Keep", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      const view = record.recovery!;
      expect(view.remaining).toBe(1);
      const client = await h.open();
      client.setPlan(record);
      const review = await reviewOf(client);
      expect(review).toMatchObject({
        review: "forward-only",
        remaining: 1,
        acknowledgment: {
          sourceDecisionKey: view.decisionKey,
          evidenceVersion: view.versions.evidence,
          winnerVersion: view.versions.winner,
          decisionResolutionVersion: 0,
          evidenceDigest: view.evidenceDigest,
          unknownCount: 0,
        },
      });
      expect(client.canKeepChanges()).toBe(true);
      await client.keepChanges(review);
      expect(keepBodies(h)).toEqual([
        expect.objectContaining({
          kind: "keep",
          review: "forward-only",
          target: { type: "execution", id: view.executionId },
          capturedRound: view.round,
          expectedSlotVersion: view.slots.keep,
          acknowledgment: expect.objectContaining({
            evidenceDigest: view.evidenceDigest,
          }),
        }),
      ]);
      await until(() => client.getSnapshot().plan?.recovery?.sealed === true);
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("left-known");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("sends the captured review even when a newer record is adopted while the chunk loads", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      const client = await h.open();
      client.setPlan(record);
      const review = await reviewOf(client);
      const keeping = client.keepChanges(review);
      client.setPlan({
        ...record,
        recovery: {
          ...record.recovery!,
          revision: record.recovery!.revision + 1,
          versions: { ...record.recovery!.versions, winner: 99 },
        },
      });
      await keeping;
      expect(keepBodies(h)[0]!.acknowledgment!.winnerVersion).toBe(
        record.recovery!.versions.winner,
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a double press is one host outcome", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      const client = await h.open();
      client.setPlan(record);
      const review = await reviewOf(client);
      await Promise.all([
        client.keepChanges(review),
        client.keepChanges(review),
      ]);
      // The second press joins the first: one delivery.
      expect(keepBodies(h)).toHaveLength(1);
      expect((await h.read()).recovery?.slots.keep).toBe(1);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("each disabled reason, in order", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      // Initial review: nothing accepted yet.
      expect(await reviewOf(client)).toEqual({
        disabled: "keepNoDecision",
      });
      expect(client.canKeepChanges()).toBe(false);
      await h.control({ operation: "hold", boundary: "commit:plan-p" });
      const confirming = client.confirmPlan();
      await until(() => admitted(h, "step-a"));
      client.setPlan(await h.read());
      expect(await reviewOf(client)).toEqual({
        disabled: "keepBlockedActive",
      });
      await h.post("/plans/plan-p/safety-control", stopBody(await h.read()));
      await h.control({ operation: "release", boundary: "commit:plan-p" });
      await confirming.catch(() => undefined);
      const unknown = await h.read();
      expect(unknown.recovery?.unknownCount).toBe(1);
      client.setPlan(unknown);
      expect(await reviewOf(client)).toEqual({
        disabled: "keepBlockedUnknown",
      });
      client.dispose();
      // Sealed.
      const k = await protectedHost();
      try {
        const record = await readback(k);
        const keeper = await k.open();
        keeper.setPlan(record);
        await keeper.keepChanges(await reviewOf(keeper));
        keeper.setPlan(await k.read());
        expect(await reviewOf(keeper)).toEqual({ disabled: "sealed" });
        keeper.dispose();
      } finally {
        await k.close();
      }
    } finally {
      await h.close();
    }
  });
  it("without an agreed Keep capability nothing is sent", async () => {
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
      client.setPlan(record);
      const review = await reviewOf(client);
      expect(review).toEqual({ disabled: "capabilityMissing" });
      await client.keepChanges(review);
      expect(intents).toBe(0);
      expect(client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "plan-keep",
      });
      client.setPlan({
        ...record,
        id: "other-plan",
        recovery: { ...record.recovery!, profile: "plan-recovery-v2" },
      });
      await client.keepChanges(review);
      expect(client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "plan-keep",
      });
      const readOnlyReview = client.keepChangesReview();
      // Every read-only answer is the same value; no caller can change it
      // for the next one.
      expect(Object.isFrozen(readOnlyReview)).toBe(true);
      expect(() => {
        (readOnlyReview as { disabled: string }).disabled = "keepNoDecision";
      }).toThrow(TypeError);
      expect(client.keepChangesReview()).toEqual({
        disabled: "capabilityMissing",
      });
      client.setPlan(record);
      await client.keepChanges(readOnlyReview);
      expect(client.getSnapshot().problem?.code).toBe("refused");
      expect(intents).toBe(0);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("Keep is offered only together with plan recovery", async () => {
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
          capabilities: ["plans", "plan-keep"],
        }),
      },
    });
    await client.ready;
    expect(client.getSnapshot().capabilities).toEqual(["plans"]);
    client.dispose();
  });
});

describe("Keep when the intent chunk cannot load", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("a failed load gives a stable disabled reason, never enables Keep, and sends nothing", async () => {
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
      // The preload fails: the review says so, stably, and never enables
      // Keep; a press then reports the failed load and sends nothing.
      await until(() => {
        const review = client.keepChangesReview();
        return "disabled" in review && review.disabled === "intentUnavailable";
      });
      for (let i = 0; i < 3; i++) {
        await flush();
        expect(client.keepChangesReview()).toEqual({
          disabled: "intentUnavailable",
        });
      }
      expect(client.canKeepChanges()).toBe(false);
      await client.keepChanges(client.keepChangesReview());
      expect(client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "plan-keep",
      });
      expect(intents).toBe(0);
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("a failed intent chunk load is retried", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("the review becomes available once a later load succeeds", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      vi.resetModules();
      let fail = true;
      vi.doMock("../../src/core/intent", async () => {
        if (fail) throw new Error("chunk unavailable");
        return vi.importActual("../../src/core/intent");
      });
      const { createWaypointClient: create } =
        await import("../../src/core/client");
      const { createSseTransport: sseOf } =
        await import("../../src/core/transports");
      const client = create({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: sseOf(h.request, { subscribe: () => () => {} }),
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
      await until(() => {
        const review = client.keepChangesReview();
        return "disabled" in review && review.disabled === "intentUnavailable";
      });
      fail = false;
      vi.resetModules();
      // The next review retries the load and then answers.
      await until(() => !("disabled" in client.keepChangesReview()));
      expect(client.keepChangesReview()).toMatchObject({
        review: "forward-only",
      });
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("Keep reviews belong to their conversation and agreement", () => {
  it("a review issued before navigating away sends nothing", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      const client = await h.open();
      client.setPlan(record);
      const review = await reviewOf(client);
      expect("review" in review).toBe(true);
      const other = (
        (await h.post("/conversations", { protocol: "1.0", title: "Other" }))
          .body as { id: string }
      ).id;
      await client.switchConversation(other);
      await client.keepChanges(review);
      expect(keepBodies(h)).toEqual([]);
      expect((await h.read()).recovery?.sealed).toBeFalsy();
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a review issued before Keep stopped being agreed sends nothing", async () => {
    const h = await protectedHost();
    try {
      const record = await readback(h);
      const sse = createSseTransport(h.request, { subscribe: () => () => {} });
      let first: string | undefined;
      let dropKeep = false;
      const client = createWaypointClient({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: {
          ...sse,
          negotiate: async (supported, offer) => {
            const answer = await sse.negotiate(supported, offer);
            first ??= answer.agreementId;
            return !dropKeep
              ? answer
              : {
                  ...answer,
                  capabilities: answer.capabilities.filter(
                    (value) => value !== "plan-keep",
                  ),
                };
          },
          read: async (id, context) => {
            // Every read under the first agreement is refused once Keep is
            // withdrawn, so the client must renegotiate.
            if (dropKeep && context?.agreementId === first) {
              throw new ConversationReadError(id, 409, {
                code: "agreement-expired",
                id: "agreement",
              });
            }
            return sse.read(id, context);
          },
        },
        plans: {
          read: (id) => h.read(id),
          heartbeat: async () => {},
          request: async () => {},
          intent: async (intent) =>
            (await h.post(`/plans/${intent.planId}/safety-control`, intent))
              .body as never,
        },
      });
      await client.ready;
      client.setPlan(record);
      const review = await reviewOf(client);
      expect("review" in review).toBe(true);
      dropKeep = true;
      await client.refresh().catch(() => undefined);
      await until(
        () => !client.getSnapshot().capabilities.includes("plan-keep"),
      );
      await client.keepChanges(review);
      expect(keepBodies(h)).toEqual([]);
      expect(client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "plan-keep",
      });
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("remaining client Keep cells", () => {
  it("a completed plan offers the end-retention review", async () => {
    const h = await protectedHost(["a"]);
    try {
      const client = await h.open();
      await client.confirmPlan();
      client.setPlan(await h.read());
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("completed");
      const review = await reviewOf(client);
      expect(review).toMatchObject({ review: "end-retention", remaining: 0 });
      await client.keepChanges(review);
      expect(keepBodies(h)[0]).toMatchObject({ review: "end-retention" });
      await until(async () => (await h.read()).recovery?.sealed === true);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("no plan, a proposal and a cancelled plan have no decision to keep", async () => {
    const h = await protectedHost();
    try {
      const base = config();
      const empty = createWaypointClient({
        ...base,
        transport: {
          ...base.transport,
          negotiate: async () => ({
            protocol: "1.0",
            capabilities: ["plans", "plan-recovery", "plan-keep"],
          }),
        },
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
      });
      await empty.ready;
      expect(await reviewOf(empty)).toEqual({ disabled: "keepNoDecision" });
      empty.dispose();
      const client = await h.open();
      const initial = await h.read();
      client.setPlan({
        ...initial,
        recovery: {
          ...initial.recovery!,
          phase: "proposal",
          revision: initial.recovery!.revision + 1,
        },
      });
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("proposal");
      expect(await reviewOf(client)).toEqual({
        disabled: "keepNoDecision",
      });
      client.dispose();
      // Declined before any acceptance.
      const decliner = await h.open();
      await decliner.declinePlan();
      await until(async () => (await h.read()).recovery?.phase === "cancelled");
      decliner.setPlan(await h.read());
      expect(decliner.getSnapshot().plan?.recovery?.phase).toBe("cancelled");
      expect(await reviewOf(decliner)).toEqual({
        disabled: "keepNoDecision",
      });
      decliner.dispose();
    } finally {
      await h.close();
    }
  });
});
