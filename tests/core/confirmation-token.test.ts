import { describe, expect, it } from "vitest";
import {
  asProblem,
  confirmationOf,
  ConversationReadError,
  createWaypointClient,
} from "../../src/core/client";
import { createSseTransport } from "../../src/core/transports";
import type { PlanRecord, Reply } from "../../src/protocol/generated";
import samples from "../protocol/samples.json";
import { config, platform } from "../support/client";
import { protectedHost, until } from "../support/protected";
import { createFixtureServer } from "../../fixtures/server/index";

const awaiting = (confirmation = true) => {
  const record = structuredClone(samples.PlanRecord) as PlanRecord;
  record.state = "awaiting-confirmation";
  if (!confirmation) delete record.confirmation;
  return record;
};
const capture = (answer: (reply: Reply) => unknown = () => ({ id: "x" })) => {
  const sent: Reply[] = [];
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async (reply) => {
        sent.push(reply);
        const result = answer(reply);
        if (result instanceof Error || (result as { code?: string }).code)
          throw result;
        return result as never;
      },
    },
  });
  return { client, sent };
};

describe("confirming with the host's token", () => {
  it("CK-E1 a plan without a confirmation record sends nothing", async () => {
    const { client, sent } = capture();
    await client.ready;
    client.setPlan(awaiting(false));
    await client.confirmPlan();
    expect(sent).toEqual([]);
    client.dispose();
  });
  it.each([
    ["another conversation", { conversationId: "conversation-b" }],
    ["another plan", { planId: "plan-b" }],
  ])("CK-R3-wire a record issued for %s sends nothing", async (_, over) => {
    const { client, sent } = capture();
    await client.ready;
    const record = awaiting();
    Object.assign(record.confirmation!, over);
    client.setPlan(record);
    await client.confirmPlan();
    expect(sent).toEqual([]);
    client.dispose();
  });
  it("CK-R-revision a protected plan's record for another revision is not its confirmation; its own revision is", () => {
    const record = awaiting();
    record.recovery = {
      ...(structuredClone(samples.RecoveryView) as NonNullable<
        PlanRecord["recovery"]
      >),
      phase: "initial-review",
      revision: 3,
    };
    record.confirmation!.revision = 2;
    expect(confirmationOf(record, "conversation-a")).toBeUndefined();
    record.confirmation!.revision = 3;
    expect(confirmationOf(record, "conversation-a")).toBe(record.confirmation);
    expect(confirmationOf(record, "conversation-b")).toBeUndefined();
  });
  it("CK-A1-wire an immediate plan sends its token and its digest", async () => {
    const { client, sent } = capture();
    await client.ready;
    client.setPlan(awaiting());
    await client.confirmPlan();
    expect(sent).toEqual([
      expect.objectContaining({
        kind: "confirm",
        planId: "plan-a",
        confirmationToken: "confirmation-token",
        digest: "plan-digest",
      }),
    ]);
    client.dispose();
  });
  it("CK-sched-timed a timed plan sends only its token, through the same confirmation", async () => {
    const { client, sent } = capture();
    await client.ready;
    const record = awaiting();
    record.plan = structuredClone(samples.TimedPlan) as PlanRecord["plan"];
    client.setPlan(record);
    await client.confirmPlan();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "confirm",
      confirmationToken: "confirmation-token",
    });
    expect(sent[0]).not.toHaveProperty("digest");
    client.dispose();
  });
  it.each(["expired", "used", "stale", "mismatch", "missing"] as const)(
    "CK-H-reason a %s refusal keeps its reason through problem normalization",
    async (reason) => {
      const { client } = capture(() => ({
        code: "refused",
        id: "host",
        confirmation: { reason },
      }));
      await client.ready;
      client.setPlan(awaiting());
      await client.confirmPlan();
      expect(client.getSnapshot().problem).toMatchObject({
        code: "refused",
        confirmation: { reason },
      });
      client.dispose();
    },
  );
  it("CK-P-rate-wire a refused reply keeps the host's wait", async () => {
    const { client } = capture(() => ({
      code: "rate-limited",
      id: "host",
      retryAfter: 60,
    }));
    await client.ready;
    client.setPlan(awaiting());
    await client.confirmPlan();
    expect(client.getSnapshot().problem).toMatchObject({
      code: "rate-limited",
      retryAfter: 60,
    });
    client.dispose();
  });
  it.each([-1, 1.5, "60", Number.NaN, null])(
    "CK-P-rate-malformed a wait of %s is dropped",
    (retryAfter) => {
      expect(
        asProblem({ code: "rate-limited", id: "h", retryAfter }, "r"),
      ).toEqual({ code: "rate-limited", id: "r" });
    },
  );
  it("CK-P-rate-read a refused read keeps the host's wait too", () => {
    expect(
      new ConversationReadError("conversation-a", 429, {
        code: "rate-limited",
        id: "read",
        retryAfter: 5,
      }).problem,
    ).toEqual({ code: "rate-limited", id: "read", retryAfter: 5 });
  });
  it("CK-P-rate-zero a wait of zero is kept", () => {
    expect(
      asProblem({ code: "rate-limited", id: "h", retryAfter: 0 }, "r"),
    ).toEqual({ code: "rate-limited", id: "r", retryAfter: 0 });
  });
  it.each([
    [
      "an unknown reason",
      { code: "refused", id: "h", confirmation: { reason: "other" } },
    ],
    [
      "a reason on another code",
      { code: "unavailable", id: "h", confirmation: { reason: "used" } },
    ],
    ["a malformed reason", { code: "refused", id: "h", confirmation: "used" }],
  ])("CK-H-unknown %s is an ordinary problem", async (_, body) => {
    const { client } = capture(() => body);
    await client.ready;
    client.setPlan(awaiting());
    await client.confirmPlan();
    expect(client.getSnapshot().problem).not.toHaveProperty("confirmation");
    client.dispose();
  });
});

describe("the reference host through the HTTP transport", () => {
  it("CK-H-e2e a token another caller consumed is refused as used, and the reason reaches the client", async () => {
    const h = await protectedHost();
    try {
      // This window adopts the record before another caller confirms it.
      const client = await h.open();
      const record = client.getSnapshot().plan!;
      expect(record.confirmation?.token).toBeDefined();
      await h.post(`/conversations/${h.conversation}/replies`, {
        kind: "confirm",
        protocol: "1.0",
        clientReplyId: "elsewhere",
        planId: "plan-p",
        digest: (record.plan as { digest: string }).digest,
        confirmationToken: record.confirmation?.token,
      });
      await client.confirmPlan();
      expect(client.getSnapshot().problem).toMatchObject({
        code: "refused",
        confirmation: { reason: "used" },
      });
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-M1 a lost acceptance response leaves the plan accepted; the retry is refused as used and nothing runs", async () => {
    const h = await protectedHost();
    try {
      let drop = true;
      const writes: string[] = [];
      const lossy: typeof h.request = async (path, init) => {
        const result = await h.request(path, init);
        if (path.endsWith("/replies") && drop) {
          drop = false;
          throw new Error("connection lost after the host committed");
        }
        return result;
      };
      const client = createWaypointClient({
        accountId: "account-a",
        conversationId: h.conversation,
        platform,
        transport: createSseTransport(lossy, { subscribe: () => () => {} }),
        plans: {
          read: () => h.read(),
          heartbeat: async () => {},
          request: async (canonical) => {
            writes.push(canonical.path);
          },
          intent: async (body) =>
            (await h.post(`/plans/${body.planId}/safety-control`, body))
              .body as never,
        },
      });
      await client.ready;
      const record = await h.read();
      client.setPlan(record);
      await client.confirmPlan();
      expect((await h.read()).recovery?.phase).toBe("forward-active");
      await client.confirmPlan();
      expect(client.getSnapshot().problem).toMatchObject({
        code: "refused",
        confirmation: { reason: "used" },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(writes).toEqual([]);
      const replies = h.calls.filter((call) => call.path.endsWith("/replies"));
      expect(replies).toHaveLength(2);
      expect(JSON.parse(replies[0]!.body!).clientReplyId).toBe(
        JSON.parse(replies[1]!.body!).clientReplyId,
      );
      client.setPlan(await h.read());
      await until(
        () => client.getSnapshot().plan?.recovery?.phase === "forward-active",
      );
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-M1-reread after a refusal, reading the plan again shows its factual state and runs nothing", async () => {
    const h = await protectedHost();
    try {
      const steps: string[] = [];
      const client = await h.open({
        request: async (canonical) => {
          steps.push(canonical.path);
        },
      });
      const shown = client.getSnapshot().plan!;
      await h.post(`/conversations/${h.conversation}/replies`, {
        kind: "confirm",
        protocol: "1.0",
        clientReplyId: "elsewhere",
        planId: "plan-p",
        digest: (shown.plan as { digest: string }).digest,
        confirmationToken: shown.confirmation?.token,
      });
      await client.confirmPlan();
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("initial-review");
      await client.readPlan();
      expect(client.getSnapshot().plan?.recovery?.phase).toBe("forward-active");
      expect(client.getSnapshot().plan?.confirmation).toBeUndefined();
      expect(steps).toEqual([]);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("CK-M3 a lost schedule response: the retry is refused as used, never enrolled twice", async () => {
    let enrolled = 0;
    const consumed = new Set<string>();
    const { client, sent } = capture((reply) => {
      if (reply.kind !== "confirm") return { id: "x" };
      if (consumed.has(reply.confirmationToken))
        return {
          code: "refused",
          id: reply.clientReplyId,
          confirmation: { reason: "used" },
        };
      consumed.add(reply.confirmationToken);
      enrolled++;
      return new Error("connection lost after enrollment");
    });
    await client.ready;
    const record = awaiting();
    record.plan = structuredClone(samples.TimedPlan) as PlanRecord["plan"];
    client.setPlan(record);
    await client.confirmPlan();
    await client.confirmPlan();
    expect(enrolled).toBe(1);
    expect(sent).toHaveLength(2);
    expect(client.getSnapshot().problem).toMatchObject({
      confirmation: { reason: "used" },
    });
    client.dispose();
  });
});

describe("the reference host's timed plan", () => {
  it("CK-I-issue-timed CK-M3-host a timed plan's record carries every field; its token enrolls it once, the readback shows it scheduled, and a retry is refused as used", async () => {
    const host = await createFixtureServer({ testMode: true });
    try {
      const session = (await (
        await fetch(host.url + "/__conformance/session", { method: "POST" })
      ).json()) as { session: string; csrf: string };
      const call = async (path: string, body?: unknown) => {
        const response = await fetch(host.url + path, {
          method: body ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            Cookie: `waypoint=${session.session}`,
            "X-CSRF-Token": session.csrf,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        return {
          status: response.status,
          body: text ? JSON.parse(text) : null,
        };
      };
      await call("/__conformance/script", { planScenario: "timed" });
      const record = (await call("/plans/plan-a")).body as PlanRecord;
      expect(record.state).toBe("awaiting-confirmation");
      expect(Object.keys(record.confirmation!).sort()).toEqual([
        "actionLabel",
        "conversationId",
        "expiresAt",
        "heading",
        "irreversible",
        "items",
        "planId",
        "revision",
        "schedule",
        "token",
        "undo",
        "verificationCount",
      ]);
      expect(record.confirmation).toMatchObject({
        planId: "plan-a",
        conversationId: "conversation-a",
        heading: "Schedule 1 change in items",
        schedule: {
          start: "2026-12-01T10:30:00.000Z",
          end: null,
          startText: "1 Dec 2026, 10:30 UTC",
          endText: "No end date",
        },
        actionLabel: "Schedule 1 change",
      });
      const confirm = (clientReplyId: string) =>
        call("/conversations/conversation-a/replies", {
          kind: "confirm",
          protocol: "1.0",
          clientReplyId,
          planId: "plan-a",
          confirmationToken: record.confirmation!.token,
        });
      expect(await confirm("schedule-a")).toEqual({
        status: 200,
        body: { id: "schedule-a" },
      });
      const enrolled = (await call("/plans/plan-a")).body as PlanRecord;
      expect(enrolled.state).toBe("submitted");
      expect(enrolled.confirmation).toBeUndefined();
      for (const retry of ["schedule-a", "schedule-b"])
        expect(await confirm(retry)).toEqual({
          status: 409,
          body: {
            code: "refused",
            id: retry,
            confirmation: { reason: "used" },
          },
        });
      expect(((await call("/plans/plan-a")).body as PlanRecord).state).toBe(
        "submitted",
      );
    } finally {
      await host.close();
    }
  });
});

describe("bindings that hold until the answer", () => {
  it("CK-R-revision-missing a record without a revision is no plan's confirmation and sends nothing; a legacy record with one is", async () => {
    const valid = awaiting();
    expect(confirmationOf(valid, "conversation-a")).toBe(valid.confirmation);
    const missing = awaiting();
    delete (missing.confirmation as { revision?: number }).revision;
    expect(confirmationOf(missing, "conversation-a")).toBeUndefined();
    const fractional = awaiting();
    fractional.confirmation!.revision = 1.5;
    expect(confirmationOf(fractional, "conversation-a")).toBeUndefined();
    const { client, sent } = capture();
    await client.ready;
    client.setPlan(missing);
    await client.confirmPlan();
    expect(sent).toEqual([]);
    client.dispose();
  });
  it.each([
    ["a conversation read", "conversation-read"],
    ["a plan read", "plan-read"],
  ])(
    "CK-P-rate-%s a refused read keeps the host's wait on the problem it reports",
    async (_, id) => {
      const refusal = {
        code: "rate-limited",
        id: "host",
        retryAfter: 60,
      };
      const base = config();
      let failRead = false;
      const client = createWaypointClient({
        ...base,
        transport: {
          ...base.transport,
          read: async (...args) => {
            if (failRead && id === "conversation-read")
              throw new ConversationReadError("conversation-a", 429, refusal);
            return base.transport.read(...args);
          },
        },
        plans: {
          read: async () => {
            throw refusal;
          },
          request: async () => {},
          heartbeat: async () => {},
        },
      });
      await client.ready;
      client.setPlan(awaiting());
      failRead = true;
      if (id === "conversation-read") await client.refresh();
      else await client.readPlan();
      expect(client.getSnapshot().problem).toEqual({
        code: "rate-limited",
        id,
        retryAfter: 60,
      });
      client.dispose();
    },
  );
  it("CK-P-rate-read-plain a refused read without a valid wait stays an ordinary unavailable read", async () => {
    const base = config();
    let failRead = false;
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (...args) => {
          if (failRead)
            throw new ConversationReadError("conversation-a", 429, {
              code: "rate-limited",
              id: "host",
              retryAfter: 1.5,
            });
          return base.transport.read(...args);
        },
      },
    });
    await client.ready;
    failRead = true;
    await client.refresh();
    expect(client.getSnapshot().problem).toEqual({
      code: "unavailable",
      id: "conversation-read",
    });
    client.dispose();
  });
  it("CK-H-own the client records a refusal only for the confirmation attempt that received it", async () => {
    let release!: () => void;
    const { client } = capture((reply) =>
      reply.clientReplyId === "unrelated"
        ? { code: "refused", id: "unrelated", confirmation: { reason: "used" } }
        : new Promise((resolve) => {
            release = () => resolve({ id: "x" });
          }),
    );
    await client.ready;
    client.setPlan(awaiting());
    const pressed = client.confirmPlan();
    await until(() => release !== undefined);
    await client.reply({
      kind: "confirm",
      clientReplyId: "unrelated",
      planId: "plan-a",
      confirmationToken: "confirmation-token",
    } as never);
    // Another reply's refusal arrives while this attempt is in flight.
    expect(client.getSnapshot().problem?.id).toBe("unrelated");
    release();
    await pressed;
    expect(client.getSnapshot().confirmationRefusal).toBeUndefined();
    client.dispose();
  });
  it("CK-H-own-positive a refusal of the attempt itself is recorded with its token", async () => {
    const { client } = capture(() => ({
      code: "refused",
      id: "host",
      confirmation: { reason: "used" },
    }));
    await client.ready;
    client.setPlan(awaiting());
    await client.confirmPlan();
    expect(client.getSnapshot().confirmationRefusal).toEqual({
      token: "confirmation-token",
      problemId: client.getSnapshot().problem!.id,
    });
    client.dispose();
  });
});

describe("an undo retry is bound at its press", () => {
  const harness = async () => {
    const calls: string[] = [];
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    const client = createWaypointClient({
      ...config(),
      plans: {
        read: async () => structuredClone(record),
        request: async () => {},
        heartbeat: async () => {},
        retryUndo: async (id) => {
          calls.push(id);
          return structuredClone(record);
        },
      },
    });
    await client.ready;
    client.setPlan(structuredClone(record));
    return { client, calls, record };
  };
  it("CK-U-bound the press dispatches for the plan it was made on", async () => {
    const { client, calls } = await harness();
    await client.retryUndo();
    expect(calls).toEqual(["plan-a"]);
    client.dispose();
  });
  it("CK-U-switch a conversation change while its code loads refuses it", async () => {
    const { client, calls } = await harness();
    const retrying = client.retryUndo();
    const switching = client.switchConversation("conversation-b");
    await retrying;
    await switching;
    expect(calls).toEqual([]);
    client.dispose();
  });
  it("CK-U-republished a newer record of the same plan published while its code loads refuses it", async () => {
    const { client, calls, record } = await harness();
    const retrying = client.retryUndo();
    client.setPlan({ ...structuredClone(record), state: "completed" });
    await retrying;
    expect(calls).toEqual([]);
    client.dispose();
  });
  it("CK-U-replaced another plan shown while its code loads refuses it", async () => {
    const { client, calls, record } = await harness();
    const retrying = client.retryUndo();
    client.setPlan({ ...structuredClone(record), id: "plan-b" });
    await retrying;
    expect(calls).toEqual([]);
    client.dispose();
  });
});
