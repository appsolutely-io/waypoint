import type {
  TransportPort,
  TransportEvent,
  PlatformPorts,
} from "../core/client";
import type {
  Block,
  Conversation,
  Problem,
  Reply,
} from "../protocol/generated";
export interface ScriptedTurn {
  content?: string;
  blocks?: Block[];
  problem?: Problem;
  events?: TransportEvent[];
}
export function createScriptedTransport(now: () => number = Date.now) {
  const listeners = new Map<string, Set<(event: TransportEvent) => void>>();
  const replies = new Map<string, { id: string }>();
  const conversations = new Map<string, Conversation>();
  const turns: ScriptedTurn[] = [];
  let next = 0;
  const conversation = (id: string) => {
    let value = conversations.get(id);
    if (!value) {
      value = { protocol: "1.0", id, title: "Example", messages: [] };
      conversations.set(id, value);
    }
    return value;
  };
  const emit = (id: string, event: TransportEvent) => {
    for (const listener of listeners.get(id) ?? []) listener(event);
  };
  const transport: TransportPort = {
    negotiate: async () => ({
      protocol: "1.0",
      capabilities: ["plans", "flows", "widgets"],
    }),
    read: async (id) => structuredClone(conversation(id)),
    send: async (reply: Reply, id: string) => {
      const key = JSON.stringify([id, reply.clientReplyId]);
      const existing = replies.get(key);
      if (existing) return existing;
      const turn = turns.shift();
      if (turn?.problem) throw turn.problem;
      const value = conversation(id);
      if (reply.kind === "message")
        value.messages.push({
          id: `message-${++next}`,
          clientMessageId: reply.clientMessageId,
          role: "user",
          content: reply.content,
          blocks: [],
          createdAt: now(),
        });
      if (turn && (turn.content !== undefined || turn.blocks !== undefined))
        value.messages.push({
          id: `message-${++next}`,
          role: "assistant",
          content: turn.content ?? "",
          blocks: turn.blocks ?? [],
          createdAt: now(),
        });
      for (const event of turn?.events ?? []) emit(id, event);
      const result = { id: `reply-${++next}` };
      replies.set(key, result);
      return result;
    },
    subscribe: (id, listener) => {
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
  return {
    transport,
    enqueue: (turn: ScriptedTurn) => {
      turns.push(turn);
    },
    emit,
    activeStreams: () =>
      [...listeners.values()].reduce((count, set) => count + set.size, 0),
  };
}
export function createTestPlatform(): PlatformPorts {
  let id = 0;
  return {
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    online: () => true,
    visibility: () => true,
    ids: () => `test-${++id}`,
  };
}
