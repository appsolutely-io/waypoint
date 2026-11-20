import type { Message, ReplyFailure } from "../protocol/generated";
import type { ClientConfig, ClientSnapshot } from "./client";

export interface ReplyFailureRecord {
  failure: ReplyFailure;
  messageId?: string;
  status: "failed" | "unavailable";
  active: boolean;
}
export interface RetainedReplyFailure extends Omit<
  ReplyFailureRecord,
  "active"
> {
  retired: boolean;
}
export interface RecoveryRequest {
  kind: "regenerate" | "resend";
  messageId: string;
  episode?: string;
}
export function conversationTail(
  messages: readonly Message[],
): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user" || message.role === "assistant") return message;
  }
}
function turn(messages: readonly Message[], id: string): number {
  const at = messages.findIndex((message) => message.id === id);
  if (at < 0) return -1;
  for (let index = at; index >= 0; index--)
    if (messages[index]!.role === "user") return index;
  return at;
}
export function related(
  messages: readonly Message[],
  anchor: string | undefined,
  id: string,
): boolean {
  if (anchor === undefined) return false;
  if (anchor === id) return true;
  const before = turn(messages, anchor);
  return before >= 0 && before === turn(messages, id);
}
export function replyFailures(
  memory: Map<string, RetainedReplyFailure>,
  snapshot: ClientSnapshot,
): readonly ReplyFailureRecord[] {
  const messages = snapshot.conversation?.messages ?? [];
  const tail = conversationTail(messages);
  const pending = snapshot.pending.some((row) => !row.failure);
  const next = [...memory.values()].map(({ retired, ...record }) => {
    const anchor =
      record.failure.recovery?.kind === "regenerate"
        ? record.failure.recovery.messageId
        : record.messageId;
    const assistant = messages.some(
      (message) => message.id === anchor && message.role === "assistant",
    );
    return {
      ...record,
      active:
        !retired &&
        !pending &&
        (anchor === undefined
          ? !tail
          : !!tail &&
            (assistant
              ? anchor === tail.id
              : related(messages, anchor, tail.id))),
    };
  });
  const previous = snapshot.replyFailures;
  return previous?.length === next.length &&
    next.every((record, index) => {
      const old = previous[index]!;
      return (
        record.failure === old.failure &&
        record.messageId === old.messageId &&
        record.status === old.status &&
        record.active === old.active
      );
    })
    ? previous
    : next;
}
export function recoveryRequest(
  snapshot: ClientSnapshot,
  config: Pick<ClientConfig, "replies" | "versions">,
  messageId?: string,
): RecoveryRequest | undefined {
  const messages = snapshot.conversation?.messages ?? [];
  const record =
    messageId === undefined
      ? snapshot.replyFailures?.find((record) => record.active)
      : snapshot.replyFailures?.find((record) => {
          if (
            record.messageId === messageId ||
            (record.failure.recovery?.kind === "regenerate" &&
              record.failure.recovery.messageId === messageId)
          )
            return true;
          const message = messages.find((message) => message.id === messageId);
          const anchor = messages.find(
            (message) => message.id === record.messageId,
          );
          return (
            record.active &&
            anchor?.role === "user" &&
            message?.role === "assistant" &&
            (message.status === "failed" ||
              message.status === "unavailable" ||
              message.status === "writing") &&
            related(messages, record.messageId, messageId)
          );
        });
  const selected = record?.failure.recovery;
  if (selected !== undefined) {
    if (
      !record?.active ||
      selected.kind === "none" ||
      (messageId !== undefined && selected.messageId !== messageId)
    )
      return undefined;
    const target = messages.find((entry) => entry.id === selected.messageId);
    if (!target || !related(messages, record.messageId, target.id))
      return undefined;
    if (selected.kind === "regenerate") {
      if (target.role !== "assistant" || (!config.replies && !config.versions))
        return undefined;
    } else {
      if (
        target.role !== "user" ||
        !config.replies ||
        messages.some(
          (entry) =>
            entry.role === "assistant" &&
            related(messages, target.id, entry.id),
        )
      )
        return undefined;
    }
    return {
      kind: selected.kind,
      messageId: selected.messageId,
      episode: record.failure.id,
    };
  }
  if (
    messageId !== undefined &&
    config.versions &&
    messages.some(
      (entry) => entry.id === messageId && entry.role === "assistant",
    )
  )
    return { kind: "regenerate", messageId };
}
