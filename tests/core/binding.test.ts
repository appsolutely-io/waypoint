import { it, expect, describe } from "vitest";
import {
  asProblem,
  ConversationReadError,
  createWaypointClient,
  type ReaderRequestContext,
  type TransportPort,
} from "../../src/core/client";
import { createHttpTransport } from "../../src/core/transports";
import { CAPABILITIES, negotiate } from "../../src/protocol/index";
import type { Conversation, PlanRecord } from "../../src/protocol/generated";
import { config, createManualClock, flush } from "../support/client";
import samples from "../protocol/samples.json";

const conversation: Conversation = {
  protocol: "1.0",
  id: "conversation-a",
  title: "Chat",
  messages: [],
};
const expiredError = { code: "agreement-expired", id: "agreement" };

function bindingHost(
  options: {
    legacy?: boolean;
    protocols?: string[];
    readDelay?: () => Promise<void>;
  } = {},
) {
  let issued = 0;
  const expired = new Set<string>();
  const log = {
    negotiate: [] as { offer?: unknown }[],
    reads: [] as (string | undefined)[],
    sends: [] as { id: string; agreement?: string }[],
    subscribes: [] as (string | undefined)[],
    closes: 0,
    planReads: [] as (string | undefined)[],
  };
  const transport: TransportPort = {
    negotiate: async (_supported, offer) => {
      log.negotiate.push({ offer });
      const protocol = options.protocols?.[log.negotiate.length - 1] ?? "1.0";
      return options.legacy
        ? { protocol, capabilities: ["plans"] }
        : {
            protocol,
            capabilities: ["plans"],
            agreementId: `agreement-${++issued}`,
          };
    },
    read: async (id, context?: ReaderRequestContext) => {
      log.reads.push(context?.agreementId);
      await options.readDelay?.();
      if (context && expired.has(context.agreementId))
        throw new ConversationReadError(id, 409, expiredError);
      return structuredClone(conversation);
    },
    send: async (reply, _id, context?: ReaderRequestContext) => {
      log.sends.push({
        id: reply.clientReplyId,
        agreement: context?.agreementId,
      });
      if (context && expired.has(context.agreementId)) throw expiredError;
      return { id: reply.clientReplyId };
    },
    subscribe: (_id, _listener, context?: ReaderRequestContext) => {
      log.subscribes.push(context?.agreementId);
      return () => {
        log.closes++;
      };
    },
  };
  return {
    transport,
    log,
    expire: (id: string) => expired.add(id),
  };
}

describe("agreement offer and context", () => {
  it("negotiation intersects the offered capabilities and keeps a two-argument host legacy", () => {
    expect(
      negotiate(["1.0"], ["plans", "flows"], { capabilities: ["plans"] }),
    ).toEqual({ protocol: "1.0", capabilities: ["plans"] });
    expect(negotiate(["1.0"], ["plans", "flows"])).toEqual({
      protocol: "1.0",
      capabilities: ["plans", "flows"],
    });
  });
  it("each client offers its capabilities and sends its own agreement on every request", async () => {
    const host = bindingHost();
    const base = config();
    const a = createWaypointClient({ ...base, transport: host.transport });
    const b = createWaypointClient({ ...base, transport: host.transport });
    await a.ready;
    await b.ready;
    expect(host.log.negotiate[0]?.offer).toEqual({
      // Without an intent port, plan recovery, Leave and Keep are not offered.
      capabilities: CAPABILITIES.filter(
        (value) =>
          value !== "plan-recovery" &&
          value !== "plan-leave" &&
          value !== "plan-keep",
      ),
    });
    expect(host.log.reads.sort()).toEqual(["agreement-1", "agreement-2"]);
    expect(host.log.subscribes.sort()).toEqual(["agreement-1", "agreement-2"]);
    await a.setDraft("From a");
    await a.send();
    await b.setDraft("From b");
    await b.send();
    expect(host.log.sends.map((row) => row.agreement)).toEqual([
      "agreement-1",
      "agreement-2",
    ]);
    a.dispose();
    b.dispose();
  });
  it("a legacy answer without an agreement sends no binding", async () => {
    const host = bindingHost({ legacy: true });
    const client = createWaypointClient({
      ...config(),
      transport: host.transport,
    });
    await client.ready;
    expect(host.log.reads).toEqual([undefined]);
    expect(host.log.subscribes).toEqual([undefined]);
    client.dispose();
  });
  it("the HTTP transport sends the agreement as a header and stream query, never to negotiate", async () => {
    const calls: { path: string; headers?: Record<string, string> }[] = [];
    const paths: string[] = [];
    const transport = createHttpTransport(
      async (path, init) => {
        calls.push({ path, headers: init?.headers });
        if (path === "/negotiate")
          return {
            status: 200,
            body: {
              protocol: "1.0",
              capabilities: [],
              agreementId: "agreement-9",
            },
          };
        return { status: 200, body: structuredClone(conversation) };
      },
      {
        subscribe: (path) => {
          paths.push(path);
          return () => {};
        },
      },
    );
    const answer = await transport.negotiate(["1.0"], {
      capabilities: ["plans"],
    });
    expect(answer.agreementId).toBe("agreement-9");
    expect(calls[0]?.headers?.["Waypoint-Agreement"]).toBeUndefined();
    const context = { agreementId: "agreement-9" };
    await transport.read("conversation-a", context);
    await transport.send(
      {
        kind: "message",
        protocol: "1.0",
        clientReplyId: "reply-a",
        clientMessageId: "reply-a",
        content: "Hi",
      },
      "conversation-a",
      context,
    );
    transport.subscribe("conversation-a", () => {}, context);
    expect(calls[1]?.headers?.["Waypoint-Agreement"]).toBe("agreement-9");
    expect(calls[2]?.headers?.["Waypoint-Agreement"]).toBe("agreement-9");
    expect(paths[0]).toBe(
      "/conversations/conversation-a/stream?waypointAgreement=agreement-9",
    );
    await transport.read("conversation-a");
    transport.subscribe("conversation-a", () => {});
    expect(calls[3]?.headers?.["Waypoint-Agreement"]).toBeUndefined();
    expect(paths[1]).toBe("/conversations/conversation-a/stream");
  });
  it("the HTTP transport offers its capabilities in the negotiation body", async () => {
    let body: unknown;
    const transport = createHttpTransport(
      async (path, init) => {
        body = JSON.parse(init?.body ?? "null");
        return { status: 200, body: { protocol: "1.0", capabilities: [] } };
      },
      { subscribe: () => () => {} },
    );
    await transport.negotiate(["1.0"], { capabilities: ["plans"] });
    expect(body).toEqual({
      protocol: "1.0",
      supported: ["1.0"],
      offer: { capabilities: ["plans"] },
    });
  });
  it("plan reads carry the client's agreement", async () => {
    const host = bindingHost();
    const reads: (string | undefined)[] = [];
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...host.transport,
        subscribe: (_id, listener, context) => {
          host.log.subscribes.push(context?.agreementId);
          queueMicrotask(() =>
            listener({
              type: "frame",
              frame: {
                protocol: "1.0",
                sequence: 1,
                type: "plan.final",
                messageId: "message-a",
                plan: (structuredClone(samples.PlanRecord) as PlanRecord).plan,
              } as never,
            }),
          );
          return () => {};
        },
      },
      plans: {
        read: async (id, context) => {
          reads.push(context?.agreementId);
          return { ...(structuredClone(samples.PlanRecord) as PlanRecord), id };
        },
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => structuredClone(samples.PlanRecord) as PlanRecord,
      },
    });
    await client.ready;
    await flush();
    expect(reads).toEqual(["agreement-1"]);
    client.dispose();
  });
});

describe("agreement refusal", () => {
  it("a refusal of the current agreement renegotiates once and rebinds the stream and read", async () => {
    const host = bindingHost();
    const client = createWaypointClient({
      ...config(),
      transport: host.transport,
    });
    await client.ready;
    host.expire("agreement-1");
    await client.refresh();
    await flush();
    expect(host.log.negotiate).toHaveLength(2);
    expect(host.log.closes).toBe(1);
    expect(host.log.subscribes).toEqual(["agreement-1", "agreement-2"]);
    expect(host.log.reads.at(-1)).toBe("agreement-2");
    expect(client.getSnapshot().conversation?.id).toBe("conversation-a");
    expect(client.getSnapshot().problem).toBeNull();
    client.dispose();
  });
  it("concurrent refusals of one agreement share a single renegotiation", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = bindingHost();
    const client = createWaypointClient({
      ...config(),
      transport: {
        ...host.transport,
        negotiate: async (supported, offer) => {
          if (host.log.negotiate.length >= 1) await held;
          return host.transport.negotiate(supported, offer);
        },
      },
    });
    await client.ready;
    host.expire("agreement-1");
    void client.refresh();
    await flush();
    await client.setDraft("Hello");
    await client.send();
    await flush();
    release();
    await flush();
    expect(host.log.negotiate).toHaveLength(2);
    expect(host.log.subscribes).toEqual(["agreement-1", "agreement-2"]);
    client.dispose();
  });
  it("a late refusal of a superseded agreement does not renegotiate again", async () => {
    let releaseSend!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const host = bindingHost();
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...host.transport,
        send: async (reply, id, context) => {
          await held;
          return host.transport.send(reply, id, context);
        },
      },
    });
    await client.ready;
    await client.setDraft("Hello");
    const sending = client.send();
    await flush();
    host.expire("agreement-1");
    await client.refresh();
    await flush();
    expect(host.log.negotiate).toHaveLength(2);
    releaseSend();
    await sending;
    await flush();
    expect(host.log.negotiate).toHaveLength(2);
    client.dispose();
  });
  it("an immediate refusal of the replacement agreement stops with unavailable until an explicit refresh", async () => {
    const host = bindingHost();
    const client = createWaypointClient({
      ...config(),
      transport: host.transport,
    });
    await client.ready;
    for (let id = 1; id <= 6; id++) host.expire(`agreement-${id}`);
    await client.refresh();
    await flush();
    await flush();
    expect(host.log.negotiate).toHaveLength(2);
    expect(client.getSnapshot().problem).toEqual({
      code: "unavailable",
      id: "agreement",
    });
    await client.refresh();
    await flush();
    expect(host.log.negotiate).toHaveLength(3);
    client.dispose();
  });
  it("a renegotiation that changes the protocol reports update-required instead of rebinding", async () => {
    const host = bindingHost({ protocols: ["1.0", "1.1"] });
    const client = createWaypointClient({
      ...config(),
      transport: host.transport,
    });
    await client.ready;
    host.expire("agreement-1");
    await client.refresh();
    await flush();
    expect(client.getSnapshot().problem).toEqual({
      code: "update-required",
      id: "agreement",
    });
    expect(host.log.subscribes).toEqual(["agreement-1"]);
    client.dispose();
  });
  it("a refused message stays in the outbox and is resent only by an explicit retry", async () => {
    const host = bindingHost();
    const client = createWaypointClient({
      ...config(),
      transport: host.transport,
    });
    await client.ready;
    host.expire("agreement-1");
    await client.setDraft("Hello");
    await client.send();
    await flush();
    const row = client.getSnapshot().pending[0];
    expect(row?.failure?.code).toBe("agreement-expired");
    expect(host.log.negotiate).toHaveLength(2);
    expect(host.log.sends).toHaveLength(1);
    await client.retry(row!.id);
    expect(host.log.sends).toEqual([
      { id: row!.id, agreement: "agreement-1" },
      { id: row!.id, agreement: "agreement-2" },
    ]);
    expect(client.getSnapshot().pending).toEqual([]);
    client.dispose();
  });
  it("a refused reply or confirmation is not resent", async () => {
    const host = bindingHost();
    const client = createWaypointClient({
      ...config(),
      transport: host.transport,
    });
    await client.ready;
    host.expire("agreement-1");
    expect(
      await client.reply({
        kind: "action",
        protocol: "1.0",
        clientReplyId: "reply-a",
        blockId: "block-a",
        actionId: "action-a",
      }),
    ).toBe(false);
    await flush();
    expect(client.getSnapshot().problem).toEqual({
      code: "agreement-expired",
      id: "reply-a",
    });
    expect(host.log.negotiate).toHaveLength(2);
    expect(host.log.sends).toHaveLength(1);
    client.dispose();
  });
  it("agreement-expired is a closed problem code and read errors keep only a validated problem", () => {
    expect(asProblem(expiredError, "x")).toEqual({
      code: "agreement-expired",
      id: "x",
    });
    expect(new ConversationReadError("c", 409, expiredError).problem).toEqual(
      expiredError,
    );
    expect(
      new ConversationReadError("c", 409, {
        code: "secret detail",
        id: "x",
      } as never).problem,
    ).toBeUndefined();
  });
  it("dispose during renegotiation installs nothing", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = bindingHost();
    const client = createWaypointClient({
      ...config(),
      transport: {
        ...host.transport,
        negotiate: async (supported, offer) => {
          if (host.log.negotiate.length >= 1) await held;
          return host.transport.negotiate(supported, offer);
        },
      },
    });
    await client.ready;
    host.expire("agreement-1");
    void client.refresh();
    await flush();
    client.dispose();
    release();
    await flush();
    expect(host.log.subscribes).toEqual(["agreement-1"]);
    expect(host.log.reads.filter((id) => id === "agreement-2")).toEqual([]);
  });
});

describe("agreement review regressions", () => {
  const steppedPlan = (): PlanRecord => {
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    if (record.plan.kind === "immediate")
      record.plan.steps = record.plan.steps.map((step) => ({
        ...step,
        stepUp: true,
      }));
    return record;
  };
  it("a refusal of the current agreement retires an active legacy run without remote controls", async () => {
    const host = bindingHost();
    let releaseStepUp!: (code: string) => void;
    let stepUps = 0;
    const effects: string[] = [];
    let controls = 0;
    const client = createWaypointClient({
      ...config(),
      transport: host.transport,
      plans: {
        read: async () => steppedPlan(),
        request: async (_request, context) => {
          effects.push(context.stepId);
        },
        heartbeat: async () => {},
        stop: async () => {
          controls++;
          return steppedPlan();
        },
        stepUp: () =>
          ++stepUps === 1
            ? new Promise<string>((resolve) => {
                releaseStepUp = resolve;
              })
            : Promise.resolve("code-b"),
      },
    });
    await client.ready;
    const running = client.runPlan("plan-a", "plan-digest");
    await flush();
    host.expire("agreement-1");
    await client.refresh();
    await flush();
    expect(host.log.negotiate).toHaveLength(2);
    releaseStepUp("code-a");
    await running;
    await flush();
    expect(effects).toEqual([]);
    expect(controls).toBe(0);
    await client.runPlan("plan-a", "plan-digest");
    expect(effects).toEqual(["step-a"]);
    client.dispose();
  });
  it("plan-read refusals of the current agreement reach the binding owner", async () => {
    for (const source of ["frame", "runner"] as const) {
      const host = bindingHost();
      let refuse = false;
      const base = config();
      const client = createWaypointClient({
        ...base,
        transport: {
          ...host.transport,
          subscribe: (id, listener, context) => {
            const close = host.transport.subscribe(id, listener, context);
            if (source === "frame" && context?.agreementId === "agreement-1")
              queueMicrotask(() =>
                listener({
                  type: "frame",
                  frame: {
                    protocol: "1.0",
                    sequence: 1,
                    type: "plan.final",
                    messageId: "message-a",
                    plan: steppedPlan().plan,
                  } as never,
                }),
              );
            return close;
          },
        },
        plans: {
          read: async (_id, context) => {
            if (refuse && context?.agreementId === "agreement-1")
              throw expiredError;
            return structuredClone(samples.PlanRecord) as PlanRecord;
          },
          request: async () => {},
          heartbeat: async () => {},
          stop: async () => structuredClone(samples.PlanRecord) as PlanRecord,
        },
      });
      refuse = source === "frame";
      await client.ready;
      await flush();
      if (source === "runner") {
        refuse = true;
        await client.runPlan("plan-a", "plan-digest");
        await flush();
      }
      expect(host.log.negotiate, source).toHaveLength(2);
      expect(host.log.closes, source).toBe(1);
      expect(client.getSnapshot().problem?.code, source).not.toBe(
        "invalid-plan",
      );
      client.dispose();
    }
  });
  it("a binding stall also holds the startup retry owner until an explicit refresh", async () => {
    const manual = createManualClock(1000);
    const host = bindingHost();
    host.expire("agreement-1");
    host.expire("agreement-2");
    const onlineListeners = new Set<(online: boolean) => void>();
    const base = config();
    const client = createWaypointClient({
      ...base,
      platform: {
        ...base.platform,
        clock: manual.clock,
        subscribeOnline: (fn) => {
          onlineListeners.add(fn);
          return () => onlineListeners.delete(fn);
        },
      },
      transport: host.transport,
    });
    await client.ready;
    await flush();
    expect(client.getSnapshot().problem).toEqual({
      code: "unavailable",
      id: "agreement",
    });
    const reads = host.log.reads.length;
    await manual.advance(300000);
    for (const fn of onlineListeners) fn(true);
    await flush();
    expect(host.log.reads).toHaveLength(reads);
    expect(host.log.negotiate).toHaveLength(2);
    expect((await client.refresh()).kind).toBe("loaded");
    expect(host.log.negotiate).toHaveLength(3);
    client.dispose();
  });
  it("a refusal of a reply from a retired conversation leaves the current one alone", async () => {
    let rejectHeld!: (error: unknown) => void;
    const host = bindingHost();
    const client = createWaypointClient({
      ...config(),
      transport: {
        ...host.transport,
        read: async (id, context) => ({
          ...(await host.transport.read(id, context)),
          id,
        }),
        send: (reply, id, context) =>
          reply.kind === "action"
            ? new Promise((_resolve, reject) => {
                rejectHeld = reject;
              })
            : host.transport.send(reply, id, context),
      },
    });
    await client.ready;
    const held = client.reply({
      kind: "action",
      protocol: "1.0",
      clientReplyId: "reply-a",
      blockId: "block-a",
      actionId: "action-a",
    });
    await flush();
    await client.switchConversation("conversation-b");
    const closes = host.log.closes;
    rejectHeld(expiredError);
    expect(await held).toBe(false);
    await flush();
    expect(host.log.negotiate).toHaveLength(1);
    expect(host.log.closes).toBe(closes);
    client.dispose();
  });
  it("disposal during the replacement publication or subscribe starts no further read", async () => {
    for (const when of ["capabilities", "subscribe"] as const) {
      const host = bindingHost();
      let calls = 0;
      const base = config();
      let dispose = () => {};
      const client = createWaypointClient({
        ...base,
        transport: {
          ...host.transport,
          negotiate: async (supported, offer) => {
            const answer = await host.transport.negotiate(supported, offer);
            return ++calls === 2 && when === "capabilities"
              ? { ...answer, capabilities: ["plans", "flows"] }
              : answer;
          },
          subscribe: (id, listener, context) => {
            const close = host.transport.subscribe(id, listener, context);
            if (when === "subscribe" && context?.agreementId === "agreement-2")
              dispose();
            return close;
          },
        },
      });
      dispose = () => client.dispose();
      await client.ready;
      if (when === "capabilities")
        client.subscribe(() => {
          if (client.getSnapshot().capabilities.includes("flows"))
            client.dispose();
        });
      host.expire("agreement-1");
      await client.refresh();
      await flush();
      expect(
        host.log.reads.filter((id) => id === "agreement-2"),
        when,
      ).toEqual([]);
      if (when === "capabilities")
        expect(host.log.subscribes, when).toEqual(["agreement-1"]);
    }
  });
});

describe("agreement fix-diff regressions", () => {
  const steppedPlan = (stepUp: boolean): PlanRecord => {
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    if (record.plan.kind === "immediate")
      record.plan.steps = record.plan.steps.map((step) => ({
        ...step,
        stepUp,
      }));
    return record;
  };
  for (const outcome of [
    "cancelled step-up",
    "rejected request",
    "unattributed request",
  ] as const)
    it(`an interrupted run asks for no remote stop or undo after a ${outcome}`, async () => {
      const host = bindingHost();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let controls = 0;
      let liveContext: { stepUpCode?: string } | undefined;
      const client = createWaypointClient({
        ...config(),
        transport: host.transport,
        plans: {
          read: async () => steppedPlan(true),
          request: async (_request, context) => {
            liveContext = context;
            await held;
            if (outcome === "rejected request") throw new Error("failed");
          },
          heartbeat: async () => {},
          stop: async () => {
            controls++;
            return steppedPlan(true);
          },
          stepUp: async () => {
            if (outcome === "cancelled step-up") {
              await held;
              return null;
            }
            return "code-a";
          },
        },
      });
      await client.ready;
      const running = client.runPlan("plan-a", "plan-digest");
      await flush();
      host.expire("agreement-1");
      await client.refresh();
      await flush();
      if (outcome !== "cancelled step-up")
        expect(liveContext?.stepUpCode).toBeUndefined();
      release();
      await running;
      await flush();
      expect(controls).toBe(0);
      client.dispose();
    });
  it("the post-rebind plan read cannot overwrite a newer plan read", async () => {
    const host = bindingHost();
    let listener!: (event: never) => void;
    let releaseOld!: () => void;
    const holdOld = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let planReads = 0;
    const running = structuredClone(samples.PlanRecord) as PlanRecord;
    const completed = { ...running, state: "completed" } as PlanRecord;
    const client = createWaypointClient({
      ...config(),
      transport: {
        ...host.transport,
        subscribe: (id, fn, context) => {
          listener = fn as never;
          return host.transport.subscribe(id, fn, context);
        },
      },
      plans: {
        read: async (_id, context) => {
          planReads++;
          if (context?.agreementId === "agreement-2" && planReads === 1) {
            await holdOld;
            return structuredClone(running);
          }
          return structuredClone(completed);
        },
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => structuredClone(running),
      },
    });
    await client.ready;
    client.setPlan(structuredClone(running));
    host.expire("agreement-1");
    await client.refresh();
    await flush();
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 5,
        type: "plan.final",
        messageId: "message-a",
        plan: running.plan,
      },
    } as never);
    await flush();
    expect(client.getSnapshot().plan?.state).toBe("completed");
    releaseOld();
    await flush();
    expect(client.getSnapshot().plan?.state).toBe("completed");
    client.dispose();
  });
  it("a plan response after a binding stall keeps the fixed unavailable problem", async () => {
    const host = bindingHost();
    let releaseRead!: () => void;
    const holdRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let held = false;
    let listener!: (event: never) => void;
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    const client = createWaypointClient({
      ...config(),
      transport: {
        ...host.transport,
        subscribe: (id, fn, context) => {
          listener = fn as never;
          return host.transport.subscribe(id, fn, context);
        },
      },
      plans: {
        read: async (_id, context) => {
          if (held && context?.agreementId === "agreement-2") await holdRead;
          return structuredClone(record);
        },
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => structuredClone(record),
      },
    });
    await client.ready;
    client.setPlan(structuredClone(record));
    host.expire("agreement-1");
    host.expire("agreement-2");
    await client.refresh();
    await flush();
    expect(client.getSnapshot().problem).toEqual({
      code: "unavailable",
      id: "agreement",
    });
    held = true;
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 5,
        type: "plan.final",
        messageId: "message-a",
        plan: record.plan,
      },
    } as never);
    await flush();
    releaseRead();
    await flush();
    expect(client.getSnapshot().problem).toEqual({
      code: "unavailable",
      id: "agreement",
    });
    client.dispose();
  });
});

describe("agreement invocation tokens", () => {
  const plain = () => structuredClone(samples.PlanRecord) as PlanRecord;
  for (const held of ["queued heartbeat", "initial plan read"] as const)
    it(`an interrupted run dispatches no ${held === "queued heartbeat" ? "queued" : "initial"} heartbeat`, async () => {
      const manual = createManualClock(1000);
      const host = bindingHost();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let heartbeats = 0;
      let reads = 0;
      const base = config();
      const client = createWaypointClient({
        ...base,
        platform: { ...base.platform, clock: manual.clock },
        transport: host.transport,
        plans: {
          clock: manual.clock,
          read: async () => {
            reads++;
            if (held === "initial plan read" && reads === 1) await gate;
            return plain();
          },
          request: async () => {
            if (held === "queued heartbeat" && reads <= 2) await gate;
          },
          heartbeat: async () => {
            heartbeats++;
          },
          stop: async () => plain(),
        },
      });
      await client.ready;
      const running = client.runPlan("plan-a", "plan-digest");
      await flush();
      const before = heartbeats;
      host.expire("agreement-1");
      await client.refresh();
      await flush();
      if (held === "queued heartbeat") await manual.advance(30000);
      release();
      await running;
      await flush();
      await manual.advance(30000);
      expect(heartbeats).toBe(before);
      client.dispose();
    });
  it("the post-rebind plan read cannot overwrite facts the runner published later", async () => {
    const host = bindingHost();
    let releaseHeld!: () => void;
    const holdRead = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    let afterRebind = 0;
    const running = plain();
    const completed: PlanRecord = {
      ...plain(),
      state: "completed",
      outcomes: [{ stepId: "step-a", status: 200, attributed: true }],
    };
    const client = createWaypointClient({
      ...config(),
      transport: host.transport,
      plans: {
        read: async (_id, context) => {
          if (context?.agreementId !== "agreement-2") return plain();
          afterRebind++;
          if (afterRebind === 1) {
            await holdRead;
            return structuredClone(running);
          }
          return afterRebind >= 4
            ? structuredClone(completed)
            : structuredClone(running);
        },
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => plain(),
      },
    });
    await client.ready;
    client.setPlan(plain());
    host.expire("agreement-1");
    await client.refresh();
    await flush();
    await client.runPlan("plan-a", "plan-digest");
    await flush();
    expect(client.getSnapshot().plan?.state).toBe("completed");
    releaseHeld();
    await flush();
    expect(client.getSnapshot().plan?.state).toBe("completed");
    expect(client.getSnapshot().plan?.outcomes).toEqual(completed.outcomes);
    client.dispose();
  });
});

describe("publication tokens from the sweep", () => {
  it("a frame plan read cannot overwrite a plan published after it was dispatched", async () => {
    const host = bindingHost();
    let listener!: (event: never) => void;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const older = structuredClone(samples.PlanRecord) as PlanRecord;
    const newer = { ...older, state: "completed" } as PlanRecord;
    const client = createWaypointClient({
      ...config(),
      transport: {
        ...host.transport,
        subscribe: (id, fn, context) => {
          listener = fn as never;
          return host.transport.subscribe(id, fn, context);
        },
      },
      plans: {
        read: async () => {
          await gate;
          return structuredClone(older);
        },
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => structuredClone(older),
      },
    });
    await client.ready;
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 5,
        type: "plan.final",
        messageId: "message-a",
        plan: older.plan,
      },
    } as never);
    await flush();
    client.setPlan(newer);
    release();
    await flush();
    expect(client.getSnapshot().plan?.state).toBe("completed");
    client.dispose();
  });
  it("an older flow load cannot overwrite a newer one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loads = 0;
    const client = createWaypointClient({
      ...config(),
      tabs: ["presets"],
      flowSource: {
        list: async () => {
          const load = ++loads;
          if (load === 1) await gate;
          return [{ id: `flow-${load}`, title: `Flow ${load}` }];
        },
        setFavourite: async () => {},
        run: async () => ({ conversationId: "conversation-a" }),
      },
    });
    await client.ready;
    const first = client.loadFlows();
    // The older load's list request is in flight before the newer starts.
    while (loads === 0) await flush();
    await client.loadFlows();
    release();
    await first;
    expect(client.getSnapshot().flows.presets?.[0]?.id).toBe("flow-2");
    client.dispose();
  });
});

describe("publication tokens from the sweep, deprecated and flow paths", () => {
  it("a retry-undo result cannot overwrite a plan published after it was requested", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const older = structuredClone(samples.PlanRecord) as PlanRecord;
    const newer = { ...older, state: "completed" } as PlanRecord;
    const client = createWaypointClient({
      ...config(),
      plans: {
        read: async () => structuredClone(older),
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => structuredClone(older),
        retryUndo: async () => {
          await gate;
          return structuredClone(older);
        },
      },
    });
    await client.ready;
    client.setPlan(structuredClone(older));
    const retrying = client.retryUndo();
    await flush();
    client.setPlan(newer);
    release();
    await retrying;
    expect(client.getSnapshot().plan?.state).toBe("completed");
    client.dispose();
  });
  it("a flow run that finishes after dispose does not switch conversations", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const touched: string[] = [];
    let writes = 0;
    const base = config();
    const client = createWaypointClient({
      ...base,
      storage: {
        get: () => null,
        set: () => {
          writes++;
        },
        remove: () => {},
      },
      transport: {
        ...base.transport,
        read: async (id) => {
          touched.push(id);
          return { ...structuredClone(conversation), id };
        },
        subscribe: (id) => {
          touched.push(id);
          return () => {};
        },
      },
      flowSource: {
        list: async () => [],
        setFavourite: async () => {},
        run: async () => {
          await gate;
          return { conversationId: "conversation-b" };
        },
      },
    });
    await client.ready;
    const running = client.runFlow("flow-a", {});
    await flush();
    client.dispose();
    const before = writes;
    release();
    await running;
    await flush();
    expect(touched.filter((id) => id === "conversation-b")).toEqual([]);
    expect(writes).toBe(before);
  });
});
