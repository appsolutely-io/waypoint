import { it, expect, describe } from "vitest";
import {
  ConversationReadError,
  createWaypointClient,
  type ClientConfig,
  type TransportEvent,
  type WaypointClient,
} from "../../src/core/client";
import type { Conversation, PlanRecord } from "../../src/protocol/generated";
import {
  createScope,
  SCOPE_PARENTS,
  type Scope,
  type ScopeKind,
  type ScopeParentKind,
} from "../../src/core/scope";
import { config, createManualClock, flush } from "../support/client";
import samples from "../protocol/samples.json";

type Trigger = "dispose" | "retire" | "supersede" | "navigate";
type Effect =
  | "step dispatch"
  | "remote stop or undo"
  | "heartbeat"
  | "runner plan publication"
  | "frame plan publication"
  | "conversation read publication"
  | "stream event"
  | "flow dispatch"
  | "flow navigation"
  | "flow plan publication"
  | "startup retry"
  | "storage write";

const plan = (patch: Partial<PlanRecord> = {}): PlanRecord => ({
  ...(structuredClone(samples.PlanRecord) as PlanRecord),
  ...patch,
});
const stepped = (): PlanRecord => {
  const record = plan();
  if (record.plan.kind === "immediate")
    record.plan.steps = record.plan.steps.map((step) => ({
      ...step,
      stepUp: true,
    }));
  return record;
};
const conversationOf = (id: string): Conversation => ({
  protocol: "1.0",
  id,
  title: "Chat",
  messages: [],
});
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

interface Harness {
  client: WaypointClient;
  /** Counts effects that must not land after the trigger. */
  landed: () => number;
  start: () => Promise<void>;
  release: () => Promise<void>;
  supersede?: () => Promise<void>;
}

// Builds a client whose transport refuses the first agreement on demand, so
// "retire" can use the binding owner's local interruption.
function makeClient(extra: Partial<ClientConfig>, refusal: { on: boolean }) {
  const base = config();
  let issued = 0;
  const listeners = new Map<string, (event: TransportEvent) => void>();
  const client = createWaypointClient({
    ...base,
    transport: {
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: ["plans", "flows"],
        agreementId: `a-${++issued}`,
      }),
      read: async (id, context) => {
        if (refusal.on && context?.agreementId === "a-1")
          throw new ConversationReadError(id, 409, {
            code: "agreement-expired",
            id: "agreement",
          });
        return conversationOf(id);
      },
      send: async (reply) => ({ id: reply.clientReplyId }),
      subscribe: (id, listener) => {
        listeners.set(id, listener);
        return () => listeners.delete(id);
      },
      ...extra.transport,
    },
    ...extra,
  });
  return { client, listeners };
}
async function trigger(
  h: Harness,
  which: Trigger,
  refusal: { on: boolean },
): Promise<void> {
  if (which === "dispose") h.client.dispose();
  if (which === "navigate") await h.client.switchConversation("conversation-z");
  if (which === "retire") {
    refusal.on = true;
    await h.client.refresh();
    await flush();
  }
  if (which === "supersede") await h.supersede!();
}

const runner = (
  effect: "step dispatch" | "remote stop or undo" | "heartbeat",
): ((refusal: { on: boolean }) => Harness) => {
  return (refusal) => {
    const held = gate();
    const manual = createManualClock(1000);
    let count = 0;
    const { client } = makeClient(
      {
        platform: { ...config().platform, clock: manual.clock },
        plans: {
          clock: manual.clock,
          read: async () => (effect === "heartbeat" ? plan() : stepped()),
          request: async () => {
            if (effect === "step dispatch") count++;
            if (effect === "remote stop or undo") {
              await held.wait;
              throw new Error("failed");
            }
            if (effect === "heartbeat") await held.wait;
          },
          heartbeat: async () => {
            if (effect === "heartbeat") count++;
          },
          stop: async () => {
            if (effect === "remote stop or undo") count++;
            return plan();
          },
          stepUp: async () => {
            if (effect === "step dispatch") await held.wait;
            return "code";
          },
        },
      },
      refusal,
    );
    let running: Promise<void> = Promise.resolve();
    let before = 0;
    return {
      client,
      landed: () => count - before,
      async start() {
        await client.ready;
        running = client.runPlan("plan-a", "plan-digest");
        await flush();
        before = count;
      },
      async release() {
        await manual.advance(30000);
        held.open();
        await running;
        await flush();
        await manual.advance(30000);
      },
    };
  };
};

const scenarios: Record<
  Effect,
  Partial<Record<Trigger, (refusal: { on: boolean }) => Harness>>
> = {
  "step dispatch": {
    dispose: runner("step dispatch"),
    retire: runner("step dispatch"),
    navigate: runner("step dispatch"),
  },
  "remote stop or undo": {
    dispose: runner("remote stop or undo"),
    retire: runner("remote stop or undo"),
    navigate: runner("remote stop or undo"),
  },
  heartbeat: {
    dispose: runner("heartbeat"),
    retire: runner("heartbeat"),
    navigate: runner("heartbeat"),
  },
  "runner plan publication": Object.fromEntries(
    (["dispose", "retire", "navigate", "supersede"] as const).map((t) => [
      t,
      (refusal: { on: boolean }) => {
        const held = gate();
        let reads = 0;
        const { client } = makeClient(
          {
            plans: {
              read: async () => {
                reads++;
                if (reads === 1) {
                  await held.wait;
                  return plan({ state: "running" });
                }
                return plan({ state: "completed" });
              },
              request: async () => {},
              heartbeat: async () => {},
              stop: async () => plan(),
            },
          },
          refusal,
        );
        const published: string[] = [];
        return {
          client,
          landed: () => published.filter((s) => s === "running").length,
          async start() {
            await client.ready;
            client.subscribe(() => {
              const state = client.getSnapshot().plan?.state;
              if (state && published.at(-1) !== state) published.push(state);
            });
            void client.runPlan("plan-a", "plan-digest");
            await flush();
            published.length = 0;
          },
          async supersede() {
            client.setPlan(plan({ state: "completed" }));
          },
          async release() {
            held.open();
            await flush();
          },
        };
      },
    ]),
  ),
  "frame plan publication": Object.fromEntries(
    (["dispose", "navigate", "supersede"] as const).map((t) => [
      t,
      (refusal: { on: boolean }) => {
        const held = gate();
        const made = makeClient(
          {
            plans: {
              read: async () => {
                await held.wait;
                return plan({ state: "running" });
              },
              request: async () => {},
              heartbeat: async () => {},
              stop: async () => plan(),
            },
          },
          refusal,
        );
        let published = 0;
        return {
          client: made.client,
          landed: () => published,
          async start() {
            await made.client.ready;
            made.client.subscribe(() => {
              if (made.client.getSnapshot().plan?.state === "running")
                published++;
            });
            made.listeners.get("conversation-a")?.({
              type: "frame",
              frame: {
                protocol: "1.0",
                sequence: 9,
                type: "plan.final",
                messageId: "m",
                plan: plan().plan,
              } as never,
            });
            await flush();
          },
          async supersede() {
            made.client.setPlan(plan({ state: "completed" }));
          },
          async release() {
            held.open();
            await flush();
          },
        };
      },
    ]),
  ),
  "conversation read publication": Object.fromEntries(
    (["dispose", "navigate"] as const).map((t) => [
      t,
      (refusal: { on: boolean }) => {
        const held = gate();
        let reads = 0;
        const made = makeClient(
          {
            transport: {
              negotiate: async () => ({ protocol: "1.0", capabilities: [] }),
              read: async (id) => {
                const ordinal = ++reads;
                if (ordinal === 2) {
                  await held.wait;
                  return { ...conversationOf(id), title: "Stale" };
                }
                return conversationOf(id);
              },
              send: async (reply) => ({ id: reply.clientReplyId }),
              subscribe: () => () => {},
            },
          },
          refusal,
        );
        return {
          client: made.client,
          landed: () => {
            const snapshot = made.client.getSnapshot();
            // The stale read is for the conversation the client has left (or
            // the disposed client): it must not be the displayed record.
            return snapshot.conversation?.title === "Stale" ||
              (snapshot.conversation &&
                snapshot.conversation.id !== snapshot.conversationId)
              ? 1
              : 0;
          },
          async start() {
            await made.client.ready;
            void made.client.refresh();
            await flush();
          },
          async release() {
            held.open();
            await flush();
          },
        };
      },
    ]),
  ),
  "stream event": Object.fromEntries(
    (["dispose", "navigate"] as const).map((t) => [
      t,
      (refusal: { on: boolean }) => {
        const made = makeClient({}, refusal);
        let late!: (event: TransportEvent) => void;
        return {
          client: made.client,
          landed: () =>
            made.client.getSnapshot().status === "reconnecting" ? 1 : 0,
          async start() {
            await made.client.ready;
            late = made.listeners.get("conversation-a")!;
          },
          async release() {
            late({ type: "status", status: "reconnecting" });
            await flush();
          },
        };
      },
    ]),
  ),
  ...(Object.fromEntries(
    (
      ["flow dispatch", "flow navigation", "flow plan publication"] as const
    ).map((effect) => [
      effect,
      Object.fromEntries(
        (["dispose", "navigate", "supersede"] as const).map((t) => [
          t,
          (refusal: { on: boolean }) => {
            const held = gate();
            let runs = 0;
            const made = makeClient(
              {
                flowSource: {
                  list: async () => [],
                  setFavourite: async () => {},
                  load:
                    effect === "flow dispatch"
                      ? async (id) => {
                          if (id === "flow-a") await held.wait;
                          return undefined as never;
                        }
                      : undefined,
                  run: async (id) => {
                    runs++;
                    if (effect !== "flow dispatch" && id === "flow-a")
                      await held.wait;
                    return {
                      conversationId:
                        id === "flow-a" ? "conversation-b" : "conversation-c",
                      plan: plan({ id: id === "flow-a" ? "plan-b" : "plan-c" }),
                    };
                  },
                },
              },
              refusal,
            );
            let before = 0;
            return {
              client: made.client,
              landed: () => {
                const snapshot = made.client.getSnapshot();
                if (effect === "flow dispatch") return runs - before;
                if (effect === "flow navigation")
                  return snapshot.conversationId === "conversation-b" ? 1 : 0;
                return snapshot.plan?.id === "plan-b" ? 1 : 0;
              },
              async start() {
                await made.client.ready;
                void made.client.runFlow("flow-a", {});
                await flush();
                before = effect === "flow dispatch" ? runs : 0;
              },
              async supersede() {
                await made.client.runFlow("flow-c", {});
                if (effect === "flow dispatch") before++;
              },
              async release() {
                held.open();
                await flush();
                await flush();
              },
            };
          },
        ]),
      ),
    ]),
  ) as Record<
    "flow dispatch" | "flow navigation" | "flow plan publication",
    Partial<Record<Trigger, (refusal: { on: boolean }) => Harness>>
  >),
  "startup retry": {
    dispose: (refusal) => {
      const manual = createManualClock(1000);
      let negotiations = 0;
      const made = makeClient(
        {
          platform: { ...config().platform, clock: manual.clock },
          transport: {
            negotiate: async () => {
              negotiations++;
              throw new Error("offline");
            },
            read: async (id) => conversationOf(id),
            send: async (reply) => ({ id: reply.clientReplyId }),
            subscribe: () => () => {},
          },
        },
        refusal,
      );
      let before = 0;
      return {
        client: made.client,
        landed: () => negotiations - before,
        async start() {
          await made.client.ready;
          before = negotiations;
        },
        async release() {
          await manual.advance(120000);
        },
      };
    },
  },
  "storage write": {
    dispose: (refusal) => {
      let writes = 0;
      const made = makeClient(
        {
          storage: {
            get: () => null,
            set: () => {
              writes++;
            },
            remove: () => {},
          },
        },
        refusal,
      );
      let before = 0;
      return {
        client: made.client,
        landed: () => writes - before,
        async start() {
          await made.client.ready;
          before = writes;
        },
        async release() {
          await made.client.setDraft("After dispose");
          await flush();
        },
      };
    },
  },
};

describe("no effect lands after its scope is aborted", () => {
  const rows = Object.entries(scenarios).flatMap(([effect, triggers]) =>
    Object.entries(triggers!).map(([which, build]) => ({
      effect,
      which: which as Trigger,
      build: build as (refusal: { on: boolean }) => Harness,
    })),
  );
  it("covers every effect kind", () => {
    expect(Object.keys(scenarios)).toHaveLength(12);
    expect(rows.length).toBeGreaterThanOrEqual(30);
  });
  for (const row of rows)
    it(`${row.effect} after ${row.which}`, async () => {
      const refusal = { on: false };
      const h = row.build(refusal);
      await h.start();
      await trigger(h, row.which, refusal);
      await h.release();
      expect(h.landed()).toBe(0);
      if (row.which !== "dispose") h.client.dispose();
    });
});

describe("scope parentage invariant", () => {
  const build = (kind: ScopeParentKind): Pick<Scope, "signal" | "abort"> => {
    if (kind === "external") return new AbortController();
    const parents: readonly ScopeParentKind[] = SCOPE_PARENTS[kind];
    return createScope(kind, parents[0] ? build(parents[0]).signal : undefined);
  };
  for (const fallback of [false, true])
    it(`every scope kind is aborted with its parent${fallback ? " without AbortSignal.any" : ""}`, () => {
      const any = (AbortSignal as { any?: unknown }).any;
      if (fallback)
        Object.defineProperty(AbortSignal, "any", {
          value: undefined,
          configurable: true,
        });
      try {
        for (const kind of Object.keys(SCOPE_PARENTS) as ScopeKind[]) {
          const allowed: readonly ScopeParentKind[] = SCOPE_PARENTS[kind];
          for (const parentKind of allowed) {
            const parent = build(parentKind);
            const child = createScope(kind, parent.signal);
            const grandchildKinds = (
              Object.keys(SCOPE_PARENTS) as ScopeKind[]
            ).filter((k) =>
              (SCOPE_PARENTS[k] as readonly ScopeParentKind[]).includes(kind),
            );
            const grandchildren = grandchildKinds.map((k) =>
              createScope(k, child.signal),
            );
            expect(child.signal.aborted, `${kind} under ${parentKind}`).toBe(
              false,
            );
            parent.abort();
            expect(child.signal.aborted, `${kind} under ${parentKind}`).toBe(
              true,
            );
            for (const grandchild of grandchildren)
              expect(grandchild.signal.aborted).toBe(true);
          }
        }
      } finally {
        if (fallback)
          Object.defineProperty(AbortSignal, "any", {
            value: any,
            configurable: true,
          });
      }
    });
  it("refuses a scope whose parent has an undeclared kind", () => {
    const client = createScope("client");
    expect(() => createScope("invocation", client.signal)).toThrow();
    expect(() => createScope("connection")).toThrow();
  });
  it("a child abort stays local", () => {
    const parent = createScope("client");
    const child = createScope("conversation", parent.signal);
    const sibling = createScope("conversation", parent.signal);
    child.abort();
    expect([parent.signal.aborted, sibling.signal.aborted]).toEqual([
      false,
      false,
    ]);
  });
});

describe("reviewed cases", () => {
  const run = async (effect: Effect, which: Trigger) => {
    const refusal = { on: false };
    const h = scenarios[effect][which]!(refusal);
    await h.start();
    await trigger(h, which, refusal);
    await h.release();
    const landed = h.landed();
    if (which !== "dispose") h.client.dispose();
    return landed;
  };
  it("a held request rejected after the runner is disposed asks for no remote stop", async () => {
    expect(await run("remote stop or undo", "navigate")).toBe(0);
    expect(await run("remote stop or undo", "dispose")).toBe(0);
  });
  it("a flow whose document load finishes after dispose does not dispatch", async () => {
    expect(await run("flow dispatch", "dispose")).toBe(0);
  });
  it("a retired runner read cannot overwrite the recovery read's newer facts", async () => {
    expect(await run("runner plan publication", "retire")).toBe(0);
  });
  it("an obsolete flow result neither navigates nor attaches its plan", async () => {
    expect(await run("flow navigation", "navigate")).toBe(0);
    expect(await run("flow plan publication", "navigate")).toBe(0);
    expect(await run("flow navigation", "supersede")).toBe(0);
  });
});

describe("reviewed cases, flow switch race", () => {
  it("a flow whose own switch is overtaken does not attach its plan to the newer conversation", async () => {
    const held = gate();
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id) => {
          if (id === "conversation-b") await held.wait;
          return conversationOf(id);
        },
      },
      flowSource: {
        list: async () => [],
        setFavourite: async () => {},
        run: async () => ({
          conversationId: "conversation-b",
          plan: plan({ id: "plan-b" }),
        }),
      },
    });
    await client.ready;
    const flowing = client.runFlow("flow-a", {});
    await flush();
    await client.switchConversation("conversation-c");
    held.open();
    await flowing;
    await flush();
    expect(client.getSnapshot().conversationId).toBe("conversation-c");
    expect(client.getSnapshot().plan?.id).toBeUndefined();
    client.dispose();
  });
});

describe("fix-diff 4 cases", () => {
  it("a disposed client's queued final save cannot overwrite a newer client's draft", async () => {
    // A storage double whose commits land only when the test releases them,
    // so a write is in flight across the check-then-write gap.
    const values = new Map<string, string>();
    const pending: (() => void)[] = [];
    let delay = false;
    const storage = {
      get: async (key: string) => values.get(key) ?? null,
      set: (key: string, value: string) =>
        delay
          ? new Promise<void>((resolve) => {
              pending.push(() => {
                values.set(key, value);
                resolve();
              });
            })
          : Promise.resolve(void values.set(key, value)),
      remove: async (key: string) => {
        values.delete(key);
      },
    };
    const drain = async () => {
      for (let round = 0; round < 50; round++) {
        await flush();
        // Newest first: a later writer's commit lands before an earlier
        // in-flight one, the order that exposes an unfenced overwrite.
        const next = pending.pop();
        if (!next) return;
        next();
      }
    };
    let tick = 1_000_000;
    const walled = () => {
      const base = config();
      return {
        ...base,
        platform: {
          ...base.platform,
          clock: { ...base.platform.clock, now: () => ++tick },
        },
      };
    };
    const old = createWaypointClient({ ...walled(), storage });
    await old.ready;
    await flush();
    delay = true;
    void old.setDraft("Old first");
    await flush();
    void old.setDraft("Old queued");
    await flush();
    old.dispose();
    const replacement = createWaypointClient({ ...walled(), storage });
    void replacement.setDraft("New current");
    await flush();
    await drain();
    await replacement.ready;
    await drain();
    delay = false;
    expect(replacement.getSnapshot().draft).toBe("New current");
    const reload = createWaypointClient({ ...walled(), storage });
    await reload.ready;
    expect(reload.getSnapshot().draft).toBe("New current");
    replacement.dispose();
    reload.dispose();
    const alone = new Map<string, string>();
    let soloHold: ReturnType<typeof gate> | undefined;
    const solo = createWaypointClient({
      ...walled(),
      storage: {
        get: async (key) => alone.get(key) ?? null,
        set: async (key, value) => {
          alone.set(key, value);
          const held = soloHold;
          soloHold = undefined;
          if (held) await held.wait;
        },
        remove: async () => {},
      },
    });
    await solo.ready;
    await flush();
    const soloFirst = gate();
    soloHold = soloFirst;
    void solo.setDraft("Earlier");
    await flush();
    void solo.setDraft("Last words");
    await flush();
    solo.dispose();
    soloFirst.open();
    await flush();
    // With no newer writer, the disposed client's final save lands.
    expect([...alone.values()].some((v) => v.includes("Last words"))).toBe(
      true,
    );
  });
  it("a superseded flow does not perform its pending switch", async () => {
    let holdSet: ReturnType<typeof gate> | undefined;
    const loadC = gate();
    const dispatched: string[] = [];
    const client = createWaypointClient({
      ...config(),
      storage: {
        // Each save reads the stored record first; holding that read holds it.
        get: async () => {
          if (holdSet) await holdSet.wait;
          return null;
        },
        set: () => {},
        remove: () => {},
      },
      flowSource: {
        list: async () => [],
        setFavourite: async () => {},
        load: async (id) => {
          if (id === "flow-c") await loadC.wait;
          return undefined as never;
        },
        run: async (id) => {
          dispatched.push(id);
          return {
            conversationId:
              id === "flow-a" ? "conversation-b" : "conversation-c",
          };
        },
      },
    });
    await client.ready;
    holdSet = gate();
    const held = holdSet;
    const a = client.runFlow("flow-a", {});
    await flush();
    const c = client.runFlow("flow-c", {});
    await flush();
    held.open();
    holdSet = undefined;
    await a;
    await flush();
    expect(client.getSnapshot().conversationId).toBe("conversation-a");
    loadC.open();
    await c;
    await flush();
    expect(dispatched).toEqual(["flow-a", "flow-c"]);
    expect(client.getSnapshot().conversationId).toBe("conversation-c");
    client.dispose();
  });
  it("a frame read derived from a closed connection does not publish", async () => {
    const held = gate();
    const negotiation = gate();
    let negotiations = 0;
    let listener!: (event: TransportEvent) => void;
    let refuse = false;
    const client = createWaypointClient({
      ...config(),
      transport: {
        negotiate: async () => {
          if (++negotiations === 2) await negotiation.wait;
          return {
            protocol: "1.0",
            capabilities: ["plans"],
            agreementId: `a-${negotiations}`,
          };
        },
        read: async (id, context) => {
          if (refuse && context?.agreementId === "a-1")
            throw new ConversationReadError(id, 409, {
              code: "agreement-expired",
              id: "agreement",
            });
          return conversationOf(id);
        },
        send: async (reply) => ({ id: reply.clientReplyId }),
        subscribe: (_id, fn) => {
          listener = fn;
          return () => {};
        },
      },
      plans: {
        read: async () => {
          await held.wait;
          return plan({ state: "running" });
        },
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => plan(),
      },
    });
    await client.ready;
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 3,
        type: "plan.final",
        messageId: "m",
        plan: plan().plan,
      } as never,
    });
    await flush();
    refuse = true;
    void client.refresh();
    await flush();
    held.open();
    await flush();
    expect(client.getSnapshot().plan).toBeNull();
    negotiation.open();
    await flush();
    client.dispose();
  });
  it("eligibility stays with the read, not with an adapter's shared record", async () => {
    const shared = plan({ state: "running" });
    const first = gate();
    let reads = 0;
    const client = createWaypointClient({
      ...config(),
      plans: {
        read: async () => {
          if (++reads === 1) await first.wait;
          return shared;
        },
        request: async () => {
          shared.state = "completed";
          shared.outcomes = [
            { stepId: "step-a", status: 200, attributed: true },
          ];
        },
        heartbeat: async () => {},
        stop: async () => plan(),
      },
    });
    await client.ready;
    const running = client.runPlan("plan-a", "plan-digest");
    await flush();
    client.setPlan(plan({ state: "needs-attention" }));
    first.open();
    await running;
    await flush();
    expect(client.getSnapshot().plan?.state).toBe("completed");
    expect(client.getSnapshot().plan?.outcomes).toHaveLength(1);
    client.dispose();
  });
  for (const which of ["interrupt", "dispose"] as const)
    it(`a retired run dispatches no read after its request completes (${which})`, async () => {
      const held = gate();
      let reads = 0;
      let negotiations = 0;
      let refuse = false;
      const client = createWaypointClient({
        ...config(),
        transport: {
          ...config().transport,
          negotiate: async () => ({
            protocol: "1.0",
            capabilities: ["plans"],
            agreementId: `a-${++negotiations}`,
          }),
          read: async (id, context) => {
            if (refuse && context?.agreementId === "a-1")
              throw new ConversationReadError(id, 409, {
                code: "agreement-expired",
                id: "agreement",
              });
            return conversationOf(id);
          },
        },
        plans: {
          read: async () => {
            reads++;
            return plan();
          },
          request: async () => {
            await held.wait;
          },
          heartbeat: async () => {},
          stop: async () => plan(),
        },
      });
      await client.ready;
      const running = client.runPlan("plan-a", "plan-digest");
      await flush();
      if (which === "dispose") client.dispose();
      else {
        refuse = true;
        await client.refresh();
        await flush();
      }
      const before = reads;
      held.open();
      await running;
      await flush();
      expect(reads - before).toBe(0);
      if (which !== "dispose") client.dispose();
    });
  for (const which of ["dispose", "supersede"] as const)
    it(`an aborted flow-list load lists no further tab (${which})`, async () => {
      const held = gate();
      const listed: string[] = [];
      const client = createWaypointClient({
        ...config(),
        flowSource: {
          list: async (tab) => {
            const id = typeof tab === "string" ? tab : tab.id;
            listed.push(id);
            if (listed.length === 1) await held.wait;
            return [];
          },
          setFavourite: async () => {},
          run: async () => ({ conversationId: "conversation-a" }),
        },
      });
      await client.ready;
      const first = client.loadFlows();
      await flush();
      if (which === "dispose") client.dispose();
      else await client.loadFlows();
      const before = listed.length;
      held.open();
      await first;
      await flush();
      expect(listed.length).toBe(before);
      if (which !== "dispose") client.dispose();
    });
});

describe("fix-diff 5 cases", () => {
  it("a flow result does not navigate after the user left its conversation during the switch", async () => {
    let holdSet: ReturnType<typeof gate> | undefined;
    const flowResult = gate();
    const navigations: string[] = [];
    const base = config();
    const client = createWaypointClient({
      ...base,
      storage: {
        // Each save reads the stored record first; holding that read holds it.
        get: async () => {
          const held = holdSet;
          if (held) await held.wait;
          return null;
        },
        set: () => {},
        remove: () => {},
      },
      transport: {
        ...base.transport,
        read: async (id) => {
          navigations.push(id);
          return conversationOf(id);
        },
      },
      flowSource: {
        list: async () => [],
        setFavourite: async () => {},
        run: async () => {
          await flowResult.wait;
          return {
            conversationId: "conversation-b",
            plan: plan({ id: "plan-b" }),
          };
        },
      },
    });
    await client.ready;
    navigations.length = 0;
    const flowing = client.runFlow("flow-a", {});
    await flush();
    const persistence = gate();
    holdSet = persistence;
    const userSwitch = client.switchConversation("conversation-c");
    await flush();
    flowResult.open();
    await flush();
    holdSet = undefined;
    persistence.open();
    await userSwitch;
    await flowing;
    await flush();
    expect(client.getSnapshot().conversationId).toBe("conversation-c");
    expect(navigations).toEqual(["conversation-c"]);
    expect(client.getSnapshot().plan).toBeNull();
    client.dispose();
  });
  it("a refresh requested by a closed connection does not publish", async () => {
    const held = gate();
    let listener!: (event: TransportEvent) => void;
    let reads = 0;
    let negotiations = 0;
    const negotiation = gate();
    const client = createWaypointClient({
      ...config(),
      transport: {
        negotiate: async () => {
          if (++negotiations === 2) await negotiation.wait;
          return {
            protocol: "1.0",
            capabilities: [],
            agreementId: `a-${negotiations}`,
          };
        },
        read: async (id) => {
          const ordinal = ++reads;
          if (ordinal === 2) {
            await held.wait;
            return { ...conversationOf(id), title: "Old connection" };
          }
          return conversationOf(id);
        },
        send: async (reply, _id, context) => {
          if (context?.agreementId === "a-1")
            throw { code: "agreement-expired", id: "agreement" };
          return { id: reply.clientReplyId };
        },
        subscribe: (_id, fn) => {
          listener = fn;
          return () => {};
        },
      },
    });
    await client.ready;
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 1,
        type: "message.end",
        messageId: "m",
      } as never,
    });
    await flush();
    await client.reply({
      kind: "action",
      protocol: "1.0",
      clientReplyId: "reply-a",
      blockId: "block-a",
      actionId: "action-a",
    });
    await flush();
    held.open();
    await flush();
    expect(client.getSnapshot().conversation?.title).not.toBe("Old connection");
    negotiation.open();
    await flush();
    client.dispose();
  });
  it("frames buffered by a closed connection leave the replacement's sequence alone", async () => {
    let listener!: (event: TransportEvent) => void;
    let negotiations = 0;
    const firstRead = gate();
    let reads = 0;
    const client = createWaypointClient({
      ...config(),
      transport: {
        negotiate: async () => ({
          protocol: "1.0",
          capabilities: ["plans"],
          agreementId: `a-${++negotiations}`,
        }),
        read: async (id, context) => {
          if (++reads === 1) {
            await firstRead.wait;
            throw new ConversationReadError(id, 409, {
              code: "agreement-expired",
              id: "agreement",
            });
          }
          void context;
          return conversationOf(id);
        },
        send: async (reply) => ({ id: reply.clientReplyId }),
        subscribe: (_id, fn) => {
          listener = fn;
          return () => {};
        },
      },
      plans: {
        read: async () => plan(),
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => plan(),
      },
    });
    await flush();
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 100,
        type: "plan.final",
        messageId: "m",
        plan: plan().plan,
      } as never,
    });
    await flush();
    firstRead.open();
    await client.ready;
    await flush();
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 2,
        type: "message.start",
        messageId: "current",
        role: "assistant",
      } as never,
    });
    await flush();
    expect(
      client.getSnapshot().conversation?.messages.map((m) => m.id),
    ).toEqual(["current"]);
    expect(client.getSnapshot().plan).toBeNull();
    client.dispose();
  });
  it("the runner accepts any standard AbortSignal and retires its run when it aborts", async () => {
    const { createPlanRunner } = await import("../../src/core/runner");
    const aborted = new AbortController();
    aborted.abort();
    expect(() =>
      createPlanRunner({
        signal: aborted.signal,
        read: async () => plan(),
        request: async () => {},
        heartbeat: async () => {},
        stop: async () => plan(),
      }),
    ).not.toThrow();
    const controller = new AbortController();
    const held = gate();
    let reads = 0;
    let controls = 0;
    const runner = createPlanRunner({
      signal: controller.signal,
      read: async () => {
        reads++;
        return plan();
      },
      request: async () => {
        await held.wait;
        throw new Error("failed");
      },
      heartbeat: async () => {},
      stop: async () => {
        controls++;
        return plan();
      },
    });
    const running = runner.run("plan-a", "plan-digest");
    await flush();
    const before = reads;
    controller.abort();
    held.open();
    await running;
    expect(reads).toBe(before);
    expect(controls).toBe(0);
  });
});
