import type {
  TransportPort,
  TransportEvent,
  PlatformPorts,
} from "../core/client";
import type {
  Block,
  Conversation,
  Problem,
  CardAnswer,
  Reply,
  ReplyAction,
} from "../protocol/generated";
export interface ScriptedTurn {
  content?: string;
  blocks?: Block[];
  problem?: Problem;
  events?: TransportEvent[];
  /** The reply is left being written, as a reply still streaming in. */
  writing?: boolean;
}
// Whether a message's block is, or holds, the block a reply answers.
const holds = (block: Block, id: string): boolean =>
  block.id === id ||
  ((block.body as { blocks?: Block[] } | null)?.blocks ?? []).some((child) =>
    holds(child, id),
  );
/**
 * A scripted host. A `stop` ends the reply being written as `stopped` and
 * keeps its text. Like a real one it deduplicates by reply id, refuses the
 * same id with another body, and holds one answer per card: the first
 * answer it applies marks the card answered and names it in the card's
 * `answer`, and any other answer to that card is refused (`refused`).
 */
export function createScriptedTransport(now: () => number = Date.now) {
  const listeners = new Map<string, Set<(event: TransportEvent) => void>>();
  const replies = new Map<string, { body: string; result: { id: string } }>();
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
      const body = JSON.stringify({ ...reply, protocol: undefined });
      const existing = replies.get(key);
      const conflict = { id: reply.clientReplyId, code: "refused" } as const;
      if (existing) {
        if (existing.body !== body) throw conflict;
        return existing.result;
      }
      const value = conversation(id);
      const card =
        "blockId" in reply
          ? value.messages
              .flatMap((message) => message.blocks)
              .find((block) => holds(block, reply.blockId))
          : undefined;
      if (card?.answered) throw conflict;
      if (reply.kind === "stop") {
        const message = value.messages.find(
          (item) => item.id === reply.messageId && item.role === "assistant",
        );
        if (!message) throw conflict;
        if (message.status === "writing") message.status = "stopped";
        const result = { id: `reply-${++next}` };
        replies.set(key, { body, result });
        return result;
      }
      const turn = turns.shift();
      if (turn?.problem) throw turn.problem;
      if (card) {
        const answer: Partial<ReplyAction> = { ...(reply as ReplyAction) };
        delete answer.protocol;
        card.answered = true;
        card.answer = answer as CardAnswer;
      }
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
          ...(turn.writing && { status: "writing" as const }),
        });
      for (const event of turn?.events ?? []) emit(id, event);
      const result = { id: `reply-${++next}` };
      replies.set(key, { body, result });
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
