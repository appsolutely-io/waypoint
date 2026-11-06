import { it, expect, describe, vi, afterEach } from "vitest";
import { protectedHost, until } from "../support/protected";
import type { PlanRecord } from "../../src/protocol/generated";
import {
  ConversationReadError,
  createWaypointClient,
} from "../../src/core/client";
import { createSseTransport } from "../../src/core/transports";
import { platform } from "../support/client";

type Host = Awaited<ReturnType<typeof protectedHost>>;
const admitted = async (h: Host, stepId: string) =>
  (
    (await h.control({ operation: "admitted", stepId })).body as {
      admitted: boolean;
    }
  ).admitted;

describe("the cold-load window", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("new consent is refused from the moment of the press, before any overlay appears", async () => {
    const h = await protectedHost();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      vi.resetModules();
      vi.doMock("../../src/core/intent", async () => {
        await gate;
        return vi.importActual("../../src/core/intent");
      });
      const { createWaypointClient: create } =
        await import("../../src/core/client");
      const { createSseTransport: sseOf } =
        await import("../../src/core/transports");
      let intents = 0;
      const client = create({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: sseOf(h.request, { subscribe: () => () => {} }),
        plans: {
          read: () => h.read(),
          heartbeat: async () => {},
          request: async () => {},
          intent: async (intent) => {
            intents++;
            return (
              await h.post(`/plans/${intent.planId}/safety-control`, intent)
            ).body as never;
          },
        },
      });
      await client.ready;
      // A stopped run in readback, so Leave is available.
      const initial = await h.read();
      const accepted = (
        await h.post(`/conversations/${h.conversation}/replies`, {
          kind: "confirm",
          protocol: "1.0",
          clientReplyId: "confirm-window",
          planId: "plan-p",
          digest: (initial.plan as { digest: string }).digest,
          confirmationToken: initial.confirmation?.token,
        })
      ).body as { acceptance: unknown };
      expect(accepted.acceptance).toBeDefined();
      const running = await h.read();
      await h.post("/plans/plan-p/safety-control", {
        kind: "stop",
        planId: "plan-p",
        target: { type: "execution", id: running.recovery!.executionId },
        capturedRound: running.recovery!.round,
        expectedSlotVersion: running.recovery!.slots.stop,
        correlation: "stop-window",
        cause: "connection-lost",
      });
      client.setPlan(await h.read());
      void client.leavePlan();
      // The chunk is still loading: no overlay yet, but new consent is
      // refused from the moment of the press.
      expect(client.getSnapshot().intentOverlays).toEqual({});
      await client.confirmPlan();
      expect(client.getSnapshot().problem).toEqual({
        code: "refused",
        id: "intentPending",
      });
      release();
      await until(() => intents === 1);
      await until(
        async () =>
          (await h.read()).recovery?.phase === "left-unconfirmed" ||
          (await h.read()).recovery?.phase === "left-known",
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("own-run detection for a user Stop", () => {
  it("a user Stop of this window's running plan is not labelled as another window's", async () => {
    const h = await protectedHost();
    try {
      let online = true;
      const client = createWaypointClient({
        accountId: "account-a",
        conversationId: h.conversation,
        platform: { ...platform, online: () => online },
        transport: createSseTransport(h.request, { subscribe: () => () => {} }),
        plans: {
          read: () => h.read(),
          heartbeat: async () => {},
          request: async (canonical, context) => {
            const result = await h.request(canonical.path, {
              method: canonical.method,
              headers: {
                "Content-Type": "application/json",
                ...canonical.headers,
                ...context.headers,
              },
              body: canonical.body,
            });
            if (result.status >= 400) throw new Error("step refused");
          },
          intent: async (intent) =>
            (await h.post(`/plans/${intent.planId}/safety-control`, intent))
              .body as never,
        },
      });
      await client.ready;
      client.setPlan(await h.read());
      await h.control({ operation: "hold", boundary: "commit:plan-p" });
      const confirming = client.confirmPlan();
      await until(() => admitted(h, "step-a"));
      client.setPlan(await h.read());
      // Offline when the Stop is pressed: the Stop is not sent, and it is
      // this window's own run that it inhibited.
      online = false;
      client.stopPlan();
      await until(
        () =>
          client.getSnapshot().intentOverlays["plan-p"] !== undefined &&
          client.getSnapshot().intentOverlays["plan-p"]!.delivery ===
            "not-sent",
      );
      expect(client.getSnapshot().intentOverlays["plan-p"]).toMatchObject({
        ownRun: true,
        lastProblem: { key: "stopNotSent", cause: "offline" },
      });
      online = true;
      await h.control({ operation: "release", boundary: "commit:plan-p" });
      await confirming.catch(() => undefined);
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("status from the client", () => {
  it("checkIntentStatus, checkSavedChoice, checkKeepStatus and retryIntent are one action", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      expect(client.checkSavedChoice).toBe(client.checkIntentStatus);
      expect(client.checkKeepStatus).toBe(client.checkIntentStatus);
      expect(client.retryIntent).toBe(client.checkIntentStatus);
      // Nothing pending: nothing is sent.
      await client.checkIntentStatus();
      expect(
        h.calls.filter((call) => call.path.endsWith("/safety-control")),
      ).toHaveLength(0);
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

// A client on a manual clock against the protected host, with the intent
// chunk import held until released.
async function heldClient(
  h: Host,
  options: {
    read?: (id: string) => Promise<unknown>;
    intent?: (intent: { planId: string }) => Promise<unknown>;
  } = {},
) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.resetModules();
  vi.doMock("../../src/core/intent", async () => {
    await gate;
    return vi.importActual("../../src/core/intent");
  });
  const { createWaypointClient: create } =
    await import("../../src/core/client");
  const { createSseTransport: sseOf } =
    await import("../../src/core/transports");
  const { createManualClock } = await import("../support/client");
  const manual = createManualClock(1_000);
  const intents: { kind: string }[] = [];
  const client = create({
    accountId: "account-a",
    conversationId: h.conversation,
    platform: { ...platform, clock: manual.clock },
    transport: sseOf(h.request, { subscribe: () => () => {} }),
    plans: {
      read: (options.read as never) ?? (() => h.read()),
      heartbeat: async () => {},
      request: async () => {},
      intent: async (intent) => {
        intents.push(intent);
        return options.intent
          ? ((await options.intent(intent)) as never)
          : ((await h.post(`/plans/${intent.planId}/safety-control`, intent))
              .body as never);
      },
    },
  });
  await client.ready;
  client.setPlan(await h.read());
  return { client, manual, release, intents };
}

const loaded = (client: { keepChangesReview(): object }) => {
  const review = client.keepChangesReview() as { disabled?: string };
  return review.disabled !== "loading";
};

describe("presses during a cold load are decided when they are made", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("a Cancel pressed while a Stop is loading is refused, also after the Stop's load expired", async () => {
    const h = await protectedHost();
    try {
      const { client, manual, release, intents } = await heldClient(h);
      client.stopPlan();
      await manual.advance(9_000);
      void client.declinePlan();
      await Promise.resolve();
      expect(client.getSnapshot().problem).toEqual({
        code: "refused",
        id: "intentPending",
      });
      await manual.advance(2_000);
      release();
      await manual.advance(0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        intents.filter((intent) => intent.kind === "cancel-initial"),
      ).toEqual([]);
      expect((await h.read()).recovery?.phase).not.toBe("cancelled");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a Stop pressed while a Cancel is loading is let through and wins", async () => {
    const h = await protectedHost();
    try {
      const { client, manual, release, intents } = await heldClient(h);
      void client.declinePlan();
      await manual.advance(1_000);
      client.stopPlan();
      release();
      await until(() => intents.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(intents.map((intent) => intent.kind)).toEqual(["stop"]);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("an identical press joins the reservation and its first deadline; nothing is sent after it", async () => {
    const h = await protectedHost();
    try {
      const { client, manual, release, intents } = await heldClient(h);
      const settled = { a: false, b: false, checking: false };
      void client.declinePlan().then(() => (settled.a = true));
      await manual.advance(9_000);
      void client.declinePlan().then(() => (settled.b = true));
      void client.checkIntentStatus().then(() => (settled.checking = true));
      await manual.advance(1_000);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toEqual({ a: true, b: true, checking: true });
      await manual.advance(1_000);
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(intents).toEqual([]);
      expect((await h.read()).recovery?.phase).toBe("initial-review");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a Stop pressed again after an unrelated review replacement joins; a changed round is refused", async () => {
    const h = await protectedHost();
    try {
      const { client, release, intents } = await heldClient(h);
      const first = client.getSnapshot().plan!;
      client.stopPlan();
      const replaced = (await h.control({ operation: "replace-review" }))
        .body as PlanRecord;
      expect(replaced.recovery?.revision).toBeGreaterThan(
        first.recovery!.revision,
      );
      expect(replaced.recovery?.round).toBe(first.recovery!.round);
      expect(replaced.recovery?.slots.stop).toBe(first.recovery!.slots.stop);
      client.setPlan(replaced);
      expect(client.getSnapshot().plan?.recovery?.revision).toBe(
        replaced.recovery?.revision,
      );
      client.stopPlan();
      expect(client.getSnapshot().problem).toBeNull();
      // A changed round is a different Stop: refused at once.
      client.setPlan({
        ...replaced,
        recovery: {
          ...replaced.recovery!,
          revision: replaced.recovery!.revision + 1,
          round: replaced.recovery!.round + 1,
        },
      });
      client.stopPlan();
      expect(client.getSnapshot().problem).toEqual({
        code: "refused",
        id: "intentPending",
      });
      release();
      await until(() => intents.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(intents.map((intent) => intent.kind)).toEqual(["stop"]);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a reservation ends with its conversation: back in it, a new press is decided afresh", async () => {
    const h = await protectedHost();
    try {
      const { client, manual, release, intents } = await heldClient(h);
      let stopped = false;
      client.stopPlan();
      void client.checkIntentStatus("plan-p").then(() => (stopped = true));
      const other = (
        (await h.post("/conversations", { protocol: "1.0", title: "Other" }))
          .body as { id: string }
      ).id;
      await client.switchConversation(other);
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Status of the retired reservation settles with its scope.
      expect(stopped).toBe(true);
      await client.switchConversation(h.conversation);
      await manual.advance(1_000);
      client.setPlan(
        (await h.control({ operation: "replace-review" })).body as PlanRecord,
      );
      const declining = client.declinePlan();
      expect(client.getSnapshot().problem).toBeNull();
      release();
      await declining;
      expect(intents.map((intent) => intent.kind)).toEqual(["cancel-initial"]);
      expect((await h.read()).recovery?.phase).toBe("cancelled");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("status during a cold load settles with the reserved operation, even if the import never settles", async () => {
    const h = await protectedHost();
    try {
      const { client, manual } = await heldClient(h);
      const declining = client.declinePlan();
      let settled = false;
      const checking = client.checkIntentStatus().then(() => (settled = true));
      await manual.advance(9_000);
      // It joins the reserved press instead of answering at once.
      expect(settled).toBe(false);
      await manual.advance(1_000);
      await declining;
      await Promise.race([
        checking,
        new Promise((resolve) => setTimeout(resolve, 50)),
      ]);
      expect(settled).toBe(true);
      expect(client.getSnapshot().problem).toEqual({
        code: "retryable",
        id: "intent-load",
      });
      // Nothing is reserved any more: status answers at once.
      await client.checkIntentStatus();
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("the factual read is published through the gate, and only while it owns the plan", () => {
  it("a resolved intent's read publishes the newer record", async () => {
    const h = await protectedHost();
    try {
      const client = await h.open();
      client.setPlan(await h.read());
      await client.declinePlan();
      await until(
        () => client.getSnapshot().plan?.recovery?.phase === "cancelled",
      );
      expect(client.getSnapshot().plan?.recovery?.revision).toBe(
        (await h.read()).recovery?.revision,
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a read that misses its budget reports plan-read and is not published when it arrives later", async () => {
    const h = await protectedHost();
    try {
      let hold = false;
      let late!: (record: unknown) => void;
      const { client, manual, release } = await heldClient(h, {
        read: (id) =>
          hold ? new Promise((resolve) => (late = resolve)) : h.read(id),
      });
      release();
      await until(() => loaded(client));
      const before = client.getSnapshot().plan;
      hold = true;
      const declining = client.declinePlan();
      await until(async () => (await h.read()).recovery?.phase === "cancelled");
      await declining;
      await manual.advance(10_000);
      expect(client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "plan-read",
      });
      late(await h.read());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(client.getSnapshot().plan).toBe(before);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("a read held across navigation is neither published nor reported", async () => {
    const h = await protectedHost();
    try {
      let hold = false;
      let late!: (record: unknown) => void;
      const { client, manual, release } = await heldClient(h, {
        read: (id) =>
          hold ? new Promise((resolve) => (late = resolve)) : h.read(id),
      });
      release();
      await until(() => loaded(client));
      hold = true;
      const declining = client.declinePlan();
      await until(async () => (await h.read()).recovery?.phase === "cancelled");
      await declining;
      const other = (
        (await h.post("/conversations", { protocol: "1.0", title: "Other" }))
          .body as { id: string }
      ).id;
      hold = false;
      await client.switchConversation(other);
      await manual.advance(10_000);
      late(await h.read());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(client.getSnapshot().problem).toBeNull();
      expect(client.getSnapshot().plan?.recovery?.phase).not.toBe("cancelled");
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("a factual read superseded by publication", () => {
  it("reports nothing when its budget runs out", async () => {
    const h = await protectedHost();
    try {
      let hold = false;
      const { client, manual, release } = await heldClient(h, {
        read: (id) => (hold ? new Promise(() => {}) : h.read(id)),
      });
      release();
      await until(() => loaded(client));
      hold = true;
      await client.declinePlan();
      expect((await h.read()).recovery?.phase).toBe("cancelled");
      // The newer record is adopted through the gate; the held read lost.
      client.setPlan(await h.read());
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("cancelled");
      await manual.advance(10_000);
      expect(client.getSnapshot().problem).toBeNull();
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("sign-in recovery through negotiation", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/intent");
    vi.resetModules();
  });
  it("a successful renegotiation after a 401 sends the intent once more", async () => {
    const h = await protectedHost();
    try {
      let first = true;
      let expire = false;
      let holdReads = false;
      const sse = createSseTransport(h.request, { subscribe: () => () => {} });
      let negotiated = 0;
      let intents = 0;
      const client = createWaypointClient({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: {
          ...sse,
          negotiate: async (supported, offer) => {
            const answer = await sse.negotiate(supported, offer);
            negotiated++;
            return answer;
          },
          read: async (id, context) => {
            if (holdReads) return new Promise(() => {});
            if (expire) {
              expire = false;
              holdReads = true;
              throw new ConversationReadError(id, 409, {
                code: "agreement-expired",
                id: "agreement",
              });
            }
            return sse.read(id, context);
          },
        },
        plans: {
          read: () => h.read(),
          heartbeat: async () => {},
          request: async () => {},
          intent: async (intent) => {
            intents++;
            if (first) {
              first = false;
              throw Object.assign(new Error("401"), { status: 401 });
            }
            return (
              await h.post(`/plans/${intent.planId}/safety-control`, intent)
            ).body as never;
          },
        },
      });
      await client.ready;
      client.setPlan(await h.read());
      await client.declinePlan();
      expect(
        client.getSnapshot().intentOverlays["plan-p"]?.lastProblem?.cause,
      ).toBe("sign-in");
      expect(intents).toBe(1);
      expect(negotiated).toBe(1);
      expire = true;
      void client.refresh().catch(() => undefined);
      await until(() => negotiated === 2);
      await until(() => intents === 2);
      client.dispose();
    } finally {
      await h.close();
    }
  });
});
