import { it, expect, describe } from "vitest";
import {
  createWaypointClient,
  ConversationReadError,
  type TransportEvent,
  type TransportPort,
} from "../../src/core/client";
import { config, createManualClock, flush } from "../support/client";

type ReadMode =
  "ok" | "network" | "expired" | "sign-in" | "version" | "missing";
interface Subscription {
  listener: (event: TransportEvent) => void;
  agreement: string | undefined;
  closed: boolean;
}
function harness(
  options: {
    bound?: boolean;
    syncStatus?: TransportEvent;
    // Subscriptions (by 0-based index) that fail inside subscribe.
    failInside?: (index: number) => boolean;
  } = {},
) {
  const bound = options.bound ?? true;
  const manual = createManualClock(1000);
  let issued = 0;
  const subscriptions: Subscription[] = [];
  const reads: (string | undefined)[] = [];
  const readIds: string[] = [];
  let online = true;
  let onlineListener: ((value: boolean) => void) | undefined;
  const control = {
    read: "ok" as ReadMode,
    holdRead: undefined as Promise<void> | undefined,
    sendExpired: false,
  };
  const base = config();
  const transport: TransportPort = {
    ...base.transport,
    negotiate: async () => ({
      protocol: "1.0",
      capabilities: ["plans", "flows", "widgets"],
      ...(bound ? { agreementId: `agreement-${++issued}` } : {}),
    }),
    read: async (id, context) => {
      reads.push(context?.agreementId);
      readIds.push(id);
      const held = control.holdRead;
      control.holdRead = undefined;
      if (held) await held;
      switch (control.read) {
        case "network":
          throw new Error("network");
        case "expired":
          throw new ConversationReadError(id, 409, {
            protocol: "1.0",
            code: "agreement-expired",
            id: "agreement",
          });
        case "sign-in":
          throw new ConversationReadError(id, 401, {
            protocol: "1.0",
            code: "sign-in",
            id: "sign-in",
          });
        case "version":
          throw new ConversationReadError(id, 409, {
            protocol: "1.0",
            code: "update-required",
            id: "version",
          });
        case "missing":
          throw new ConversationReadError(id, 404);
      }
      return { protocol: "1.0", id, title: "Chat", messages: [] };
    },
    send: async (reply) => {
      if (control.sendExpired) {
        control.sendExpired = false;
        throw { code: "agreement-expired", id: "agreement" };
      }
      return { id: reply.clientReplyId };
    },
    subscribe: (_id, listener, context) => {
      const subscription: Subscription = {
        listener,
        agreement: context?.agreementId,
        closed: false,
      };
      subscriptions.push(subscription);
      if (options.syncStatus) listener(options.syncStatus);
      if (options.failInside?.(subscriptions.length - 1))
        listener({ type: "status", status: "reconnecting" });
      return () => {
        subscription.closed = true;
      };
    },
  };
  const client = createWaypointClient({
    ...base,
    platform: {
      ...base.platform,
      clock: manual.clock,
      online: () => online,
      subscribeOnline: (listener: (value: boolean) => void) => {
        onlineListener = listener;
        return () => {
          onlineListener = undefined;
        };
      },
    },
    transport,
  });
  const setOnline = (value: boolean, notify = true) => {
    online = value;
    if (notify) onlineListener?.(value);
  };
  const last = () => subscriptions[subscriptions.length - 1]!;
  const status = (
    value: "connecting" | "open" | "reconnecting" | "unavailable",
    target = last(),
  ) => target.listener({ type: "status", status: value });
  const start = async () => {
    await manual.advance(0);
    await client.ready;
    await flush();
  };
  return {
    client,
    manual,
    subscriptions,
    reads,
    readIds,
    control,
    last,
    status,
    start,
    setOnline,
  };
}
const DELAYS = [250, 500, 1000, 2000, 4000];

describe("bound stream recovery", () => {
  it("closes a failed subscription at once, probes after the first delay and reopens under the agreement", async () => {
    const h = harness();
    await h.start();
    const first = h.last();
    expect(first.agreement).toBe("agreement-1");
    h.status("open");
    const readsBefore = h.reads.length;
    h.status("reconnecting");
    // Closed before any native retry could run.
    expect(first.closed).toBe(true);
    expect(h.client.getSnapshot().status).toBe("reconnecting");
    await h.manual.advance(DELAYS[0]! - 1);
    expect(h.reads.length).toBe(readsBefore);
    expect(h.subscriptions).toHaveLength(1);
    await h.manual.advance(1);
    expect(h.reads.slice(readsBefore)).toEqual(["agreement-1"]);
    expect(h.subscriptions).toHaveLength(2);
    expect(h.last().agreement).toBe("agreement-1");
    expect(h.last().closed).toBe(false);
    h.client.dispose();
  });
  it("runs one owner however many failures arrive during an episode", async () => {
    const h = harness();
    await h.start();
    const first = h.last();
    h.status("reconnecting");
    h.status("unavailable", first);
    h.status("reconnecting", first);
    const readsBefore = h.reads.length;
    await h.manual.advance(DELAYS[0]!);
    expect(h.reads.length - readsBefore).toBe(1);
    expect(h.subscriptions).toHaveLength(2);
    h.client.dispose();
  });
  it("does not reset the backoff on a probe or a mere open, and gives up after five reopens", async () => {
    const h = harness();
    await h.start();
    for (let attempt = 0; attempt < 5; attempt++) {
      h.status("open");
      h.status("reconnecting");
      const before = h.subscriptions.length;
      await h.manual.advance(DELAYS[attempt]! - 1);
      expect(h.subscriptions.length).toBe(before);
      await h.manual.advance(1);
      expect(h.subscriptions.length).toBe(before + 1);
    }
    h.status("reconnecting");
    await h.manual.advance(10_000);
    expect(h.subscriptions).toHaveLength(6);
    expect(h.client.getSnapshot().streamUnavailable).toBe(true);
    expect(h.client.getSnapshot().status).toBe("unavailable");
    expect(h.client.getSnapshot().problem).toEqual({
      code: "unavailable",
      id: "stream",
    });
    expect(h.manual.pending()).toBe(0);
    h.client.dispose();
  });
  it("resets the episode after ten seconds of continuously healthy open", async () => {
    const h = harness();
    await h.start();
    h.status("reconnecting");
    await h.manual.advance(DELAYS[0]!);
    h.status("open");
    await h.manual.advance(9_999);
    h.status("reconnecting");
    // Not yet healthy: the second delay applies.
    await h.manual.advance(DELAYS[0]!);
    expect(h.subscriptions).toHaveLength(2);
    await h.manual.advance(DELAYS[1]! - DELAYS[0]!);
    expect(h.subscriptions).toHaveLength(3);
    h.status("open");
    await h.manual.advance(10_000);
    h.status("reconnecting");
    await h.manual.advance(DELAYS[0]!);
    expect(h.subscriptions).toHaveLength(4);
    h.client.dispose();
  });
  it("keeps the backoff bounded while probes fail on the network", async () => {
    const h = harness();
    await h.start();
    h.control.read = "network";
    h.status("reconnecting");
    const readsBefore = h.reads.length;
    let elapsed = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      await h.manual.advance(DELAYS[attempt]!);
      elapsed += DELAYS[attempt]!;
      expect(h.reads.length - readsBefore).toBe(attempt + 1);
    }
    await h.manual.advance(60_000);
    expect(h.reads.length - readsBefore).toBe(5);
    expect(h.subscriptions).toHaveLength(1);
    expect(h.client.getSnapshot().streamUnavailable).toBe(true);
    expect(elapsed).toBe(7750);
    h.client.dispose();
  });
  it("joins the binding owner when the probe's agreement expired and reopens under the new agreement", async () => {
    const h = harness();
    await h.start();
    h.control.read = "expired";
    h.status("reconnecting");
    await h.manual.advance(DELAYS[0]!);
    h.control.read = "ok";
    await h.manual.advance(0);
    await flush();
    const open = h.subscriptions.filter((s) => !s.closed);
    expect(open).toHaveLength(1);
    expect(open[0]!.agreement).toBe("agreement-2");
    // The episode did not also reopen on its own.
    await h.manual.advance(10_000);
    expect(h.subscriptions.filter((s) => !s.closed)).toHaveLength(1);
    expect(h.subscriptions).toHaveLength(2);
    h.client.dispose();
  });
  for (const [mode, code] of [
    ["sign-in", "sign-in"],
    ["version", "update-required"],
  ] as const)
    it(`stops with the actual cause when the probe fails with ${mode}`, async () => {
      const h = harness();
      await h.start();
      h.control.read = mode;
      h.status("reconnecting");
      const readsBefore = h.reads.length;
      await h.manual.advance(DELAYS[0]!);
      await h.manual.advance(60_000);
      expect(h.reads.length - readsBefore).toBe(1);
      expect(h.subscriptions).toHaveLength(1);
      expect(h.client.getSnapshot().problem).toEqual({ code, id: "stream" });
      expect(h.manual.pending()).toBe(0);
      h.client.dispose();
    });
  it("stops when the probe finds the conversation missing", async () => {
    const h = harness();
    await h.start();
    h.control.read = "missing";
    h.status("reconnecting");
    const readsBefore = h.reads.length;
    await h.manual.advance(DELAYS[0]!);
    await h.manual.advance(60_000);
    expect(h.reads.length - readsBefore).toBe(1);
    expect(h.client.getSnapshot().streamUnavailable).toBe(false);
    expect(h.subscriptions).toHaveLength(1);
    expect(h.client.getSnapshot().conversationUnavailable).toBe(true);
    expect(h.manual.pending()).toBe(0);
    h.client.dispose();
  });
  it("an explicit refresh retries a stream that became unavailable", async () => {
    const h = harness();
    await h.start();
    h.control.read = "network";
    h.status("reconnecting");
    for (const delay of DELAYS) await h.manual.advance(delay);
    expect(h.client.getSnapshot().streamUnavailable).toBe(true);
    h.control.read = "ok";
    await h.client.refresh();
    await flush();
    expect(h.client.getSnapshot().streamUnavailable).toBe(false);
    expect(h.subscriptions).toHaveLength(2);
    expect(h.last().closed).toBe(false);
    // The episode count starts again from the first delay.
    h.status("reconnecting");
    await h.manual.advance(DELAYS[0]!);
    expect(h.subscriptions).toHaveLength(3);
    h.client.dispose();
  });
  for (const ending of ["dispose", "switch"] as const)
    it(`aborts the episode's timers and late probe on ${ending}`, async () => {
      const h = harness();
      await h.start();
      h.status("open");
      h.status("reconnecting");
      let release!: () => void;
      h.control.holdRead = new Promise<void>((resolve) => (release = resolve));
      await h.manual.advance(DELAYS[0]!);
      const before = h.subscriptions.length;
      if (ending === "dispose") h.client.dispose();
      else await h.client.switchConversation("conversation-b");
      release();
      await flush();
      await h.manual.advance(60_000);
      // No reopen of the old conversation's stream.
      expect(
        h.subscriptions.slice(before).filter((s) => !s.closed),
      ).toHaveLength(ending === "dispose" ? 0 : 1);
      if (ending === "switch") {
        expect(h.manual.pending()).toBe(0);
        h.client.dispose();
      }
    });
  it("starts no probe once the episode's conversation is left during its delay", async () => {
    const h = harness();
    await h.start();
    h.status("reconnecting");
    const readsBefore = h.reads.length;
    await h.manual.advance(DELAYS[0]! - 1);
    h.client.dispose();
    await h.manual.advance(60_000);
    expect(h.reads.length).toBe(readsBefore);
  });
  it("keeps one recovery owner when another reconnect opens a stream during its delay", async () => {
    const h = harness();
    await h.start();
    h.status("reconnecting");
    // A refused send renegotiates and opens a new subscription while the
    // episode is still waiting; that one fails too.
    h.control.sendExpired = true;
    await h.client.setDraft("Hello");
    await h.client.send();
    await flush();
    const reopened = h.last();
    expect(reopened.agreement).toBe("agreement-2");
    const readsBefore = h.reads.length;
    h.status("reconnecting", reopened);
    await h.manual.advance(DELAYS[0]! + DELAYS[1]! + DELAYS[2]!);
    expect(h.reads.length - readsBefore).toBe(1);
    h.client.dispose();
  });
  it("closes the real connection when a failure is reported inside subscribe", async () => {
    const h = harness({
      syncStatus: { type: "status", status: "reconnecting" },
    });
    await h.start();
    expect(h.subscriptions[0]!.closed).toBe(true);
    h.client.dispose();
  });
  it("ignores opens and frames from a closed subscription", async () => {
    const h = harness();
    await h.start();
    const first = h.last();
    h.status("reconnecting");
    first.listener({ type: "status", status: "open" });
    first.listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: 1,
        type: "message.start",
        messageId: "late",
        role: "assistant",
      },
    });
    await flush();
    expect(h.client.getSnapshot().status).toBe("reconnecting");
    expect(
      h.client
        .getSnapshot()
        .conversation?.messages.some((m) => m.id === "late"),
    ).toBe(false);
    h.client.dispose();
  });
});

describe("unbound streams keep the adapter's reconnect", () => {
  it("does not close or probe on reconnecting; refetches on reopen", async () => {
    const h = harness({ bound: false });
    await h.start();
    const first = h.last();
    expect(first.agreement).toBeUndefined();
    const readsBefore = h.reads.length;
    h.status("reconnecting");
    await h.manual.advance(10_000);
    expect(first.closed).toBe(false);
    expect(h.subscriptions).toHaveLength(1);
    expect(h.reads.length - readsBefore).toBe(1);
    h.client.dispose();
  });
});

describe("signal hints", () => {
  it("coalesce into one authoritative refetch and are never applied as content", async () => {
    const h = harness();
    await h.start();
    let release!: () => void;
    h.control.holdRead = new Promise<void>((resolve) => (release = resolve));
    const readsBefore = h.reads.length;
    for (let hint = 0; hint < 5; hint++)
      h.last().listener({ type: "invalidate" });
    await flush();
    expect(h.reads.length - readsBefore).toBe(1);
    release();
    await flush();
    // One further read covers every hint that arrived meanwhile.
    expect(h.reads.length - readsBefore).toBe(2);
    await flush();
    expect(h.reads.length - readsBefore).toBe(2);
    h.client.dispose();
  });
});

describe("each stream binding owns its recovery", () => {
  for (const notify of [true, false])
    it(`regaining connectivity resets the attempt budget (${notify ? "online event" : "recheck"})`, async () => {
      const h = harness();
      await h.start();
      h.control.read = "network";
      h.status("reconnecting");
      for (const delay of DELAYS.slice(0, 4)) await h.manual.advance(delay);
      const spent = h.reads.length;
      h.setOnline(false, notify);
      await h.manual.advance(60_000);
      h.setOnline(true, notify);
      // Five fresh attempts follow, not the one that was left.
      await h.manual.advance(4_000);
      for (const delay of DELAYS) await h.manual.advance(delay);
      await h.manual.advance(10_000);
      expect(h.reads.length - spent).toBe(5);
      expect(h.client.getSnapshot().streamUnavailable).toBe(true);
      h.client.dispose();
    });
  it("an online event resumes a stream that gave up", async () => {
    const h = harness();
    await h.start();
    h.control.read = "network";
    h.status("reconnecting");
    for (const delay of DELAYS) await h.manual.advance(delay);
    expect(h.client.getSnapshot().streamUnavailable).toBe(true);
    h.control.read = "ok";
    h.setOnline(true);
    await h.manual.advance(DELAYS[0]!);
    expect(h.client.getSnapshot().streamUnavailable).toBe(false);
    expect(h.subscriptions).toHaveLength(2);
    expect(h.last().closed).toBe(false);
    h.client.dispose();
  });
  it("a retired conversation's trailing hint read never adds a second one to the next conversation", async () => {
    const h = harness();
    await h.start();
    let releaseA!: () => void;
    h.control.holdRead = new Promise<void>((resolve) => (releaseA = resolve));
    h.last().listener({ type: "invalidate" });
    h.last().listener({ type: "invalidate" });
    await flush();
    let releaseB!: () => void;
    const switching = h.client.switchConversation("conversation-b");
    await flush();
    h.control.holdRead = new Promise<void>((resolve) => (releaseB = resolve));
    await switching.catch(() => undefined);
    void h.client.refresh();
    await flush();
    const before = h.readIds.length;
    h.last().listener({ type: "invalidate" });
    h.last().listener({ type: "invalidate" });
    releaseA();
    await flush();
    h.last().listener({ type: "invalidate" });
    releaseB();
    await flush();
    await flush();
    expect(h.readIds.slice(before)).toEqual(["conversation-b"]);
    h.client.dispose();
  });

  it("a reopen that fails inside subscribe keeps the episode going until it gives up", async () => {
    const h = harness({ failInside: (index) => index > 0 });
    await h.start();
    h.status("reconnecting");
    for (const delay of DELAYS) await h.manual.advance(delay);
    await h.manual.advance(10_000);
    expect(h.subscriptions).toHaveLength(6);
    expect(h.subscriptions.every((s) => s.closed)).toBe(true);
    expect(h.client.getSnapshot().streamUnavailable).toBe(true);
    expect(h.manual.pending()).toBe(0);
    h.client.dispose();
  });
  it("a rebind retires the old episode, and the new binding's failure recovers on its own", async () => {
    const h = harness();
    await h.start();
    h.status("reconnecting");
    let release!: () => void;
    h.control.holdRead = new Promise<void>((resolve) => (release = resolve));
    await h.manual.advance(DELAYS[0]!);
    // The old episode's probe is held; a refused send rebinds meanwhile.
    h.control.sendExpired = true;
    await h.client.setDraft("Hello");
    await h.client.send();
    await flush();
    const replacement = h.last();
    expect(replacement.agreement).toBe("agreement-2");
    h.status("reconnecting", replacement);
    const before = h.reads.length;
    await h.manual.advance(DELAYS[0]!);
    expect(h.reads.slice(before)).toEqual(["agreement-2"]);
    const reopened = h.last();
    expect(reopened.agreement).toBe("agreement-2");
    expect(reopened.closed).toBe(false);
    release();
    await flush();
    await h.manual.advance(10_000);
    // The retired episode opened nothing.
    expect(h.last()).toBe(reopened);
    expect(reopened.closed).toBe(false);
    h.client.dispose();
  });
  it("offline time defers attempts without spending them, and coming back online probes", async () => {
    const h = harness();
    await h.start();
    h.setOnline(false);
    h.status("reconnecting");
    const before = h.reads.length;
    await h.manual.advance(60_000);
    expect(h.reads.length).toBe(before);
    expect(h.client.getSnapshot().streamUnavailable).toBe(false);
    h.setOnline(true);
    await h.manual.advance(0);
    await flush();
    expect(h.reads.length - before).toBe(1);
    expect(h.subscriptions).toHaveLength(2);
    expect(h.last().closed).toBe(false);
    h.client.dispose();
  });
  it("without online notifications a deferred attempt rechecks connectivity", async () => {
    const h = harness();
    await h.start();
    h.setOnline(false, false);
    h.status("reconnecting");
    await h.manual.advance(60_000);
    expect(h.subscriptions).toHaveLength(1);
    h.setOnline(true, false);
    await h.manual.advance(4_000);
    expect(h.subscriptions).toHaveLength(2);
    h.client.dispose();
  });
  it("a hint coalesces with the read a stream open already started", async () => {
    const h = harness();
    await h.start();
    let release!: () => void;
    h.control.holdRead = new Promise<void>((resolve) => (release = resolve));
    const before = h.reads.length;
    h.status("open");
    await flush();
    expect(h.reads.length - before).toBe(1);
    for (let hint = 0; hint < 5; hint++)
      h.last().listener({ type: "invalidate" });
    await flush();
    expect(h.reads.length - before).toBe(1);
    release();
    await flush();
    expect(h.reads.length - before).toBe(2);
    h.client.dispose();
  });
  it("a retired conversation's held hint read does not swallow the next conversation's hint", async () => {
    const h = harness();
    await h.start();
    let release!: () => void;
    h.control.holdRead = new Promise<void>((resolve) => (release = resolve));
    h.last().listener({ type: "invalidate" });
    await flush();
    await h.client.switchConversation("conversation-b");
    await flush();
    const before = h.readIds.length;
    h.last().listener({ type: "invalidate" });
    await flush();
    expect(h.readIds.slice(before)).toEqual(["conversation-b"]);
    release();
    await flush();
    h.last().listener({ type: "invalidate" });
    await flush();
    expect(h.readIds.slice(before)).toEqual([
      "conversation-b",
      "conversation-b",
    ]);
    h.client.dispose();
  });
  it("a successful retry clears the stream problem but not a newer unrelated one", async () => {
    const h = harness();
    await h.start();
    h.control.read = "network";
    h.status("reconnecting");
    for (const delay of DELAYS) await h.manual.advance(delay);
    expect(h.client.getSnapshot().problem?.id).toBe("stream");
    h.control.read = "ok";
    await h.client.refresh();
    h.status("open");
    expect(h.client.getSnapshot().problem).toBeNull();
    // Control: a newer, unrelated problem survives a later healthy open.
    h.status("reconnecting");
    await h.manual.advance(DELAYS[0]!);
    h.client.report({ code: "refused", id: "unrelated" });
    h.status("open");
    expect(h.client.getSnapshot().problem?.id).toBe("unrelated");
    h.client.dispose();
  });
  it("a new binding does not inherit the old binding's stream-unavailable flag", async () => {
    const h = harness();
    await h.start();
    h.control.read = "network";
    h.status("reconnecting");
    for (const delay of DELAYS) await h.manual.advance(delay);
    expect(h.client.getSnapshot().streamUnavailable).toBe(true);
    h.control.read = "ok";
    h.control.sendExpired = true;
    await h.client.setDraft("Hello");
    await h.client.send();
    await flush();
    expect(h.last().agreement).toBe("agreement-2");
    expect(h.client.getSnapshot().streamUnavailable).toBe(false);
    h.status("open");
    await h.manual.advance(10_000);
    expect(h.client.getSnapshot().streamUnavailable).toBe(false);
    h.client.dispose();
  });
});

describe("a replacement binding owns its recovery while its first read is pending", () => {
  for (const probe of ["succeeds", "fails"] as const)
    it(`a replacement that fails before its rebinding read settles recovers once it settles (probe ${probe})`, async () => {
      const h = harness({ failInside: (index) => index === 1 });
      await h.start();
      // A refused send renegotiates; the replacement fails inside subscribe
      // while the rebinding read is held.
      let release!: () => void;
      h.control.sendExpired = true;
      h.control.holdRead = new Promise<void>((resolve) => (release = resolve));
      const sending = (async () => {
        await h.client.setDraft("Hello");
        await h.client.send();
      })();
      await flush();
      expect(h.subscriptions).toHaveLength(2);
      expect(h.subscriptions[1]!.agreement).toBe("agreement-2");
      expect(h.subscriptions[1]!.closed).toBe(true);
      if (probe === "fails") h.control.read = "network";
      await h.manual.advance(DELAYS[0]!);
      // The outcome waits for the replacement's first read.
      expect(h.subscriptions).toHaveLength(2);
      release();
      await sending;
      await flush();
      if (probe === "fails") {
        // The failed probe keeps the replacement's budget going.
        h.control.read = "ok";
        await h.manual.advance(DELAYS[1]!);
      }
      await h.manual.advance(0);
      expect(h.subscriptions).toHaveLength(3);
      expect(h.last().agreement).toBe("agreement-2");
      expect(h.last().closed).toBe(false);
      h.client.dispose();
    });
});
