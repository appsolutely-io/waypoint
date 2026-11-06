// One answer per card: a card answered here is locked until the client
// refuses the answer, so a second press never sends a second reply.
import { useCallback, useRef, useState } from "react";
import type { ReplyInput, WaypointClient } from "../core/client";
import type { Block, Reply } from "../protocol/generated";
import { clientOf, useWaypointSnapshot } from "./headless";

/** An answer to a card, without the ids the hook fills in. */
export type BlockAnswer = Pick<Reply, "kind"> & Record<string, unknown>;

export interface BlockReply {
  /** Cards answered here whose answer the client has not refused. */
  answered: ReadonlySet<string>;
  /**
   * Sends one answer to the card. A press on a card already answered here
   * does nothing; a refused answer frees the card for another.
   */
  reply(block: Pick<Block, "id">, answer: BlockAnswer): void;
}

/** The card answer lock every renderer uses. */
export function useBlockReply(client?: WaypointClient): BlockReply {
  const store = clientOf(client);
  const { conversationId } = useWaypointSnapshot(store);
  const locks = useRef(new Set<string>());
  const [answered, setAnswered] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const reply = useCallback(
    (block: Pick<Block, "id">, answer: BlockAnswer) => {
      if (locks.current.has(block.id)) return;
      locks.current.add(block.id);
      setAnswered(new Set(locks.current));
      void store
        .reply({
          ...answer,
          blockId:
            typeof answer.blockId === "string" ? answer.blockId : block.id,
          clientReplyId: `${conversationId}:${block.id}`,
        } as ReplyInput)
        .then((accepted) => {
          if (accepted) return;
          locks.current.delete(block.id);
          setAnswered(new Set(locks.current));
        });
    },
    [store, conversationId],
  );
  return { answered, reply };
}
