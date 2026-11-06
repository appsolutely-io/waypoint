// One answer per card: a card answered here is locked until the client
// refuses the answer, so a second press never sends a second reply. The
// locks belong to the client, by conversation, message and card, so a
// screen that mounts again while an answer is in flight finds its card
// still locked, and a card id a later message uses again is not.
import { useCallback, useSyncExternalStore } from "react";
import type { ReplyInput, WaypointClient } from "../core/client";
import type { Block, Reply } from "../protocol/generated";
import { clientOf, useWaypointSnapshot } from "./headless";

/** An answer to a card, without the ids the hook fills in. */
export type BlockAnswer = Pick<Reply, "kind"> & Record<string, unknown>;

export interface BlockReply {
  /** Ids of this conversation's cards answered here and not refused. */
  answered: ReadonlySet<string>;
  /**
   * Whether a card takes no answer: the host marks it answered, or one is
   * locked here. Pass the card's message id when card ids repeat.
   */
  isAnswered(
    block: Pick<Block, "id" | "answered">,
    messageId?: string,
  ): boolean;
  /**
   * Sends one answer to the card of `messageId` (when given). A press on a
   * card already answered here does nothing. The same answer keeps its
   * reply id until the host refuses it; see `cardReplyId`.
   */
  reply(
    block: Pick<Block, "id">,
    answer: BlockAnswer,
    messageId?: string,
  ): void;
}

interface Card {
  conversationId: string;
  blockId: string;
  locked: boolean;
  // The attempt the next send makes: a new one only after a refusal.
  attempt: number;
}
interface Locks {
  // By a tuple key, so no id's characters can make two cards one.
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

// The protocol's limit on a reply id.
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
/**
 * A card answer's reply id: the same for the same answer to the same card,
 * so a host deduplicates a resend; `#2`, `#3` for an attempt after a
 * refusal. Its parts are URI-encoded, so no id can make two cards one, and
 * one longer than the protocol allows is a digest of the same parts.
 */
export function cardReplyId(
  conversationId: string,
  messageId: string,
  blockId: string,
  attempt: number,
): string {
  const id =
    `card:${[conversationId, messageId, blockId].map(encodeURIComponent).join(":")}` +
    (attempt > 1 ? `#${attempt}` : "");
  return id.length <= MAX_REPLY_ID
    ? id
    : `card~${fnv(id, 0x811c9dc5)}${fnv(id, 0x2b992ddf)}`;
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
          .filter(
            (card) => card.locked && card.conversationId === conversationId,
          )
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
      const card = locks.cards.get(key) ?? {
        conversationId,
        blockId: block.id,
        locked: false,
        attempt: 1,
      };
      if (card.locked) return;
      card.locked = true;
      locks.cards.set(key, card);
      changed(locks);
      const attempt = card.attempt;
      void store
        .replyOutcome({
          ...answer,
          blockId:
            typeof answer.blockId === "string" ? answer.blockId : block.id,
          clientReplyId: cardReplyId(
            conversationId,
            messageId,
            block.id,
            attempt,
          ),
        } as ReplyInput)
        .then((outcome) => {
          if (outcome.accepted) return;
          // Only a definitive refusal (nothing applied) starts a new
          // attempt; any other failure leaves the same answer's id.
          if (outcome.problem?.code === "refused") card.attempt = attempt + 1;
          card.locked = false;
          changed(locks);
        });
    },
    [store, locks, conversationId],
  );
  const isAnswered = useCallback(
    (block: Pick<Block, "id" | "answered">, messageId = "") =>
      Boolean(block.answered) ||
      locks.cards.get(cardKey(conversationId, messageId, block.id))?.locked ===
        true,
    // A new `answered` set marks a lock change, so this changes with it.
    [locks, conversationId, answered],
  );
  return { answered, isAnswered, reply };
}
