import { it, expect, describe } from "vitest";
import { request as httpRequest } from "node:http";
import { protectedHost, until } from "../support/protected";
import { createPlanRunner } from "../../src/core/runner";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import type { PlanRecord } from "../../src/protocol/generated";

type Host = Awaited<ReturnType<typeof protectedHost>>;
const truth = (record: PlanRecord) =>
  Object.fromEntries(
    (record.recovery?.steps ?? []).map((step) => [step.stepId, step.truth]),
  );
// The confirmation token each plan was first offered with, so a retry of
// the accepting confirmation sends the same one.
const tokens = new WeakMap<Host, Map<string, string | undefined>>();
const tokenOf = (h: Host, record: PlanRecord) => {
  const known = tokens.get(h) ?? new Map<string, string | undefined>();
  tokens.set(h, known);
  if (!known.has(record.id) || record.confirmation)
    known.set(record.id, record.confirmation?.token ?? known.get(record.id));
  return known.get(record.id);
};
// Accepts a protected plan directly over HTTP and returns its acceptance.
async function accept(h: Host, planId: string, conversation = h.conversation) {
  const record = await h.read(planId);
  const result = await h.post(`/conversations/${conversation}/replies`, {
    kind: "confirm",
    protocol: "1.0",
    clientReplyId: `confirm-${planId}`,
    planId,
    digest: (record.plan as { digest: string }).digest,
    confirmationToken: tokenOf(h, record),
  });
  return result;
}
const stopBody = (
  record: PlanRecord,
  overrides: Record<string, unknown> = {},
) => ({
  kind: "stop",
  planId: record.id,
  target: record.recovery!.executionId
    ? { type: "execution", id: record.recovery!.executionId }
    : { type: "generation", id: record.recovery!.generation },
  capturedRound: record.recovery!.round,
  expectedSlotVersion: record.recovery!.slots.stop,
  correlation: "sec-1",
  cause: "user",
  ...overrides,
});
async function asPrincipal(h: Host, principal: string) {
  const session = (await (
    await fetch(`${h.host.url}/__conformance/session?principal=${principal}`, {
      method: "POST",
    })
  ).json()) as { session: string; csrf: string };
  return (path: string, body?: unknown, method = body ? "POST" : "GET") =>
    fetch(h.host.url + path, {
      method,
      headers: {
        Cookie: `waypoint=${session.session}`,
        "X-CSRF-Token": session.csrf,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe("effects use only the host's own execution record", () => {
  it("another plan's live execution cannot carry an effect onto a stopped plan's resource", async () => {
    const h = await protectedHost(["a"]);
    try {
      await h.control({
        operation: "create",
        planId: "plan-q",
        rows: ["b"],
        conversationId: h.conversation,
      });
      const first = (await accept(h, "plan-p")).body as {
        acceptance: { executionId: string; fence: number };
      };
      await accept(h, "plan-q");
      const stopped = await h.read("plan-q");
      await h.post("/plans/plan-q/safety-control", stopBody(stopped));
      for (const step of ["plan-p.0", "plan-q.0"]) {
        const result = await h.request("/protected-items/b", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Waypoint-Step": step,
            "Waypoint-Execution": first.acceptance.executionId,
            "Waypoint-Fence": String(first.acceptance.fence),
          },
          body: '{"title":"After"}',
        });
        expect(result.status, step).toBe(409);
      }
      expect(truth(await h.read("plan-q"))).toEqual({ "step-b": "not-done" });
      expect(truth(await h.read("plan-p"))).toEqual({ "step-a": "unknown" });
      // The step header must name the execution's own plan.
      const misnamed = await h.request("/protected-items/a", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Waypoint-Step": "plan-q.0",
          "Waypoint-Execution": first.acceptance.executionId,
          "Waypoint-Fence": String(first.acceptance.fence),
        },
        body: '{"title":"After"}',
      });
      expect(misnamed.status).toBe(409);
      expect(truth(await h.read("plan-p"))).toEqual({ "step-a": "unknown" });
      // Positive control: the exact accepted operation still applies.
      const own = await h.request("/protected-items/a", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Waypoint-Step": "plan-p.0",
          "Waypoint-Execution": first.acceptance.executionId,
          "Waypoint-Fence": String(first.acceptance.fence),
        },
        body: '{"title":"After"}',
      });
      expect(own.status).toBe(200);
      expect(truth(await h.read("plan-p"))).toEqual({ "step-a": "done" });
    } finally {
      await h.close();
    }
  });
});

describe("protected commands need scoped permission and a matching conversation", () => {
  it("another principal is refused everywhere until granted", async () => {
    const h = await protectedHost(["a"]);
    try {
      const other = await asPrincipal(h, "other");
      const record = await h.read();
      expect((await other("/plans/plan-p")).status).toBe(403);
      expect(
        (await other("/plans/plan-p/safety-control", stopBody(record))).status,
      ).toBe(403);
      expect(
        (
          await other(`/conversations/${h.conversation}/replies`, {
            kind: "confirm",
            protocol: "1.0",
            clientReplyId: "x",
            planId: "plan-p",
            digest: (record.plan as { digest: string }).digest,
          })
        ).status,
      ).toBe(403);
      expect((await h.read()).recovery).toEqual(record.recovery);
      await h.control({ operation: "grant", principal: "other" });
      const granted = await other(
        "/plans/plan-p/safety-control",
        stopBody(record),
      );
      expect(granted.status).toBe(200);
    } finally {
      await h.close();
    }
  });
  it("a confirmation through another conversation's route is refused as a mismatched token", async () => {
    const h = await protectedHost(["a"]);
    try {
      const result = await accept(h, "plan-p", "conversation-elsewhere");
      expect(result).toEqual({
        status: 409,
        body: {
          code: "refused",
          id: "confirm-plan-p",
          confirmation: { reason: "mismatch" },
        },
      });
      expect((await h.read()).recovery?.phase).toBe("initial-review");
    } finally {
      await h.close();
    }
  });
  it("an intent's body cannot select a different plan than its route", async () => {
    const h = await protectedHost(["a"]);
    try {
      await h.control({
        operation: "create",
        planId: "plan-q",
        rows: ["b"],
        conversationId: h.conversation,
      });
      const target = await h.read("plan-q");
      const result = await h.post(
        "/plans/plan-q/safety-control",
        stopBody(target, { planId: "plan-p" }),
      );
      expect(result).toMatchObject({
        status: 400,
        body: { id: "plan-mismatch" },
      });
      expect((await h.read("plan-q")).recovery).toEqual(target.recovery);
    } finally {
      await h.close();
    }
  });
  it("an authenticated request without CSRF is refused", async () => {
    const h = await protectedHost(["a"]);
    try {
      const session = (await (
        await fetch(`${h.host.url}/__conformance/session`, { method: "POST" })
      ).json()) as { session: string };
      const result = await fetch(`${h.host.url}/plans/plan-p/safety-control`, {
        method: "POST",
        headers: {
          Cookie: `waypoint=${session.session}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(stopBody(await h.read())),
      });
      expect(result.status).toBe(403);
    } finally {
      await h.close();
    }
  });
});

describe("intent bodies are validated and bounded first", () => {
  for (const [name, body] of [
    ["empty", {}],
    ["unknown kind", { kind: "leave" }],
    ["unknown field", { extra: 1 }],
    ["oversize payload", { payload: "x".repeat(4097) }],
    ["oversize multibyte payload", { payload: "é".repeat(2049) }],
    ["non-integer round", { capturedRound: 1.5 }],
    ["bad token", { correlation: "has space" }],
  ] as const)
    it(`refuses ${name} with a fixed problem and changes nothing`, async () => {
      const h = await protectedHost(["a"]);
      try {
        const record = await h.read();
        const request =
          name === "empty" ? {} : { ...stopBody(record), ...body };
        const result = await h.post("/plans/plan-p/safety-control", request);
        expect(result).toEqual({
          status: 400,
          body: { code: "refused", id: "intent-invalid" },
        });
        expect((await h.read()).recovery).toEqual(record.recovery);
      } finally {
        await h.close();
      }
    });
  it("accepts a payload of exactly the limit and refuses a body over its size bound", async () => {
    const h = await protectedHost(["a"]);
    try {
      const record = await h.read();
      const exact = await h.post(
        "/plans/plan-p/safety-control",
        stopBody(record, { payload: "é".repeat(2048) }),
      );
      expect((exact.body as { result: string }).result).toBe("applied");
      // A body over the bound is refused even when its fields are valid.
      const padded = await h.request("/plans/plan-p/safety-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          JSON.stringify(stopBody(record, { correlation: "sec-2" })) +
          " ".repeat(9000),
      });
      expect(padded).toEqual({
        status: 413,
        body: { code: "refused", id: "body-too-large" },
      });
      const huge = await h.request("/plans/plan-p/safety-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...stopBody(record),
          padding: "x".repeat(9000),
        }),
      });
      expect(huge.status).toBe(413);
    } finally {
      await h.close();
    }
  });
});

const used = (id: string) => ({
  status: 409,
  body: { code: "refused", id, confirmation: { reason: "used" } },
});
describe("a consumed confirmation is never accepted again", () => {
  it("a retry of the same confirmation is refused as used without new authority, also after the run ended", async () => {
    const h = await protectedHost(["a"]);
    try {
      const first = await accept(h, "plan-p");
      expect((first.body as { acceptance?: unknown }).acceptance).toBeDefined();
      const accepted = (await h.read()).recovery;
      expect(await accept(h, "plan-p")).toEqual(used("confirm-plan-p"));
      expect((await h.read()).recovery).toEqual(accepted);
      await h.post("/plans/plan-p/safety-control", stopBody(await h.read()));
      expect(await accept(h, "plan-p")).toEqual(used("confirm-plan-p"));
      // A different command with the consumed token is refused as used.
      const other = await h.post(`/conversations/${h.conversation}/replies`, {
        kind: "confirm",
        protocol: "1.0",
        clientReplyId: "confirm-other",
        planId: "plan-p",
        digest: ((await h.read()).plan as { digest: string }).digest,
        confirmationToken: tokenOf(h, await h.read()),
      });
      expect(other).toEqual(used("confirm-other"));
    } finally {
      await h.close();
    }
  });
});

describe("protected runs start only under their private acceptance", () => {
  it("the runner refuses a protected record without acceptance before renewal or dispatch", async () => {
    const h = await protectedHost(["a"]);
    try {
      await accept(h, "plan-p");
      const record = await h.read();
      let renewals = 0;
      let dispatches = 0;
      const runner = createPlanRunner({
        read: async () => record,
        heartbeat: async () => {
          renewals++;
        },
        request: async () => {
          dispatches++;
        },
      });
      await expect(
        runner.run("plan-p", (record.plan as { digest: string }).digest),
      ).rejects.toThrow("unauthorized-run");
      await expect(
        runner.run("plan-p", (record.plan as { digest: string }).digest, {
          planId: "plan-p",
          executionId: "plan-p.other",
          fence: 1,
        }),
      ).rejects.toThrow("unauthorized-run");
      expect([renewals, dispatches]).toEqual([0, 0]);
    } finally {
      await h.close();
    }
  });
  it("an observer's public runPlan or resumePlan is refused and does not stop the owner's run", async () => {
    const h = await protectedHost(["a"]);
    try {
      await accept(h, "plan-p");
      const observer = await h.open({
        resume: async (id) => h.read(id),
      });
      const digest = ((await h.read()).plan as { digest: string }).digest;
      await observer.runPlan("plan-p", digest);
      expect(observer.getSnapshot().problem).toEqual({
        code: "refused",
        id: "plan-p",
      });
      await observer.resumePlan();
      expect(h.calls.some((call) => call.path.endsWith("/heartbeat"))).toBe(
        false,
      );
      expect((await h.read()).recovery?.phase).toBe("forward-active");
      expect((await h.read()).recovery?.winner).toBeUndefined();
      observer.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("a failed plan read during a run submits the interruption Stop", () => {
  for (const failing of [2, 3])
    it(`read ${failing} fails: automatic Stop with connection-lost, then a problem`, async () => {
      const h = await protectedHost(["a"]);
      try {
        let reads = 0;
        let failed = false;
        const client = await h.open({
          read: async (id) => {
            reads++;
            if (reads === failing && !failed) {
              failed = true;
              throw new Error("offline");
            }
            return h.read(id);
          },
        });
        reads = 0;
        await client.confirmPlan();
        await until(
          async () => (await h.read()).recovery?.winner !== undefined,
        );
        expect((await h.read()).recovery?.winner).toEqual({
          kind: "stop",
          cause: "connection-lost",
        });
        expect(client.getSnapshot().problem?.code).toBe("unavailable");
        client.dispose();
      } finally {
        await h.close();
      }
    });
});

describe("the gate is final", () => {
  it("a record the gate rejects never drives execution or outside publication", async () => {
    const h = await protectedHost(["a"]);
    try {
      const published: PlanRecord[] = [];
      let first = true;
      const client = await h.open({
        read: async (id) => {
          const record = await h.read(id);
          if (record.recovery?.phase === "forward-active" && first) {
            first = false;
            return {
              ...record,
              recovery: { ...record.recovery, conversationId: "other" },
            };
          }
          return record;
        },
        onRecord: (record) => published.push(record),
      });
      await client.confirmPlan();
      expect(
        h.calls.some((call) => call.path.startsWith("/protected-items")),
      ).toBe(false);
      expect(
        published.every(
          (record) => record.recovery?.conversationId !== "other",
        ),
      ).toBe(true);
      expect((await h.read()).recovery?.winner).toEqual({
        kind: "stop",
        cause: "plan-changed",
      });
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("an older record read during a run is never published outside", async () => {
    const h = await protectedHost(["a", "b"]);
    try {
      const published: number[] = [];
      let stale: PlanRecord | undefined;
      let reads = 0;
      const client = await h.open({
        read: async (id) => {
          const record = await h.read(id);
          reads++;
          if (reads === 2) stale = structuredClone(record);
          // A later read answers with the older record once.
          if (reads === 4 && stale) return stale;
          return record;
        },
        onRecord: (record) => published.push(record.recovery!.revision),
      });
      reads = 0;
      await client.confirmPlan();
      expect(published.length).toBeGreaterThan(1);
      for (let index = 1; index < published.length; index++)
        expect(published[index]).toBeGreaterThan(published[index - 1]!);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("gate history survives showing another plan, and a missing recovery view is refused", async () => {
    const h = await protectedHost(["a"]);
    try {
      const client = await h.open();
      const p = client.getSnapshot().plan!;
      client.setPlan({
        ...structuredClone(p),
        recovery: { ...p.recovery!, revision: 50, phase: "cancelled" },
      });
      client.setPlan({
        protocol: "1.0",
        id: "plan-other",
        state: "proposed",
        outcomes: [],
        plan: p.plan,
      });
      client.setPlan(structuredClone(p));
      expect(client.getSnapshot().plan?.id).toBe("plan-other");
      expect(client.getSnapshot().problem).toBeNull();
      const legacy = structuredClone(p);
      delete legacy.recovery;
      client.setPlan(legacy);
      expect(client.getSnapshot().problem).toEqual({
        code: "invalid-plan",
        id: "plan-p",
      });
      expect(client.getSnapshot().plan?.id).toBe("plan-other");
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("an identical record changes nothing and notifies no one", async () => {
    const h = await protectedHost(["a"]);
    try {
      const client = await h.open();
      let notified = 0;
      client.subscribe(() => notified++);
      client.setPlan(structuredClone(client.getSnapshot().plan!));
      expect(notified).toBe(0);
      client.dispose();
    } finally {
      await h.close();
    }
  });
  it("recovery is enabled only when this client offered it, whatever the host echoes", async () => {
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        negotiate: async () => ({
          protocol: "1.0",
          capabilities: ["plans", "plan-recovery"],
        }),
      },
    });
    await client.ready;
    expect(client.getSnapshot().capabilities).toEqual(["plans"]);
    client.dispose();
  });
});

describe("serialized races at the host", () => {
  for (const order of ["stop first", "cancel first"] as const)
    it(`held Stop and Cancel arriving ${order}`, async () => {
      const h = await protectedHost(["a"]);
      try {
        await accept(h, "plan-p");
        const record = await h.read();
        await h.control({ operation: "hold", boundary: "intent:plan-p" });
        const stop = stopBody(record, { correlation: "s" });
        const cancel = stopBody(record, {
          kind: "cancel-initial",
          correlation: "c",
          expectedSlotVersion: 0,
        });
        const [firstBody, secondBody] =
          order === "stop first" ? [stop, cancel] : [cancel, stop];
        const firstReply = h.post("/plans/plan-p/safety-control", firstBody);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const secondReply = h.post("/plans/plan-p/safety-control", secondBody);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await h.control({ operation: "release", boundary: "intent:plan-p" });
        const [a, b] = (await Promise.all([firstReply, secondReply])).map(
          (reply) => reply.body as { result: string },
        );
        expect(a!.result).toBe("applied");
        expect(b!.result).toBe(
          order === "stop first" ? "defeated" : "already-stopped",
        );
        expect((await h.read()).recovery?.winner?.kind).toBe(
          order === "stop first" ? "stop" : "cancel-initial",
        );
      } finally {
        await h.close();
      }
    });
  it("a Cancel before a held first acceptance closes the generation; after it, the Cancel fences", async () => {
    const h = await protectedHost(["a"]);
    try {
      await h.control({ operation: "hold", boundary: "confirm:plan-p" });
      const confirming = accept(h, "plan-p");
      await new Promise((resolve) => setTimeout(resolve, 20));
      const before = await h.read();
      await h.post(
        "/plans/plan-p/safety-control",
        stopBody(before, { kind: "cancel-initial", expectedSlotVersion: 0 }),
      );
      await h.control({ operation: "release", boundary: "confirm:plan-p" });
      // The Cancel changed the plan, so the held confirmation's token is
      // stale before any acceptance.
      expect(await confirming).toMatchObject({
        status: 409,
        body: { code: "refused", confirmation: { reason: "stale" } },
      });
      expect((await h.read()).recovery?.phase).toBe("cancelled");
      // The other order, on a separately authorized generation.
      await h.control({
        operation: "create",
        planId: "plan-q",
        rows: ["b"],
        conversationId: h.conversation,
      });
      await accept(h, "plan-q");
      const accepted = await h.read("plan-q");
      const reply = await h.post(
        "/plans/plan-q/safety-control",
        stopBody(accepted, { kind: "cancel-initial", expectedSlotVersion: 0 }),
      );
      expect((reply.body as { keys: string[] }).keys).toEqual([
        "cancelStarted",
      ]);
    } finally {
      await h.close();
    }
  });
  it("the legacy stop route refuses every protected phase", async () => {
    const h = await protectedHost(["a"]);
    try {
      for (const phase of ["left-known", "left-unconfirmed", "left-reopened"]) {
        await h.control({
          operation: "create",
          planId: `plan-${phase}`,
          rows: [phase],
          conversationId: h.conversation,
        });
        await h.control({
          operation: "seed-left",
          planId: `plan-${phase}`,
          phase,
        });
      }
      const phases: string[] = [];
      const check = async (planId: string) => {
        phases.push((await h.read(planId)).recovery!.phase);
        expect((await h.post(`/plans/${planId}/stop`, {})).status).toBe(409);
      };
      await check("plan-p"); // initial-review
      await accept(h, "plan-p");
      await check("plan-p"); // forward-active
      await h.post("/plans/plan-p/safety-control", stopBody(await h.read()));
      await check("plan-p"); // readback
      for (const phase of ["left-known", "left-unconfirmed", "left-reopened"])
        await check(`plan-${phase}`);
      expect(new Set(phases)).toEqual(
        new Set([
          "initial-review",
          "forward-active",
          "readback",
          "left-known",
          "left-unconfirmed",
          "left-reopened",
        ]),
      );
    } finally {
      await h.close();
    }
  });
});

// Each dimension alone, against an otherwise valid request, with the valid
// request itself as the positive control.
describe("security matrix", () => {
  const dimensions = [
    "valid",
    "forged inherited token",
    "foreign execution token",
    "foreign plan in body",
    "foreign conversation",
    "missing permission",
    "replay",
    "oversize body",
  ] as const;
  for (const dimension of dimensions)
    it(dimension, async () => {
      const h = await protectedHost(["a"]);
      try {
        await h.control({
          operation: "create",
          planId: "plan-q",
          rows: ["b"],
          conversationId: h.conversation,
        });
        await accept(h, "plan-q");
        await accept(h, "plan-p");
        const record = await h.read();
        const other = await asPrincipal(h, "other");
        const before = await h.read();
        const intent = (overrides: Record<string, unknown> = {}) =>
          h.post("/plans/plan-p/safety-control", stopBody(record, overrides));
        let status: number;
        let applied = false;
        switch (dimension) {
          case "valid": {
            const reply = await intent();
            status = reply.status;
            applied = (reply.body as { result: string }).result === "applied";
            break;
          }
          case "forged inherited token":
            status =
              (
                (
                  await intent({
                    target: { type: "execution", id: "constructor" },
                  })
                ).body as { result: string }
              ).result === "invalid-target"
                ? 409
                : 200;
            break;
          case "foreign execution token": {
            const q = await h.read("plan-q");
            status =
              (
                (
                  await intent({
                    target: { type: "execution", id: q.recovery!.executionId },
                  })
                ).body as { result: string }
              ).result === "invalid-target"
                ? 409
                : 200;
            break;
          }
          case "foreign plan in body":
            status = (await intent({ planId: "plan-q" })).status;
            break;
          case "foreign conversation": {
            // On a plan that is still awaiting its first acceptance.
            await h.control({
              operation: "create",
              planId: "plan-r",
              rows: ["c"],
              conversationId: h.conversation,
            });
            const foreign = await accept(h, "plan-r", "conversation-elsewhere");
            status = foreign.status;
            // A token presented for another conversation is a mismatch.
            expect(foreign.body).toMatchObject({
              code: "refused",
              confirmation: { reason: "mismatch" },
            });
            expect((await h.read("plan-r")).recovery?.phase).toBe(
              "initial-review",
            );
            break;
          }
          case "missing permission":
            status = (
              await other("/plans/plan-p/safety-control", stopBody(record))
            ).status;
            break;
          case "replay":
            status = (await accept(h, "plan-p")).status;
            break;
          case "oversize body":
            status = (
              await h.request("/plans/plan-p/safety-control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // Valid fields, so only the size bound can refuse it.
                body: JSON.stringify(stopBody(record)) + " ".repeat(9000),
              })
            ).status;
            break;
        }
        const after = await h.read();
        if (dimension === "valid") {
          expect(applied).toBe(true);
          expect(after.recovery?.winner?.kind).toBe("stop");
        } else {
          expect(status).toBeGreaterThanOrEqual(400);
          expect(after.recovery).toEqual(before.recovery);
          expect((await h.read("plan-q")).recovery?.winner).toBeUndefined();
        }
      } finally {
        await h.close();
      }
    });
});

describe("an interruption's Stop belongs to the plan it interrupted", () => {
  it("a failed read while another plan is displayed still stops the interrupted plan", async () => {
    const h = await protectedHost(["a"]);
    try {
      await h.control({
        operation: "create",
        planId: "plan-q",
        rows: ["b"],
        conversationId: h.conversation,
      });
      let reads = 0;
      let failed = false;
      const holder: { client?: Awaited<ReturnType<Host["open"]>> } = {};
      const client = await h.open({
        read: async (id) => {
          if (id === "plan-p") reads++;
          if (id === "plan-p" && reads === 2 && !failed) {
            failed = true;
            // Another plan becomes the displayed one, then the read fails.
            holder.client!.setPlan(await h.read("plan-q"));
            throw new Error("offline");
          }
          return h.read(id);
        },
      });
      holder.client = client;
      reads = 0;
      await client.confirmPlan();
      await until(async () => (await h.read()).recovery?.winner !== undefined);
      expect((await h.read()).recovery?.winner).toEqual({
        kind: "stop",
        cause: "connection-lost",
      });
      expect((await h.read("plan-q")).recovery?.winner).toBeUndefined();
      expect((await h.read("plan-q")).recovery?.slots.stop).toBe(0);
      client.dispose();
    } finally {
      await h.close();
    }
  });
});

describe("the body bound is enforced while the request streams in", () => {
  const send = (
    h: Host,
    headers: Record<string, string | number>,
    write: (request: ReturnType<typeof httpRequest>) => void,
  ) =>
    new Promise<number>((resolve, reject) => {
      const url = new URL(`${h.host.url}/plans/plan-p/safety-control`);
      const request = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers,
        },
        (response) => {
          resolve(response.statusCode ?? 0);
          response.resume();
          request.destroy();
        },
      );
      request.on("error", () => undefined);
      setTimeout(() => reject(new Error("no answer before the end")), 2000);
      write(request);
    });
  const auth = async (h: Host) => {
    const session = (await (
      await fetch(`${h.host.url}/__conformance/session`, { method: "POST" })
    ).json()) as { session: string; csrf: string };
    return {
      Cookie: `waypoint=${session.session}`,
      "X-CSRF-Token": session.csrf,
      "Content-Type": "application/json",
    };
  };
  it("a streamed body crossing the limit is refused before it ends", async () => {
    const h = await protectedHost(["a"]);
    try {
      const before = await h.read();
      const status = await send(h, await auth(h), (request) => {
        // Chunked, never ended: only a bound applied while reading answers.
        request.write(" ".repeat(9000));
      });
      expect(status).toBe(413);
      expect((await h.read()).recovery).toEqual(before.recovery);
    } finally {
      await h.close();
    }
  });
  it("a declared length over the limit is refused at once", async () => {
    const h = await protectedHost(["a"]);
    try {
      const status = await send(
        h,
        { ...(await auth(h)), "Content-Length": 20000 },
        (request) => request.write("{"),
      );
      expect(status).toBe(413);
    } finally {
      await h.close();
    }
  });
});

describe("only the exact confirmation is accepted", () => {
  it("a changed or malformed confirmation is refused, never coerced into the accepted one", async () => {
    const h = await protectedHost(["a"]);
    try {
      const record = await h.read();
      const exact = {
        kind: "confirm",
        protocol: "1.0",
        clientReplyId: "same",
        planId: "plan-p",
        digest: (record.plan as { digest: string }).digest,
        confirmationToken: record.confirmation?.token,
      };
      const route = `/conversations/${h.conversation}/replies`;
      // A malformed first confirmation is refused before it can become
      // the accepted identity.
      for (const malformed of [
        { clientReplyId: ["same"] },
        { clientReplyId: 7 },
        { digest: { value: exact.digest } },
      ]) {
        const result = await h.post(route, { ...exact, ...malformed });
        expect(result.status, JSON.stringify(malformed)).toBe(400);
        expect((await h.read()).recovery?.phase).toBe("initial-review");
      }
      expect((await h.post(route, exact)).status).toBe(200);
      expect(await h.post(route, exact)).toEqual(used("same"));
      for (const change of [
        { clientReplyId: ["same"] },
        { protocol: "9.9" },
        { digest: "other" },
        { clientReplyId: "other" },
        { extra: true },
      ]) {
        const result = await h.post(route, { ...exact, ...change });
        expect(result.status, JSON.stringify(change)).toBeGreaterThanOrEqual(
          400,
        );
      }
      // The exact retry is still refused after the run ended.
      await h.post("/plans/plan-p/safety-control", stopBody(await h.read()));
      expect(await h.post(route, exact)).toEqual(used("same"));
    } finally {
      await h.close();
    }
  });
});

describe("an exact retry of a committed operation is acknowledged from the record", () => {
  const patch = (
    h: Host,
    row: string,
    step: string,
    acceptance: { executionId: string; fence: number },
    body = '{"title":"After"}',
  ) =>
    h.request(`/protected-items/${row}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Waypoint-Step": step,
        "Waypoint-Execution": acceptance.executionId,
        "Waypoint-Fence": String(acceptance.fence),
      },
      body,
    });
  it("after the plan completed, the same request returns the committed result", async () => {
    const h = await protectedHost(["a"]);
    try {
      const { acceptance } = (await accept(h, "plan-p")).body as {
        acceptance: { executionId: string; fence: number };
      };
      const first = await patch(h, "a", "plan-p.0", acceptance);
      expect(first).toEqual({ status: 200, body: { title: "After" } });
      const before = await h.read();
      const again = await patch(h, "a", "plan-p.0", acceptance);
      expect(again).toEqual({ status: 200, body: { title: "After" } });
      expect(await h.read()).toEqual(before);
      expect(truth(await h.read())).toEqual({ "step-a": "done" });
    } finally {
      await h.close();
    }
  });
  it("while another step is pending, the retry changes nothing and the next step still applies", async () => {
    const h = await protectedHost(["a", "b"]);
    try {
      const { acceptance } = (await accept(h, "plan-p")).body as {
        acceptance: { executionId: string; fence: number };
      };
      expect((await patch(h, "a", "plan-p.0", acceptance)).status).toBe(200);
      const before = await h.read();
      expect(await patch(h, "a", "plan-p.0", acceptance)).toEqual({
        status: 200,
        body: { title: "After" },
      });
      expect(await h.read()).toEqual(before);
      // A different operation at the committed step is still refused.
      expect(
        (await patch(h, "a", "plan-p.0", acceptance, '{"title":"Other"}'))
          .status,
      ).toBe(409);
      expect((await patch(h, "b", "plan-p.1", acceptance)).status).toBe(200);
      expect(truth(await h.read())).toEqual({
        "step-a": "done",
        "step-b": "done",
      });
    } finally {
      await h.close();
    }
  });
  it("a fenced execution's retry is still refused", async () => {
    const h = await protectedHost(["a", "b"]);
    try {
      const { acceptance } = (await accept(h, "plan-p")).body as {
        acceptance: { executionId: string; fence: number };
      };
      expect((await patch(h, "a", "plan-p.0", acceptance)).status).toBe(200);
      await h.post("/plans/plan-p/safety-control", stopBody(await h.read()));
      expect(await patch(h, "a", "plan-p.0", acceptance)).toEqual({
        status: 409,
        body: { code: "refused", id: "fenced" },
      });
    } finally {
      await h.close();
    }
  });
});

describe("an exact retry over HTTP returns the committed bytes", () => {
  it("after the item changed, the retry still returns the committed result", async () => {
    const h = await protectedHost(["a"]);
    try {
      const { acceptance } = (await accept(h, "plan-p")).body as {
        acceptance: { executionId: string; fence: number };
      };
      const send = () =>
        h.request("/protected-items/a", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Waypoint-Step": "plan-p.0",
            "Waypoint-Execution": acceptance.executionId,
            "Waypoint-Fence": String(acceptance.fence),
          },
          body: '{"title":"After"}',
        });
      expect(await send()).toEqual({ status: 200, body: { title: "After" } });
      const before = await h.read();
      await h.control({
        operation: "create",
        planId: "plan-q",
        rows: ["a"],
        conversationId: h.conversation,
      });
      expect(await send()).toEqual({ status: 200, body: { title: "After" } });
      // The record is unchanged; only the displayed item value moved.
      const after = await h.read();
      expect([after.state, after.recovery]).toEqual([
        before.state,
        before.recovery,
      ]);
    } finally {
      await h.close();
    }
  });
});

describe("a long plan id keeps Stop deliverable", () => {
  it("Stop applies to the issued execution of the longest plan id the host derives, and the held effect is refused", async () => {
    // The host derives `<plan>-digest-1`, which must fit the 128 bound.
    const planId = "p".repeat(119);
    const h = await protectedHost(["a"]);
    try {
      await h.control({
        operation: "create",
        planId,
        rows: ["a"],
        conversationId: h.conversation,
      });
      const accepted = await accept(h, planId);
      expect(accepted.status).toBe(200);
      const { acceptance } = accepted.body as {
        acceptance: { executionId: string; fence: number };
      };
      expect(acceptance.executionId).toMatch(/^[A-Za-z0-9._~-]{1,128}$/);
      expect((await h.read(planId)).recovery!.executionId).toBe(
        acceptance.executionId,
      );
      await h.control({ operation: "hold", boundary: `commit:${planId}` });
      const held = h.request("/protected-items/a", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Waypoint-Step": `${planId}.0`,
          "Waypoint-Execution": acceptance.executionId,
          "Waypoint-Fence": String(acceptance.fence),
        },
        body: '{"title":"After"}',
      });
      await until(
        async () =>
          (
            (
              await h.control({
                operation: "admitted",
                planId,
                stepId: "step-a",
              })
            ).body as { admitted: boolean }
          ).admitted,
      );
      const stop = await h.post(
        `/plans/${planId}/safety-control`,
        stopBody(await h.read(planId)),
      );
      expect(stop.status).toBe(200);
      expect(stop.body).toMatchObject({ result: "applied" });
      await h.control({ operation: "release", boundary: `commit:${planId}` });
      expect(await held).toEqual({
        status: 409,
        body: { code: "refused", id: "fenced" },
      });
    } finally {
      await h.close();
    }
  });
});

describe("Leave over the safety-control route", () => {
  const leaveBody = (
    record: PlanRecord,
    overrides: Record<string, unknown> = {},
  ) => {
    const view = record.recovery!;
    return {
      kind: "leave",
      planId: record.id,
      target: { type: "execution", id: view.executionId },
      capturedRound: view.round,
      expectedSlotVersion: view.slots.leave,
      correlation: "leave-1",
      cause: "user",
      acknowledgment: {
        sourceDecisionKey: view.decisionKey,
        evidenceVersion: view.versions.evidence,
        winnerVersion: view.versions.winner,
        decisionResolutionVersion: view.versions.decisionResolution,
        evidenceDigest: view.evidenceDigest,
        unknownCount: view.unknownCount,
      },
      ...overrides,
    };
  };
  async function stopped(h: Host) {
    await accept(h, "plan-p");
    await h.post("/plans/plan-p/safety-control", stopBody(await h.read()));
    return h.read();
  }
  it("the largest Leave body over HTTP is read, and the bound still refuses more", async () => {
    const h = await protectedHost(["a"]);
    try {
      const record = await stopped(h);
      const largest = leaveBody(record, {
        correlation: "c".repeat(128),
        cause: "attribution-missing",
        payload: "é".repeat(2048),
      });
      expect(
        new TextEncoder().encode(JSON.stringify(largest)).length,
      ).toBeLessThan(8192);
      const reply = await h.post("/plans/plan-p/safety-control", largest);
      expect(reply.status).toBe(200);
      expect((reply.body as { result: string }).result).toBe("applied");
      const padded = await h.request("/plans/plan-p/safety-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leaveBody(record)) + " ".repeat(9000),
      });
      expect(padded.status).toBe(413);
    } finally {
      await h.close();
    }
  });
  it("the parser's maximum Leave shape is read over HTTP, next to an oversize refusal", async () => {
    const h = await protectedHost(["a"]);
    try {
      const token = "t".repeat(128);
      // A plan whose id is at the 128-character bound (the reference
      // fixture derives its review digest from the id, so this plan cannot
      // be confirmed; the route and parser do not need it to be).
      const longId = "p".repeat(128);
      await h.control({
        operation: "create",
        planId: longId,
        rows: ["a"],
        conversationId: h.conversation,
      });
      const record = await h.read(longId);
      // Every field at its bound; the route reads and parses it, and the
      // resolver then refuses its foreign target with nothing changed.
      const maximum = {
        kind: "leave",
        planId: longId,
        target: { type: "execution", id: token },
        capturedRound: Number.MAX_SAFE_INTEGER,
        expectedSlotVersion: Number.MAX_SAFE_INTEGER,
        correlation: token,
        cause: "attribution-missing",
        payload: "é".repeat(2048),
        acknowledgment: {
          sourceDecisionKey: token,
          evidenceVersion: Number.MAX_SAFE_INTEGER,
          winnerVersion: Number.MAX_SAFE_INTEGER,
          decisionResolutionVersion: Number.MAX_SAFE_INTEGER,
          evidenceDigest: "A".repeat(43),
          unknownCount: Number.MAX_SAFE_INTEGER,
        },
      };
      const bytes = new TextEncoder().encode(JSON.stringify(maximum)).length;
      expect(bytes).toBeLessThan(8192);
      const read = await h.post(`/plans/${longId}/safety-control`, maximum);
      expect(read.status).toBe(200);
      expect((read.body as { result: string }).result).toBe("invalid-target");
      expect(await h.read(longId)).toEqual(record);
      const oversize = await h.request(`/plans/${longId}/safety-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...maximum, payload: "é".repeat(2049) }),
      });
      expect(oversize.status).toBe(400);
      const streamed = await h.request(`/plans/${longId}/safety-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(maximum) + " ".repeat(8192 - bytes + 1),
      });
      expect(streamed.status).toBe(413);
    } finally {
      await h.close();
    }
  });
  // The reference fixture always creates a plan with its initial review, so
  // a proposal without a review is reached through the resolver tests only.
  it("over the route, a Leave without an accepted decision is unavailable or already closed, and a foreign target is refused", async () => {
    const h = await protectedHost(["a"]);
    try {
      const initial = await h.read();
      const body = {
        kind: "leave",
        planId: "plan-p",
        target: { type: "generation", id: initial.recovery!.generation },
        capturedRound: initial.recovery!.round,
        expectedSlotVersion: initial.recovery!.slots.leave,
        correlation: "no-decision",
        cause: "user",
        acknowledgment: {
          sourceDecisionKey: "anything",
          evidenceVersion: 0,
          winnerVersion: 0,
          decisionResolutionVersion: 0,
          evidenceDigest: "A".repeat(43),
          unknownCount: 0,
        },
      };
      const reply = await h.post("/plans/plan-p/safety-control", body);
      expect(reply.body).toMatchObject({
        result: "unavailable",
        keys: ["leaveNoDecision"],
      });
      expect(await h.read()).toEqual(initial);
      // Cancelled before any acceptance: already closed by the Cancel.
      await h.control({
        operation: "create",
        planId: "plan-c",
        rows: ["a"],
        conversationId: h.conversation,
      });
      const fresh = await h.read("plan-c");
      await h.post(
        "/plans/plan-c/safety-control",
        stopBody(fresh, { kind: "cancel-initial", correlation: "decline" }),
      );
      const cancelled = await h.read("plan-c");
      expect(cancelled.recovery?.phase).toBe("cancelled");
      const closed = await h.post("/plans/plan-c/safety-control", {
        ...body,
        planId: "plan-c",
        target: { type: "generation", id: cancelled.recovery!.generation },
        capturedRound: cancelled.recovery!.round,
        expectedSlotVersion: cancelled.recovery!.slots.leave,
      });
      expect(closed.body).toMatchObject({
        result: "already-closed",
        keys: ["alreadyClosedByWinner"],
        winner: { kind: "cancel-initial" },
        phase: "cancelled",
      });
      expect(await h.read("plan-c")).toEqual(cancelled);
      const record = await stopped(h);
      const foreign = await h.post(
        "/plans/plan-p/safety-control",
        leaveBody(record, { target: { type: "execution", id: "elsewhere" } }),
      );
      expect(foreign.body).toMatchObject({ result: "invalid-target" });
      expect(await h.read()).toEqual(record);
    } finally {
      await h.close();
    }
  });
  it("a host that does not offer Leave answers capabilityMissing and changes nothing", async () => {
    const h = await protectedHost(["a"]);
    try {
      const record = await stopped(h);
      await h.control({ operation: "leave-offered", offered: false });
      const reply = await h.post(
        "/plans/plan-p/safety-control",
        leaveBody(record),
      );
      expect(reply.body).toMatchObject({
        result: "unavailable",
        keys: ["capabilityMissing"],
      });
      expect(await h.read()).toEqual(record);
    } finally {
      await h.close();
    }
  });
  for (const order of ["leave first", "stop first"] as const)
    it(`held Leave and Stop on a running execution, ${order}`, async () => {
      const h = await protectedHost(["a"]);
      try {
        await accept(h, "plan-p");
        const record = await h.read();
        await h.control({ operation: "hold", boundary: "intent:plan-p" });
        const leave = leaveBody(record);
        const stop = stopBody(record, { correlation: "s" });
        const [first, second] =
          order === "leave first" ? [leave, stop] : [stop, leave];
        const firstReply = h.post("/plans/plan-p/safety-control", first);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const secondReply = h.post("/plans/plan-p/safety-control", second);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await h.control({ operation: "release", boundary: "intent:plan-p" });
        const replies = [await firstReply, await secondReply].map(
          (reply) =>
            reply.body as { kind: string; result: string; keys: string[] },
        );
        const byKind = Object.fromEntries(
          replies.map((reply) => [reply.kind, reply]),
        );
        const after = await h.read();
        if (order === "leave first") {
          expect(byKind.leave).toMatchObject({
            result: "needs-review",
            keys: ["leaveSafetyNeedsReview"],
          });
          expect(byKind.stop).toMatchObject({
            result: "already-stopped",
            keys: [
              "currentStopped",
              "alreadyStoppedNeedsDecision",
              "leaveSafetyAlreadyStopped",
            ],
          });
          expect(after.recovery?.winner?.kind).toBe("leave");
        } else {
          expect(byKind.stop).toMatchObject({ result: "applied" });
          expect(byKind.leave).toMatchObject({
            result: "defeated",
            keys: ["leaveDefeatedByWinner"],
          });
          expect(after.recovery?.winner?.kind).toBe("stop");
        }
        expect(after.recovery?.phase).toBe("readback");
        // A new Leave from the resulting readback closes the decision; the
        // old Stop replayed afterwards cannot replace it.
        const closing = await h.post(
          "/plans/plan-p/safety-control",
          leaveBody(after, { correlation: "leave-2" }),
        );
        expect(closing.body).toMatchObject({
          result: "applied",
          keys: ["leftKnown"],
        });
        const replay = await h.post("/plans/plan-p/safety-control", stop);
        expect(replay.body).toMatchObject({
          result: "superseded",
          winner: { kind: "leave" },
        });
        expect((await h.read()).recovery?.phase).toBe("left-known");
      } finally {
        await h.close();
      }
    });
});

describe("Keep over the safety-control route", () => {
  const informed = (
    record: PlanRecord,
    kind: "leave" | "keep",
    overrides: Record<string, unknown> = {},
  ) => {
    const view = record.recovery!;
    return {
      kind,
      planId: record.id,
      target: { type: "execution", id: view.executionId },
      capturedRound: view.round,
      expectedSlotVersion: view.slots[kind],
      correlation: `${kind}-1`,
      cause: "user",
      ...(kind === "keep"
        ? {
            review:
              (view.remaining ?? 0) > 0 ? "forward-only" : "end-retention",
          }
        : {}),
      acknowledgment: {
        sourceDecisionKey: view.decisionKey,
        evidenceVersion: view.versions.evidence,
        winnerVersion: view.versions.winner,
        decisionResolutionVersion: view.versions.decisionResolution,
        evidenceDigest: view.evidenceDigest,
        unknownCount: view.unknownCount,
      },
      ...overrides,
    };
  };
  // Two steps: a commits, then a connection-lost Stop before b runs.
  async function readback(h: Host) {
    const { acceptance } = (await accept(h, "plan-p")).body as {
      acceptance: { executionId: string; fence: number };
    };
    await h.request("/protected-items/a", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Waypoint-Step": "plan-p.0",
        "Waypoint-Execution": acceptance.executionId,
        "Waypoint-Fence": String(acceptance.fence),
      },
      body: '{"title":"After"}',
    });
    await h.post("/plans/plan-p/safety-control", {
      ...stopBody(await h.read()),
      cause: "connection-lost",
    });
    return h.read();
  }
  it("a host that does not offer Keep answers capabilityMissing and changes nothing", async () => {
    const h = await protectedHost(["a", "b"]);
    try {
      const record = await readback(h);
      await h.control({ operation: "keep-offered", offered: false });
      const reply = await h.post(
        "/plans/plan-p/safety-control",
        informed(record, "keep"),
      );
      expect(reply.body).toMatchObject({
        result: "unavailable",
        keys: ["capabilityMissing"],
      });
      expect(await h.read()).toEqual(record);
    } finally {
      await h.close();
    }
  });
  for (const kind of ["stop", "cancel-initial", "cancel-review"] as const)
    for (const order of ["keep first", "other first"] as const)
      it(`held Keep and ${kind}, ${order}`, async () => {
        const h = await protectedHost(["a", "b"]);
        try {
          const record = await readback(h);
          const keep = informed(record, "keep");
          const other = {
            ...stopBody(record, { correlation: `${kind}-1` }),
            kind,
            expectedSlotVersion: record.recovery!.slots[kind],
            ...(kind === "cancel-review"
              ? {
                  target: {
                    type: "review",
                    id: record.recovery!.reviewId ?? "plan-p.r1",
                  },
                }
              : {}),
          };
          await h.control({ operation: "hold", boundary: "intent:plan-p" });
          const [first, second] =
            order === "keep first" ? [keep, other] : [other, keep];
          const firstReply = h.post("/plans/plan-p/safety-control", first);
          await new Promise((resolve) => setTimeout(resolve, 20));
          const secondReply = h.post("/plans/plan-p/safety-control", second);
          await new Promise((resolve) => setTimeout(resolve, 20));
          await h.control({ operation: "release", boundary: "intent:plan-p" });
          const replies = Object.fromEntries(
            [await firstReply, await secondReply].map((reply) => [
              (reply.body as { kind: string }).kind,
              reply.body as Record<string, unknown>,
            ]),
          );
          // Keep was rendered after the Stop winner, so it is informed in
          // both orders: the Stop or Cancel adds no safety to the fenced
          // run and changes no version the Keep acknowledged.
          expect(replies.keep, order).toMatchObject({
            result: "already-kept",
            keys: ["alreadyKept", "planClosedKept", "keptForwardClosed"],
          });
          expect(replies[kind], order).toMatchObject(
            order === "keep first"
              ? { result: "superseded" }
              : kind === "stop"
                ? // The same Stop as the readback's: one semantic intent.
                  { result: "applied", requestKey: "requestAlreadyStopped" }
                : { result: "defeated" },
          );
          expect((await h.read()).recovery).toMatchObject({
            phase: "left-known",
            sealed: true,
            winner: { kind: "keep" },
          });
        } finally {
          await h.close();
        }
      });
  for (const order of ["leave first", "keep first"] as const)
    it(`two windows render the same Stop and choose Leave and Keep, ${order}`, async () => {
      const h = await protectedHost(["a", "b"]);
      try {
        const record = await readback(h);
        const leave = informed(record, "leave");
        const keep = informed(record, "keep");
        await h.control({
          operation: "hold",
          boundary: "intent-response:plan-p",
        });
        const [first, second] =
          order === "leave first" ? [leave, keep] : [keep, leave];
        const firstReply = h.post("/plans/plan-p/safety-control", first);
        await until(async () => (await h.read()).recovery!.round === 2);
        const secondReply = h.post("/plans/plan-p/safety-control", second);
        await until(async () => (await h.read()).recovery!.sealed === true);
        await h.control({
          operation: "release",
          boundary: "intent-response:plan-p",
        });
        const replies = Object.fromEntries(
          [await firstReply, await secondReply].map((reply) => [
            (reply.body as { kind: string }).kind,
            reply.body as Record<string, unknown>,
          ]),
        );
        if (order === "leave first") {
          expect(replies.leave).toMatchObject({ result: "applied" });
          expect(replies.keep).toMatchObject({
            result: "already-kept",
            keys: expect.arrayContaining(["leaveCompletedByKeep"]),
          });
          // The Leave's lost response, retried: its own bytes and the completion.
          const retry = await h.post("/plans/plan-p/safety-control", leave);
          expect(retry.body).toMatchObject({
            result: "applied",
            keys: ["leftKnown"],
            finalHistory: {
              relation: "leaveCompletedByKeep",
              requestedTargetApplied: true,
            },
          });
        } else {
          expect(replies.keep).toMatchObject({
            result: "already-kept",
            keys: ["alreadyKept", "planClosedKept", "keptForwardClosed"],
          });
          expect(replies.leave).toMatchObject({
            result: "already-closed",
            keys: ["leaveCoveredByKeep"],
            finalHistory: { requestedTargetApplied: false },
          });
          const retry = await h.post("/plans/plan-p/safety-control", keep);
          expect(retry.body).toMatchObject({
            result: "already-kept",
            finalHistory: { winner: { kind: "keep" } },
          });
        }
        const after = await h.read();
        expect(after.recovery).toMatchObject({
          phase: "left-known",
          sealed: true,
          winner: { kind: "keep" },
        });
        // The old Stop replay is superseded and changes nothing.
        expect(
          (
            await h.post("/plans/plan-p/safety-control", {
              ...stopBody(record),
              capturedRound: 1,
              expectedSlotVersion: 0,
              cause: "connection-lost",
            })
          ).body,
        ).toMatchObject({ result: "superseded" });
        expect(await h.read()).toEqual(after);
      } finally {
        await h.close();
      }
    });
});
