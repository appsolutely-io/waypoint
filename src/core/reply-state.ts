import type { Conversation, Frame, Message } from "../protocol/generated";
import type { PendingSend, ReplyState } from "./client";
import { conversationTail } from "./reply-recovery";
import { normalizeSender } from "./message-sender";

export const REPLY_STALL_MS = 15000;
export type ReplyPresentation = "writing" | "waiting" | "expected";
export interface ReplyBusy {
  label?: string;
  overdue: boolean;
}
export interface ReplyOwner {
  kind: ReplyPresentation | "pending";
  id?: string;
  version?: number;
  generation?: number;
}
export interface ReplyDecisionInput {
  messages: readonly Message[];
  pending: readonly PendingSend[];
  now: number;
  askedAt?: number;
  overdueAt?: number;
  heldUntil?: number;
  unavailable?: boolean;
  failed?: boolean;
  streamLost?: boolean;
  activityAt?: number;
  conversation?: Conversation | null;
  version?: number;
  generation?: number;
  completeTailId?: string;
}
export interface ReplyDecision {
  state: ReplyState;
  presentation?: ReplyPresentation;
  owner?: ReplyOwner;
  at?: number;
  busy?: ReplyBusy;
}
export const positiveVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const time = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

export function normalizeReplyConversation(value: Conversation): Conversation {
  return {
    ...value,
    messages: value.messages.map((message) => {
      const { sender: raw, ...rest } = message;
      const sender = normalizeSender(raw);
      return { ...rest, ...(sender && { sender }) };
    }),
    replyStatus: ["expected", "failed", "unavailable", "complete"].includes(
      value.replyStatus ?? "",
    )
      ? value.replyStatus
      : undefined,
    replyLabel:
      value.replyLabel === null ||
      (typeof value.replyLabel === "string" &&
        [...value.replyLabel].length <= 200)
        ? value.replyLabel
        : undefined,
    replyExpectedId: nonempty(value.replyExpectedId)
      ? value.replyExpectedId
      : undefined,
    replyOverdueAt: time(value.replyOverdueAt)
      ? value.replyOverdueAt
      : undefined,
    replyOverdueFor:
      value.replyOverdueFor === null || nonempty(value.replyOverdueFor)
        ? value.replyOverdueFor
        : undefined,
    replyOverdueVersion: positiveVersion(value.replyOverdueVersion)
      ? value.replyOverdueVersion
      : undefined,
  };
}

export function normalizeReplyFrame(frame: Frame): Frame {
  if (frame.type !== "message.start" && frame.type !== "stale") return frame;
  return {
    ...frame,
    ...(frame.type === "message.start" && {
      sender: normalizeSender(frame.sender),
    }),
    replyOverdueAt: time(frame.replyOverdueAt)
      ? frame.replyOverdueAt
      : undefined,
    replyOverdueFor:
      frame.replyOverdueFor === null || nonempty(frame.replyOverdueFor)
        ? frame.replyOverdueFor
        : undefined,
    versionIndex: positiveVersion(frame.versionIndex)
      ? frame.versionIndex
      : undefined,
  };
}

export function ownedDeadline(
  conversation: Conversation,
  owner: ReplyOwner,
): number | undefined {
  const at = conversation.replyOverdueAt;
  if (typeof at !== "number" || !Number.isFinite(at)) return;
  if (
    !conversation.replyOverdueFor ||
    conversation.replyOverdueFor !== owner.id
  )
    return;
  if (owner.kind === "expected") {
    if (
      conversation.replyExpectedId !== owner.id ||
      conversation.messages.some((message) => message.id === owner.id)
    )
      return;
  } else if (
    owner.version === undefined ||
    conversation.replyOverdueVersion !== owner.version ||
    conversation.replyExpectedId === owner.id
  )
    return;
  return at;
}

export function sameReplyOwner(
  before: ReplyOwner | undefined,
  after: ReplyOwner | undefined,
): boolean {
  return (
    before?.kind === after?.kind &&
    before?.id === after?.id &&
    before?.generation === after?.generation &&
    (before?.version === undefined ||
      after?.version === undefined ||
      before.version === after.version)
  );
}

export function replyDecision(input: ReplyDecisionInput): ReplyDecision {
  const conversation = input.conversation;
  const last = conversationTail(input.messages);
  const pending = input.pending.find((row) => !row.failure);
  const writing =
    last?.role === "assistant" && last.status === "writing" && !pending;
  const expected = conversation?.replyStatus === "expected";
  const busy: ReplyBusy | undefined = expected
    ? {
        ...(conversation.replyLabel != null && {
          label: conversation.replyLabel,
        }),
        overdue: false,
      }
    : undefined;
  const terminal = (state: ReplyState): ReplyDecision => ({
    state,
    ...(busy && { busy }),
  });
  const timed = (owner: ReplyOwner, fallback?: number): ReplyDecision => {
    const host = conversation && ownedDeadline(conversation, owner);
    const at = host ?? fallback;
    const deadline =
      at === undefined ? undefined : Math.max(at, input.heldUntil ?? 0);
    const overdue = deadline !== undefined && input.now >= deadline;
    const presentation = owner.kind === "pending" ? "waiting" : owner.kind;
    return {
      state:
        presentation === "expected"
          ? overdue
            ? "expected-overdue"
            : "expected"
          : overdue
            ? "overdue"
            : "writing",
      presentation,
      owner,
      at: deadline,
      ...(busy && {
        busy: { ...busy, overdue: presentation === "expected" && overdue },
      }),
    };
  };
  if (writing) {
    if (input.unavailable || input.streamLost) return terminal("unavailable");
    if (input.failed) return terminal("failed");
    return timed(
      {
        kind: "writing",
        id: last.id,
        version: input.version,
        generation: input.generation,
      },
      input.activityAt === undefined
        ? undefined
        : input.activityAt + REPLY_STALL_MS,
    );
  }
  if (expected)
    return timed({ kind: "expected", id: conversation.replyExpectedId });
  if (
    last?.role === "assistant" &&
    (last.status === "failed" || last.status === "unavailable") &&
    !pending
  )
    return terminal(last.status);
  if (last?.role !== "user" && !pending) return terminal("none");
  if (pending)
    return {
      state: "writing",
      presentation: "waiting",
      owner: { kind: "pending", id: pending.id },
    };
  if (input.unavailable) return terminal("unavailable");
  if (input.failed) return terminal("failed");
  if (
    conversation?.replyStatus === "complete" &&
    input.completeTailId === last?.id
  )
    return terminal("none");
  const unowned = conversation?.replyOverdueFor == null;
  return timed(
    { kind: "waiting", id: last?.id, version: input.version },
    Math.max(
      (last?.createdAt ?? input.now) + REPLY_STALL_MS,
      (input.askedAt ?? 0) + REPLY_STALL_MS,
      unowned ? (input.overdueAt ?? 0) : 0,
    ),
  );
}

export function frameDeadline(
  frame: Extract<Frame, { type: "message.start" | "stale" }>,
  conversation: Conversation,
  owner: ReplyOwner | undefined,
): Partial<Conversation> | undefined {
  if (
    !owner ||
    frame.replyOverdueAt === undefined ||
    !frame.replyOverdueFor ||
    frame.replyOverdueFor !== owner.id
  )
    return;
  if (owner.kind === "expected") {
    if (
      conversation.replyExpectedId !== owner.id ||
      conversation.messages.some((message) => message.id === owner.id)
    )
      return;
  } else if (
    owner.kind === "pending" ||
    owner.version === undefined ||
    frame.versionIndex !== owner.version ||
    conversation.replyExpectedId === owner.id
  )
    return;
  return {
    replyOverdueAt: frame.replyOverdueAt,
    replyOverdueFor: frame.replyOverdueFor,
    replyOverdueVersion:
      owner.kind === "expected" ? undefined : frame.versionIndex,
  };
}
