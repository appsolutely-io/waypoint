import type { ClientConfig } from "../../src/core/client";
export const platform = {
  clock: {
    now: () => 100,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) =>
      clearTimeout(id as ReturnType<typeof setTimeout>),
  },
  online: () => true,
  visibility: () => true,
  ids: (() => {
    let id = 0;
    return () => `id-${++id}`;
  })(),
};
export function config(extra: Partial<ClientConfig> = {}): ClientConfig {
  return {
    accountId: "account-a",
    conversationId: "conversation-a",
    platform,
    transport: {
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: ["plans", "flows", "widgets"],
      }),
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [],
      }),
      send: async (reply) => ({ id: reply.clientReplyId }),
      subscribe: () => () => {},
    },
    ...extra,
  };
}
export interface ManualClock {
  clock: {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  advance(ms: number): Promise<void>;
  pending(): number;
}
export async function flush(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn++)
    await new Promise<void>((resolve) => setImmediate(resolve));
}
export function createManualClock(start = 0): ManualClock {
  let now = start;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimeout: (fn, ms) => {
        const id = ++nextId;
        timers.set(id, { at: now + Math.max(0, ms), fn });
        return id;
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number);
      },
    },
    async advance(ms) {
      const target = now + ms;
      await flush();
      for (;;) {
        let dueId: number | undefined;
        let due: { at: number; fn: () => void } | undefined;
        for (const [id, timer] of timers)
          if (timer.at <= target && (!due || timer.at < due.at)) {
            dueId = id;
            due = timer;
          }
        if (!due || dueId === undefined) break;
        timers.delete(dueId);
        now = due.at;
        due.fn();
        await flush();
      }
      now = target;
      await flush();
    },
    pending: () => timers.size,
  };
}
