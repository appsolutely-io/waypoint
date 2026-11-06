// One answer per card is the host's rule: it applies the first answer to a
// card, marks the card answered in its reads and refuses any other answer.
// This hook only keeps a card from being answered twice while an answer is
// in flight, and frees it once the client has read the conversation after
// the answer, whatever the outcome, so the card shows what the host holds.
// The locks belong to the client, by conversation, message and card, so a
// screen that mounts again while an answer is in flight finds its card
// still locked, and a card id a later message uses again is not.
import { useCallback, useSyncExternalStore } from "react";
import type { ReplyInput, WaypointClient } from "../core/client";
import type { Block, Reply } from "../protocol/generated";
import { clientOf, useWaypointSnapshot } from "./headless";

/** An answer to a card, without the ids the hook fills in. */
export type BlockAnswer = Pick<Reply, "kind"> & Record<string, unknown>;

export interface BlockReply {
  /**
   * Ids of this conversation's cards with an answer in flight, by card id
   * alone; `isAnswered` with a message id tells cards of
   * different messages apart.
   */
  answered: ReadonlySet<string>;
  /**
   * Whether a card takes no answer: the host marks it answered, or one is
   * in flight here. Pass the card's message id when card ids repeat.
   */
  isAnswered(
    block: Pick<Block, "id" | "answered">,
    messageId?: string,
  ): boolean;
  /**
   * Sends one answer to the card of `messageId` (when given), with a reply
   * id built from the card and the answer (see `cardReplyId`). A press on a
   * card with an answer in flight does nothing. Resolves once the client
   * has read the conversation after the answer, accepted or not; the card
   * is then shown as the host reports it.
   */
  reply(
    block: Pick<Block, "id">,
    answer: BlockAnswer,
    messageId?: string,
  ): Promise<void>;
}

interface Card {
  conversationId: string;
  blockId: string;
}
interface Locks {
  // The cards with an answer in flight, by a tuple key, so no id's
  // characters can make two cards one.
  cards: Map<string, Card>;
  listeners: Set<() => void>;
}
const stores = new WeakMap<WaypointClient, Locks>();
const locksOf = (client: WaypointClient) => {
  let locks = stores.get(client);
  if (!locks)
    stores.set(client, (locks = { cards: new Map(), listeners: new Set() }));
  return locks;
};
const cardKey = (conversationId: string, messageId: string, blockId: string) =>
  JSON.stringify([conversationId, messageId, blockId]);
// The answered set handed out stays the same until a lock changes.
const views = new WeakMap<
  Map<string, Card>,
  Map<string, ReadonlySet<string>>
>();
const changed = (locks: Locks) => {
  views.delete(locks.cards);
  for (const listener of locks.listeners) listener();
};

// The longest reply id the hook builds before it uses a digest; the
// schema's limit on a decline's `clientReplyId`.
const MAX_REPLY_ID = 128;
// FNV-1a, 32 bits, from a seed: two seeds give a 64-bit digest.
const fnv = (text: string, seed: number) => {
  let hash = seed;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};
const digest = (text: string) => fnv(text, 0x811c9dc5) + fnv(text, 0x2b992ddf);
// Each UTF-16 code unit outside `[A-Za-z0-9_.~-]` as `%` and four hex
// digits: it cannot throw, even on an unpaired surrogate, and no part's
// characters can make two cards one.
const encodePart = (part: string) =>
  part.replace(
    /[^\w.~-]/g,
    (unit) => `%${(unit.charCodeAt(0) + 0x10000).toString(16).slice(1)}`,
  );
/**
 * A card's reply id: the same for the same answer to the same card, in any
 * page or tab, so a host deduplicates a resend, and another for another
 * answer, which a host that already holds one refuses. It is opaque: its
 * parts and a digest of the answer, escaped by code unit, and a digest of
 * all of it past 128 characters.
 */
export function cardReplyId(
  conversationId: string,
  messageId: string,
  blockId: string,
  answer: BlockAnswer,
): string {
  const id = `card:${[conversationId, messageId, blockId].map(encodePart).join(":")}:${digest(JSON.stringify(answer))}`;
  return id.length <= MAX_REPLY_ID ? id : `card~${digest(id)}`;
}

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
    let byConversation = views.get(locks.cards);
    if (!byConversation) views.set(locks.cards, (byConversation = new Map()));
    let answered = byConversation.get(conversationId);
    if (!answered) {
      answered = new Set(
        [...locks.cards.values()]
          .filter((card) => card.conversationId === conversationId)
          .map((card) => card.blockId),
      );
      byConversation.set(conversationId, answered);
    }
    return answered;
  }, [locks, conversationId]);
  const answered = useSyncExternalStore(subscribe, snapshot, snapshot);
  const reply = useCallback(
    (block: Pick<Block, "id">, answer: BlockAnswer, messageId = "") => {
      const key = cardKey(conversationId, messageId, block.id);
      if (locks.cards.has(key)) return Promise.resolve();
      // Built before the lock is taken, so nothing below it can throw.
      const sending = {
        ...answer,
        blockId: typeof answer.blockId === "string" ? answer.blockId : block.id,
        clientReplyId: cardReplyId(conversationId, messageId, block.id, answer),
      } as ReplyInput;
      locks.cards.set(key, { conversationId, blockId: block.id });
      changed(locks);
      const free = () => {
        locks.cards.delete(key);
        changed(locks);
      };
      return store.replyOutcome(sending).then(free, free);
    },
    [store, locks, conversationId],
  );
  const isAnswered = useCallback(
    (block: Pick<Block, "id" | "answered">, messageId = "") =>
      Boolean(block.answered) ||
      locks.cards.has(cardKey(conversationId, messageId, block.id)),
    // A new `answered` set marks a lock change, so this changes with it.
    [locks, conversationId, answered],
  );
  return { answered, isAnswered, reply };
}
