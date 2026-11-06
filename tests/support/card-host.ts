// A host that holds one answer per card, shared by any number of clients
// (a reloaded page, a second tab). A replay of the applied request (same
// reply id and body) gets its first response; any other answer to the card,
// or the same reply id with another body, is refused as a conflict.
import { createWaypointClient, type ClientConfig } from "../../src/core/client";
import type { Block, Conversation, Reply } from "../../src/protocol/generated";
import { config } from "./client";

export const question: Block = {
  type: "buttons",
  id: "question-a",
  fallback: "Answer",
  body: {
    actions: [
      { id: "accept", label: "Accept" },
      { id: "decline", label: "Decline" },
    ],
  },
};
export const accept = { kind: "action" as const, actionId: "accept" };
export const decline = { kind: "action" as const, actionId: "decline" };
const conflict = { id: "card-answer", code: "refused" };

export interface CardHostOptions {
  // Whether the response to this send (1-based, across clients) is lost
  // after the host has applied it.
  lose?: (send: number) => boolean;
  // A refusal for this send instead of applying it; `answered` also closes
  // the card, as a host that ends a card on `closed` does.
  refuse?: (send: number) => { error: unknown; answered?: boolean } | undefined;
  // Whether this read (1-based, across clients) never returns.
  hang?: (read: number) => boolean;
  // Whether this read (1-based, across clients) fails as a dropped request.
  fail?: (read: number) => boolean;
  // Whether reads name the applied answer in the card's `answer`.
  answer?: boolean;
}
export function createCardHost(options: CardHostOptions = {}) {
  const block: Block = { ...question };
  const conversation: Conversation = {
    protocol: "1.0",
    id: "conversation-a",
    title: "Chat",
    messages: [
      {
        id: "m",
        role: "assistant",
        content: "",
        createdAt: 0,
        blocks: [block],
      } as Conversation["messages"][number],
    ],
  };
  const requests = new Map<
    string,
    { body: string; outcome: () => Promise<{ id: string }> }
  >();
  const applied: string[] = [];
  const sent: string[] = [];
  let reads = 0;
  const read = () => {
    reads++;
    if (options.fail?.(reads))
      return Promise.reject(new TypeError("Failed to fetch"));
    return options.hang?.(reads)
      ? new Promise<Conversation>(() => {})
      : Promise.resolve(structuredClone(conversation));
  };
  const send = async (reply: Reply) => {
    // The body without the protocol version the client adds.
    const body = JSON.stringify(reply, (key, value) =>
      key === "protocol" ? undefined : value,
    );
    const action = (reply as { actionId?: string }).actionId ?? reply.kind;
    sent.push(action);
    const number = sent.length;
    const seen = requests.get(reply.clientReplyId);
    if (seen) {
      if (seen.body !== body) throw conflict;
      return seen.outcome();
    }
    if (block.answered) throw conflict;
    const refusal = options.refuse?.(number);
    if (refusal) {
      if (refusal.answered) block.answered = true;
      requests.set(reply.clientReplyId, {
        body,
        outcome: () => Promise.reject(refusal.error),
      });
      throw refusal.error;
    }
    block.answered = true;
    if (options.answer) {
      const answer: Partial<Reply> = { ...reply };
      delete answer.protocol;
      block.answer = answer as Block["answer"];
    }
    applied.push(action);
    const result = { id: `reply-${number}` };
    requests.set(reply.clientReplyId, {
      body,
      outcome: () => Promise.resolve(result),
    });
    if (options.lose?.(number)) throw new TypeError("Failed to fetch");
    return result;
  };
  const client = (extra: Partial<ClientConfig> = {}) => {
    const base = config(extra);
    return createWaypointClient({
      ...base,
      transport: { ...base.transport, read, send },
    });
  };
  return {
    client,
    applied,
    sent,
    reads: () => reads,
    answered: () => Boolean(block.answered),
  };
}
/** The card as a client shows it now. */
export function shownCard(client: {
  getSnapshot(): { conversation: Conversation | null };
}): Block {
  return client.getSnapshot().conversation!.messages[0]!.blocks[0]!;
}
