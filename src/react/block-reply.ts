// One answer per card: a card answered here is locked until the client
// refuses the answer, so a second press never sends a second reply. An
// answer whose outcome is unknown stays the card's answer: every later
// press sends it again, with the same id and body, until the host settles
// it, because the same reply id with another body is a conflict. The
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
  /**
   * Ids of this conversation's cards with an answer in flight or accepted
   * here, by card id alone; `isAnswered` with a message id tells cards of
   * different messages apart.
   */
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
   * card already answered here does nothing. After a failure that leaves
   * unknown whether the host applied it, a press sends the unsettled answer
   * again, whatever `answer` it is given, so the host can deduplicate it;
   * only after the host's definitive `refused` does a new answer get a new
   * reply id (see `cardReplyId`).
   */
  reply(
    block: Pick<Block, "id">,
    answer: BlockAnswer,
    messageId?: string,
  ): void;
  /**
   * The answer sent to this card whose outcome is unknown, while it is not
   * in flight: a UI offers to send it again instead of taking another.
   */
  unsettled(
    block: Pick<Block, "id">,
    messageId?: string,
  ): BlockAnswer | undefined;
}

interface Card {
  conversationId: string;
  blockId: string;
  locked: boolean;
  // The attempt the next send makes: a new one only after a refusal.
  attempt: number;
  // The answer sent with no definitive outcome, sent again as it was.
  unsettled?: { answer: BlockAnswer; reply: ReplyInput };
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
// Each UTF-16 code unit outside `[A-Za-z0-9_.~-]` as `%` and four hex
// digits: it cannot throw, even on an unpaired surrogate, and no part's
// characters can make two cards one.
const encodePart = (part: string) =>
  part.replace(
    /[^\w.~-]/g,
    (unit) => `%${(unit.charCodeAt(0) + 0x10000).toString(16).slice(1)}`,
  );
/**
 * A card's reply id: the same for every send of one attempt at the same
 * card, so a host deduplicates a resend (`useBlockReply` sends one answer
 * per attempt); `#2`, `#3` for an attempt after a refusal. Its parts are
 * escaped by code unit (`:` is `%003a`), so no id can make two cards one,
 * and one longer than 128 characters is a digest of the parts.
 */
export function cardReplyId(
  conversationId: string,
  messageId: string,
  blockId: string,
  attempt: number,
): string {
  const id =
    `card:${[conversationId, messageId, blockId].map(encodePart).join(":")}` +
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
      const attempt = card.attempt;
      // Built before the lock is taken, so nothing below it can throw.
      const sending = card.unsettled ?? {
        answer,
        reply: {
          ...answer,
          blockId:
            typeof answer.blockId === "string" ? answer.blockId : block.id,
          clientReplyId: cardReplyId(
            conversationId,
            messageId,
            block.id,
            attempt,
          ),
        } as ReplyInput,
      };
      card.locked = true;
      locks.cards.set(key, card);
      changed(locks);
      void store.replyOutcome(sending.reply).then((outcome) => {
        if (outcome.accepted) {
          card.unsettled = undefined;
          return;
        }
        // Only a definitive refusal (nothing applied) frees the card for a
        // new attempt with its own id; after any other failure the answer
        // sent stays the card's answer, and nothing sent changes nothing.
        if (outcome.problem?.code === "refused") {
          card.attempt = attempt + 1;
          card.unsettled = undefined;
        } else if (outcome.problem) card.unsettled = sending;
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
  const unsettled = useCallback(
    (block: Pick<Block, "id">, messageId = "") => {
      const card = locks.cards.get(
        cardKey(conversationId, messageId, block.id),
      );
      return card?.locked ? undefined : card?.unsettled?.answer;
    },
    [locks, conversationId, answered],
  );
  return { answered, isAnswered, reply, unsettled };
}
