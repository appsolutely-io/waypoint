import { it, expect } from "vitest";
import { createPlanRunner, canTransition } from "../../src/core/runner";
import type {
  PlanRecord,
  CanonicalRequest,
} from "../../src/protocol/generated";
import samples from "../protocol/samples.json";
const plan = () => structuredClone(samples.PlanRecord) as PlanRecord;
it("sends canonical bytes, ephemeral code and verified outcome; refuses duplicate starts", async () => {
  const record = plan();
  const requests: unknown[] = [];
  const runner = createPlanRunner({
    read: async () => record,
    heartbeat: async () => {},
    stop: async () => record,
    stepUp: async () => "ephemeral",
    request: async (request, context) => {
      requests.push([request, context]);
      record.outcomes = [{ stepId: "step-a", status: 200, attributed: true }];
      record.state = "completed";
    },
  });
  await Promise.all([
    runner.run("plan-a", "plan-digest"),
    runner.run("plan-a", "plan-digest"),
  ]);
  expect(requests).toHaveLength(1);
  expect((requests[0] as [CanonicalRequest])[0].body).toBe('{"title":"After"}');
  expect(JSON.stringify(record)).not.toContain("ephemeral");
});
it("Stop drains an in-flight write, dispatches nothing more and never asks for an undo", async () => {
  const record = plan();
  const sent: string[] = [];
  let stops = 0;
  let reads = 0;
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const runner = createPlanRunner({
    read: async () => {
      reads++;
      return record;
    },
    heartbeat: async () => {},
    stop: async () => {
      stops++;
      return record;
    },
    request: async (_request, context) => {
      sent.push(context.planId);
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  const running = runner.run("plan-a", "plan-digest");
  await started;
  runner.stop();
  const readsBefore = reads;
  release();
  await running;
  expect(sent).toEqual(["plan-a"]);
  expect(stops).toBe(0);
  // Facts are read again after stopping.
  expect(reads).toBeGreaterThan(readsBefore);
});
for (const [refusal, cause] of [
  ["412", "attribution-missing"],
  ["cancel", "step-up-failed"],
  ["mismatch", "attribution-missing"],
  ["throw", "step-failed"],
] as const)
  it(`failure ${refusal} never retries, asks for no undo and reports ${cause}`, async () => {
    const record = plan();
    if (refusal === "cancel" && record.plan.kind === "immediate")
      record.plan.steps[0]!.stepUp = true;
    let writes = 0;
    let stops = 0;
    const causes: string[] = [];
    let readsAfterInterrupt = 0;
    let interrupted = false;
    const runner = createPlanRunner({
      read: async () => {
        if (interrupted) readsAfterInterrupt++;
        return record;
      },
      heartbeat: async () => {},
      stepUp: async () => null,
      stop: async () => {
        stops++;
        return record;
      },
      interrupted: async (_id, reason) => {
        causes.push(reason);
        interrupted = true;
      },
      request: async () => {
        writes++;
        if (refusal === "throw") throw new Error("refused");
        record.outcomes = [
          {
            stepId: "step-a",
            status: refusal === "412" ? 412 : 200,
            attributed: false,
          },
        ];
      },
    });
    await runner.run("plan-a", "plan-digest");
    expect(writes).toBe(refusal === "cancel" ? 0 : 1);
    expect(stops).toBe(0);
    expect(causes).toEqual([cause]);
    // Every step is read after the Stop intent was submitted.
    expect(readsAfterInterrupt).toBeGreaterThan(0);
  });
it("timed plans execute nothing and only valid transitions are offered", async () => {
  const record = plan();
  record.plan = samples.TimedPlan as PlanRecord["plan"];
  let writes = 0;
  const runner = createPlanRunner({
    read: async () => record,
    heartbeat: async () => {},
    stop: async () => record,
    request: async () => {
      writes++;
    },
  });
  await runner.run("plan-a", "plan-digest");
  expect(writes).toBe(0);
  expect(canTransition("completed", "undoing")).toBe(true);
  expect(canTransition("undone", "running")).toBe(false);
  expect(canTransition("needs-attention", "running")).toBe(true);
});
it("cleans heartbeat timers after a failure", async () => {
  const record = plan();
  let next = 0;
  const timers = new Set<unknown>();
  const runner = createPlanRunner({
    clock: {
      now: () => 0,
      setTimeout: () => {
        const id = ++next;
        timers.add(id);
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      },
    },
    read: async () => record,
    heartbeat: async () => {},
    request: async () => {
      throw new Error("refused");
    },
  });
  await runner.run("plan-a", "plan-digest");
  expect(timers.size).toBe(0);
});
it("an accepted execution's id and fence travel with every step and renewal", async () => {
  const record = plan();
  const headers: Record<string, string>[] = [];
  const renewals: unknown[] = [];
  const runner = createPlanRunner({
    read: async () => record,
    heartbeat: async (_id, acceptance) => {
      renewals.push(acceptance);
    },
    request: async (_request, context) => {
      headers.push(context.headers);
      record.outcomes = [{ stepId: "step-a", status: 200, attributed: true }];
      record.state = "completed";
    },
  });
  const acceptance = { planId: "plan-a", executionId: "plan-a.e1", fence: 3 };
  await runner.run("plan-a", "plan-digest", acceptance);
  expect(headers[0]).toMatchObject({
    "Waypoint-Execution": "plan-a.e1",
    "Waypoint-Fence": "3",
  });
  expect(renewals[0]).toEqual(acceptance);
});
it("a shared mutable server response cannot change the confirmed request snapshot", async () => {
  const record = plan();
  let reads = 0;
  let writes = 0;
  const runner = createPlanRunner({
    read: async () => {
      if (
        ++reads === 2 &&
        record.plan.kind === "immediate" &&
        record.plan.stage === "final"
      )
        record.plan.steps[0]!.request!.body =
          '{"title":"Changed after confirmation"}';
      return record;
    },
    heartbeat: async () => {},
    stop: async () => record,
    request: async () => {
      writes++;
    },
  });
  await expect(runner.run("plan-a", "plan-digest")).rejects.toThrow(
    "invalid-plan",
  );
  expect(writes).toBe(0);
});
it("rejects delete requests at the runtime boundary even when an adapter violates its type", async () => {
  const record = plan();
  if (record.plan.kind === "immediate" && record.plan.stage === "final")
    record.plan.steps[0]!.request!.method = "DELETE" as never;
  let writes = 0;
  const runner = createPlanRunner({
    read: async () => record,
    heartbeat: async () => {},
    stop: async () => record,
    request: async () => {
      writes++;
    },
  });
  await expect(runner.run("plan-a", "plan-digest")).rejects.toThrow(
    "invalid-plan",
  );
  expect(writes).toBe(0);
});
for (const interruption of ["stop", "dispose", "state"] as const)
  it(`rechecks permission to write after a step-up wait: ${interruption}`, async () => {
    const record = plan();
    if (record.plan.kind === "immediate") record.plan.steps[0]!.stepUp = true;
    let entered!: () => void;
    let release!: (code: string) => void;
    const prompt = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let writes = 0;
    let stops = 0;
    const runner = createPlanRunner({
      read: async () => record,
      heartbeat: async () => {},
      stepUp: () => {
        entered();
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
      stop: async () => {
        stops++;
        record.state = "needs-attention";
        return record;
      },
      request: async () => {
        writes++;
        record.state = "completed";
        record.outcomes = [{ stepId: "step-a", status: 200, attributed: true }];
      },
    });
    const running = runner.run("plan-a", "plan-digest");
    await prompt;
    if (interruption === "stop") runner.stop();
    else if (interruption === "dispose") runner.dispose();
    else record.state = "cancelled";
    release("ephemeral");
    await running;
    expect(writes).toBe(0);
    // A stopped run never asks the host to stop or undo.
    expect(stops).toBe(0);
  });
for (const interruption of ["stop", "dispose"] as const)
  it(`checks cancellation after a pre-write state read: ${interruption}`, async () => {
    const record = plan();
    let reads = 0;
    let entered!: () => void;
    let release!: (value: PlanRecord) => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let writes = 0;
    let stops = 0;
    const runner = createPlanRunner({
      read: async () => {
        if (++reads === 2) {
          entered();
          return new Promise<PlanRecord>((resolve) => {
            release = resolve;
          });
        }
        return record;
      },
      heartbeat: async () => {},
      stop: async () => {
        stops++;
        record.state = "needs-attention";
        return record;
      },
      request: async () => {
        writes++;
        record.state = "completed";
        record.outcomes = [{ stepId: "step-a", status: 200, attributed: true }];
      },
    });
    const running = runner.run("plan-a", "plan-digest");
    await waiting;
    if (interruption === "stop") runner.stop();
    else runner.dispose();
    release(record);
    await running;
    expect(writes).toBe(0);
    // A stopped run never asks the host to stop or undo.
    expect(stops).toBe(0);
  });
it("a stop recorded before run prevents writes", async () => {
  const record = plan();
  let writes = 0;
  const runner = createPlanRunner({
    read: async () => record,
    heartbeat: async () => {},
    stop: async () => record,
    request: async () => {
      writes++;
    },
  });
  runner.stop("plan-a");
  await runner.run("plan-a", "plan-digest");
  expect(writes).toBe(0);
});
it("starting a different plan while active refuses instead of sharing its promise", async () => {
  const record = plan();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const runner = createPlanRunner({
    read: async () => record,
    heartbeat: async () => {},
    stop: async () => record,
    request: async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      record.state = "completed";
      record.outcomes = [{ stepId: "step-a", status: 200, attributed: true }];
    },
  });
  const active = runner.run("plan-a", "plan-digest");
  await started;
  try {
    const other = runner.run("plan-b", "plan-digest");
    expect(other).not.toBe(active);
    await expect(other).rejects.toThrow("active-plan");
  } finally {
    release();
    await active;
  }
});
it("refuses a server plan whose digest differs from the confirmed digest", async () => {
  const record = plan();
  let writes = 0;
  const runner = createPlanRunner({
    read: async () => record,
    heartbeat: async () => {},
    stop: async () => record,
    request: async () => {
      writes++;
    },
  });
  await expect(runner.run("plan-a", "different-digest")).rejects.toThrow(
    "invalid-plan",
  );
  expect(writes).toBe(0);
});
it("a successful resumed outcome supersedes a failed earlier attempt", async () => {
  const record = plan();
  record.outcomes = [{ stepId: "step-a", status: 412, attributed: false }];
  let stops = 0;
  let writes = 0;
  const runner = createPlanRunner({
    read: async () => record,
    heartbeat: async () => {},
    stop: async () => {
      stops++;
      return record;
    },
    request: async () => {
      writes++;
      record.outcomes.push({ stepId: "step-a", status: 200, attributed: true });
      record.state = "completed";
    },
  });
  await runner.run("plan-a", "plan-digest");
  expect(writes).toBe(1);
  expect(stops).toBe(0);
});
