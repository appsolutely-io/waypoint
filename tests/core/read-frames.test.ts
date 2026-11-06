import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  type ClientConfig,
  type TransportEvent,
} from "../../src/core/client";
import type {
  ManifestEntry,
  ToolCall,
  ReadTemplate,
  Reply,
} from "../../src/protocol/generated";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
it("answers tool and planning frames through trusted read handlers", async () => {
  const base = config();
  let listener!: (event: TransportEvent) => void;
  const replies: Reply[] = [];
  const requested: unknown[] = [];
  const reads = {
    manifest: [samples.ManifestEntry as ManifestEntry],
    request: async (call: ToolCall) => {
      requested.push(call);
      return { title: "Safe", email: "Hidden" };
    },
    planning: {
      template: () => samples.ReadTemplate as ReadTemplate,
      request: async () => ({
        rows: { a: { title: "Private", extra: "Hidden" } },
        versions: { a: "v1" },
      }),
    },
  };
  const client = createWaypointClient({
    ...base,
    reads,
    transport: {
      ...base.transport,
      subscribe: (_id, fn) => {
        listener = fn;
        return () => {};
      },
      send: async (reply) => {
        replies.push(reply);
        return { id: reply.clientReplyId };
      },
    },
  } as ClientConfig);
  await client.ready;
  listener({
    type: "frame",
    frame: {
      type: "tool.call",
      protocol: "1.0",
      sequence: 1,
      call: samples.ToolCall as ToolCall,
    },
  });
  listener({
    type: "frame",
    frame: {
      type: "planning-read",
      protocol: "1.0",
      sequence: 2,
      planId: "plan-a",
      stepId: "step-a",
      template: samples.ReadTemplate as ReadTemplate,
    },
  });
  await vi.waitFor(() => expect(replies).toHaveLength(2));
  expect(replies.find((reply) => reply.kind === "tool-result")).toMatchObject({
    result: { title: "Safe" },
  });
  expect(replies.find((reply) => reply.kind === "plan.values")).toMatchObject({
    steps: [
      {
        stepId: "step-a",
        rows: { a: { title: "Private" } },
        versions: { a: "v1" },
      },
    ],
  });
  expect(
    JSON.stringify(replies.filter((reply) => reply.kind === "tool-result")),
  ).not.toContain("Private");
  listener({
    type: "frame",
    frame: {
      type: "tool.call",
      protocol: "1.0",
      sequence: 3,
      call: { ...samples.ToolCall, method: "POST" } as ToolCall,
    },
  });
  await vi.waitFor(() => expect(replies).toHaveLength(3));
  expect(requested).toHaveLength(1);
  expect(client.getSnapshot().problem?.code).toBe("invalid-read");
  client.dispose();
});
for (const failed of [false, true])
  it(`keeps ordinary frames and stop intent while the first read ${failed ? "fails" : "loads"}`, async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listener!: (event: TransportEvent) => void;
    let readFailed = failed;
    const request = vi.fn(async () => ({ title: "Safe" }));
    const cfg = config();
    cfg.reads = { manifest: [samples.ManifestEntry as ManifestEntry], request };
    cfg.plans = {
      read: async () =>
        structuredClone(
          samples.PlanRecord,
        ) as import("../../src/protocol/generated").PlanRecord,
      request: async () => {},
      heartbeat: async () => {},
      stop: async () =>
        structuredClone(
          samples.PlanRecord,
        ) as import("../../src/protocol/generated").PlanRecord,
    };
    cfg.transport.read = async () => {
      await gate;
      if (readFailed) throw new Error("Unavailable");
      return {
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [],
      };
    };
    cfg.transport.subscribe = (_id, fn) => {
      listener = fn;
      return () => {};
    };
    const client = createWaypointClient(cfg);
    await vi.waitFor(() => expect(listener).toBeDefined());
    listener({
      type: "frame",
      frame: {
        type: "tool.call",
        protocol: "1.0",
        sequence: 1,
        call: samples.ToolCall as ToolCall,
      },
    });
    listener({
      type: "frame",
      frame: {
        type: "plan.step",
        protocol: "1.0",
        sequence: 2,
        planId: "plan-a",
        outcome: { stepId: "step-a", status: 200, attributed: true },
      },
    });
    expect(client.getSnapshot().problem?.id).not.toBe("form-tools");
    expect(request).not.toHaveBeenCalled();
    client.stopPlan("plan-a");
    release();
    await client.ready;
    if (failed) {
      expect(client.getSnapshot().problem?.id).toBe("conversation-read");
      expect(request).not.toHaveBeenCalled();
      readFailed = false;
      await client.refresh();
    }
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await client.runPlan("plan-a", "digest");
    expect(client.getSnapshot().problem?.code).toBe("stopped");
    client.dispose();
  });
