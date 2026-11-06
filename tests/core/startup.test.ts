import { it, expect, describe } from "vitest";
import {
  ConversationReadError,
  createWaypointClient,
  type ClientConfig,
  type PlatformPorts,
} from "../../src/core/client";
import { createHttpTransport } from "../../src/core/transports";
import { config, createManualClock, flush } from "../support/client";
import type { Conversation } from "../../src/protocol/generated";

const conversation: Conversation = {
  protocol: "1.0",
  id: "conversation-a",
  title: "Chat",
  messages: [],
};
const answer = { protocol: "1.0", capabilities: ["plans"] };

function harness(
  options: {
    negotiate?: () => Promise<{ protocol: string; capabilities: string[] }>;
    read?: () => Promise<Conversation>;
    notifications?: boolean;
    online?: boolean;
    visible?: boolean;
    storage?: ClientConfig["storage"];
    send?: () => Promise<{ id: string }>;
    manual?: ReturnType<typeof createManualClock>;
  } = {},
) {
  const manual = options.manual ?? createManualClock(1000);
  const counts = { negotiate: 0, read: 0, subscribe: 0, send: 0 };
  const listeners = {
    online: new Set<(online: boolean) => void>(),
    visibility: new Set<(visible: boolean) => void>(),
  };
  const unsubscribed = { online: 0, visibility: 0 };
  let online = options.online ?? true;
  let visible = options.visible ?? true;
  const platform: PlatformPorts = {
    clock: manual.clock,
    online: () => online,
    visibility: () => visible,
    ids: (() => {
      let id = 0;
      return () => `id-${++id}`;
    })(),
    ...(options.notifications === false
      ? {}
      : {
          subscribeOnline: (fn: (value: boolean) => void) => {
            listeners.online.add(fn);
            return () => {
              unsubscribed.online++;
              listeners.online.delete(fn);
            };
          },
          subscribeVisibility: (fn: (value: boolean) => void) => {
            listeners.visibility.add(fn);
            return () => {
              unsubscribed.visibility++;
              listeners.visibility.delete(fn);
            };
          },
        }),
  };
  const base = config();
  const client = createWaypointClient({
    ...base,
    platform,
    ...(options.storage ? { storage: options.storage } : {}),
    transport: {
      ...base.transport,
      negotiate: async () => {
        counts.negotiate++;
        return options.negotiate ? options.negotiate() : answer;
      },
      read: async () => {
        counts.read++;
        return options.read ? options.read() : structuredClone(conversation);
      },
      subscribe: () => {
        counts.subscribe++;
        return () => {};
      },
      send: async (reply) => {
        counts.send++;
        return options.send ? options.send() : { id: reply.clientReplyId };
      },
    },
  });
  let settled = false;
  void client.ready.then(() => {
    settled = true;
  });
  return {
    client,
    manual,
    counts,
    unsubscribed,
    settled: () => settled,
    setOnline(value: boolean) {
      online = value;
      for (const fn of [...listeners.online]) fn(value);
    },
    setVisible(value: boolean) {
      visible = value;
      for (const fn of [...listeners.visibility]) fn(value);
    },
  };
}
// A consistent store whose first read (hydration) answers late with the
// record it captured, while later reads and writes are immediate.
function slowFirstRead(initial: string) {
  const values = new Map<string, string>();
  let seeded = false;
  let gets = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const storage = {
    get: async (key: string) => {
      if (!seeded) {
        seeded = true;
        values.set(key, initial);
      }
      const captured = values.get(key) ?? null;
      if (++gets === 1) await gate;
      return captured;
    },
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  return { storage, release: () => open() };
}
const offline = () => Promise.reject(new Error("offline"));
const never = <T>() => new Promise<T>(() => {});

describe("startup classification", () => {
  it("classifies a sign-in refusal at startup as sign-in", async () => {
    const h = harness({
      negotiate: () =>
        Promise.reject({ protocol: "1.0", code: "sign-in", id: "sign-in" }),
    });
    await h.client.ready;
    expect(h.client.getSnapshot().problem).toEqual({
      code: "sign-in",
      id: "negotiation",
    });
    h.client.dispose();
  });
  it("classifies an HTTP 401 negotiation without a typed body as sign-in", async () => {
    const transport = createHttpTransport(
      async () => ({ status: 401, body: {} }),
      { subscribe: () => () => {} },
    );
    const base = config();
    const client = createWaypointClient({ ...base, transport });
    await client.ready;
    expect(client.getSnapshot().problem).toEqual({
      code: "sign-in",
      id: "negotiation",
    });
    client.dispose();
  });
  it("classifies a transient startup failure as unavailable", async () => {
    for (const failure of [
      () => Promise.reject(new Error("offline")),
      () => Promise.reject({}),
      () => Promise.reject({ code: "retryable", id: "server" }),
    ]) {
      const h = harness({ negotiate: failure });
      await h.client.ready;
      expect(h.client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "negotiation",
      });
      h.client.dispose();
    }
  });
  it("reports update-required only for an incompatible protocol and never retries it automatically", async () => {
    for (const negotiate of [
      async () => ({ protocol: "9.0", capabilities: [] }),
      () => Promise.reject({ code: "update-required", id: "version" }),
    ]) {
      const h = harness({ negotiate });
      await h.client.ready;
      expect(h.client.getSnapshot().problem).toEqual({
        code: "update-required",
        id: "negotiation",
      });
      await h.manual.advance(300000);
      h.setOnline(true);
      h.setVisible(true);
      await flush();
      expect(h.counts.negotiate).toBe(1);
      h.client.dispose();
    }
  });
});

describe("startup retry owner", () => {
  it("retries a transient negotiation failure with backoff and recovers", async () => {
    let calls = 0;
    const h = harness({
      notifications: false,
      negotiate: () => (++calls === 1 ? offline() : Promise.resolve(answer)),
    });
    await h.client.ready;
    expect(h.client.getSnapshot().problem?.code).toBe("unavailable");
    expect(h.counts.subscribe).toBe(0);
    await h.manual.advance(999);
    expect(h.counts.negotiate).toBe(1);
    await h.manual.advance(1);
    expect(h.counts.negotiate).toBe(2);
    expect(h.client.getSnapshot().protocol).toBe("1.0");
    expect(h.client.getSnapshot().problem).toBeNull();
    expect(h.counts.subscribe).toBe(1);
    expect(h.client.getSnapshot().conversation?.id).toBe("conversation-a");
    h.client.dispose();
  });
  it("keeps one attempt in flight and bounds the delay between attempts", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const h = harness({
      negotiate: async () => {
        calls++;
        if (calls === 2) {
          await held;
          throw new Error("offline");
        }
        throw new Error("offline");
      },
    });
    await h.client.ready;
    await h.manual.advance(1000);
    expect(h.counts.negotiate).toBe(2);
    const first = h.client.refresh();
    const second = h.client.refresh();
    h.setOnline(true);
    h.setVisible(true);
    await flush();
    expect(h.counts.negotiate).toBe(2);
    release();
    await first;
    await second;
    const times: number[] = [];
    let last = h.manual.clock.now();
    for (let step = 0; step < 8; step++) {
      const before = h.counts.negotiate;
      for (let waited = 0; h.counts.negotiate === before; waited += 500) {
        if (waited > 60000) throw new Error("no retry");
        await h.manual.advance(500);
      }
      times.push(h.manual.clock.now() - last);
      last = h.manual.clock.now();
    }
    expect(times).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000,
    ]);
    h.client.dispose();
  });
  it("does not attempt while offline and retries on the online notification", async () => {
    const h = harness({ online: false, negotiate: offline });
    await h.client.ready;
    expect(h.counts.negotiate).toBe(1);
    await h.manual.advance(120000);
    expect(h.counts.negotiate).toBe(1);
    h.setOnline(true);
    await flush();
    expect(h.counts.negotiate).toBe(2);
    h.client.dispose();
  });
  it("retries at once when the platform reports it is back online", async () => {
    let calls = 0;
    const h = harness({
      negotiate: () => (++calls === 1 ? offline() : Promise.resolve(answer)),
    });
    await h.client.ready;
    h.setOnline(true);
    await flush();
    expect(h.counts.negotiate).toBe(2);
    expect(h.client.getSnapshot().protocol).toBe("1.0");
    h.client.dispose();
  });
  it("waits for visibility after sign-in and while hidden, then retries", async () => {
    let calls = 0;
    const h = harness({
      negotiate: () =>
        ++calls === 1
          ? Promise.reject({ code: "sign-in", id: "sign-in" })
          : Promise.resolve(answer),
    });
    await h.client.ready;
    await h.manual.advance(300000);
    expect(h.counts.negotiate).toBe(1);
    h.setVisible(false);
    h.setVisible(true);
    await flush();
    expect(h.counts.negotiate).toBe(2);
    expect(h.client.getSnapshot().problem).toBeNull();
    const hidden = harness({ visible: false, negotiate: offline });
    await hidden.client.ready;
    await hidden.manual.advance(120000);
    expect(hidden.counts.negotiate).toBe(1);
    hidden.setVisible(true);
    await flush();
    expect(hidden.counts.negotiate).toBe(2);
    h.client.dispose();
    hidden.client.dispose();
  });
  it("explicit refresh retries a failed startup once and returns the read", async () => {
    let calls = 0;
    const h = harness({
      negotiate: () =>
        ++calls === 1
          ? Promise.reject({ code: "sign-in", id: "sign-in" })
          : Promise.resolve(answer),
    });
    await h.client.ready;
    const result = await h.client.refresh();
    expect(h.counts.negotiate).toBe(2);
    expect(result.kind).toBe("loaded");
    expect(h.client.getSnapshot().problem).toBeNull();
    h.client.dispose();
  });
});

describe("startup budgets", () => {
  it("settles readiness when negotiation exceeds its budget and ignores the late answer", async () => {
    let resolveLate!: (value: typeof answer) => void;
    let calls = 0;
    const h = harness({
      negotiate: () =>
        ++calls === 1
          ? new Promise((resolve) => {
              resolveLate = resolve;
            })
          : offline(),
    });
    await h.manual.advance(9999);
    expect(h.settled()).toBe(false);
    await h.manual.advance(1);
    expect(h.settled()).toBe(true);
    expect(h.client.getSnapshot().problem).toEqual({
      code: "unavailable",
      id: "negotiation",
    });
    resolveLate(answer);
    await flush();
    expect(h.client.getSnapshot().protocol).toBeNull();
    expect(h.counts.subscribe).toBe(0);
    h.client.dispose();
  });
  it("settles readiness within twenty seconds when the first read hangs", async () => {
    const manual = createManualClock(1000);
    const h = harness({
      manual,
      negotiate: async () => {
        await new Promise<void>((resolve) =>
          manual.clock.setTimeout(resolve, 9999),
        );
        return answer;
      },
      read: never,
    });
    await h.manual.advance(19998);
    expect(h.settled()).toBe(false);
    await h.manual.advance(1);
    expect(h.settled()).toBe(true);
    expect(h.client.getSnapshot().problem).toEqual({
      code: "unavailable",
      id: "conversation-read",
    });
    h.client.dispose();
  });
  it("retries a transient first read and stops after a definitive missing read", async () => {
    let reads = 0;
    const transient = harness({
      read: () =>
        ++reads === 1
          ? Promise.reject(new ConversationReadError("conversation-a", 503))
          : Promise.resolve(structuredClone(conversation)),
    });
    await transient.client.ready;
    expect(transient.client.getSnapshot().conversation).toBeNull();
    await transient.manual.advance(1000);
    expect(transient.client.getSnapshot().conversation?.id).toBe(
      "conversation-a",
    );
    transient.client.dispose();
    let explicitReads = 0;
    const explicit = harness({
      read: () =>
        ++explicitReads === 1
          ? Promise.reject(new ConversationReadError("conversation-a", 503))
          : Promise.resolve(structuredClone(conversation)),
    });
    await explicit.client.ready;
    expect((await explicit.client.refresh()).kind).toBe("loaded");
    await explicit.manual.advance(300000);
    expect(explicit.counts.read).toBe(2);
    explicit.client.dispose();
    const missing = harness({
      read: () =>
        Promise.reject(new ConversationReadError("conversation-a", 404)),
    });
    await missing.client.ready;
    expect(missing.client.getSnapshot().conversationUnavailable).toBe(true);
    await missing.manual.advance(300000);
    missing.setOnline(true);
    await flush();
    expect(missing.counts.read).toBe(1);
    missing.client.dispose();
  });
});

describe("startup hydration", () => {
  it("negotiates in parallel with a slow storage read and bounds it to one second", async () => {
    let negotiatedBeforeStorage = false;
    let storageResolved = false;
    const manual = createManualClock(1000);
    const h = harness({
      manual,
      storage: {
        // Only hydration is slow; later reads belong to saves.
        get: (() => {
          let gets = 0;
          return () =>
            ++gets === 1
              ? new Promise<string | null>((resolve) =>
                  manual.clock.setTimeout(() => {
                    storageResolved = true;
                    resolve(null);
                  }, 5000),
                )
              : null;
        })(),
        set: () => {},
        remove: () => {},
      },
      negotiate: async () => {
        negotiatedBeforeStorage = !storageResolved;
        return answer;
      },
    });
    await h.manual.advance(999);
    expect(negotiatedBeforeStorage).toBe(true);
    expect(h.counts.read).toBe(0);
    expect(h.settled()).toBe(false);
    await h.manual.advance(1);
    expect(h.counts.read).toBe(1);
    expect(storageResolved).toBe(false);
    // The lazy storage write uses real I/O after the hydration deadline.
    await h.client.ready;
    expect(h.manual.clock.now()).toBe(2000);
    expect(storageResolved).toBe(false);
    expect(h.settled()).toBe(true);
    expect(h.client.getSnapshot().conversation?.id).toBe("conversation-a");
    h.client.dispose();
  });
  it("late hydration keeps the live draft and pending rows", async () => {
    const store = slowFirstRead(
      JSON.stringify({
        draft: "Saved draft",
        pending: [{ id: "saved-row", content: "Saved", failure: null }],
        editingId: null,
      }),
    );
    const h = harness({ storage: store.storage, send: never });
    await h.manual.advance(1000);
    expect(h.settled()).toBe(true);
    await h.client.setDraft("Live message");
    void h.client.send();
    await flush();
    await h.client.setDraft("Still typing");
    const live = h.client
      .getSnapshot()
      .pending.map((row) => row.id)
      .filter((id) => id !== "saved-row");
    expect(live).toHaveLength(1);
    store.release();
    await flush();
    const snapshot = h.client.getSnapshot();
    expect(snapshot.draft).toBe("Still typing");
    expect(snapshot.pending.map((row) => row.id).sort()).toEqual(
      [...live, "saved-row"].sort(),
    );
    h.client.dispose();
  });
});

describe("startup ownership", () => {
  it("dispose stops retries and unsubscribes platform notifications", async () => {
    const h = harness({ negotiate: offline });
    await h.client.ready;
    h.client.dispose();
    expect(h.unsubscribed).toEqual({ online: 1, visibility: 1 });
    expect(h.manual.pending()).toBe(0);
    await h.manual.advance(300000);
    h.setOnline(true);
    await flush();
    expect(h.counts.negotiate).toBe(1);
  });
  it("recovery never resends messages or replies on its own", async () => {
    const storage = {
      get: () =>
        JSON.stringify({
          draft: "",
          pending: [{ id: "row-a", content: "Unsent", failure: null }],
          editingId: null,
        }),
      set: () => {},
      remove: () => {},
    };
    let calls = 0;
    const h = harness({
      storage,
      negotiate: () => (++calls === 1 ? offline() : Promise.resolve(answer)),
    });
    await h.client.ready;
    await h.manual.advance(1000);
    expect(h.client.getSnapshot().protocol).toBe("1.0");
    await h.manual.advance(60000);
    expect(h.counts.send).toBe(0);
    expect(h.client.getSnapshot().pending[0]?.failure?.code).toBe("in-doubt");
    h.client.dispose();
  });
});

describe("startup review regressions", () => {
  it("an older startup read cannot restore the warning after a successful refresh", async () => {
    let reads = 0;
    const h = harness({
      read: () => {
        reads++;
        if (reads === 1)
          return Promise.reject(
            new ConversationReadError("conversation-a", 503),
          );
        if (reads === 2) return never();
        return Promise.resolve(structuredClone(conversation));
      },
    });
    await h.client.ready;
    await h.manual.advance(1000);
    expect(h.counts.read).toBe(2);
    expect((await h.client.refresh()).kind).toBe("loaded");
    expect(h.client.getSnapshot().problem).toBeNull();
    await h.manual.advance(300000);
    expect(h.client.getSnapshot().problem).toBeNull();
    expect(h.client.getSnapshot().conversation?.id).toBe("conversation-a");
    h.client.dispose();
  });
  it("treats a malformed successful negotiation body as unavailable and recovers", async () => {
    for (const body of [{}, null, undefined, { protocol: "1.0" }]) {
      let calls = 0;
      const manual = createManualClock(1000);
      let subscribed = 0;
      const base = config();
      const client = createWaypointClient({
        ...base,
        platform: { ...base.platform, clock: manual.clock },
        transport: {
          ...createHttpTransport(
            async (path) =>
              path === "/negotiate"
                ? {
                    status: 200,
                    body: ++calls === 1 ? body : { ...answer },
                  }
                : { status: 200, body: structuredClone(conversation) },
            { subscribe: () => () => {} },
          ),
          subscribe: () => {
            subscribed++;
            return () => {};
          },
        },
      });
      await client.ready;
      expect(client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "negotiation",
      });
      expect(client.getSnapshot().protocol).toBeNull();
      await manual.advance(1000);
      expect(calls).toBe(2);
      expect(client.getSnapshot().protocol).toBe("1.0");
      expect(client.getSnapshot().capabilities).toEqual(["plans"]);
      expect(subscribed).toBe(1);
      expect(client.getSnapshot().problem).toBeNull();
      client.dispose();
    }
  });
  it("late hydration does not restore a message the first read already acknowledged", async () => {
    let release!: (value: string) => void;
    const h = harness({
      storage: {
        // Only hydration is slow; later reads belong to saves.
        get: (() => {
          let gets = 0;
          return () =>
            ++gets === 1
              ? new Promise<string>((resolve) => {
                  release = resolve;
                })
              : null;
        })(),
        set: () => {},
        remove: () => {},
      },
      read: async () => ({
        ...structuredClone(conversation),
        messages: [
          {
            id: "message-a",
            role: "user",
            content: "Saved",
            blocks: [],
            createdAt: 1,
            clientMessageId: "saved-row",
          },
        ],
      }),
    });
    await h.manual.advance(1000);
    expect(h.settled()).toBe(true);
    release(
      JSON.stringify({
        draft: "",
        pending: [{ id: "saved-row", content: "Saved", failure: null }],
        editingId: null,
      }),
    );
    await flush();
    expect(h.client.getSnapshot().pending).toEqual([]);
    h.client.dispose();
  });
  for (const wait of ["negotiation", "hydration", "first read"] as const)
    it(`dispose during the ${wait} budget leaves no timer and installs nothing late`, async () => {
      let resolveLate: ((value: typeof answer) => void) | undefined;
      const h = harness({
        ...(wait === "negotiation"
          ? {
              negotiate: () =>
                new Promise<typeof answer>((resolve) => {
                  resolveLate = resolve;
                }),
            }
          : {}),
        ...(wait === "hydration"
          ? { storage: { get: never, set: () => {}, remove: () => {} } }
          : {}),
        ...(wait === "first read" ? { read: never } : {}),
      });
      await flush();
      h.client.dispose();
      await flush();
      expect(h.manual.pending()).toBe(0);
      expect(h.settled()).toBe(true);
      resolveLate?.(answer);
      await flush();
      if (wait === "negotiation")
        expect(h.client.getSnapshot().protocol).toBeNull();
      expect(h.counts.subscribe).toBe(wait === "first read" ? 1 : 0);
    });
});

describe("startup fix-diff regressions", () => {
  it("an acknowledged saved edit does not lend its id to the next send", async () => {
    const sent: string[] = [];
    const store = slowFirstRead(
      JSON.stringify({
        draft: "Revised message",
        pending: [
          {
            id: "saved-row",
            content: "Original",
            failure: { code: "retryable", id: "saved-row" },
          },
        ],
        editingId: "saved-row",
      }),
    );
    const base = config();
    const manual = createManualClock(1000);
    const client = createWaypointClient({
      ...base,
      platform: { ...base.platform, clock: manual.clock },
      storage: store.storage,
      transport: {
        ...base.transport,
        read: async () => ({
          ...structuredClone(conversation),
          messages: [
            {
              id: "message-a",
              role: "user",
              content: "Original",
              blocks: [],
              createdAt: 1,
              clientMessageId: "saved-row",
            },
          ],
        }),
        send: async (reply) => {
          sent.push(reply.clientReplyId);
          return { id: reply.clientReplyId };
        },
      },
    });
    await manual.advance(1000);
    store.release();
    await flush();
    expect(client.getSnapshot().draft).toBe("Revised message");
    await client.send();
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toBe("saved-row");
    client.dispose();
  });
  it("dispose from a synchronous connection notification starts no read or budget", async () => {
    const manual = createManualClock(1000);
    let reads = 0;
    const base = config();
    const client: ReturnType<typeof createWaypointClient> =
      createWaypointClient({
        ...base,
        platform: { ...base.platform, clock: manual.clock },
        transport: {
          ...base.transport,
          read: () => {
            reads++;
            return never();
          },
          subscribe: (_id, listener) => {
            listener({ type: "status", status: "connecting" });
            return () => {};
          },
        },
      });
    let settled = false;
    void client.ready.then(() => {
      settled = true;
    });
    client.subscribe(() => {
      if (client.getSnapshot().status === "connecting") client.dispose();
    });
    await flush();
    expect(reads).toBe(0);
    expect(manual.pending()).toBe(0);
    expect(settled).toBe(true);
  });
  it("treats an empty or blank protocol answer as unavailable and recovers", async () => {
    for (const protocol of ["", "   "]) {
      let calls = 0;
      const h = harness({
        negotiate: async () =>
          ++calls === 1 ? { protocol, capabilities: [] } : answer,
      });
      await h.client.ready;
      expect(h.client.getSnapshot().problem).toEqual({
        code: "unavailable",
        id: "negotiation",
      });
      await h.manual.advance(1000);
      expect(h.counts.negotiate).toBe(2);
      expect(h.client.getSnapshot().protocol).toBe("1.0");
      expect(h.client.getSnapshot().capabilities).toEqual(["plans"]);
      expect(h.counts.subscribe).toBe(1);
      h.client.dispose();
    }
  });
});
