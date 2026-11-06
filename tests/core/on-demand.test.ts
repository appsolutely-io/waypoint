// The lazily loaded client actions, against a constructed client context,
// so guards that the client's own scopes also enforce are tested alone.
import { describe, expect, it } from "vitest";
import { createOnDemand, type OnDemandContext } from "../../src/core/on-demand";
import { createScope } from "../../src/core/scope";
import type { PlanRecord } from "../../src/protocol/generated";
import samples from "../protocol/samples.json";

const context = (plan: PlanRecord, calls: string[]): OnDemandContext =>
  ({
    ready: Promise.resolve(),
    config: {
      plans: {
        retryUndo: async (id: string) => {
          calls.push(id);
          return plan;
        },
      },
    },
    client: { setPlan: () => {} },
    state: () => ({ plan }),
    live: () => true,
    disposed: () => false,
    restricted: () => false,
    readOnly: () => false,
    finishPlanRead: () => true,
  }) as unknown as OnDemandContext;

// A conversation under a client, and a plan read under its own live
// conversation, so the guard under test is the only one that can refuse.
const conversation = () =>
  createScope("conversation", createScope("client").signal);
const liveRead = () => createScope("plan-read", conversation().signal);
describe("an undo retry dispatches only for the plan and conversation of its press", () => {
  const plan = structuredClone(samples.PlanRecord) as PlanRecord;
  it("CK-U-guard-positive a live press for the shown plan dispatches", async () => {
    const calls: string[] = [];
    const read = liveRead();
    await createOnDemand(context(plan, calls)).retryUndo(
      conversation().signal,
      read,
      plan.id,
    );
    expect(calls).toEqual([plan.id]);
  });
  it("CK-U-guard-plan another plan shown, with its read still live, sends nothing", async () => {
    const calls: string[] = [];
    await createOnDemand(context(plan, calls)).retryUndo(
      conversation().signal,
      liveRead(),
      "plan-other",
    );
    expect(calls).toEqual([]);
  });
  it("CK-U-guard-scope an ended conversation, with its read still live, sends nothing", async () => {
    const calls: string[] = [];
    const ended = conversation();
    ended.abort();
    await createOnDemand(context(plan, calls)).retryUndo(
      ended.signal,
      liveRead(),
      plan.id,
    );
    expect(calls).toEqual([]);
  });
});
