import { it, expect, describe } from "vitest";
import {
  buildIntent,
  captureFrom,
  createIntentMachine,
  semantic,
  signInRetryAllowed,
  type IntentContext,
  type IntentOverlay,
  type IntentPress,
} from "../../src/core/intent";
import type {
  IntentKind,
  IntentRequest,
  PlanIntentReply,
  PlanRecord,
} from "../../src/protocol/generated";
import { createManualClock, flush } from "../support/client";
import { semanticKey, type CoreIntentKind } from "../../src/core/same-intent";

type Problem = { code: string; id: string; retryAfter?: number };
interface Call {
  request: IntentRequest;
  resolve(reply: unknown): void;
  reject(error: unknown): void;
}
function record(
  overrides: Partial<NonNullable<PlanRecord["recovery"]>> = {},
  id = "p",
): PlanRecord {
  return {
    id,
    recovery: {
      profile: "plan-recovery-v1",
      phase: "readback",
      generation: "g1",
      round: 1,
      revision: 3,
      conversationId: "c",
      reviewId: "r1",
      executionId: "e1",
      decisionKey: "e1",
      slots: {
        stop: 1,
        "cancel-initial": 0,
        "cancel-review": 0,
        leave: 0,
        keep: 0,
      },
      versions: { evidence: 2, winner: 1, decisionResolution: 0 },
      evidenceDigest: "A".repeat(43),
      unknownCount: 0,
      remaining: 1,
      ...overrides,
    },
  } as unknown as PlanRecord;
}
// A clock whose timers fire only when told, so a reply can arrive after
// the deadline but before its timer callback runs.
function lateTimerClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 0;
  return {
    clock: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        timers.set(++next, { at: now + ms, fn });
        return next;
      },
      clearTimeout: (handle: unknown) => {
        timers.delete(handle as number);
      },
    },
    jump: (ms: number) => (now += ms),
    fire: () => {
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
    },
  };
}
function harness(
  options: { clock?: ReturnType<typeof lateTimerClock>["clock"] } = {},
) {
  const manual = createManualClock(0);
  const clock = options.clock ?? manual.clock;
  const calls: Call[] = [];
  const reports: Problem[] = [];
  const setPlans: PlanRecord[] = [];
  const reads: {
    id: string;
    resolve(value: boolean): void;
    reject(error: unknown): void;
    cancelled: boolean;
    // A newer core read or a publication supersedes this one.
    supersede(): void;
    endSilently(): void;
  }[] = [];
  let online = true;
  let ids = 0;
  let capabilities = ["plan-recovery", "plan-leave", "plan-keep"];
  let controller = new AbortController();
  const snapshot: {
    intentOverlays: Record<string, IntentOverlay>;
    intentNotice: unknown;
    intentAlert: unknown;
  } = { intentOverlays: {}, intentNotice: null, intentAlert: null };
  const context: IntentContext = {
    config: {
      plans: {
        intent: (request) =>
          new Promise<PlanIntentReply>((resolve, reject) =>
            calls.push({
              request,
              resolve: resolve as (reply: unknown) => void,
              reject,
            }),
          ),
      },
      platform: {
        clock,
        online: () => online,
        ids: () => `id-${++ids}`,
      },
    },
    publish: (patch) => Object.assign(snapshot, patch),
    client: {
      getSnapshot: () => ({ capabilities }),
      setPlan: (published) => setPlans.push(published),
    },
    scope: () => controller.signal,
    report: (problem) => reports.push(problem),
    read(id) {
      let resolve!: (record: PlanRecord) => void;
      let reject!: (error: unknown) => void;
      const reading = new Promise<PlanRecord>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const owner = new AbortController();
      const entry = {
        id,
        // Settles the read: `true` delivers a record.
        resolve: (value: boolean) => {
          if (value) resolve(record({ revision: 9 }));
        },
        reject,
        get cancelled() {
          return owner.signal.aborted;
        },
        supersede: () => owner.abort(),
        // Ends ownership without dispatching the abort event.
        endSilently: () => (ended = true),
      };
      let ended = false;
      const signal = {
        get aborted() {
          return ended || owner.signal.aborted;
        },
        addEventListener: owner.signal.addEventListener.bind(owner.signal),
        removeEventListener: owner.signal.removeEventListener.bind(
          owner.signal,
        ),
      };
      reads.push(entry);
      return [
        { signal, abort: () => owner.abort() },
        reading,
        () => !signal.aborted,
      ];
    },
  };
  const machine = createIntentMachine(context);
  const press = (
    kind: IntentKind,
    options: {
      from?: PlanRecord;
      cause?: IntentPress["cause"];
      producer?: IntentPress["producer"];
      ownRun?: boolean;
      deferred?: boolean;
      capability?: string;
      scope?: AbortSignal;
    } = {},
  ) => {
    let settled = false;
    const done = new Promise<void>((resolve) =>
      machine.press(
        {
          captured: {
            record: options.from ?? record(),
            kind,
            correlation: `c-${++ids}`,
          },
          cause: options.cause ?? "user",
          producer: options.producer ?? "user",
          scope: options.scope ?? controller.signal,
          ...(options.capability ? { capability: options.capability } : {}),
          ownRun: options.ownRun ?? false,
          startedAt: clock.now(),
          done: () => {
            settled = true;
            resolve();
          },
        },
        options.deferred,
      ),
    );
    return { done, settled: () => settled };
  };
  const answer = (
    call: Call,
    overrides: Partial<PlanIntentReply> = {},
  ): PlanIntentReply => ({
    planId: call.request.planId,
    kind: call.request.kind,
    capturedRound: call.request.capturedRound,
    correlation: call.request.correlation,
    effectiveRound: call.request.capturedRound,
    slotVersion: call.request.expectedSlotVersion + 1,
    result: "applied",
    keys: ["stopped"],
    phase: "readback",
    ...overrides,
  });
  const overlay = (planId = "p") => snapshot.intentOverlays[planId];
  return {
    manual,
    calls,
    reports,
    reads,
    setPlans,
    snapshot,
    machine,
    press,
    answer,
    overlay,
    setOnline: (value: boolean) => (online = value),
    setCapabilities: (value: string[]) => (capabilities = value),
    navigate: () => {
      controller.abort();
      controller = new AbortController();
    },
  };
}
const status = (status: number, retryAfter?: number) =>
  Object.assign(new Error(`HTTP ${status}`), {
    status,
    ...(retryAfter === undefined ? {} : { retryAfter }),
  });

describe("answering a reply", () => {
  it("a first Stop's reply resolves the overlay although its resolved slot version differs", async () => {
    const h = harness();
    const pressed = h.press("stop");
    expect(h.calls[0]!.request.expectedSlotVersion).toBe(1);
    h.calls[0]!.resolve(h.answer(h.calls[0]!, { slotVersion: 2 }));
    await pressed.done;
    expect(h.overlay()).toBeUndefined();
    expect(h.snapshot.intentNotice).toMatchObject({ resolvedSlotVersion: 2 });
  });
  it("a dedup answer to an older expected version resolves the overlay", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!, { slotVersion: 1 }));
    await pressed.done;
    expect(h.overlay()).toBeUndefined();
  });
  it("a conflict answer resolves the overlay", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.resolve(
      h.answer(h.calls[0]!, { result: "conflict", keys: ["intentConflict"] }),
    );
    await pressed.done;
    expect(h.overlay()).toBeUndefined();
    expect(h.snapshot.intentNotice).toMatchObject({ result: "conflict" });
  });
});

describe("classifying one attempt", () => {
  it("a matching reply resolves the overlay and sets the notice", async () => {
    const h = harness();
    const pressed = h.press("stop");
    expect(h.overlay()).toMatchObject({ delivery: "sending", kind: "stop" });
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    expect(h.snapshot.intentNotice).toMatchObject({
      kind: "stop",
      result: "applied",
      keys: ["stopped"],
    });
  });
  it("a reply for another request is unconfirmed", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!, { correlation: "other" }));
    await pressed.done;
    expect(h.overlay()).toMatchObject({
      delivery: "uncertain",
      lastProblem: { key: "stopUnconfirmed", cause: "connection-lost" },
    });
  });
  it("offline at send calls nothing and is not sent", async () => {
    const h = harness();
    h.setOnline(false);
    await h.press("leave").done;
    expect(h.calls).toHaveLength(0);
    expect(h.overlay()).toMatchObject({
      delivery: "not-sent",
      lastProblem: { key: "leaveNotSent", cause: "offline" },
    });
  });
  it("401 asks for sign-in and is not sent", async () => {
    const h = harness();
    const pressed = h.press("keep");
    h.calls[0]!.reject(status(401));
    await pressed.done;
    expect(h.overlay()).toMatchObject({
      delivery: "not-sent",
      lastProblem: { key: "keepNotSent", cause: "sign-in" },
    });
    expect(h.reports).toContainEqual({ code: "sign-in", id: "intent" });
  });
  it("403 is refused with host guidance", async () => {
    const h = harness();
    const pressed = h.press("cancel-review");
    h.calls[0]!.reject(status(403));
    await pressed.done;
    expect(h.overlay()).toMatchObject({
      delivery: "not-sent",
      lastProblem: { key: "cancelReviewRefused", cause: "forbidden" },
    });
    expect(h.snapshot.intentAlert).toMatchObject({ action: "hostGuidance" });
  });
  it("429 records when Retry becomes eligible", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(429, 5));
    await pressed.done;
    expect(h.overlay()).toMatchObject({
      delivery: "not-sent",
      retryAt: 5000,
      lastProblem: { cause: "rate-limited" },
    });
  });
  it.each([1.5, -1, Number.NaN])(
    "a 429 wait of %s is not a whole number of seconds, so the one-second default applies",
    async (wait) => {
      const h = harness();
      const pressed = h.press("leave");
      h.calls[0]!.reject(status(429, wait));
      await pressed.done;
      expect(h.overlay()).toMatchObject({ retryAt: 1000 });
    },
  );
  it("a connection lost after the host applied the intent is unconfirmed, and status returns the applied outcome", async () => {
    const h = harness();
    const pressed = h.press("keep");
    // The host committed; the response was lost before the deadline.
    h.calls[0]!.reject(new TypeError("network"));
    await pressed.done;
    expect(h.overlay()).toMatchObject({
      delivery: "uncertain",
      lastProblem: { key: "keepUnconfirmed", cause: "connection-lost" },
    });
    const checking = h.machine.status("p");
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.request).toEqual(h.calls[0]!.request);
    h.calls[1]!.resolve(
      h.answer(h.calls[1]!, { result: "already-kept", keys: ["alreadyKept"] }),
    );
    await checking;
    expect(h.overlay()).toBeUndefined();
  });
  it("only a proven offline start is not sent; a rejection after sending is unconfirmed", async () => {
    const offline = harness();
    offline.setOnline(false);
    await offline.press("stop", { ownRun: true }).done;
    expect(offline.overlay()?.lastProblem?.key).toBe("stopNotSent");
    const lost = harness();
    const pressed = lost.press("stop", { ownRun: true });
    lost.calls[0]!.reject(new Error("socket hang up"));
    await pressed.done;
    expect(lost.overlay()?.lastProblem?.key).toBe("stopUnconfirmed");
  });
  it("the delivery deadline makes the outcome unconfirmed without cancelling the request", async () => {
    const h = harness();
    const pressed = h.press("stop");
    await h.manual.advance(9_999);
    expect(pressed.settled()).toBe(false);
    await h.manual.advance(1);
    await pressed.done;
    expect(h.overlay()).toMatchObject({
      delivery: "uncertain",
      lastProblem: { key: "stopUnconfirmed", cause: "timeout" },
    });
    expect(h.calls).toHaveLength(1);
  });
});

describe("one deadline per operation, the read in the background", () => {
  it("a reply just before the deadline settles the caller by the deadline while the read continues in the background", async () => {
    const h = harness();
    const pressed = h.press("stop");
    await h.manual.advance(9_900);
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    expect(h.manual.clock.now()).toBeLessThanOrEqual(10_000);
    expect(h.reads).toHaveLength(1);
    expect(h.reads[0]!.cancelled).toBe(false);
  });
  it("a deferred press made during a load keeps its own deadline", async () => {
    const h = harness();
    await h.manual.advance(0);
    const pressed = h.press("stop", { deferred: true });
    await h.manual.advance(4_000);
    await flush();
    expect(h.calls).toHaveLength(1);
    await h.manual.advance(6_000);
    await pressed.done;
    expect(h.overlay()?.lastProblem?.cause).toBe("timeout");
  });
});

describe("transitions", () => {
  it("an interruption with no overlay creates a Stop overlay with its automatic cause", async () => {
    const h = harness();
    h.press("stop", {
      cause: "step-failed",
      producer: "automatic",
      ownRun: true,
    });
    expect(h.overlay()).toMatchObject({
      kind: "stop",
      producer: "automatic",
      ownRun: true,
      request: { cause: "step-failed" },
    });
  });
  it("an interrupted plan keeps its own overlay while another plan is displayed", async () => {
    const h = harness();
    h.press("stop", {
      from: record({}, "other"),
      producer: "automatic",
      cause: "connection-lost",
    });
    h.press("leave");
    expect(Object.keys(h.snapshot.intentOverlays).sort()).toEqual([
      "other",
      "p",
    ]);
  });
  it("at most one overlay per plan", async () => {
    const h = harness();
    h.press("leave");
    h.press("stop");
    h.press("stop");
    h.press("keep");
    expect(Object.keys(h.snapshot.intentOverlays)).toEqual(["p"]);
    expect(h.overlay()?.kind).toBe("stop");
  });
  it("a second identical press joins: one port call, both callers settle together", async () => {
    const h = harness();
    const from = record();
    const first = h.press("stop", { from });
    const second = h.press("stop", { from });
    expect(h.calls).toHaveLength(1);
    await flush();
    // The joined caller waits for the shared delivery.
    expect(second.settled()).toBe(false);
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await Promise.all([first.done, second.done]);
  });
  it("an automatic Stop joins a pending human Stop and keeps the human cause", async () => {
    const h = harness();
    const from = record();
    h.press("stop", { from });
    h.press("stop", { from, cause: "connection-lost", producer: "automatic" });
    expect(h.calls).toHaveLength(1);
    expect(h.overlay()).toMatchObject({
      producer: "user",
      request: { cause: "user" },
    });
  });
  it("a human Stop joins a pending automatic Stop and keeps the automatic cause", async () => {
    const h = harness();
    const from = record();
    h.press("stop", { from, cause: "step-failed", producer: "automatic" });
    h.press("stop", { from });
    expect(h.calls).toHaveLength(1);
    expect(h.overlay()?.request.cause).toBe("step-failed");
  });
  it("after G is accepted as E, a second Stop with the new target is refused while the first is held", async () => {
    const h = harness();
    h.press("stop", {
      from: record({ executionId: undefined, phase: "initial-review" }),
    });
    h.press("stop", { from: record() });
    expect(h.calls).toHaveLength(1);
    expect(h.overlay()?.request.target).toEqual({
      type: "generation",
      id: "g1",
    });
    expect(h.reports).toContainEqual({ code: "refused", id: "intentPending" });
  });
  it("after a round advance, a second Leave is refused while the first is held", async () => {
    const h = harness();
    h.press("leave", { from: record() });
    h.press("leave", { from: record({ round: 2 }) });
    expect(h.calls).toHaveLength(1);
    expect(h.reports).toContainEqual({ code: "refused", id: "intentPending" });
  });
  it("a Stop over a pending Leave takes over and the Leave's late reply changes nothing", async () => {
    const h = harness();
    const leave = h.press("leave");
    h.press("stop");
    await leave.done;
    expect(h.overlay()?.kind).toBe("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!, { kind: "leave" }));
    await flush();
    expect(h.overlay()).toMatchObject({ kind: "stop", delivery: "sending" });
    expect(h.snapshot.intentNotice).toBeNull();
  });
  it("a Cancel over a pending Keep takes over", async () => {
    const h = harness();
    h.press("keep");
    h.press("cancel-initial");
    expect(h.overlay()?.kind).toBe("cancel-initial");
    expect(h.calls).toHaveLength(2);
  });
  it("an interruption's Stop takes over a pending Leave", async () => {
    const h = harness();
    h.press("leave");
    h.press("stop", { cause: "renewal-refused", producer: "automatic" });
    expect(h.overlay()).toMatchObject({ kind: "stop", producer: "automatic" });
  });
  for (const [pending, refused] of [
    ["stop", "leave"],
    ["cancel-initial", "keep"],
    ["cancel-review", "cancel-initial"],
  ] as const)
    it(`a ${refused} while a ${pending} is pending is refused`, async () => {
      const h = harness();
      h.press(pending);
      await h.press(refused).done;
      expect(h.calls).toHaveLength(1);
      expect(h.overlay()?.kind).toBe(pending);
      expect(h.reports).toContainEqual({
        code: "refused",
        id: "intentPending",
      });
    });
  it("status while sending joins: no extra port call, same deadline", async () => {
    const h = harness();
    h.press("stop");
    const checking = h.machine.status("p");
    expect(h.calls).toHaveLength(1);
    await h.manual.advance(10_000);
    await checking;
    expect(h.overlay()?.delivery).toBe("uncertain");
  });
  it("Retry overlapping status joins", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.reject(new Error("lost"));
    await pressed.done;
    const a = h.machine.status("p");
    const b = h.machine.status("p");
    expect(h.calls).toHaveLength(2);
    h.calls[1]!.resolve(h.answer(h.calls[1]!));
    await Promise.all([a, b]);
  });
  it("status after a timeout redelivers the same bytes", async () => {
    const h = harness();
    h.press("leave");
    await h.manual.advance(10_000);
    void h.machine.status("p");
    expect(h.calls[1]!.request).toEqual(h.calls[0]!.request);
  });
  it("Retry after a lost response does not apply twice", async () => {
    const h = harness();
    const pressed = h.press("keep");
    h.calls[0]!.reject(new Error("lost"));
    await pressed.done;
    const retry = h.machine.status("p");
    // The host's semantic dedup answers the redelivery with the stored outcome.
    h.calls[1]!.resolve(
      h.answer(h.calls[1]!, { result: "already-kept", keys: ["alreadyKept"] }),
    );
    await retry;
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.request).toEqual(h.calls[0]!.request);
  });
  it("Retry after the deadline redelivers the same bytes", async () => {
    const h = harness();
    h.press("stop");
    await h.manual.advance(10_000);
    void h.machine.status("p");
    expect(h.calls).toHaveLength(2);
  });
  it("a status during that Retry joins it", async () => {
    const h = harness();
    h.press("stop");
    await h.manual.advance(10_000);
    void h.machine.status("p");
    void h.machine.status("p");
    expect(h.calls).toHaveLength(2);
  });
  it("Retry after offline redelivers", async () => {
    const h = harness();
    h.setOnline(false);
    await h.press("leave").done;
    h.setOnline(true);
    void h.machine.status("p");
    expect(h.calls).toHaveLength(1);
  });
  it("Retry after 403 redelivers on request", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(403));
    await pressed.done;
    void h.machine.status("p");
    expect(h.calls).toHaveLength(2);
  });
  it("a manual Retry before sign-in redelivers", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(401));
    await pressed.done;
    void h.machine.status("p");
    expect(h.calls).toHaveLength(2);
  });
  it("a manual Retry after the second 401 redelivers", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(401));
    await pressed.done;
    h.machine.authenticated();
    h.calls[1]!.reject(status(401));
    await flush();
    void h.machine.status("p");
    expect(h.calls).toHaveLength(3);
  });
  it("Retry before Retry-After is refused", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(429, 5));
    await pressed.done;
    await h.machine.status("p");
    expect(h.calls).toHaveLength(1);
    expect(h.reports).toContainEqual({
      code: "rate-limited",
      id: "intent",
      retryAfter: 5,
    });
  });
  it("after Retry-After passes nothing is sent and the alert offers Retry", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(429, 5));
    await pressed.done;
    expect(h.snapshot.intentAlert).toMatchObject({ action: "wait" });
    const serial = (h.snapshot.intentAlert as { serial: number }).serial;
    await h.manual.advance(60_000);
    expect(h.calls).toHaveLength(1);
    expect(h.snapshot.intentAlert).toEqual({ serial, action: "retry" });
  });
  it("a user Retry after Retry-After redelivers", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(429, 5));
    await pressed.done;
    await h.manual.advance(5_000);
    void h.machine.status("p");
    expect(h.calls).toHaveLength(2);
  });
  it("after a 401 and a successful authenticated read the same request is sent once", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(401));
    await pressed.done;
    h.machine.authenticated();
    h.machine.authenticated();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.request).toEqual(h.calls[0]!.request);
  });
  it("an automatic Stop's sign-in retry sends its original cause", async () => {
    const h = harness();
    const pressed = h.press("stop", {
      cause: "step-up-failed",
      producer: "automatic",
    });
    h.calls[0]!.reject(status(401));
    await pressed.done;
    h.machine.authenticated();
    expect(h.calls[1]!.request.cause).toBe("step-up-failed");
  });
  it("no automatic retry when the overlay or scope changed before sign-in", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(401));
    await pressed.done;
    h.navigate();
    h.machine.authenticated();
    expect(h.calls).toHaveLength(1);
  });
  it("a second 401 stops automatic retries", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(401));
    await pressed.done;
    h.machine.authenticated();
    h.calls[1]!.reject(status(401));
    await flush();
    h.machine.authenticated();
    expect(h.calls).toHaveLength(2);
  });
  it("an authenticated read while sending, uncertain or rate-limited changes nothing", async () => {
    const h = harness();
    h.press("stop");
    h.machine.authenticated();
    expect(h.calls).toHaveLength(1);
    await h.manual.advance(10_000);
    h.machine.authenticated();
    expect(h.calls).toHaveLength(1);
    const rated = harness();
    const pressed = rated.press("leave");
    rated.calls[0]!.reject(status(429, 9));
    await pressed.done;
    rated.machine.authenticated();
    expect(rated.calls).toHaveLength(1);
  });
  it("a late success of a timed-out attempt changes nothing", async () => {
    const h = harness();
    h.press("stop");
    await h.manual.advance(10_000);
    const reads = h.reads.length;
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await flush();
    expect(h.overlay()?.delivery).toBe("uncertain");
    expect(h.snapshot.intentNotice).toBeNull();
    expect(h.reads).toHaveLength(reads);
  });
  it("the first outcome of a timed-out attempt arriving during a later status delivery changes nothing", async () => {
    const h = harness();
    h.press("stop");
    await h.manual.advance(10_000);
    const alert = h.snapshot.intentAlert;
    const checking = h.machine.status("p");
    expect(h.overlay()?.delivery).toBe("sending");
    const reads = h.reads.length;
    // Attempt A settles only now, for the first time.
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await flush();
    expect(h.overlay()?.delivery).toBe("sending");
    expect(h.snapshot.intentNotice).toBeNull();
    expect(h.snapshot.intentAlert).toBe(alert);
    expect(h.reads).toHaveLength(reads);
    // Attempt B resolves.
    h.calls[1]!.resolve(h.answer(h.calls[1]!));
    await checking;
    expect(h.overlay()).toBeUndefined();
    expect(h.snapshot.intentNotice).toMatchObject({
      correlation: h.calls[1]!.request.correlation,
    });
  });
  it("a reply arriving after the deadline but before its timer runs is unconfirmed", async () => {
    const timers = lateTimerClock();
    const h = harness({ clock: timers.clock });
    const pressed = h.press("stop");
    timers.jump(10_001);
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await flush();
    expect(h.overlay()).toMatchObject({
      delivery: "uncertain",
      lastProblem: { cause: "timeout" },
    });
    expect(h.snapshot.intentNotice).toBeNull();
    timers.fire();
    await pressed.done;
    expect(h.overlay()?.delivery).toBe("uncertain");
  });
  it("a rejection arriving after the deadline but before its timer runs is unconfirmed", async () => {
    const timers = lateTimerClock();
    const h = harness({ clock: timers.clock });
    h.press("leave");
    timers.jump(10_001);
    h.calls[0]!.reject(status(403));
    await flush();
    expect(h.overlay()?.lastProblem?.cause).toBe("timeout");
  });
  it("a reply within the deadline still resolves", async () => {
    const timers = lateTimerClock();
    const h = harness({ clock: timers.clock });
    const pressed = h.press("stop");
    timers.jump(9_999);
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    expect(h.overlay()).toBeUndefined();
  });
  it("an attempt whose operation budget is already spent is not dispatched", async () => {
    const timers = lateTimerClock();
    const h = harness({ clock: timers.clock });
    h.press("stop", { deferred: true });
    timers.jump(10_000);
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.overlay()).toMatchObject({
      delivery: "not-sent",
      lastProblem: { cause: "timeout", key: "stopNotSentElsewhere" },
    });
  });
  it("a late 401 or network failure of an expired attempt changes nothing", async () => {
    const h = harness();
    h.press("stop");
    await h.manual.advance(10_000);
    const before = { ...h.overlay()! };
    h.calls[0]!.reject(status(401));
    await flush();
    expect(h.overlay()).toEqual(before);
    expect(h.reports).not.toContainEqual({ code: "sign-in", id: "intent" });
  });
  it("a delivery outcome after dispose changes nothing", async () => {
    const h = harness();
    h.press("stop");
    h.navigate();
    expect(h.overlay()).toBeUndefined();
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await flush();
    expect(h.snapshot.intentNotice).toBeNull();
    expect(h.reads).toHaveLength(0);
  });
  it("navigating away retires the overlay and its attempt", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.navigate();
    await pressed.done;
    expect(h.snapshot.intentOverlays).toEqual({});
  });
  it("status and Retry without an overlay send nothing", async () => {
    const h = harness();
    await h.machine.status("p");
    expect(h.calls).toHaveLength(0);
  });
  it("a deferred batch made during a load sends only the latest intent", async () => {
    const h = harness();
    h.press("leave", { deferred: true });
    h.press("stop", { deferred: true });
    expect(h.calls).toHaveLength(0);
    await flush();
    expect(h.calls.map((call) => call.request.kind)).toEqual(["stop"]);
  });
  it("a deferred identical press joins the batch", async () => {
    const h = harness();
    const from = record();
    const first = h.press("stop", { from, deferred: true });
    const second = h.press("stop", { from, deferred: true });
    await flush();
    expect(h.calls).toHaveLength(1);
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await Promise.all([first.done, second.done]);
  });
  it("a press without its capability does not take over a pending lower intent", async () => {
    const h = harness();
    h.press("leave");
    h.setCapabilities(["plan-recovery", "plan-leave"]);
    await h.press("keep", { capability: "plan-keep" }).done;
    expect(h.overlay()).toMatchObject({ kind: "leave", delivery: "sending" });
    expect(h.calls).toHaveLength(1);
  });
  it("a press after its capability was withdrawn sends nothing", async () => {
    const h = harness();
    h.setCapabilities(["plan-recovery"]);
    await h.press("keep", { capability: "plan-keep" }).done;
    expect(h.calls).toHaveLength(0);
    expect(h.reports).toContainEqual({ code: "unavailable", id: "plan-keep" });
  });
});

describe("the factual read", () => {
  it("a resolved intent reads the plan in the background", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    expect(h.reads.map((read) => read.id)).toEqual(["p"]);
  });
  it("an observer's Stop that times out still reads the plan; the overlay stays unconfirmed", async () => {
    const h = harness();
    h.press("stop", { ownRun: false });
    await h.manual.advance(10_000);
    expect(h.reads).toHaveLength(1);
    expect(h.overlay()?.delivery).toBe("uncertain");
    h.reads[0]!.resolve(true);
    await flush();
    expect(h.overlay()?.delivery).toBe("uncertain");
  });
  it("the background read is published", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    h.reads[0]!.resolve(true);
    await flush();
    expect(h.setPlans.map((plan) => plan.recovery?.revision)).toEqual([9]);
    expect(h.reports).toEqual([]);
  });
  it("a failed background read reports plan-read and leaves the overlay", async () => {
    const h = harness();
    h.press("stop");
    await h.manual.advance(10_000);
    h.reads[0]!.reject(new Error("read"));
    await flush();
    expect(h.reports).toContainEqual({ code: "unavailable", id: "plan-read" });
    expect(h.overlay()?.delivery).toBe("uncertain");
  });
  it("a factual read refused with a host's wait reports that wait", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    h.reads[0]!.reject(
      Object.assign(new Error("rate limited"), {
        code: "rate-limited",
        id: "host",
        retryAfter: 3,
      }),
    );
    await flush();
    expect(h.reports).toContainEqual({
      code: "rate-limited",
      id: "plan-read",
      retryAfter: 3,
    });
  });
  it("a background read past its budget reports plan-read and is not published later", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    await h.manual.advance(10_000);
    expect(h.reads[0]!.cancelled).toBe(true);
    expect(h.reports).toContainEqual({ code: "unavailable", id: "plan-read" });
    // The record arrives after its budget: it is not published.
    h.reads[0]!.resolve(true);
    await flush();
    expect(h.setPlans).toEqual([]);
  });
  it("a background read superseded by a newer one is not published", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    const again = h.press("leave");
    h.calls[1]!.resolve(h.answer(h.calls[1]!, { kind: "leave" }));
    await again.done;
    expect(h.reads[0]!.cancelled).toBe(true);
    expect(h.reads[1]!.cancelled).toBe(false);
  });
  it("a background read retired by navigation reports nothing, even if it never settles", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    h.navigate();
    await h.manual.advance(10_000);
    expect(h.reports).toEqual([]);
    h.reads[0]!.reject(new Error("late"));
    await flush();
    expect(h.reports).toEqual([]);
  });
  it("a read superseded by a newer core read or a publication reports nothing", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    h.reads[0]!.supersede();
    await h.manual.advance(10_000);
    expect(h.reports).toEqual([]);
    h.reads[0]!.resolve(true);
    await flush();
    expect(h.setPlans).toEqual([]);
  });
  it("a read whose owner ended reports nothing even without an abort event", async () => {
    // Guarded twice: the owner's abort listener normally retires it first.
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    h.reads[0]!.endSilently();
    await h.manual.advance(10_000);
    expect(h.reports).toEqual([]);
  });
  it("a read arriving after its deadline, before its timer ran, is not published and reports once", async () => {
    const timers = lateTimerClock();
    const h = harness({ clock: timers.clock });
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    timers.jump(10_001);
    h.reads[0]!.resolve(true);
    await flush();
    expect(h.setPlans).toEqual([]);
    expect(h.reports).toEqual([{ code: "unavailable", id: "plan-read" }]);
    timers.fire();
    await flush();
    expect(h.reports).toHaveLength(1);
  });
  it("a read failing after its deadline, before its timer ran, reports once", async () => {
    const timers = lateTimerClock();
    const h = harness({ clock: timers.clock });
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    timers.jump(10_001);
    h.reads[0]!.reject(new Error("late"));
    await flush();
    timers.fire();
    await flush();
    expect(h.reports).toEqual([{ code: "unavailable", id: "plan-read" }]);
  });
  it("a read inside its deadline is published", async () => {
    const timers = lateTimerClock();
    const h = harness({ clock: timers.clock });
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    timers.jump(9_999);
    h.reads[0]!.resolve(true);
    await flush();
    expect(h.setPlans).toHaveLength(1);
    expect(h.reports).toEqual([]);
  });
  it("navigation cancels the background read", async () => {
    const h = harness();
    const pressed = h.press("stop");
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    h.navigate();
    expect(h.reads[0]!.cancelled).toBe(true);
  });
  it("a read whose scope ended reports nothing even without an abort event", async () => {
    // Guarded twice: the abort listener normally stops the read first.
    const h = harness();
    const scope = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {},
    };
    const pressed = h.press("stop", { scope: scope as unknown as AbortSignal });
    h.calls[0]!.resolve(h.answer(h.calls[0]!));
    await pressed.done;
    scope.aborted = true;
    await h.manual.advance(10_000);
    expect(h.reports).toEqual([]);
  });
  it("a refused or offline intent starts no read", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(status(403));
    await pressed.done;
    h.setOnline(false);
    await h.machine.status("p");
    expect(h.reads).toHaveLength(0);
  });
});

describe("the notice copies the reply", () => {
  it("a Leave completed by Keep keeps its historical winner and carries the final Keep relation", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.resolve(
      h.answer(h.calls[0]!, {
        kind: "leave",
        keys: ["leftKnown"],
        winner: { kind: "leave", cause: "user" },
        finalHistory: {
          winner: { kind: "keep", cause: "user" },
          keptFact: {
            keepEffect: "leave-completed",
            actorCause: "user",
            round: 2,
          },
          relation: "leaveCompletedByKeep",
          requestedTargetApplied: true,
        },
      }),
    );
    await pressed.done;
    expect(h.snapshot.intentNotice).toMatchObject({
      winner: { kind: "leave" },
      finalHistory: {
        winner: { kind: "keep" },
        relation: "leaveCompletedByKeep",
      },
    });
  });
  it("a Leave covered by Keep reports not applied with the final Keep winner", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.resolve(
      h.answer(h.calls[0]!, {
        kind: "leave",
        result: "already-closed",
        keys: ["leaveCoveredByKeep"],
        finalHistory: {
          winner: { kind: "keep", cause: "user" },
          keptFact: {
            keepEffect: "forward-closed",
            actorCause: "user",
            round: 2,
          },
          relation: "leaveCoveredByKeep",
          requestedTargetApplied: false,
        },
      }),
    );
    await pressed.done;
    expect(h.snapshot.intentNotice).toMatchObject({
      finalHistory: { requestedTargetApplied: false, winner: { kind: "keep" } },
    });
  });
  it("a retained settled Stop or Cancel winner is the final winner", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.resolve(
      h.answer(h.calls[0]!, {
        kind: "leave",
        result: "sealed",
        keys: ["planSealed"],
        finalHistory: {
          winner: { kind: "cancel-initial", cause: "user" },
          keptFact: {
            keepEffect: "retention-ended",
            actorCause: "user",
            round: 1,
          },
        },
      }),
    );
    await pressed.done;
    expect(h.snapshot.intentNotice).toMatchObject({
      finalHistory: { winner: { kind: "cancel-initial" } },
    });
  });
  it("an own-human and an automatic coalesced Stop carry their own request keys", async () => {
    for (const requestKey of [
      "requestAlreadyStopped",
      "requestTargetStopped",
    ] as const) {
      const h = harness();
      const pressed = h.press("stop");
      h.calls[0]!.resolve(h.answer(h.calls[0]!, { requestKey }));
      await pressed.done;
      expect(h.snapshot.intentNotice).toMatchObject({ requestKey });
    }
  });
});

describe("keys and alerts", () => {
  it("every kind × failure gives its key; Stop with and without an own run", async () => {
    const expected: Record<string, [string, string, string]> = {
      "stop own": ["stopNotSent", "stopUnconfirmed", "stopRefused"],
      "stop elsewhere": [
        "stopNotSentElsewhere",
        "stopUnconfirmed",
        "stopRefused",
      ],
      "cancel-initial": [
        "cancelInitialNotSent",
        "cancelInitialUnconfirmed",
        "cancelInitialRefused",
      ],
      "cancel-review": [
        "cancelReviewNotSent",
        "cancelReviewUnconfirmed",
        "cancelReviewRefused",
      ],
      leave: ["leaveNotSent", "leaveUnconfirmed", "leaveRefused"],
      keep: ["keepNotSent", "keepUnconfirmed", "keepRefused"],
    };
    for (const [name, keys] of Object.entries(expected)) {
      const kind = name.split(" ")[0] as IntentKind;
      const ownRun = name === "stop own";
      const offline = harness();
      offline.setOnline(false);
      await offline.press(kind, { ownRun }).done;
      expect(offline.overlay()?.lastProblem?.key, name).toBe(keys[0]);
      const lost = harness();
      const a = lost.press(kind, { ownRun });
      lost.calls[0]!.reject(new Error("lost"));
      await a.done;
      expect(lost.overlay()?.lastProblem?.key, name).toBe(keys[1]);
      const refused = harness();
      const b = refused.press(kind, { ownRun });
      refused.calls[0]!.reject(status(403));
      await b.done;
      expect(refused.overlay()?.lastProblem?.key, name).toBe(keys[2]);
    }
  });
  it("each failure raises its one alert action", async () => {
    for (const [outcome, action] of [
      [new Error("lost"), "checkStatus"],
      [status(401), "signIn"],
      [status(403), "hostGuidance"],
      [status(429, 3), "wait"],
    ] as const) {
      const h = harness();
      const pressed = h.press("leave");
      h.calls[0]!.reject(outcome);
      await pressed.done;
      expect(h.snapshot.intentAlert, action).toMatchObject({ action });
    }
    const offline = harness();
    offline.setOnline(false);
    await offline.press("leave").done;
    expect(offline.snapshot.intentAlert).toMatchObject({ action: "retry" });
    const late = harness();
    late.press("leave");
    await late.manual.advance(10_000);
    expect(late.snapshot.intentAlert).toMatchObject({ action: "checkStatus" });
  });
  it("the same failure again raises no new alert", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(new Error("lost"));
    await pressed.done;
    const first = h.snapshot.intentAlert;
    const retry = h.machine.status("p");
    h.calls[1]!.reject(new Error("lost"));
    await retry;
    expect(h.snapshot.intentAlert).toBe(first);
  });
  it("success clears the alert and restores focus once", async () => {
    const h = harness();
    const pressed = h.press("leave");
    h.calls[0]!.reject(new Error("lost"));
    await pressed.done;
    const serial = (h.snapshot.intentAlert as { serial: number }).serial;
    const retry = h.machine.status("p");
    h.calls[1]!.resolve(h.answer(h.calls[1]!, { kind: "leave" }));
    await retry;
    expect(h.snapshot.intentAlert).toEqual({ serial, restoreFocus: true });
  });
});

// Guarded twice: on a live client a retired scope already removed its
// overlay, so this predicate is tested on a constructed state.
describe("second guards, tested at their own boundary", () => {
  it("no sign-in retry for an intent whose scope has ended", () => {
    const base = {
      autoRetried: false,
      overlay: { lastProblem: { cause: "sign-in" as const } },
      scope: { aborted: false },
    };
    expect(signInRetryAllowed(base)).toBe(true);
    expect(signInRetryAllowed({ ...base, scope: { aborted: true } })).toBe(
      false,
    );
    expect(signInRetryAllowed({ ...base, autoRetried: true })).toBe(false);
    expect(signInRetryAllowed({ ...base, attempt: {} })).toBe(false);
    expect(
      signInRetryAllowed({
        ...base,
        overlay: { lastProblem: { cause: "offline" } },
      }),
    ).toBe(false);
  });
});

describe("the core's cold-load key", () => {
  // Every field of the recovery view changed one at a time, alone and in
  // pairs, against a record without an execution and one with it.
  const changes: Partial<NonNullable<PlanRecord["recovery"]>>[] = [
    { revision: 4 },
    { phase: "forward-active" },
    { generation: "g2" },
    { round: 2 },
    { reviewId: "r2" },
    { reviewId: undefined },
    { executionId: "e2" },
    { executionId: undefined },
    { decisionKey: "e2" },
    { evidenceDigest: "B".repeat(43) },
    { unknownCount: 1 },
    { remaining: 0 },
    { versions: { evidence: 3, winner: 1, decisionResolution: 0 } },
    { versions: { evidence: 2, winner: 2, decisionResolution: 0 } },
    { versions: { evidence: 2, winner: 1, decisionResolution: 1 } },
    ...(
      ["stop", "cancel-initial", "cancel-review", "leave", "keep"] as const
    ).map((slot) => ({
      slots: {
        stop: 1,
        "cancel-initial": 0,
        "cancel-review": 0,
        leave: 0,
        keep: 0,
        [slot]: 7,
      },
    })),
  ];
  const variants = [
    ...changes,
    ...changes.flatMap((a, i) =>
      changes.slice(i + 1).map((b) => ({ ...a, ...b })),
    ),
  ];
  const sem = (source: PlanRecord, kind: IntentKind) =>
    semantic(
      buildIntent(
        captureFrom({ record: source, kind, correlation: "x" }),
        "user",
      ),
    );
  it.each(["stop", "cancel-initial", "leave"] as const)(
    "is equal exactly when the chunk's request comparison is (%s)",
    (kind: CoreIntentKind) => {
      for (const base of [record(), record({ executionId: undefined })])
        for (const change of variants) {
          const other = record({ ...base.recovery, ...change });
          expect([
            kind,
            change,
            semanticKey(base, kind) === semanticKey(other, kind),
          ]).toEqual([kind, change, sem(base, kind) === sem(other, kind)]);
        }
    },
  );
  it("ignores the revision, so an unrelated replacement keeps a Stop the same", () => {
    expect(semanticKey(record({ revision: 9, reviewId: "r9" }), "stop")).toBe(
      semanticKey(record(), "stop"),
    );
  });
});
