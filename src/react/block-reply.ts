// One answer per card: a card answered here is locked until the client
// refuses the answer, so a second press never sends a second reply. The
// locks belong to the client, by conversation and card, so a screen that
// mounts again while an answer is in flight finds its card still locked.
import { useCallback, useSyncExternalStore } from "react";
import type { ReplyInput, WaypointClient } from "../core/client";
import type { Block, Reply } from "../protocol/generated";
import { clientOf, useWaypointSnapshot } from "./headless";

/** An answer to a card, without the ids the hook fills in. */
export type BlockAnswer = Pick<Reply, "kind"> & Record<string, unknown>;

export interface BlockReply {
  /** Cards of this conversation answered here and not refused. */
  answered: ReadonlySet<string>;
  /** Whether a card takes no answer: the host marks it answered, or one is locked here. */
  isAnswered(block: Pick<Block, "id" | "answered">): boolean;
  /**
   * Sends one answer to the card. A press on a card already answered here
   * does nothing; a refused answer frees the card for another.
   */
  reply(block: Pick<Block, "id">, answer: BlockAnswer): void;
}

interface Locks {
  // Locked cards, keyed `conversation:card`.
  keys: Set<string>;
  // Answers sent per card, so each attempt gets its own reply id.
  attempts: Map<string, number>;
  listeners: Set<() => void>;
}
const stores = new WeakMap<WaypointClient, Locks>();
const locksOf = (client: WaypointClient) => {
  let locks = stores.get(client);
  if (!locks)
    stores.set(
      client,
      (locks = { keys: new Set(), attempts: new Map(), listeners: new Set() }),
    );
  return locks;
};
// The answered set handed out stays the same until a lock changes.
const views = new WeakMap<Set<string>, Map<string, ReadonlySet<string>>>();
const setLock = (locks: Locks, key: string, held: boolean) => {
  if (held) locks.keys.add(key);
  else locks.keys.delete(key);
  views.delete(locks.keys);
  for (const listener of locks.listeners) listener();
};

/** The card answer lock every renderer uses. */
export function useBlockReply(client?: WaypointClient): BlockReply {
  const store = clientOf(client);
  const { conversationId } = useWaypointSnapshot(store);
  const locks = locksOf(store);
  const subscribe = useCallback(
    (listener: () => void) => {
      locks.listeners.add(listener);
      return () => locks.listeners.delete(listener);
    },
    [locks],
  );
  const snapshot = useCallback(() => {
    let byConversation = views.get(locks.keys);
    if (!byConversation) views.set(locks.keys, (byConversation = new Map()));
    let answered = byConversation.get(conversationId);
    if (!answered) {
      const prefix = `${conversationId}:`;
      answered = new Set(
        [...locks.keys]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length)),
      );
      byConversation.set(conversationId, answered);
    }
    return answered;
  }, [locks, conversationId]);
  const answered = useSyncExternalStore(subscribe, snapshot, snapshot);
  const reply = useCallback(
    (block: Pick<Block, "id">, answer: BlockAnswer) => {
      const key = `${conversationId}:${block.id}`;
      if (locks.keys.has(key)) return;
      setLock(locks, key, true);
      // The first answer's id is the card's, so the same answer sent again
      // (after a reload) is the same reply; an answer after a refusal is a
      // new reply with its own id, never a changed replay of the refused one.
      const attempt = (locks.attempts.get(key) ?? 0) + 1;
      locks.attempts.set(key, attempt);
      void store
        .reply({
          ...answer,
          blockId:
            typeof answer.blockId === "string" ? answer.blockId : block.id,
          clientReplyId: attempt === 1 ? key : `${key}:${attempt}`,
        } as ReplyInput)
        .then((accepted) => {
          if (!accepted) setLock(locks, key, false);
        });
    },
    [store, locks, conversationId],
  );
  const isAnswered = useCallback(
    (block: Pick<Block, "id" | "answered">) =>
      Boolean(block.answered) || answered.has(block.id),
    [answered],
  );
  return { answered, isAnswered, reply };
}
