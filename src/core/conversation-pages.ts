import type {
  ConversationPage,
  Conversation,
  Message,
  OutlineMessage,
} from "../protocol/generated";
import type { ConversationPageInput, ReaderRequestContext } from "./client";
import { createScope, onAbort, type Scope, type ScopeSignal } from "./scope";
import { normalizeSender } from "./message-sender";

type Page = Exclude<ConversationPage, { stale: true }>;
interface Boundary {
  cursor: string | null;
  snapshotId: string;
  token: number;
}
export interface PageCandidate {
  conversation: Conversation;
  outline: OutlineMessage[];
  snapshotId: string;
  token: number;
  tokens: Map<string, number>;
  held: Set<string>;
  requested: Set<string>;
  boundary: Boundary;
  rootBoundary: Boundary;
  cursors: Set<string>;
}
const invalid = (): Error => new Error("Invalid conversation page");
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
function sender(value: unknown): boolean {
  return value === undefined || normalizeSender(value) !== undefined;
}
function validMessage(value: Message): boolean {
  return Boolean(
    value &&
    nonempty(value.id) &&
    ["user", "assistant", "notice"].includes(value.role) &&
    typeof value.content === "string" &&
    Array.isArray(value.blocks) &&
    value.blocks.every(
      (block) =>
        block && nonempty(block.id) && nonempty(block.type) && "body" in block,
    ) &&
    Number.isInteger(value.createdAt) &&
    value.createdAt >= 0 &&
    sender(value.sender) &&
    (value.clientMessageId === undefined || nonempty(value.clientMessageId)) &&
    (value.status === undefined ||
      ["writing", "completed", "failed", "unavailable", "stopped"].includes(
        value.status,
      )) &&
    [value.versionIndex, value.versionCount].every(
      (version) =>
        version === undefined || (Number.isInteger(version) && version >= 1),
    ) &&
    (value.sources === undefined ||
      (Array.isArray(value.sources) &&
        value.sources.length <= 50 &&
        value.sources.every(
          (source) =>
            source &&
            typeof source.id === "string" &&
            typeof source.title === "string" &&
            typeof source.url === "string",
        ))) &&
    (value.attachments === undefined ||
      (Array.isArray(value.attachments) &&
        value.attachments.length <= 50 &&
        value.attachments.every(
          (attachment) =>
            attachment &&
            nonempty(attachment.id) &&
            nonempty(attachment.name) &&
            nonempty(attachment.mediaType) &&
            Number.isInteger(attachment.size) &&
            attachment.size >= 0 &&
            (attachment.url === undefined || nonempty(attachment.url)),
        ))),
  );
}
function validate(
  value: ConversationPage,
  id: string,
  requested: ReadonlySet<string>,
): Page {
  if (!value || typeof value !== "object" || "stale" in value) throw invalid();
  const { conversation, outline, heldClientMessageIds } = value;
  if (
    !nonempty(value.snapshotId) ||
    !(value.olderCursor === null || nonempty(value.olderCursor)) ||
    !conversation ||
    conversation.id !== id ||
    !nonempty(conversation.protocol) ||
    typeof conversation.title !== "string" ||
    !Array.isArray(conversation.messages) ||
    !Array.isArray(outline) ||
    !Array.isArray(heldClientMessageIds)
  )
    throw invalid();
  const index = new Map<string, OutlineMessage>();
  for (const entry of outline) {
    if (
      !entry ||
      !nonempty(entry.id) ||
      !nonempty(entry.revision) ||
      typeof entry.text !== "string" ||
      !["user", "assistant", "notice"].includes(entry.role) ||
      !sender(entry.sender) ||
      index.has(entry.id)
    )
      throw invalid();
    index.set(entry.id, entry);
  }
  const bodies = new Set<string>(),
    clientIds = new Set<string>();
  let previous = -1;
  const positions = new Map(outline.map((entry, at) => [entry.id, at]));
  for (const message of conversation.messages) {
    const entry = index.get(message?.id);
    const position = positions.get(message?.id);
    if (
      !validMessage(message) ||
      !entry ||
      position === undefined ||
      position <= previous ||
      bodies.has(message.id) ||
      entry.role !== message.role ||
      !sameSender(entry.sender, message.sender) ||
      (message.clientMessageId !== undefined &&
        clientIds.has(message.clientMessageId))
    )
      throw invalid();
    previous = position;
    bodies.add(message.id);
    if (message.clientMessageId) clientIds.add(message.clientMessageId);
  }
  if (outline.length && !bodies.size) throw invalid();
  const held = new Set<string>();
  for (const receipt of heldClientMessageIds) {
    if (!nonempty(receipt) || !requested.has(receipt) || held.has(receipt))
      throw invalid();
    held.add(receipt);
  }
  return value;
}
const sameSender = (
  left: Message["sender"],
  right: Message["sender"],
): boolean =>
  left === undefined
    ? right === undefined
    : right !== undefined &&
      left.id === right.id &&
      left.name === right.name &&
      left.avatarUrl === right.avatarUrl;
const sameIndex = (
  left: readonly OutlineMessage[],
  right: readonly OutlineMessage[],
): boolean =>
  left.length === right.length &&
  left.every((entry, at) => {
    const other = right[at]!;
    return (
      entry.id === other.id &&
      entry.role === other.role &&
      entry.revision === other.revision &&
      entry.text === other.text &&
      sameSender(entry.sender, other.sender)
    );
  });
function ordered(
  index: readonly OutlineMessage[],
  bodies: ReadonlyMap<string, Message>,
): Message[] {
  return index.flatMap((entry) => {
    const body = bodies.get(entry.id);
    return body ? [body] : [];
  });
}
export class ConversationPages {
  private current?: PageCandidate;
  private readonly pending = new Set<Scope>();
  constructor(
    private readonly read: (
      id: string,
      input: ConversationPageInput,
    ) => Promise<ConversationPage>,
  ) {}
  cancel(): void {
    for (const scope of this.pending) scope.abort();
    this.pending.clear();
  }
  reset(): void {
    this.cancel();
    this.current = undefined;
  }
  adopt(candidate: PageCandidate): void {
    this.current = candidate;
  }
  private async operation<T>(
    parent: ScopeSignal,
    owner: ScopeSignal | undefined,
    run: (scope: ScopeSignal) => Promise<T>,
  ): Promise<T> {
    const scope = createScope("conversation-page", parent);
    const off = owner ? onAbort(owner, () => scope.abort()) : () => {};
    this.pending.add(scope);
    try {
      return await run(scope.signal);
    } finally {
      off();
      this.pending.delete(scope);
      scope.end();
    }
  }
  private async fetch(
    id: string,
    input: ConversationPageInput,
    requested: ReadonlySet<string>,
  ): Promise<Page> {
    if (input.signal.aborted) throw invalid();
    const value = await new Promise<ConversationPage>((resolve, reject) => {
      const off = onAbort(input.signal, () => reject(invalid()));
      Promise.resolve()
        .then(() => this.read(id, input))
        .then(
          (page) => {
            off();
            resolve(page);
          },
          (error: unknown) => {
            off();
            reject(error);
          },
        );
    });
    if (input.signal.aborted) throw invalid();
    return validate(value, id, requested);
  }
  async latest(
    id: string,
    token: number,
    clientMessageIds: string[],
    parent: ScopeSignal,
    context?: ReaderRequestContext,
    owner?: ScopeSignal,
    live: readonly Message[] = [],
  ): Promise<PageCandidate> {
    this.cancel();
    const prior = this.current;
    return this.operation(parent, owner, async (signal) => {
      const requested = new Set(clientMessageIds);
      const input = { clientMessageIds, signal, context };
      const root = await this.fetch(id, input, requested);
      if (root.outline.at(-1)?.id !== root.conversation.messages.at(-1)?.id)
        throw invalid();
      const previousIndex = new Map(
        prior?.outline.map((entry) => [entry.id, entry]),
      );
      const nextIndex = new Map(root.outline.map((entry) => [entry.id, entry]));
      const bodies = new Map<string, Message>(),
        tokens = new Map<string, number>(),
        held = new Set(root.heldClientMessageIds);
      if (prior)
        for (const body of prior.conversation.messages) {
          if (
            nextIndex.get(body.id)?.revision ===
            previousIndex.get(body.id)?.revision
          ) {
            bodies.set(body.id, body);
            tokens.set(body.id, prior.tokens.get(body.id)!);
          }
        }
      const accept = (page: Page) => {
        if (
          page.snapshotId !== root.snapshotId ||
          !sameIndex(page.outline, root.outline)
        )
          throw invalid();
        for (const body of page.conversation.messages) {
          bodies.set(body.id, body);
          tokens.set(body.id, token);
        }
        for (const receipt of page.heldClientMessageIds) held.add(receipt);
      };
      accept(root);
      const required = new Set(
        [...(prior?.conversation.messages ?? []), ...live].map(
          (body) => body.id,
        ),
      );
      for (const bodyId of required) {
        if (!nextIndex.has(bodyId) || bodies.has(bodyId)) continue;
        const target = await this.fetch(
          id,
          { ...input, snapshotId: root.snapshotId, aroundMessageId: bodyId },
          requested,
        );
        accept(target);
        if (!bodies.has(bodyId)) throw invalid();
      }
      for (const [bodyId, body] of bodies) {
        const entry = nextIndex.get(bodyId)!;
        if (entry.role !== body.role || !sameSender(entry.sender, body.sender))
          throw invalid();
      }
      const rootBoundary = {
        cursor: root.olderCursor,
        snapshotId: root.snapshotId,
        token,
      };
      let boundary = rootBoundary;
      if (prior && prior.conversation.messages.length) {
        const oldTail = prior.conversation.messages.at(-1)!.id;
        const oldAt = root.outline.findIndex((entry) => entry.id === oldTail);
        const first = root.outline.findIndex(
          (entry) => entry.id === root.conversation.messages[0]?.id,
        );
        if (
          oldAt >= 0 &&
          first <= oldAt + 1 &&
          prior.boundary.cursor !== null &&
          sameIndex(prior.outline, root.outline.slice(0, prior.outline.length))
        )
          boundary = prior.boundary;
        else if (root.outline.every((entry) => bodies.has(entry.id)))
          boundary = { ...rootBoundary, cursor: null };
      }
      return {
        conversation: {
          ...root.conversation,
          messages: ordered(root.outline, bodies),
        },
        outline: root.outline,
        snapshotId: root.snapshotId,
        token,
        tokens,
        held,
        requested,
        boundary,
        rootBoundary,
        cursors:
          boundary === prior?.boundary ? new Set(prior.cursors) : new Set(),
      };
    });
  }
  async older(
    id: string,
    clientMessageIds: string[],
    parent: ScopeSignal,
    context?: ReaderRequestContext,
    owner?: ScopeSignal,
  ): Promise<PageCandidate> {
    const before = this.current;
    if (!before?.boundary.cursor) throw invalid();
    return this.operation(parent, owner, async (signal) => {
      const requested = new Set(clientMessageIds);
      const key = JSON.stringify([
        before.boundary.snapshotId,
        before.boundary.cursor,
      ]);
      if (before.cursors.has(key)) throw invalid();
      let page: Page;
      try {
        page = await this.fetch(
          id,
          {
            cursor: before.boundary.cursor!,
            snapshotId: before.boundary.snapshotId,
            clientMessageIds,
            signal,
            context,
          },
          requested,
        );
      } catch (error) {
        if (this.current === before && !signal.aborted)
          this.current = {
            ...before,
            boundary: before.rootBoundary,
            cursors: new Set(),
          };
        throw error;
      }
      if (
        this.current !== before ||
        signal.aborted ||
        page.snapshotId !== before.boundary.snapshotId ||
        page.outline.length > before.outline.length ||
        !sameIndex(page.outline, before.outline.slice(0, page.outline.length))
      )
        throw invalid();
      const nextKey = JSON.stringify([page.snapshotId, page.olderCursor]);
      if (
        page.olderCursor !== null &&
        (nextKey === key || before.cursors.has(nextKey))
      )
        throw invalid();
      const bodies = new Map(
        before.conversation.messages.map((body) => [body.id, body]),
      );
      const tokens = new Map(before.tokens);
      for (const body of page.conversation.messages) {
        if ((tokens.get(body.id) ?? -1) > before.boundary.token) continue;
        bodies.set(body.id, body);
        tokens.set(body.id, before.boundary.token);
      }
      return {
        ...before,
        conversation: {
          ...before.conversation,
          messages: ordered(before.outline, bodies),
        },
        tokens,
        requested,
        held: new Set(page.heldClientMessageIds),
        boundary: {
          cursor: page.olderCursor,
          snapshotId: page.snapshotId,
          token: before.boundary.token,
        },
        cursors: new Set([...before.cursors, key]),
      };
    });
  }
}
