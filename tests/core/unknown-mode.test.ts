import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  type TransportEvent,
} from "../../src/core/client";
import type {
  Conversation,
  Frame,
  ManifestEntry,
  ImmediateDraft,
  PlanRecord,
  ToolCall,
} from "../../src/protocol/generated";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const record = () => structuredClone(samples.PlanRecord) as PlanRecord;
const tool: Frame = {
  protocol: "1.0",
  sequence: 1,
  type: "tool.call",
  call: samples.ToolCall as ToolCall,
};
const plan: Frame = {
  protocol: "1.0",
  sequence: 2,
  type: "plan.draft",
  messageId: "draft",
  plan: samples.ImmediateDraft as ImmediateDraft,
};
for (const mode of ["ordinary", "form-fill"] as const)
  for (const startup of [false, true])
    it(`holds frames for ${mode} on ${startup ? "startup" : "child selection"} until the read succeeds`, async () => {
      const gate = deferred();
      let listener!: (event: TransportEvent) => void;
      const order: string[] = [];
      const request = vi.fn(async () => {
        order.push("tool");
        return { title: "Safe" };
      });
      const readPlan = vi.fn(async () => {
        order.push("plan");
        return record();
      });
      const cfg = config();
      cfg.reads = {
        manifest: [samples.ManifestEntry as ManifestEntry],
        request,
      };
      cfg.plans = {
        read: readPlan,
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => record(),
      };
      cfg.transport.subscribe = (_id, fn) => {
        listener = fn;
        return () => {};
      };
      cfg.transport.read = async (id) => {
        if (startup || id === "child") await gate.promise;
        return {
          protocol: "1.0",
          id,
          title: "Chat",
          messages: [],
          ...(mode === "form-fill" && (startup || id === "child")
            ? { mode }
            : {}),
        };
      };
      const client = createWaypointClient(cfg);
      const refused: string[] = [];
      client.on((event) => {
        if (event.type === "problem" && event.problemId === "form-tools")
          refused.push(event.problemId);
      });
      const selection = startup
        ? client.ready
        : client.ready.then(() => client.switchConversation("child"));
      await vi.waitFor(() =>
        expect(client.getSnapshot().conversationId).toBe(
          startup ? "conversation-a" : "child",
        ),
      );
      await vi.waitFor(() => expect(listener).toBeDefined());
      listener({ type: "frame", frame: tool });
      listener({ type: "frame", frame: plan });
      listener({ type: "frame", frame: plan });
      await Promise.resolve();
      await Promise.resolve();
      expect(request).not.toHaveBeenCalled();
      expect(readPlan).not.toHaveBeenCalled();
      expect(client.getSnapshot().plan).toBeNull();
      gate.resolve();
      await selection;
      if (mode === "ordinary") {
        await vi.waitFor(() =>
          expect(client.getSnapshot().plan?.id).toBe(record().id),
        );
        expect(order).toEqual(["tool", "plan"]);
        listener({ type: "frame", frame: tool });
        listener({ type: "frame", frame: plan });
        expect(request).toHaveBeenCalledOnce();
        expect(readPlan).toHaveBeenCalledOnce();
      } else {
        await vi.waitFor(() =>
          expect(client.getSnapshot().problem?.code).toBe("refused"),
        );
        expect(request).not.toHaveBeenCalled();
        expect(readPlan).not.toHaveBeenCalled();
        expect(client.getSnapshot().plan).toBeNull();
        expect(refused).toHaveLength(2);
      }
      client.dispose();
    });
it("holds frames after a failed read, refuses direct execution, and resolves them on recovery", async () => {
  let listener!: (event: TransportEvent) => void;
  let recovered = false;
  const cfg = config();
  const request = vi.fn(async () => ({ title: "Safe" }));
  const readPlan = vi.fn(async () => record());
  const runFlow = vi.fn();
  cfg.reads = { manifest: [samples.ManifestEntry as ManifestEntry], request };
  cfg.plans = {
    read: readPlan,
    request: async () => {},
    heartbeat: async () => {},
    stop: async () => record(),
  };
  cfg.flowSource = {
    list: async () => [],
    setFavourite: async () => {},
    run: runFlow,
  };
  cfg.transport.read = async (id): Promise<Conversation> => {
    if (!recovered) throw new Error("Unavailable");
    return { protocol: "1.0", id, title: "Chat", messages: [] };
  };
  cfg.transport.subscribe = (_id, fn) => {
    listener = fn;
    return () => {};
  };
  const client = createWaypointClient(cfg);
  await client.ready;
  listener({ type: "frame", frame: tool });
  listener({ type: "frame", frame: plan });
  client.setPlan(record());
  await client.runPlan("plan-a", "digest");
  await client.runFlow("flow", {});
  expect(client.getSnapshot().plan).toBeNull();
  expect(client.getSnapshot().problem?.id).toBe("conversation-read");
  expect(request).not.toHaveBeenCalled();
  expect(readPlan).not.toHaveBeenCalled();
  expect(runFlow).not.toHaveBeenCalled();
  client.stopPlan("plan-a");
  recovered = true;
  await client.refresh();
  await vi.waitFor(() => expect(readPlan).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledOnce();
  await client.runPlan("plan-a", "digest");
  expect(client.getSnapshot().problem?.code).toBe("stopped");
  client.dispose();
});
for (const mode of ["ordinary", "form-fill"] as const)
  it(`ignores untrusted extra mode hints until a read confirms ${mode}`, async () => {
    const cfg = config();
    const gate = deferred();
    let listener!: (event: TransportEvent) => void;
    const request = vi.fn(async () => ({ title: "Safe" }));
    cfg.reads = { manifest: [samples.ManifestEntry as ManifestEntry], request };
    cfg.transport.subscribe = (_id, fn) => {
      listener = fn;
      return () => {};
    };
    cfg.transport.read = async (id) => {
      if (id === "child") await gate.promise;
      return {
        protocol: "1.0",
        id,
        title: "Chat",
        messages: [],
        ...(id === "child" && mode === "form-fill" ? { mode } : {}),
      };
    };
    const client = createWaypointClient(cfg);
    await client.ready;
    const select: Promise<void> = Reflect.apply(
      client.switchConversation,
      client,
      ["child", mode === "ordinary" ? "form-fill" : "ordinary"],
    );
    await vi.waitFor(() =>
      expect(client.getSnapshot().conversationId).toBe("child"),
    );
    listener({ type: "frame", frame: tool });
    await Promise.resolve();
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    expect(client.getSnapshot().problem).toBeNull();
    gate.resolve();
    await select;
    if (mode === "ordinary")
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    else {
      expect(request).not.toHaveBeenCalled();
      expect(client.getSnapshot().problem?.code).toBe("refused");
    }
    client.dispose();
  });
it("establishes mode on the first successful read even when a newer refetch is pending", async () => {
  const cfg = config();
  const first = deferred(),
    next = deferred();
  let listener!: (event: TransportEvent) => void;
  let reads = 0;
  cfg.transport.subscribe = (_id, fn) => {
    listener = fn;
    return () => {};
  };
  cfg.transport.read = async (id) => {
    const attempt = ++reads;
    await (attempt === 1 ? first.promise : next.promise);
    return { protocol: "1.0", id, title: "Ordinary", messages: [] };
  };
  const client = createWaypointClient(cfg);
  await vi.waitFor(() => expect(reads).toBe(1));
  listener({
    type: "frame",
    frame: {
      protocol: "1.0",
      type: "stale",
      sequence: 1,
      reads: ["conversation"],
    },
  });
  expect(reads).toBe(2);
  first.resolve();
  await vi.waitFor(() =>
    expect(client.getSnapshot().conversation?.title).toBe("Ordinary"),
  );
  client.setPlan(record());
  expect(client.getSnapshot().plan?.id).toBe(record().id);
  next.resolve();
  await client.refresh();
  client.dispose();
});
for (const held of [false, true])
  it(`starts later frames despite a hung first host read for ${held ? "held" : "live"} frames`, async () => {
    const gate = deferred();
    const cfg = config();
    let listener!: (event: TransportEvent) => void;
    const order: string[] = [];
    cfg.transport.read = async (id) => {
      if (held) await gate.promise;
      return { protocol: "1.0", id, title: "Chat", messages: [] };
    };
    cfg.transport.subscribe = (_id, fn) => {
      listener = fn;
      return () => {};
    };
    const request = vi.fn((call: ToolCall): Promise<unknown> => {
      order.push(call.id);
      return call.id === "hung"
        ? new Promise(() => {})
        : Promise.resolve({ title: "Safe" });
    });
    const readPlan = vi.fn(async () => {
      order.push("plan");
      return record();
    });
    cfg.reads = { manifest: [samples.ManifestEntry as ManifestEntry], request };
    cfg.plans = {
      read: readPlan,
      request: async () => {},
      heartbeat: async () => {},
      stop: async () => record(),
    };
    const send = vi.spyOn(cfg.transport, "send");
    const client = createWaypointClient(cfg);
    if (held) await vi.waitFor(() => expect(listener).toBeDefined());
    else await client.ready;
    listener({
      type: "frame",
      frame: {
        ...tool,
        call: { ...(samples.ToolCall as ToolCall), id: "hung" },
      } as Frame,
    });
    listener({
      type: "frame",
      frame: {
        ...tool,
        sequence: 2,
        call: { ...(samples.ToolCall as ToolCall), id: "second" },
      } as Frame,
    });
    listener({ type: "frame", frame: { ...plan, sequence: 3 } });
    gate.resolve();
    await client.ready;
    await vi.waitFor(() =>
      expect(client.getSnapshot().plan?.id).toBe(record().id),
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(order).toEqual(["hung", "second", "plan"]);
    expect(
      send.mock.calls.some(
        ([reply]) => reply.kind === "tool-result" && reply.callId === "second",
      ),
    ).toBe(true);
    client.dispose();
  });
it("discards held frames when switching away before their read resolves", async () => {
  const cfg = config();
  const a = deferred(),
    b = deferred();
  const listeners = new Map<string, (event: TransportEvent) => void>();
  cfg.transport.subscribe = (id, listener) => {
    listeners.set(id, listener);
    return () => {};
  };
  cfg.transport.read = async (id) => {
    if (id === "a") await a.promise;
    if (id === "b") await b.promise;
    return { protocol: "1.0", id, title: id, messages: [] };
  };
  const request = vi.fn(async () => ({ title: "Safe" }));
  cfg.reads = { manifest: [samples.ManifestEntry as ManifestEntry], request };
  const client = createWaypointClient(cfg);
  await client.ready;
  const selectA = client.switchConversation("a");
  await vi.waitFor(() => expect(listeners.has("a")).toBe(true));
  listeners.get("a")!({ type: "frame", frame: tool });
  const selectB = client.switchConversation("b");
  await vi.waitFor(() => expect(listeners.has("b")).toBe(true));
  b.resolve();
  await selectB;
  a.resolve();
  await selectA;
  expect(client.getSnapshot().conversationId).toBe("b");
  expect(request).not.toHaveBeenCalled();
  client.dispose();
});
it("deduplicates held sequences after reconnect resets the ingress sequence", async () => {
  const cfg = config();
  const gate = deferred();
  let listener!: (event: TransportEvent) => void;
  cfg.transport.subscribe = (_id, fn) => {
    listener = fn;
    return () => {};
  };
  cfg.transport.read = async (id) => {
    await gate.promise;
    return { protocol: "1.0", id, title: "Chat", messages: [] };
  };
  const request = vi.fn(async (_call: ToolCall) => ({ title: "Safe" }));
  cfg.reads = { manifest: [samples.ManifestEntry as ManifestEntry], request };
  const client = createWaypointClient(cfg);
  await vi.waitFor(() => expect(listener).toBeDefined());
  const frame = (sequence: number): Frame =>
    ({
      ...tool,
      sequence,
      call: { ...(samples.ToolCall as ToolCall), id: `call-${sequence}` },
    }) as Frame;
  listener({ type: "frame", frame: frame(1) });
  listener({ type: "frame", frame: frame(2) });
  listener({ type: "status", status: "reconnecting" });
  listener({ type: "frame", frame: frame(1) });
  listener({ type: "frame", frame: frame(3) });
  gate.resolve();
  await client.ready;
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(request.mock.calls.map(([call]) => call.id)).toEqual([
    "call-1",
    "call-2",
    "call-3",
  ]);
  client.dispose();
});
it("does not let a slow draft read overwrite a later final plan", async () => {
  const cfg = config();
  const draft = deferred();
  let listener!: (event: TransportEvent) => void;
  cfg.transport.subscribe = (_id, fn) => {
    listener = fn;
    return () => {};
  };
  const old: PlanRecord = {
    ...record(),
    state: "proposed",
    plan: samples.ImmediateDraft as ImmediateDraft,
  };
  const final = { ...record(), state: "awaiting-confirmation" as const };
  const read = vi
    .fn<NonNullable<typeof cfg.plans>["read"]>()
    .mockImplementationOnce(async () => {
      await draft.promise;
      return old;
    })
    .mockResolvedValue(final);
  cfg.plans = {
    read,
    request: async () => {},
    heartbeat: async () => {},
    stop: async () => record(),
  };
  const client = createWaypointClient(cfg);
  await client.ready;
  listener({ type: "frame", frame: { ...plan, sequence: 1 } });
  listener({
    type: "frame",
    frame: {
      type: "plan.final",
      sequence: 2,
      protocol: "1.0",
      messageId: "final",
      plan: final.plan as import("../../src/protocol/generated").ImmediatePlan,
    },
  });
  await vi.waitFor(() =>
    expect(client.getSnapshot().plan?.state).toBe("awaiting-confirmation"),
  );
  draft.resolve();
  await read.mock.results[0]!.value;
  await Promise.resolve();
  await Promise.resolve();
  expect(client.getSnapshot().plan?.state).toBe("awaiting-confirmation");
  expect(client.getSnapshot().plan?.plan).toEqual(final.plan);
  client.dispose();
});
for (const mode of ["ordinary", "form-fill"] as const)
  for (const reload of ["refresh", "switchConversation"] as const)
    it(`stops at the held bound and recovers ${mode} through explicit ${reload}`, async () => {
      const cfg = config();
      const gate = deferred();
      const listeners: ((event: TransportEvent) => void)[] = [];
      const unsubscribe = vi.fn();
      cfg.transport.subscribe = (_id, listener) => {
        listeners.push(listener);
        return unsubscribe;
      };
      cfg.transport.read = async (id) => {
        await gate.promise;
        return {
          protocol: "1.0",
          id,
          title: "Chat",
          messages: [],
          ...(mode === "form-fill" ? { mode } : {}),
        };
      };
      const request = vi.fn(async () => ({ title: "Safe" }));
      cfg.reads = {
        manifest: [samples.ManifestEntry as ManifestEntry],
        request,
      };
      const send = vi.spyOn(cfg.transport, "send");
      const client = createWaypointClient(cfg);
      const problems: string[] = [];
      client.on((event) => {
        if (event.type === "problem") problems.push(event.problemId);
      });
      await vi.waitFor(() => expect(listeners).toHaveLength(1));
      for (let i = 1; i <= 128; i++)
        listeners[0]!({ type: "frame", frame: { ...tool, sequence: i } });
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(problems).toEqual(["conversation-unavailable"]);
      listeners[0]!({ type: "status", status: "reconnecting" });
      listeners[0]!({ type: "frame", frame: { ...tool, sequence: 129 } });
      gate.resolve();
      await client.ready;
      expect(client.getSnapshot().problem?.id).toBe("conversation-unavailable");
      expect(client.getSnapshot().conversation).toBeNull();
      expect(problems).toEqual(["conversation-unavailable"]);
      expect(request).not.toHaveBeenCalled();
      await client.setDraft("Hello");
      await client.send();
      expect(
        await client.reply({
          kind: "tool-result",
          clientReplyId: "late",
          callId: "late",
          result: null,
        }),
      ).toBe(false);
      expect(send).not.toHaveBeenCalled();
      const result =
        reload === "refresh"
          ? await client.refresh()
          : await client.switchConversation("conversation-a");
      expect(result.kind).toBe("loaded");
      expect(listeners).toHaveLength(2);
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(client.getSnapshot().problem).toBeNull();
      listeners[1]!({ type: "frame", frame: tool });
      if (mode === "ordinary") {
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        expect(request).toHaveBeenCalledOnce();
      } else {
        expect(client.getSnapshot().problem?.id).toBe("form-tools");
        expect(request).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
      }
      client.dispose();
      expect(unsubscribe).toHaveBeenCalledTimes(2);
    });

it("reloads without waiting for the abandoned startup read", async () => {
  const cfg = config();
  let listener!: (event: TransportEvent) => void;
  let reads = 0;
  cfg.transport.read = async (id) => {
    if (++reads === 1) await new Promise(() => {});
    return { protocol: "1.0", id, title: "Chat", messages: [] };
  };
  cfg.transport.subscribe = (_id, fn) => {
    listener = fn;
    return () => {};
  };
  cfg.reads = {
    manifest: [samples.ManifestEntry as ManifestEntry],
    request: async () => ({ title: "Safe" }),
  };
  const send = vi.spyOn(cfg.transport, "send");
  const client = createWaypointClient(cfg);
  await vi.waitFor(() => expect(reads).toBe(1));
  for (let sequence = 1; sequence <= 128; sequence++)
    listener({ type: "frame", frame: { ...tool, sequence } });
  expect((await client.refresh()).kind).toBe("loaded");
  listener({ type: "frame", frame: tool });
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  client.dispose();
});
it("unsubscribes once when the held bound is reached synchronously during subscribe", async () => {
  const cfg = config();
  const unsubscribe = vi.fn();
  cfg.transport.subscribe = (_id, listener) => {
    for (let sequence = 1; sequence <= 130; sequence++)
      listener({ type: "frame", frame: { ...tool, sequence } });
    return unsubscribe;
  };
  const client = createWaypointClient(cfg);
  await client.ready;
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(client.getSnapshot().problem?.id).toBe("conversation-unavailable");
  client.dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

for (const storage of ["none", "working", "stale", "failing"] as const)
  for (const reload of ["refresh", "switchConversation"] as const)
    it(`preserves local input through ${reload} with ${storage} storage`, async () => {
      const cfg = config();
      let raw: string | null = null;
      if (storage !== "none")
        cfg.storage = {
          get: async () =>
            storage === "stale"
              ? JSON.stringify({ draft: "stale", pending: [] })
              : raw,
          set: async (_key, value) => {
            if (storage === "failing") throw new Error("Storage unavailable");
            raw = value;
          },
          remove: async () => {},
        };
      let recovered = false;
      cfg.transport.read = async (id) => {
        if (!recovered) throw new Error("Read unavailable");
        return { protocol: "1.0", id, title: "Chat", messages: [] };
      };
      const send = vi
        .fn<typeof cfg.transport.send>()
        .mockRejectedValue({ code: "refused", id: "send-refused" });
      cfg.transport.send = send;
      let listener!: (event: TransportEvent) => void;
      cfg.transport.subscribe = (_id, fn) => {
        listener = fn;
        return () => {};
      };
      const client = createWaypointClient(cfg);
      await client.ready;
      await client.setDraft("Failed row");
      await client.send();
      const pending = client.getSnapshot().pending;
      expect(pending).toHaveLength(1);
      await client.setDraft("Keep edit");
      for (let sequence = 1; sequence <= 128; sequence++)
        listener({ type: "frame", frame: { ...tool, sequence } });
      await client.send();
      await client.retry(pending[0]!.id);
      // A send is dispatched only after its claim is committed.
      const sends = storage === "failing" ? 0 : 1;
      expect(send).toHaveBeenCalledTimes(sends);
      recovered = true;
      const result =
        reload === "refresh"
          ? await client.refresh()
          : await client.switchConversation("conversation-a");
      expect(result.kind).toBe("loaded");
      expect(client.getSnapshot().draft).toBe("Keep edit");
      expect(client.getSnapshot().pending).toEqual(pending);
      send.mockResolvedValue({ id: "accepted" });
      await client.retry(pending[0]!.id);
      if (storage === "failing") {
        expect(send).not.toHaveBeenCalled();
        expect(client.getSnapshot().pending).toEqual(pending);
      } else {
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1]![0]).toMatchObject({
          clientReplyId: pending[0]!.id,
          content: "Failed row",
        });
        expect(client.getSnapshot().pending).toEqual([]);
      }
      expect(client.getSnapshot().draft).toBe("Keep edit");
      client.dispose();
    });

for (const mode of ["ordinary", "form-fill"] as const)
  it(`publishes the loaded ${mode} conversation before held frames start`, async () => {
    const gate = deferred();
    let listener!: (event: TransportEvent) => void;
    const cfg = config();
    cfg.reads = {
      manifest: [samples.ManifestEntry as ManifestEntry],
      request: async () => ({ title: "Safe" }),
    };
    cfg.plans = {
      read: async () => record(),
      request: async () => {},
      heartbeat: async () => {},
      stop: async () => record(),
    };
    cfg.transport.subscribe = (_id, fn) => {
      listener = fn;
      return () => {};
    };
    cfg.transport.read = async (id) => {
      await gate.promise;
      return {
        protocol: "1.0",
        id,
        title: "Chat",
        messages: [],
        ...(mode === "form-fill" ? { mode } : {}),
      };
    };
    const client = createWaypointClient(cfg);
    await vi.waitFor(() => expect(listener).toBeDefined());
    listener({ type: "frame", frame: tool });
    listener({ type: "frame", frame: plan });
    // Every notification, in order: what the snapshot held and which
    // problem events had been emitted by then.
    const seen: { loaded: boolean; problems: number }[] = [];
    let problems = 0;
    client.on((event) => {
      if (event.type === "problem") problems++;
    });
    client.subscribe(() =>
      seen.push({
        loaded: client.getSnapshot().conversation?.title === "Chat",
        problems,
      }),
    );
    gate.resolve();
    await client.ready;
    await vi.waitFor(() =>
      mode === "ordinary"
        ? expect(client.getSnapshot().plan?.id).toBe(record().id)
        : expect(client.getSnapshot().problem?.id).toBe("form-tools"),
    );
    const firstLoaded = seen.findIndex((entry) => entry.loaded);
    expect(firstLoaded).toBeGreaterThanOrEqual(0);
    // Nothing a held frame did reached a subscriber before the conversation
    // the frames belong to was published.
    expect(seen.slice(0, firstLoaded + 1).every((e) => e.problems === 0)).toBe(
      true,
    );
    client.dispose();
  });

it("starts the held frames even when a subscriber throws on the loaded snapshot", async () => {
  const gate = deferred();
  let listener!: (event: TransportEvent) => void;
  const readPlan = vi.fn(async () => record());
  const cfg = config();
  cfg.plans = {
    read: readPlan,
    request: async () => {},
    heartbeat: async () => {},
    stop: async () => record(),
  };
  cfg.transport.subscribe = (_id, fn) => {
    listener = fn;
    return () => {};
  };
  cfg.transport.read = async (id) => {
    await gate.promise;
    return { protocol: "1.0", id, title: "Chat", messages: [] };
  };
  const client = createWaypointClient(cfg);
  await vi.waitFor(() => expect(listener).toBeDefined());
  listener({ type: "frame", frame: plan });
  let thrown = false;
  client.subscribe(() => {
    if (!thrown && client.getSnapshot().conversation) {
      thrown = true;
      throw new Error("subscriber failed");
    }
  });
  gate.resolve();
  await client.ready.catch(() => {});
  await vi.waitFor(() => expect(readPlan).toHaveBeenCalledOnce());
  expect(thrown).toBe(true);
  client.dispose();
});
