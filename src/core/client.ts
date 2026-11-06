import type { FormSession } from "./form-fill";
import { loadReadHandlers, STREAM_READS_UNAVAILABLE } from "./reads";
import { load as loadReads, loaded as readCode } from "./reads-load";
import { createPlanRunner, PlanReadRefused, type RunnerPorts } from "./runner";
import { semanticKey, type CoreIntentKind } from "./same-intent";
import { createScope, onAbort, type Scope, type ScopeSignal } from "./scope";
import type { OnDemand } from "./on-demand";
import { revisionOf, type StoredRecord } from "./stored-record";
import type {
  IntentAlert,
  IntentContext,
  IntentMachine,
  IntentNotice,
  IntentOverlay,
} from "./intent";
import {
  CAPABILITIES,
  SUPPORTED_PROTOCOLS,
  withPrerequisites,
  type Capability,
  type NegotiationOffer,
} from "../protocol/index";
import type {
  LeaveAcknowledgment,
  ExecutionAcceptance,
  IntentCause,
  IntentKind,
  RecoveryPhase,
  Flow,
  Conversation,
  Frame,
  Message,
  ConfirmationRecord,
  PlanRecord,
  Problem,
  Reply,
  ReadTemplate,
  ManifestEntry,
  ToolCall,
} from "../protocol/generated";
export type {
  IntentAlert,
  IntentFailure,
  IntentNotice,
  IntentOverlay,
} from "./intent";
export type MaybePromise<T> = T | Promise<T>;
export type KeepDisabledReason =
  | "loading"
  | "intentUnavailable"
  | "capabilityMissing"
  | "keepNoDecision"
  | "sealed"
  | "keepBlockedActive"
  | "keepBlockedUnknown";
export interface KeepChangesReview {
  // forward-only: the remaining planned work ends; end-retention: only
  // this plan's own history retention ends.
  review: "forward-only" | "end-retention";
  remaining: number;
  acknowledgment: LeaveAcknowledgment;
}
export type KeepChangesReviewResult =
  KeepChangesReview | { disabled: KeepDisabledReason };
export interface StoragePort {
  get(key: string): MaybePromise<string | null>;
  set(key: string, value: string): MaybePromise<void>;
  remove(key: string): MaybePromise<void>;
  /**
   * Optional atomic commit: writes `value` only if the stored value is still
   * `expected` (null for absent), and reports whether it wrote. Stores shared
   * by several runtimes should implement it; see `commitRecord`.
   */
  compareAndSet?(
    key: string,
    expected: string | null,
    value: string,
  ): MaybePromise<boolean>;
}
export interface PlatformPorts {
  clock: {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  online(): boolean;
  visibility(): boolean;
  ids(): string;
  /**
   * Optional notification of connectivity changes. The client retries a failed
   * startup when it reports `true`, and unsubscribes on dispose. Without it the
   * client falls back to its retry timer and the `online()` boolean.
   */
  subscribeOnline?(listener: (online: boolean) => void): () => void;
  /**
   * Optional notification of visibility changes. The client retries a failed
   * startup when the view becomes visible, and unsubscribes on dispose.
   */
  subscribeVisibility?(listener: (visible: boolean) => void): () => void;
}
/**
 * The binding a client sends with each request once the host issued an
 * agreement. It identifies the negotiated answer; it is never authority.
 */
export interface ReaderRequestContext {
  agreementId: string;
}
/**
 * What a host returns for a delivered reply. A first accepting confirmation
 * of a protected plan also carries the private acceptance, which only the
 * runner receives; public `reply` stays a boolean.
 */
export interface ReplyDelivery {
  id: string;
  acceptance?: ExecutionAcceptance;
}
export interface TransportPort {
  /**
   * Negotiates without storing any binding: each client owns its answer, even
   * when several clients share one transport.
   */
  negotiate(
    supported: readonly string[],
    offer?: NegotiationOffer,
  ): Promise<{
    protocol: string;
    capabilities: string[];
    agreementId?: string;
  }>;
  read(
    conversationId: string,
    context?: ReaderRequestContext,
  ): Promise<Conversation>;
  send(
    reply: Reply & { extensions?: Record<string, unknown> },
    conversationId: string,
    context?: ReaderRequestContext,
  ): Promise<ReplyDelivery>;
  subscribe(
    conversationId: string,
    listener: (event: TransportEvent) => void,
    context?: ReaderRequestContext,
  ): () => void;
}
export type TransportEvent =
  | {
      type: "status";
      status: "connecting" | "open" | "reconnecting" | "unavailable";
    }
  | { type: "frame"; frame: Frame }
  /** A hint that the conversation changed; it is never applied as content. */
  | { type: "invalidate" };
export type WaypointEvent =
  | { type: "send" | "reply"; conversationId: string; replyId: string }
  | { type: "plan.state"; planId: string }
  | { type: "problem"; problemId: string }
  | { type: "transport.status"; conversationId: string };
export interface ComposerContribution {
  id: string;
  evaluate(context: {
    draft: string;
    conversationId: string;
  }): MaybePromise<{ hold?: string; hint?: string; payload?: unknown }>;
}
export interface MessageVersionInput {
  conversationId: string;
  messageId: string;
  clientReplyId: string;
}
export interface MessageVersionPort {
  edit(input: MessageVersionInput & { content: string }): MaybePromise<void>;
  regenerate(input: MessageVersionInput): MaybePromise<void>;
  select(input: MessageVersionInput & { index: number }): MaybePromise<void>;
}
export interface FeedbackInput extends MessageVersionInput {
  rating: "positive" | "negative";
}
/** Where a host takes the user's rating of a reply. */
export interface FeedbackPort {
  send(input: FeedbackInput): MaybePromise<void>;
}
export interface FlowSource {
  load?(id: string): MaybePromise<Flow>;
  list(tab: FlowTab): MaybePromise<FlowSummary[]>;
  setFavourite(id: string, favourite: boolean): MaybePromise<void>;
  run(
    id: string,
    values: Record<string, unknown>,
    document?: Flow,
  ): MaybePromise<{ conversationId: string; plan?: PlanRecord }>;
}
export type BuiltinFlowTab = "favourites" | "most-used" | "recent" | "presets";
export type FlowTab = BuiltinFlowTab | { id: string; labelKey: string };
export const DEFAULT_FLOW_TABS: readonly BuiltinFlowTab[] = Object.freeze([
  "favourites",
  "most-used",
  "recent",
  "presets",
]);
export function flowTabId(tab: FlowTab): string {
  return typeof tab === "string" ? tab : tab.id;
}
export interface FlowSummary {
  id: string;
  title: string;
  favourite?: boolean;
  runCount?: number;
  lastRunAt?: number;
}
export interface PendingSend {
  id: string;
  content: string;
  failure: Problem | null;
  extensions?: Record<string, unknown>;
}
export type ReplyState =
  "none" | "writing" | "unavailable" | "failed" | "overdue";
export interface ClientSnapshot {
  protocol: string | null;
  replyState: ReplyState;
  conversationId: string;
  conversation: Conversation | null;
  conversationUnavailable: boolean;
  draft: string;
  pending: readonly PendingSend[];
  problem: Problem | null;
  announcement: number;
  observerFailures: number;
  capabilities: readonly Capability[];
  status: string;
  plan: PlanRecord | null;
  flows: Partial<Record<string, FlowSummary[]>>;
  flowTab: string;
  flowTabs: readonly FlowTab[];
  hints: readonly string[];
  sending: boolean;
  /** The stream gave up after its bounded reopen attempts; `refresh()` retries. */
  streamUnavailable: boolean;
  /**
   * The latest confirmation attempt that was not accepted: its token and its
   * reply id. The current problem is that attempt's refusal only when its
   * id is this reply id.
   */
  confirmationRefusal?: { token: string; problemId: string };
  /** Queued messages whose withdrawal is waiting for its commit. */
  withdrawing: readonly string[];
  /**
   * The reads the host asked for since the user's last message, in order,
   * each running, done or failed.
   */
  toolSteps: readonly ToolStep[];
  /** Withdrawn messages, kept apart from the draft until discarded. */
  restored: readonly RestoredMessage[];
  /** Pending terminal intents of protected plans, by plan id. */
  intentOverlays: Readonly<Record<string, IntentOverlay>>;
  /** The facts of the last resolved intent, as its reply gave them. */
  intentNotice: IntentNotice | null;
  intentAlert: IntentAlert | null;
  /**
   * The shown plan is protected but this client cannot control it now (a
   * profile, phase or agreement it lacks, or a fresh read still due after
   * a new agreement): it is shown, and nothing can be done with it here.
   */
  planReadOnly?: boolean;
}
/** A read the host asked for while writing a reply, as the user sees it. */
export interface ToolStep {
  id: string;
  /** The host's plain words for it (`ToolCall.label`), when it gave any. */
  label?: string;
  status: "running" | "done" | "failed";
}
export interface RestoredMessage {
  id: string;
  content: string;
}
export interface ReadPorts {
  manifest: readonly ManifestEntry[];
  request(call: ToolCall): Promise<unknown>;
  planning?: {
    template(planId: string, stepId: string): MaybePromise<ReadTemplate | null>;
    request(template: ReadTemplate): Promise<{
      rows: Record<string, unknown>;
      versions: Record<string, string>;
    }>;
  };
}
export interface ClientConfig {
  formSession?: FormSession;
  reads?: ReadPorts;
  versions?: MessageVersionPort;
  feedback?: FeedbackPort;
  plans?: RunnerPorts & {
    resume?(id: string): Promise<PlanRecord>;
    retryUndo?(id: string): Promise<PlanRecord>;
  };
  accountId: string;
  conversationId: string;
  platform: PlatformPorts;
  transport: TransportPort;
  storage?: StoragePort;
  beforeSend?: (reply: Reply) => MaybePromise<Reply | false | void>;
  contributions?: readonly ComposerContribution[];
  flowSource?: FlowSource;
  flowOperations?: readonly string[];
  tabs?: readonly FlowTab[];
}
export type ReplyInput = Reply extends infer R
  ? R extends { protocol: string }
    ? Omit<R, "protocol"> & { protocol?: string }
    : never
  : never;
/** How a reply ended: accepted, or not, and why when something was sent. */
export type ReplyOutcome =
  { accepted: true } | { accepted: false; problem?: Problem };
export class ConversationReadError extends Error {
  /** A validated typed problem from the response, without any raw body. */
  readonly problem?: Problem;
  constructor(
    readonly conversationId: string,
    readonly status: number,
    problem?: unknown,
  ) {
    super("Conversation read failed");
    this.name = "ConversationReadError";
    const candidate = problem as Partial<Problem> | null | undefined;
    if (
      candidate &&
      typeof candidate.id === "string" &&
      candidate.id !== "" &&
      PROBLEM_CODES.includes(candidate.code!)
    )
      this.problem = asProblem(candidate, candidate.id);
  }
}
export type ConversationReadResult =
  | { kind: "loaded"; conversationId: string; conversation: Conversation }
  | { kind: "missing"; conversationId: string; status: 404 | 410 }
  | { kind: "unavailable" | "superseded"; conversationId: string };
export interface WaypointClient {
  ready: Promise<void>;
  getSnapshot(): ClientSnapshot;
  subscribe(listener: () => void): () => void;
  on(listener: (event: WaypointEvent) => void): () => void;
  setDraft(value: string): Promise<void>;
  editMessage(messageId: string, content: string): Promise<void>;
  regenerate(messageId: string): Promise<void>;
  selectVersion(messageId: string, index: number): Promise<void>;
  /** Whether a `versions` port can edit, regenerate and select versions. */
  canChangeVersions(): boolean;
  /** Whether a `feedback` port takes ratings of replies. */
  canSendFeedback(): boolean;
  /**
   * Rates a finished reply through the `feedback` port, once per rating
   * while it is in flight, and resolves with whether the port took it.
   */
  sendFeedback(
    messageId: string,
    rating: FeedbackInput["rating"],
  ): Promise<boolean>;
  send(): Promise<void>;
  retry(id: string): Promise<void>;
  withdraw(id: string): Promise<void>;
  /** Appends a withdrawn message's content to the draft; the item stays. */
  editRestored(id: string): Promise<void>;
  /** Deletes a withdrawn message. */
  discardRestored(id: string): Promise<void>;
  dismiss(id: string): Promise<void>;
  reply(reply: ReplyInput): Promise<boolean>;
  /**
   * Sends a reply and says how it ended: accepted, or not, with the problem
   * the host or the network gave (none when nothing was sent). Resolves
   * after the conversation was read again, so a card shows what the host
   * holds.
   */
  replyOutcome(reply: ReplyInput): Promise<ReplyOutcome>;
  refresh(): Promise<ConversationReadResult>;
  switchConversation(id: string): Promise<ConversationReadResult>;
  report(problem: Problem): void;
  setPlan(plan: PlanRecord): void;
  confirmPlan(): Promise<void>;
  runPlan(id: string, confirmedDigest: string): Promise<void>;
  stopPlan(id?: string): void;
  /**
   * Declines a protected plan's initial review: an initial Cancel through
   * the intent port, never the normal replies route.
   */
  declinePlan(): Promise<void>;
  /**
   * Leaves a protected plan's decision: a Leave through the intent port,
   * acknowledging the evidence and versions of the adopted record.
   */
  leavePlan(id?: string): Promise<void>;
  /**
   * Redelivers a protected plan's pending intent exactly as it was first
   * built (status and Retry are one action): the host returns the stored
   * outcome if it applied, or applies it once.
   */
  checkIntentStatus(id?: string): Promise<void>;
  /** The same action as `checkIntentStatus`, named for Leave. */
  checkSavedChoice(id?: string): Promise<void>;
  /** The same action as `checkIntentStatus`, named for Keep. */
  checkKeepStatus(id?: string): Promise<void>;
  retryIntent(id?: string): Promise<void>;
  /**
   * What "Keep these changes" would confirm for a protected plan, read
   * synchronously from the adopted record, or why it is not possible.
   */
  keepChangesReview(id?: string): KeepChangesReviewResult;
  canKeepChanges(id?: string): boolean;
  /** Sends exactly the Keep a review returned by `keepChangesReview`. */
  keepChanges(review: KeepChangesReviewResult): Promise<void>;
  resumePlan(): Promise<void>;
  retryUndo(): Promise<void>;
  /** Reads the plan's record from the host again and shows it. */
  readPlan(id?: string): Promise<void>;
  loadFlows(): Promise<void>;
  selectFlowTab(tab: FlowTab): void;
  setFavourite(id: string, favourite: boolean): Promise<void>;
  /**
   * Runs a flow; resolves with the conversation this run opened when its
   * own navigation succeeded and is still shown, otherwise with nothing.
   */
  runFlow(id: string, values: Record<string, unknown>): Promise<string | void>;
  /** Whether `prepareFlow` can read a flow's document (the source has `load`). */
  canPrepareFlow(): boolean;
  /** Whether the reply being written can be stopped (`reply-stop`). */
  canStopReply(): boolean;
  /**
   * Stops the reply being written: its text so far stays, marked
   * `stopped` at once, and the host is asked once to stop writing it. Text
   * that still arrives for it is dropped. Does nothing without `reply-stop`.
   */
  stopReply(): Promise<void>;
  /**
   * Waits again for an overdue reply: the reply row says `writing` and
   * turns overdue again only after another 15 seconds without progress.
   */
  keepWaiting(): void;
  /** Waits again and reads the conversation again (`refresh()`). */
  retryReply(): Promise<void>;
  /**
   * Loads and validates a flow's document, to ask for its parameters, and
   * keeps it for the next `runFlow` of that flow in this conversation (a
   * failed run keeps it for a retry); without an id, forgets it. Resolves
   * with nothing when the source cannot load documents or without an id
   * (also when the client actions' code cannot load, which reports the
   * retryable `on-demand-load` problem). Rejects with what `load` or the
   * document's validation threw, and with `{ code: "refused", id:
   * "flow-prepare" }` when the conversation changed or a later
   * preparation (or forgetting) superseded this one: nothing is kept then.
   */
  prepareFlow(id?: string): Promise<Flow | void>;
  dispose(): void;
}
export function createMemoryStorage(asynchronous = false): StoragePort {
  const values = new Map<string, string>();
  return {
    get: (key) =>
      asynchronous
        ? Promise.resolve(values.get(key) ?? null)
        : (values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return asynchronous ? Promise.resolve() : undefined;
    },
    remove: (key) => {
      values.delete(key);
      return asynchronous ? Promise.resolve() : undefined;
    },
    compareAndSet: (key, expected, value) => {
      const matches = (values.get(key) ?? null) === expected;
      if (matches) values.set(key, value);
      return asynchronous ? Promise.resolve(matches) : matches;
    },
  };
}
const MAX_HELD_FRAMES = 128;
// Read frames whose handlers could not be loaded, kept to answer later.
const MAX_KEPT_READS = 16;
const STARTUP_STEP_BUDGET_MS = 10000;
// The stored recovery phases this client can represent.
const RECOVERY_PHASES: readonly RecoveryPhase[] = [
  "proposal",
  "initial-review",
  "forward-active",
  "readback",
  "completed",
  "cancelled",
  "left-known",
  "left-unconfirmed",
  "left-reopened",
];
// Stream recovery: at most five reopens after a failure, and a continuously
// healthy open of 10 s before the count starts again.
const STREAM_REOPEN_DELAYS_MS = [250, 500, 1000, 2000, 4000];
const STREAM_HEALTHY_MS = 10000;
// Without online notifications, a deferred attempt rechecks connectivity.
const STREAM_OFFLINE_RECHECK_MS = 4000;
const HYDRATION_BUDGET_MS = 1000;
const STARTUP_RETRY_FIRST_MS = 1000;
const STARTUP_RETRY_MAX_MS = 30000;
const budgetExceeded = Symbol("budget-exceeded");
type StartupFailure = "sign-in" | "unavailable" | "update-required";
function classifyStartupFailure(error: unknown): StartupFailure {
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === "sign-in") return "sign-in";
  if (code === "update-required") return "update-required";
  return "unavailable";
}
function validAnswer(answer: unknown): answer is {
  protocol: string;
  capabilities: string[];
  agreementId?: string;
} {
  if (typeof answer !== "object" || answer === null) return false;
  const value = answer as {
    protocol?: unknown;
    capabilities?: unknown;
    agreementId?: unknown;
  };
  return (
    typeof value.protocol === "string" &&
    value.protocol.trim() !== "" &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every((item) => typeof item === "string") &&
    (value.agreementId === undefined ||
      (typeof value.agreementId === "string" &&
        /^[A-Za-z0-9._~-]{1,128}$/.test(value.agreementId)))
  );
}
function negotiatedCapabilities(
  answer: {
    protocol: string;
    capabilities: string[];
  },
  offered: readonly string[],
): Capability[] {
  // A capability holds only when this client offered it and the host echoed
  // it; an echo alone never enables one.
  return withPrerequisites(
    CAPABILITIES.filter(
      (value) =>
        answer.capabilities.includes(value) &&
        offered.includes(value) &&
        (value !== "form-fill" || answer.protocol === "1.1"),
    ),
  );
}
export function createWaypointClient(config: ClientConfig): WaypointClient {
  const tabIds = new Set<string>();
  for (const tab of config.tabs ?? DEFAULT_FLOW_TABS) {
    const id = flowTabId(tab);
    if (
      tabIds.has(id) ||
      (typeof tab !== "string" &&
        DEFAULT_FLOW_TABS.includes(id as BuiltinFlowTab))
    )
      throw new Error("Invalid flow tab id");
    tabIds.add(id);
  }
  const listeners = new Set<() => void>();
  const observers = new Set<(event: WaypointEvent) => void>();
  let state: ClientSnapshot = {
    protocol: null,
    replyState: "none",
    conversationId: config.conversationId,
    conversation: null,
    conversationUnavailable: false,
    draft: "",
    pending: [],
    problem: null,
    announcement: 0,
    observerFailures: 0,
    capabilities: [],
    status: "unsubscribed",
    plan: null,
    flows: {},
    flowTab: flowTabId(
      (config.tabs ?? DEFAULT_FLOW_TABS)[0] ?? DEFAULT_FLOW_TABS[0]!,
    ),
    flowTabs: config.tabs ?? DEFAULT_FLOW_TABS,
    hints: [],
    sending: false,
    withdrawing: [],
    restored: [],
    toolSteps: [],
    streamUnavailable: false,
    intentOverlays: {},
    intentNotice: null,
    intentAlert: null,
  };
  let formRetry:
    { key: string; request: ReturnType<FormSession["begin"]> } | undefined;
  let replyTimer: unknown;
  // When the reply being written last made progress, and the text it had
  // then: progress is any change to its text, by a frame or by a read, so
  // it is measured the same on every transport.
  let replyProgress: { id: string; content: string; at: number } | undefined;
  // Until when the user chose to keep waiting for an overdue reply.
  let waitUntil: number | undefined;
  // Scopes replace the ad-hoc tokens: the client scope is aborted on dispose,
  // and the conversation scope, its child, on every navigation. Effects check
  // the signal of the scope that produced them where they land.
  const clientScope = createScope("client");
  const isDisposed = () => clientScope.signal.aborted;
  let negotiated = false;
  let conversationScope = createScope("conversation", clientScope.signal);
  const navigate = () => {
    conversationScope.abort();
    conversationScope = createScope("conversation", clientScope.signal);
  };
  let readGeneration = 0;
  // Every plan read owns a scope under the conversation scope. A newer
  // "latest" read (frame or recovery) aborts older ones, and any plan
  // publication aborts every read still pending, so a read publishes only if
  // nothing superseded it. Runner reads keep their record for execution but
  // lose publication.
  const pendingPlanReads = new Map<Scope, boolean>();
  const readScopes = new WeakMap<PlanRecord, ScopeSignal>();
  const beginPlanRead = (
    latest: boolean,
    parent: ScopeSignal = conversationScope.signal,
  ): Scope => {
    if (latest)
      for (const [read, isLatest] of pendingPlanReads)
        if (isLatest) {
          read.abort();
          pendingPlanReads.delete(read);
        }
    const read = createScope("plan-read", parent);
    pendingPlanReads.set(read, latest);
    return read;
  };
  const finishPlanRead = (read: Scope) => {
    const live = !read.signal.aborted;
    pendingPlanReads.delete(read);
    read.end();
    return live;
  };
  let flowLoad: Scope | undefined;
  let flowRun: Scope | undefined;
  let close: () => void = () => {};
  let sequence = -1;
  let storageWrites = Promise.resolve();
  let tabSelected = false;
  const protectedPlan = (plan: PlanRecord | null | undefined) =>
    !!plan?.recovery &&
    !!config.plans?.intent &&
    state.capabilities.includes("plan-recovery") &&
    plan.recovery.profile === "plan-recovery-v1" &&
    (RECOVERY_PHASES as readonly string[]).includes(plan.recovery.phase);
  // A protected plan this client cannot control: shown, never acted on.
  // After a new agreement gives plan recovery, each plan adopted before
  // stays read-only until a fresh read of it passes the gate. Every time a
  // plan turns read-only the epoch moves, so a response to a request sent
  // before never starts anything.
  const staleControl = new Set<string>();
  const readOnlyEpoch = new Map<string, number>();
  // Shared by every caller, so nobody can change it for the next.
  const readOnlyKeep = Object.freeze({
    disabled: "capabilityMissing",
  } as const);
  const readOnly = (plan: PlanRecord | null | undefined) =>
    !!plan?.recovery && (!protectedPlan(plan) || staleControl.has(plan.id));
  const update = (patch: Partial<ClientSnapshot>) => {
    if (isDisposed()) return;
    state = { ...state, ...patch };
    if (replyTimer !== undefined) {
      config.platform.clock.clearTimeout(replyTimer);
      replyTimer = undefined;
    }
    const now = config.platform.clock.now();
    const latest = state.conversation?.messages.at(-1);
    const streaming =
      latest?.role === "assistant" && latest.status === "writing";
    if (!streaming) replyProgress = undefined;
    else if (
      replyProgress?.id !== latest.id ||
      replyProgress.content !== latest.content
    )
      replyProgress = { id: latest.id, content: latest.content, at: now };
    const activityAt = streaming ? replyProgress?.at : undefined;
    state = {
      ...state,
      planReadOnly: readOnly(state.plan),
      replyState: replyRow({
        messages: state.conversation?.messages ?? [],
        pending: state.pending,
        now: config.platform.clock.now(),
        overdueAt: state.conversation?.replyOverdueAt ?? undefined,
        unavailable: state.conversation?.replyStatus === "unavailable",
        failed: state.conversation?.replyStatus === "failed",
        streamLost: state.streamUnavailable,
        activityAt,
        heldUntil: waitUntil,
      }),
    };
    if (state.replyState === "none") waitUntil = undefined;
    // A reply that stops arriving turns overdue on its own.
    if (state.replyState === "writing" && activityAt !== undefined) {
      const delay = Math.max(activityAt + REPLY_STALL_MS, waitUntil ?? 0) - now;
      if (delay > 0)
        replyTimer = config.platform.clock.setTimeout(() => {
          replyTimer = undefined;
          update({});
        }, delay);
    }
    const last = state.conversation?.messages.at(-1);
    if (state.replyState === "writing" && last?.role === "user") {
      const delay =
        Math.max(
          last.createdAt + 15000,
          state.conversation?.replyOverdueAt ?? 0,
          waitUntil ?? 0,
        ) - config.platform.clock.now();
      if (delay > 0)
        replyTimer = config.platform.clock.setTimeout(() => {
          replyTimer = undefined;
          update({});
        }, delay);
    }
    for (const fn of listeners) fn();
  };
  const emit = (event: WaypointEvent) => {
    for (const fn of observers) {
      try {
        fn(Object.freeze({ ...event }));
      } catch {
        update({ observerFailures: state.observerFailures + 1 });
      }
    }
  };
  const report = (problem: Problem) => {
    update({ problem, announcement: state.announcement + 1 });
    emit({ type: "problem", problemId: problem.id });
  };
  const key = (id: string) =>
    JSON.stringify(["waypoint", config.accountId, id]);
  // Saves are operations, not snapshots. Each change (set the draft, add a
  // row, claim or finish a send attempt, withdraw or remove a row) carries
  // the precondition it was made under, and is applied to the stored record
  // at commit time inside the per-key commit. An operation whose
  // precondition no longer holds is dropped. The in-memory view is the last
  // stored record this client observed plus its operations not yet
  // committed; loading a record only replaces that view and never writes.
  // Outbox rows never change: one row is one logical message, and its id is
  // the server's dedupe key, so resending a row is idempotent.
  interface OutboxRow extends PendingSend {
    // Attempts whose outcome is not settled: in flight, or ended without a
    // definite answer. Only an acknowledgement of the message or a definite
    // failure of that same attempt settles one.
    open: readonly string[];
  }
  interface Outbox {
    revision: number;
    draft: string;
    draftRevision: number;
    draftWriter: string;
    pending: readonly OutboxRow[];
    restored: readonly RestoredMessage[];
  }
  type Operation =
    | { kind: "draft"; value: string; seen: string }
    | { kind: "add"; row: OutboxRow }
    | { kind: "claim"; id: string; attempt: string }
    | { kind: "finish"; id: string; attempt: string; failure: Problem }
    | { kind: "withdraw"; id: string; restoredId: string }
    | { kind: "discard"; id: string }
    | { kind: "remove"; id: string };
  const empty: Outbox = {
    revision: 0,
    draft: "",
    draftRevision: 0,
    draftWriter: "",
    pending: [],
    restored: [],
  };
  // A draft version names its revision and the client that wrote it, so an
  // edit chained on this client's own earlier edit does not match another
  // client's edit that happens to reach the same revision.
  const writer = Math.random().toString(36).slice(2);
  const draftVersion = (record: Outbox) =>
    `${record.draftRevision}:${record.draftWriter}`;
  const definite = (failure: Problem | null) =>
    failure !== null && failure.code !== "in-doubt";
  // A row can be withdrawn only when no attempt is unsettled and the last
  // one was definitely refused: a message that may have been delivered is
  // only ever resent, under its own id.
  const settled = (row: OutboxRow) =>
    row.open.length === 0 && definite(row.failure);
  const draftWith = (record: Outbox, value: string): Outbox => ({
    ...record,
    draft: value,
    draftRevision: record.draftRevision + 1,
    draftWriter: writer,
  });
  const applyOperation = (record: Outbox, operation: Operation): Outbox => {
    // The draft is ordered by commit, not by any clock: each applied edit
    // advances the record's persisted draft revision, and the later commit
    // wins. Once this client is disposed, its edit lands only if nobody
    // changed the draft since the revision it last saw.
    if (operation.kind === "draft")
      return !isDisposed() || draftVersion(record) === operation.seen
        ? draftWith(record, operation.value)
        : record;
    if (operation.kind === "add")
      return record.pending.some((row) => row.id === operation.row.id)
        ? record
        : { ...record, pending: [...record.pending, operation.row] };
    if (operation.kind === "discard")
      return {
        ...record,
        restored: record.restored.filter((item) => item.id !== operation.id),
      };
    const current = record.pending.find((row) => row.id === operation.id);
    if (!current) return record;
    const without = record.pending.filter((row) => row !== current);
    // Withdrawing moves a settled row's content into its own restored item
    // and removes the row in the same commit. It never touches the draft,
    // so no draft edit can overwrite it.
    if (operation.kind === "withdraw")
      return settled(current)
        ? {
            ...record,
            pending: without,
            restored: [
              ...record.restored,
              { id: operation.restoredId, content: current.content },
            ],
          }
        : record;
    if (operation.kind === "remove") return { ...record, pending: without };
    const next: OutboxRow =
      operation.kind === "claim"
        ? {
            ...current,
            open: [...current.open, operation.attempt],
            failure: null,
          }
        : {
            ...current,
            open: definite(operation.failure)
              ? current.open.filter((attempt) => attempt !== operation.attempt)
              : current.open,
            failure: operation.failure,
          };
    return {
      ...record,
      pending: record.pending.map((row) => (row === current ? next : row)),
    };
  };
  const readOutbox = (value: StoredRecord | null): Outbox => ({
    revision: revisionOf(value),
    draft: typeof value?.draft === "string" ? value.draft : "",
    draftRevision:
      typeof value?.draftRevision === "number" ? value.draftRevision : 0,
    draftWriter:
      typeof value?.draftWriter === "string" ? value.draftWriter : "",
    pending: (Array.isArray(value?.pending) ? value.pending : [])
      .filter(isPending)
      .map((row) => {
        const open = (row as Partial<OutboxRow>).open;
        return {
          ...row,
          open: Array.isArray(open)
            ? open.filter((a): a is string => typeof a === "string")
            : [],
        };
      }),
    restored: (Array.isArray(value?.restored) ? value.restored : []).filter(
      (item): item is RestoredMessage =>
        typeof (item as RestoredMessage | null)?.id === "string" &&
        typeof (item as RestoredMessage).content === "string",
    ),
  });
  let stored = empty;
  let storedKey = key(config.conversationId);
  let queued: Operation[] = [];
  // Operations whose effect is shown only once committed, and those that
  // were committed; an uncommitted one is dropped, changing nothing.
  let committing: Operation[] = [];
  const landed = new WeakSet<Operation>();
  const inFlight = new Set<string>();
  let view = empty;
  const derive = () => {
    view = queued.reduce(applyOperation, stored);
    // A row the transcript already acknowledges is removed, wherever the
    // record it came from was loaded.
    const acknowledged = view.pending.filter((row) =>
      state.conversation?.messages.some(
        (message) => message.clientMessageId === row.id,
      ),
    );
    if (acknowledged.length) {
      for (const row of acknowledged)
        queued.push({ kind: "remove", id: row.id });
      view = queued.reduce(applyOperation, stored);
      void persist();
    }
    update({
      draft: view.draft,
      restored: view.restored,
      // A row without a settled outcome, and not being sent here, may or may
      // not have been delivered.
      pending: view.pending.map((row) => ({
        id: row.id,
        content: row.content,
        failure: row.open.some((attempt) => inFlight.has(attempt))
          ? null
          : row.open.length === 0 && row.failure
            ? row.failure
            : { code: "in-doubt", id: row.id },
        ...(row.extensions ? { extensions: row.extensions } : {}),
      })),
    });
  };
  const record = (operation: Operation) => {
    queued.push(operation);
    derive();
  };
  const viewRow = (id: string) => view.pending.find((row) => row.id === id);
  // Edit time, strictly after the draft this client last saw.
  const editTime = () => ({ seen: draftVersion(view) });
  const persist = () => {
    if (isDisposed()) return storageWrites;
    const port = config.storage;
    const at = storedKey;
    storageWrites = storageWrites.then(async () => {
      const batch = [...queued, ...committing];
      committing = [];
      let next = stored;
      let committed: number | undefined;
      try {
        if (port)
          // The commit code loads with the first write; a failed load is
          // a failed write.
          committed = await (
            await import("./storage-commit")
          ).commitRecord(port, at, (current) => {
            let read = readOutbox(current);
            // A store that returns an older record than this client wrote
            // has lost writes; build on what this client last stored.
            if (read.revision < stored.revision) read = stored;
            next = batch.reduce(applyOperation, read);
            return next === read && read !== stored ? null : { ...next };
          });
        else {
          next = batch.reduce(applyOperation, stored);
          if (next !== stored)
            next = { ...next, revision: stored.revision + 1 };
        }
      } catch {
        report({ code: "unavailable", id: "storage-write" });
        return;
      }
      if (at !== storedKey) return;
      stored = { ...next, revision: committed ?? next.revision };
      for (const operation of batch) landed.add(operation);
      queued = queued.filter((operation) => !batch.includes(operation));
      if (!isDisposed()) derive();
    });
    return storageWrites;
  };
  const hydrate = async (id: string, token: ScopeSignal) => {
    try {
      const raw = await config.storage?.get(key(id));
      if (!raw || token.aborted || key(id) !== storedKey) return;
      const loaded = readOutbox(JSON.parse(raw) as StoredRecord);
      // A record older than one this client already observed is not loaded.
      if (loaded.revision < stored.revision) return;
      stored = loaded;
      derive();
    } catch {
      report({ code: "unavailable", id: "storage-read" });
    }
  };
  let knownMode: "ordinary" | "form-fill" | undefined;
  let heldFrames: { frame: Frame; origin: ScopeSignal }[] = [];
  const heldSequences = new Set<number>();
  let streamStopped = false;
  let releaseStartup!: () => void;
  const startupStopped = new Promise<void>((resolve) => {
    releaseStartup = resolve;
  });
  const formMode = () => knownMode === "form-fill";
  const restricted = () => knownMode !== "ordinary";
  const sensitiveFrame = (frame: Frame) =>
    [
      "tool.call",
      "planning-read",
      "plan.draft",
      "plan.final",
      "plan.step",
    ].includes(frame.type);
  const startFrame = async (frame: Frame, scope: ScopeSignal) => {
    try {
      await processFrame(frame, scope);
    } catch {
      if (!isDisposed() && !scope.aborted)
        report({ code: "unavailable", id: "frame-dispatch" });
    }
  };
  const releaseFrames = () => {
    const frames = heldFrames;
    heldFrames = [];
    heldSequences.clear();
    for (const { frame, origin } of frames) {
      // A frame from a closed connection does no work and leaves the current
      // connection's sequence alone.
      if (origin.aborted) continue;
      sequence = Math.max(sequence, frame.sequence);
      if (formMode()) processFrame(frame, origin);
      else startFrame(frame, origin);
    }
  };
  let appliedRead:
    | {
        scope: ScopeSignal;
        token: number;
        result: Extract<ConversationReadResult, { kind: "loaded" | "missing" }>;
      }
    | undefined;
  // What a stream said about an assistant message, by id: the binding whose
  // frames made it, the status they gave it (writing, an end frame's, or
  // none once dropped), the read generation when that was decided, and the
  // last read's own status. A read asked for earlier leaves the message as
  // it is; a binding that ends drops its marks back to the read's status.
  type Status = Message["status"];
  interface Mark {
    binding?: StreamBinding;
    status?: Status;
    at: number;
    read?: Status;
    reopen?: number;
  }
  const marks = new Map<string, Mark>();
  const patch = (id: string, change: (message: Message) => Partial<Message>) =>
    state.conversation &&
    update({
      conversation: {
        ...state.conversation,
        messages: state.conversation.messages.map((message) =>
          message.id === id ? { ...message, ...change(message) } : message,
        ),
      },
    });
  const setStatus = (id: string, status: Status) =>
    patch(id, () => ({ status }));
  const markAs = (id: string, status: Status, read?: Status) =>
    marks.set(id, { binding: stream, status, at: readGeneration, read });
  // After a gap in a stream, the first read asked for decides what the gap
  // ended: a reply it gives no status is no longer shown as being written.
  const gap = (binding: StreamBinding) => {
    for (const mark of marks.values())
      if (mark.binding === binding && mark.status === "writing")
        mark.reopen = readGeneration;
  };
  const dropMarks = (binding?: StreamBinding) => {
    for (const [id, mark] of marks)
      if (mark.binding === binding) {
        marks.delete(id);
        setStatus(id, mark.read);
      }
  };
  // Replies the user stopped: a read that still says the host is writing
  // shows them stopped, and text that arrives for them is dropped.
  const stopped = new Set<string>();
  const withStops = (message: Message): Message =>
    stopped.has(message.id) && message.status === "writing"
      ? { ...message, status: "stopped" }
      : message;
  const withMarks = (conversation: Conversation, token: number) => ({
    ...conversation,
    messages: shownWithMarks(conversation, token).map(withStops),
  });
  const shownWithMarks = (conversation: Conversation, token: number) => {
    const before = state.conversation?.messages ?? [];
    return conversation.messages.map((message) => {
      const mark = marks.get(message.id);
      if (!mark || mark.binding !== stream) return message;
      if (mark.reopen !== undefined && token > mark.reopen) {
        mark.reopen = undefined;
        if (!message.status) mark.status = undefined;
      }
      if (!mark.status) return message;
      if (token <= mark.at)
        return before.find((shown) => shown.id === message.id) ?? message;
      mark.read = message.status;
      if (message.status && message.status !== "writing") {
        mark.status = message.status;
        mark.at = token;
      }
      return { ...message, status: mark.status };
    });
  };
  // The read handlers' code loads with the first read frame. Frames whose
  // load failed are kept, in order, and handled again by a later read frame
  // or a refresh, while their connection is current. A kept frame handled
  // again never retries the others: failing frames would retry each other
  // without end. They stay in the order they first failed in; past the
  // bound the earliest is dropped.
  let keptReads: { frame: Frame; scope: ScopeSignal }[] = [];
  const keptFrames = new WeakMap<Frame, number>();
  let keptCount = 0;
  const retryKeptReads = (readFailed = false) => {
    const kept = keptReads;
    keptReads = [];
    for (const entry of kept)
      processFrame(entry.frame, entry.scope, readFailed);
  };
  // `owner` is set when a connection asked for the read: its result is then
  // dropped if that connection has closed by the time it lands.
  const readConversation = async (
    owner?: ScopeSignal,
    failed?: (cause: StartupFailure) => void,
  ): Promise<ConversationReadResult> => {
    if (streamStopped)
      return { kind: "unavailable", conversationId: state.conversationId };
    const token = ++readGeneration;
    const scope = conversationScope.signal;
    const id = state.conversationId;
    const bound = agreement;
    try {
      const conversation = await config.transport.read(id, requestContext());
      if (scope.aborted || owner?.aborted || isDisposed())
        return { kind: "superseded", conversationId: id };
      if (
        token !== readGeneration &&
        (knownMode !== undefined ||
          (appliedRead?.scope === scope &&
            appliedRead.token > token &&
            appliedRead.result.kind === "missing"))
      )
        return { kind: "superseded", conversationId: id };
      for (const message of conversation.messages)
        if (message.clientMessageId && viewRow(message.clientMessageId))
          queued.push({ kind: "remove", id: message.clientMessageId });
      const result: Extract<ConversationReadResult, { kind: "loaded" }> = {
        kind: "loaded",
        conversationId: id,
        conversation,
      };
      appliedRead = { scope, token, result };
      boundResponse(bound);
      knownMode = conversation.mode === "form-fill" ? "form-fill" : "ordinary";
      // Held frames start once the conversation they belong to is shown, so
      // no subscriber sees their work before it, and also when a subscriber
      // throws on that snapshot.
      try {
        update({
          conversation: withMarks(conversation, token),
          conversationUnavailable: false,
          ...(["conversation-read", "conversation-unavailable"].includes(
            state.problem?.id ?? "",
          )
            ? { problem: null }
            : {}),
        });
        derive();
      } finally {
        releaseFrames();
      }
      if (conversation.mode === "form-fill") {
        for (const message of conversation.messages)
          for (const block of message.blocks)
            if (block.type === "form.fill")
              config.formSession?.receive(block.body);
      }
      await persist();
      return result;
    } catch (error) {
      if (isDisposed() || scope.aborted)
        return { kind: "superseded", conversationId: id };
      if (token !== readGeneration)
        return { kind: "superseded", conversationId: id };
      failed?.(
        error instanceof ConversationReadError && error.status === 401
          ? "sign-in"
          : error instanceof ConversationReadError
            ? classifyStartupFailure(error.problem)
            : classifyStartupFailure(error),
      );
      if (isAgreementRefusal(error)) {
        // The binding owner renegotiates and reads again; an older agreement's
        // refusal is one ordinary failed read.
        const owned = bound !== undefined && bound === agreement;
        void bindingRefused(bound);
        if (!owned) report(readProblem(error, "conversation-read"));
        return { kind: "unavailable", conversationId: id };
      }
      if (
        error instanceof ConversationReadError &&
        error.conversationId === id &&
        (error.status === 404 || error.status === 410)
      ) {
        const result: Extract<ConversationReadResult, { kind: "missing" }> = {
          kind: "missing",
          conversationId: id,
          status: error.status,
        };
        appliedRead = { scope, token, result };
        update({ conversation: null, conversationUnavailable: true });
        report({ code: "unavailable", id: "conversation-read" });
        return result;
      }
      report(readProblem(error, "conversation-read"));
      return { kind: "unavailable", conversationId: id };
    }
  };
  let reading: { scope: ScopeSignal; done: Promise<unknown> } | undefined;
  let latestRead:
    | {
        scope: ScopeSignal;
        id: string;
        result: Promise<ConversationReadResult>;
      }
    | undefined;
  const refresh = async (
    owner?: ScopeSignal,
  ): Promise<ConversationReadResult> => {
    retryKeptReads();
    const scope = conversationScope.signal;
    const id = state.conversationId;
    const previousApplied = appliedRead;
    let resolve!: (result: ConversationReadResult) => void;
    const read = {
      scope,
      id,
      result: new Promise<ConversationReadResult>((done) => {
        resolve = done;
      }),
    };
    latestRead = read;
    const done = readConversation(owner);
    reading = { scope, done };
    void done.then(resolve).finally(() => {
      if (reading?.done === done) reading = undefined;
    });
    let current = read;
    for (;;) {
      const result = await current.result;
      if (isDisposed() || scope.aborted || id !== state.conversationId)
        return { kind: "superseded", conversationId: id };
      if (latestRead === current) {
        if (
          result.kind === "unavailable" &&
          appliedRead !== previousApplied &&
          appliedRead?.scope === scope &&
          appliedRead.result.conversationId === id
        )
          return appliedRead.result;
        return result;
      }
      if (latestRead?.scope !== scope || latestRead.id !== id)
        return { kind: "superseded", conversationId: id };
      current = latestRead;
    }
  };
  // While the read handlers load for a read frame, it and every frame after
  // it wait, so they are handled in arrival order once the load settles.
  let readsLoaded = false;
  // Each failed load is one problem for the user, however many frames it
  // held: set by a failed load, cleared by its first report.
  let unreported = false;
  const gatedFrames: { frame: Frame; scope: ScopeSignal }[] = [];
  const processFrame = (
    frame: Frame,
    scope: ScopeSignal,
    readFailed = false,
  ) => {
    if (isDisposed() || scope.aborted) return;
    const gated = gatedFrames.length;
    if (
      !readFailed &&
      (gated ||
        (!readsLoaded &&
          config.reads &&
          !formMode() &&
          (frame.type === "tool.call" || frame.type === "planning-read")))
    ) {
      gatedFrames.push({ frame, scope });
      if (gated) return;
      const open = (loaded?: unknown) => {
        readsLoaded = loaded !== false;
        if (!readsLoaded) unreported = true;
        if (readsLoaded && state.problem?.id === STREAM_READS_UNAVAILABLE.id)
          update({ problem: null });
        for (const held of gatedFrames.splice(0))
          processFrame(held.frame, held.scope, !readsLoaded);
      };
      void loadReadHandlers().then(open, () => open(false));
      return;
    }
    handleFrame(frame, scope, readFailed);
  };
  const handleFrame = (
    frame: Frame,
    scope: ScopeSignal,
    readFailed: boolean,
  ) => {
    if (isDisposed() || scope.aborted) return;
    if (formMode() && sensitiveFrame(frame)) {
      report({ code: "refused", id: "form-tools" });
      return;
    }
    if (
      frame.type === "block" &&
      frame.block.type === "form.fill" &&
      formMode()
    )
      config.formSession?.receive(frame.block.body);
    if (frame.type === "tool.call" || frame.type === "planning-read") {
      if (!keptFrames.has(frame)) retryKeptReads(readFailed);
      const conversationId = state.conversationId;
      const call = frame.type === "tool.call" ? frame.call : undefined;
      // A step keeps its place: it is added once, then its status changes.
      const step = (status: ToolStep["status"]) => {
        if (!call || !current()) return;
        const next = {
          id: call.id,
          ...(call.label && { label: call.label }),
          status,
        };
        const at = state.toolSteps.findIndex((shown) => shown.id === call.id);
        update({
          toolSteps:
            at < 0
              ? [...state.toolSteps, next]
              : state.toolSteps.map((shown, index) =>
                  index === at ? next : shown,
                ),
        });
      };
      const current = () =>
        !isDisposed() &&
        !scope.aborted &&
        conversationId === state.conversationId;
      step("running");
      return (async () => {
        if (readFailed) throw { ...STREAM_READS_UNAVAILABLE };
        const reads = config.reads;
        if (!reads)
          return report({ code: "invalid-read", id: "read-unavailable" });
        // Once loaded, the read starts in this turn, in arrival order.
        const answered = await (readCode ?? (await loadReads())).answerRead(
          frame,
          reads,
          conversationId,
          current,
          report,
          (reply) => sendReply(scope, reply),
        );
        step(answered === false ? "failed" : "done");
      })().catch((error: unknown) => {
        step("failed");
        if (!current()) return;
        if ((error as Problem | undefined)?.id !== STREAM_READS_UNAVAILABLE.id)
          return report({ code: "invalid-read", id: "read-failed" });
        // Kept for the stream binding, which outlives a reconnect; past the
        // bound the oldest is dropped and the problem stays shown.
        if (!keptFrames.has(frame)) keptFrames.set(frame, keptCount++);
        keptReads.push({ frame, scope: stream?.scope.signal ?? scope });
        keptReads.sort(
          (a, b) => keptFrames.get(a.frame)! - keptFrames.get(b.frame)!,
        );
        if (keptReads.length > MAX_KEPT_READS) keptReads.shift();
        if (readFailed) {
          if (!unreported) return;
          unreported = false;
        }
        report({ ...STREAM_READS_UNAVAILABLE });
      });
    }
    if (
      (frame.type === "plan.draft" || frame.type === "plan.final") &&
      config.plans
    ) {
      // The read belongs to the connection that delivered the frame.
      return showPlan(frame.plan.id, scope);
    }
    if (frame.type === "problem") {
      report(frame.problem);
      return;
    }
    const mark = "messageId" in frame ? marks.get(frame.messageId) : undefined;
    const shown =
      "messageId" in frame &&
      state.conversation?.messages.find((m) => m.id === frame.messageId);
    // A new reply starts: what a read said about the reply before it
    // (failed, unavailable) no longer describes the reply now.
    if (
      frame.type === "message.start" &&
      frame.role === "assistant" &&
      state.conversation &&
      (state.conversation.replyStatus === "failed" ||
        state.conversation.replyStatus === "unavailable")
    )
      update({
        conversation: { ...state.conversation, replyStatus: undefined },
      });
    if (frame.type === "text.delta" && stopped.has(frame.messageId)) return;
    if (frame.type === "text.delta") {
      // A reply that went on after its mark was dropped is written again.
      const again = mark && mark.binding === stream && !mark.status;
      if (again) markAs(frame.messageId, "writing", mark.read);
      patch(frame.messageId, (message) => ({
        content: message.content + frame.text,
        ...(again && { status: "writing" as const }),
      }));
    }
    if (
      frame.type === "message.start" &&
      frame.role === "assistant" &&
      (!shown || shown.role === "assistant")
    ) {
      // A start begins the whole text of a version: what is shown is
      // replaced, never joined.
      stopped.delete(frame.messageId);
      markAs(frame.messageId, "writing", mark?.read);
      patch(frame.messageId, () => ({
        status: "writing",
        content: "",
        blocks: [],
      }));
    }
    if (
      frame.type === "message.end" &&
      shown &&
      ["completed", "failed", "unavailable"].includes(frame.status) &&
      (mark
        ? mark.binding === stream
        : !shown.status || shown.status === "writing")
    ) {
      markAs(frame.messageId, frame.status, mark?.read ?? shown.status);
      setStatus(frame.messageId, frame.status);
    }
    if (frame.type === "message.start" && state.conversation && !shown) {
      update({
        conversation: {
          ...state.conversation,
          messages: [
            ...state.conversation.messages,
            {
              id: frame.messageId,
              role: frame.role,
              content: "",
              blocks: [],
              createdAt: config.platform.clock.now(),
              ...(frame.role === "assistant" && { status: "writing" as const }),
            },
          ],
        },
      });
    }
    if (frame.type === "stale" || frame.type === "message.end")
      void refresh(scope);
  };
  const connect = (continued?: StreamBinding) => {
    close();
    // Frames buffered by an earlier connection belong to it; they are dropped
    // so their sequence numbers cannot shadow the new connection's.
    heldFrames = heldFrames.filter((held) => !held.origin.aborted);
    heldSequences.clear();
    for (const held of heldFrames) heldSequences.add(held.frame.sequence);
    sequence = -1;
    // A reopen by recovery continues its stream binding; any other connect
    // starts a new one, retiring the previous binding's episode and state.
    const current = continued ?? newStream();
    if (continued) gap(continued);
    // The connection's scope is a child of the stream binding: closing,
    // rebinding, navigating or disposing aborts it and unsubscribes.
    const connection = createScope("connection", current.scope.signal);
    let unsubscribe = () => {};
    onAbort(connection.signal, () => unsubscribe());
    close = () => connection.abort();
    // A subscription opened under an agreement is recovered by the client;
    // others keep their adapter's own reconnect.
    const bound = agreement;
    let healthy = false;
    unsubscribe = config.transport.subscribe(
      state.conversationId,
      (event) => {
        if (connection.signal.aborted) return;
        if (event.type === "invalidate") return invalidated();
        if (event.type === "status") {
          const failed =
            event.status === "reconnecting" || event.status === "unavailable";
          if (failed) gap(current);
          if (bound !== undefined && failed) {
            // Closed now, before the adapter can retry the old URL.
            connection.abort();
            update({ status: "reconnecting" });
            emit({
              type: "transport.status",
              conversationId: state.conversationId,
            });
            return streamFailed(current);
          }
          if (event.status === "open" || event.status === "reconnecting") {
            sequence = -1;
            void refresh(connection.signal);
          }
          if (bound !== undefined && event.status === "open" && !healthy) {
            healthy = true;
            // An established stream ends the report of an earlier failure.
            if (state.problem?.id === "stream") update({ problem: null });
            // Only a continuously healthy open ends the failure episode.
            const timer = config.platform.clock.setTimeout(() => {
              if (!connection.signal.aborted) current.failures = 0;
            }, STREAM_HEALTHY_MS);
            onAbort(connection.signal, () =>
              config.platform.clock.clearTimeout(timer),
            );
          }
          update({ status: event.status });
          emit({
            type: "transport.status",
            conversationId: state.conversationId,
          });
          return;
        }
        const frame = event.frame;
        if (frame.sequence <= sequence) return;
        sequence = frame.sequence;
        if (frame.protocol !== state.protocol) {
          report({ code: "update-required", id: "stream-version" });
          return;
        }
        if (sensitiveFrame(frame)) {
          if (knownMode === undefined) {
            if (!heldSequences.has(frame.sequence)) {
              heldSequences.add(frame.sequence);
              heldFrames.push({ frame, origin: connection.signal });
              if (heldFrames.length >= MAX_HELD_FRAMES) {
                streamStopped = true;
                update({ conversationUnavailable: true });
                releaseStartup();
                navigate();
                close();
                heldFrames = [];
                heldSequences.clear();
                report({ code: "unavailable", id: "conversation-unavailable" });
              }
            }
          } else if (formMode()) processFrame(frame, connection.signal);
          else startFrame(frame, connection.signal);
        } else processFrame(frame, connection.signal);
      },
      requestContext(),
    );
    if (connection.signal.aborted) unsubscribe();
  };
  // Each stream binding owns its failure count, give-up state and at most
  // one recovery episode; transitions are listed in the phase notes' table.
  // Every outcome of an episode lands in its binding, and a retired binding
  // aborts its episode.
  interface StreamBinding {
    scope: Scope;
    failures: number;
    gaveUp: boolean;
    episode?: Scope;
    online?: () => void;
    // The renegotiation that created this binding, if any, and its first
    // read: outcomes arriving before that read settles wait for it.
    createdBy?: Promise<unknown>;
    settling?: Promise<unknown>;
  }
  let stream: StreamBinding | undefined;
  const newStream = (): StreamBinding => {
    stream?.scope.abort();
    dropMarks(stream);
    stream = {
      scope: createScope("stream", conversationScope.signal),
      failures: 0,
      gaveUp: false,
      createdBy: rebinding,
    };
    // Flags describe the current binding only.
    if (state.streamUnavailable) update({ streamUnavailable: false });
    return stream;
  };
  const wait = (
    ms: number,
    signal: ScopeSignal,
    early?: (go: () => void) => void,
  ) =>
    new Promise<void>((resolve) => {
      const timer = config.platform.clock.setTimeout(resolve, ms);
      early?.(resolve);
      onAbort(signal, () => {
        config.platform.clock.clearTimeout(timer);
        resolve();
      });
    });
  const streamFailed = (binding: StreamBinding) => {
    if (binding !== stream || binding.scope.signal.aborted || binding.gaveUp)
      return;
    if (binding.episode && !binding.episode.signal.aborted) return;
    const episode = createScope("recovery", binding.scope.signal);
    binding.episode = episode;
    const signal = episode.signal;
    const stop = (code: StartupFailure | "unavailable", gaveUp: boolean) => {
      binding.gaveUp = gaveUp;
      if (gaveUp) dropMarks(binding);
      update({ status: "unavailable", streamUnavailable: gaveUp });
      report({ code, id: "stream" });
    };
    void (async () => {
      for (;;) {
        if (binding.failures >= STREAM_REOPEN_DELAYS_MS.length)
          return stop("unavailable", true);
        await wait(STREAM_REOPEN_DELAYS_MS[binding.failures]!, signal);
        // While offline an attempt waits for connectivity without being
        // spent; regaining it resets the count.
        let offline = false;
        while (!signal.aborted && !config.platform.online()) {
          offline = true;
          await wait(STREAM_OFFLINE_RECHECK_MS, signal, (go) => {
            binding.online = go;
          });
        }
        binding.online = undefined;
        if (offline) binding.failures = 0;
        if (signal.aborted) return;
        binding.failures++;
        const bound = agreement;
        let cause: StartupFailure = "unavailable";
        const result = await readConversation(signal, (failure) => {
          cause = failure;
        });
        // An outcome waits for this binding's own first read to settle.
        await binding.settling;
        // A newer renegotiation owns recovery; the one that created this
        // binding does not.
        if (
          signal.aborted ||
          binding !== stream ||
          bound !== agreement ||
          (rebinding !== undefined && rebinding !== binding.createdBy) ||
          bindingStalled
        )
          return;
        if (result.kind === "loaded") {
          // Ownership passes to the reopened connection before it can fail.
          binding.episode = undefined;
          return connect(binding);
        }
        if (result.kind === "missing") return;
        if (cause !== "unavailable") return stop(cause, false);
      }
    })().finally(() => {
      if (binding.episode === episode) binding.episode = undefined;
      episode.end();
    });
  };
  const streamOnline = () => {
    const binding = stream;
    if (!binding || binding.scope.signal.aborted) return;
    binding.failures = 0;
    binding.online?.();
    if (binding.gaveUp) {
      binding.gaveUp = false;
      update({ streamUnavailable: false });
      streamFailed(binding);
    }
  };
  // Hints coalesce per conversation scope with whatever read is running for
  // it, however that read started: at most one more read follows it.
  let trailing: ScopeSignal | undefined;
  const invalidated = () => {
    const scope = conversationScope.signal;
    const running = reading?.scope === scope ? reading.done : undefined;
    if (!running) return void refresh();
    if (trailing === scope) return;
    trailing = scope;
    void running.finally(() => {
      if (trailing !== scope) return;
      trailing = undefined;
      if (!scope.aborted) invalidated();
    });
  };
  const dispatch = async (id: string) => {
    const scope = conversationScope.signal;
    const conversationId = state.conversationId;
    const bound = agreement;
    const current = viewRow(id);
    if (!current) return;
    update({ sending: true });
    const attempt = Math.random().toString(36).slice(2);
    inFlight.add(attempt);
    // Nothing is sent until the claim is committed; a claim that cannot be
    // committed sends nothing.
    const claim: Operation = { kind: "claim", id, attempt };
    record(claim);
    await persist();
    const row = queued.includes(claim)
      ? undefined
      : stored.pending.find((p) => p.id === id);
    const finish = (failure: Problem) => {
      record({ kind: "finish", id, attempt, failure });
      return persist();
    };
    if (queued.includes(claim)) {
      // Not committed: the message stays unsent, and can be withdrawn.
      queued = queued.filter((operation) => operation !== claim);
      record({
        kind: "finish",
        id,
        attempt,
        failure: { code: "unavailable", id },
      });
    }
    try {
      if (isDisposed() || scope.aborted || !row?.open.includes(attempt)) return;
      if (state.conversationUnavailable) {
        await finish({ code: "unavailable", id });
        return;
      }
      await config.transport.send(
        {
          kind: "message",
          protocol: state.protocol!,
          clientReplyId: id,
          clientMessageId: id,
          content: row.content,
          ...(row.extensions ? { extensions: row.extensions } : {}),
        },
        conversationId,
        requestContext(bound),
      );
      if (scope.aborted) return;
      boundResponse(bound);
      inFlight.delete(attempt);
      update({ problem: null });
      record({ kind: "remove", id });
      await persist();
      await refresh();
    } catch (error) {
      if (scope.aborted) return;
      const problem = asProblem(error, id);
      // A refused message stays in the outbox with its id; only an explicit
      // retry sends it again, under the replacement agreement. After an
      // unknown outcome a retry resends the same row under the same id.
      inFlight.delete(attempt);
      report(problem);
      await finish(problem);
      if (problem.code === "agreement-expired") bindingRefused(bound);
    } finally {
      if (inFlight.delete(attempt)) derive();
      if (!scope.aborted) update({ sending: false });
    }
  };
  // A protected plan record passes one monotone gate wherever it comes from:
  // a lower revision never regresses facts, an equal revision must be the
  // same record, and a record for another conversation or generation, an
  // unknown phase or a profile without the negotiated capability is a peer
  // error that keeps the stored record.
  // The gate remembers every protected plan it adopted, per conversation and
  // plan, for the client's lifetime: showing another plan, or a record that
  // omits its recovery view, never erases that history.
  const adopted = new Map<
    string,
    { generation: string; revision: number; bytes: string; record: PlanRecord }
  >();
  const gateKey = (planId: string) =>
    JSON.stringify([state.conversationId, planId]);
  const recoveryGate = (plan: PlanRecord): "adopt" | "ignore" | "error" => {
    const stored = adopted.get(gateKey(plan.id));
    const view = plan.recovery;
    // A protected plan never silently becomes a legacy one.
    if (!view) return stored ? "error" : "adopt";
    // A profile, phase or capability this client lacks is shown read-only;
    // the monotone rules hold for every profile, so their fields must be
    // there and well typed.
    if (
      typeof view.generation !== "string" ||
      !Number.isSafeInteger(view.revision) ||
      view.revision < 0 ||
      view.conversationId !== state.conversationId ||
      (stored && stored.generation !== view.generation)
    )
      return "error";
    if (!stored || view.revision > stored.revision) return "adopt";
    if (view.revision < stored.revision) return "ignore";
    return JSON.stringify(plan) === stored.bytes ? "ignore" : "error";
  };
  const remember = (plan: PlanRecord) => {
    if (protectedPlan(plan)) preload();
    if (plan.recovery)
      adopted.set(gateKey(plan.id), {
        generation: plan.recovery.generation,
        revision: plan.recovery.revision,
        bytes: JSON.stringify(plan),
        record: JSON.parse(JSON.stringify(plan)) as PlanRecord,
      });
  };
  const adoptedRecord = (id: string) => adopted.get(gateKey(id))?.record;
  // A terminal action captures synchronously, before any await, the adopted
  // record it saw (records are never changed once adopted); the intent chunk
  // builds the request from exactly that record.

  // The intent client is a lazy chunk. If it cannot be loaded, the action
  // reports a fixed retryable problem and changes nothing else; a local
  // inhibition already applied by the caller stays.
  // Terminal intents: the pending overlay and its delivery live in the lazy
  // intent chunk. A press waits for the chunk within its own 10 s budget;
  // presses made during the load are decided together when it arrives, and
  // one whose budget ended first sends nothing.
  let machine: IntentMachine | undefined;
  // The press of each plan waiting for the chunk: a later press is decided
  // against it at once (an identical or higher press is let through, any
  // other is refused), and status joins its completion.
  const reserved = new Map<
    string,
    { kind: IntentKind; key: string; settled: Promise<void> }
  >();
  const rank = (kind: string) => "lkcs".indexOf(kind[0]!);
  // New consent waits while a terminal intent of the plan is pending.
  const refusedPending = (id: string) =>
    (machine?.pending(id) || reserved.has(id)) && (refuse(), true);
  const refuse = () => report({ code: "refused", id: "intentPending" });
  // A protected plan loads the intent chunk ahead of its first terminal
  // action; a failed load is retried by the next review, adoption or press.
  let loadFailed = false;
  let preloading: Promise<unknown> | undefined;
  const preload = () =>
    (preloading ??= import("./intent")
      .then(
        (module) => {
          machine ??= module.createIntentMachine({
            config,
            publish: update,
            client,
            scope: () => conversationScope.signal,
            report: report as IntentContext["report"],
            // The core's own read ownership: a newer plan read or a retired
            // scope supersedes this one, and only a live read is published.
            read(id) {
              const read = beginPlanRead(true);
              return [
                read,
                planRead(id, read.signal),
                () => finishPlanRead(read),
              ];
            },
          });
        },
        () => {
          preloading = undefined;
        },
      )
      .finally(() => {
        loadFailed = !machine;
        update({});
      }));
  const submitIntent = (
    record: PlanRecord,
    kind: CoreIntentKind,
    cause: IntentCause = "user",
    ownRun = false,
  ): Promise<void> | void => {
    if (readOnly(adoptedRecord(record.id))) return refuse();
    const scope = conversationScope.signal;
    const id = record.id;
    const key = semanticKey(record, kind);
    const held = !machine && reserved.get(id);
    if (held) {
      // The same intent joins the reserved press, its deadline and its
      // completion; only a higher-ranked press takes the reservation over.
      if (held.key === key) return held.settled;
      if (rank(kind) <= rank(held.kind)) return refuse();
    }
    // A loaded chunk takes the press synchronously; a press made while it
    // loaded keeps its press time and conversation, which is still current
    // when its scope has not ended.
    const send = (pressedAt?: number) =>
      machine!.submit(record, kind, cause, ownRun, pressedAt);
    if (machine) return send();
    const startedAt = config.platform.clock.now();
    const entry = {
      kind,
      key,
      // The press waits for the chunk within its own 10 s budget; ending
      // its scope retires the reservation at once.
      settled: within(preload(), 10000, scope).then(() => {
        if (reserved.get(id) === entry) reserved.delete(id);
        if (!scope.aborted && !isDisposed())
          return machine
            ? send(startedAt)
            : report({ code: "retryable", id: "intent-load" });
      }),
    };
    reserved.set(id, entry);
    return entry.settled;
  };
  const checkIntentStatus = (id = state.plan?.id) =>
    (id &&
      (readOnly(adoptedRecord(id))
        ? Promise.resolve(refuse())
        : (reserved.get(id)?.settled ?? machine?.status(id)))) ||
    Promise.resolve();
  const makeRunner = () => {
    const scope = conversationScope.signal;
    return config.plans
      ? createPlanRunner({
          ...config.plans,
          signal: scope,
          read: (id) => {
            const read = beginPlanRead(false);
            return planRead(id, scope).then(
              (fetched) => {
                finishPlanRead(read);
                // The runner consumes only what the gate accepts: a peer
                // error ends the run, and an older record never replaces
                // newer facts.
                const gate = recoveryGate(fetched);
                if (gate === "error") {
                  report({ code: "invalid-plan", id: fetched.id });
                  throw new PlanReadRefused();
                }
                const record =
                  gate === "ignore"
                    ? (adopted.get(gateKey(fetched.id))?.record ?? fetched)
                    : fetched;
                // A plan that turned read-only gets nothing more.
                if (readOnly(record)) throw new PlanReadRefused();
                // Eligibility belongs to this read: the runner gets its own
                // copy, tied to the read's scope, never the adapter's object.
                const own = JSON.parse(JSON.stringify(record)) as PlanRecord;
                readScopes.set(own, read.signal);
                return own;
              },
              (error: unknown) => {
                finishPlanRead(read);
                throw error;
              },
            );
          },
          clock: config.platform.clock,
          // An interruption of a protected run submits the automatic Stop
          // with its cause before the runner reads every step.
          // It belongs to the interrupted plan, from that plan's last
          // validated record, whichever plan is displayed now.
          interrupted: async (id, cause) => {
            const plan = adopted.get(gateKey(id))?.record;
            if (plan && protectedPlan(plan))
              await submitIntent(plan, "stop", cause, true);
          },
          onRecord: (record) => {
            if (scope.aborted || readScopes.get(record)?.aborted) return;
            // Only an adopted record is published outside the client.
            if (adoptPlan(record)) config.plans?.onRecord?.(record);
          },
        })
      : undefined;
  };
  let runner = makeRunner();
  const stoppedPlans = new Set<string>();
  const confirmedDigests = new Map<string, string>();
  // The answer of a confirmation that sends nothing.
  const sendsNothing = Promise.resolve();
  const confirmations = new Map<
    string,
    { id: string; planId: string; active?: Promise<void> }
  >();
  const approvalKey = (planId: string) =>
    JSON.stringify([state.conversationId, planId]);
  // Stops the plan locally at once (any pending handoff included); returns
  // whether this window had a run of it in progress.
  const inhibit = (planId: string) => {
    const running = clearPlanMemory(planId);
    stoppedPlans.add(planId);
    runner?.stop(planId);
    return running;
  };
  // Returns whether this window had a run of the plan in progress.
  const clearPlanMemory = (planId: string) => {
    let running = false;
    for (const [key, attempt] of confirmations)
      if (attempt.planId === planId) {
        running ||= !!attempt.active;
        confirmations.delete(key);
      }
    confirmedDigests.delete(approvalKey(planId));
    return running;
  };
  // Actions that wait for readiness first and are not needed for the
  // first render load with their own chunk on first use.
  let onDemand: Promise<OnDemand> | undefined;
  const later = <T = void>(use: (actions: OnDemand) => Promise<T>) =>
    (onDemand ??= import("./on-demand").then(
      (module) =>
        module.createOnDemand({
          ready,
          config,
          client,
          state: () => state,
          live: () => negotiated && !isDisposed(),
          disposed: isDisposed,
          restricted,
          formMode,
          report,
          emit,
          refresh,
          stopped: (id) => stoppedPlans.has(id),
          refusedPending,
          readOnly: (id) => readOnly(adoptedRecord(id)),
          confirmedDigest: (id) => confirmedDigests.get(approvalKey(id)),
          finishPlanRead,
          showPlan,
          switchTo,
          update,
          tabSelected: () => tabSelected,
          sendReply,
          confirmed: (planId, digest) =>
            confirmedDigests.set(approvalKey(planId), digest),
          run: (scope, planId, digest, acceptance) =>
            acceptance
              ? runner?.run(planId, digest, acceptance).catch((error) => {
                  // A refused read was reported by the gate; any other
                  // failure ended the run as an interruption.
                  if (!scope.aborted && !(error instanceof PlanReadRefused))
                    report({ code: "unavailable", id: planId });
                })
              : client.runPlan(planId, digest),
        }),
      (error: unknown) => {
        onDemand = undefined;
        throw error;
      },
    )).then(use, () => report({ code: "retryable", id: "on-demand-load" }));
  // Every plan record, from any source, is adopted only through the gate.
  const adoptPlan = (plan: PlanRecord): boolean => {
    if (restricted()) return false;
    const gate = recoveryGate(plan);
    if (gate === "error") {
      report({ code: "invalid-plan", id: plan.id });
      return false;
    }
    // A fresh read that passes the gate (a newer record, or the same one
    // again) is what gives controls back after a new agreement.
    const freed =
      (gate === "adopt" ||
        plan.recovery?.revision === adopted.get(gateKey(plan.id))?.revision) &&
      staleControl.delete(plan.id);
    if (gate === "ignore") {
      if (freed) update({});
      return false;
    }
    remember(plan);
    if (readOnly(plan)) {
      const key = gateKey(plan.id);
      readOnlyEpoch.set(key, (readOnlyEpoch.get(key) ?? 0) + 1);
    }
    if (["completed", "undone", "cancelled", "submitted"].includes(plan.state))
      clearPlanMemory(plan.id);
    for (const read of pendingPlanReads.keys()) read.abort();
    pendingPlanReads.clear();
    update({ plan: JSON.parse(JSON.stringify(plan)) as PlanRecord });
    emit({ type: "plan.state", planId: plan.id });
    return true;
  };
  const client: WaypointClient = {
    get ready() {
      return ready;
    },
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    on: (fn) => {
      observers.add(fn);
      return () => {
        observers.delete(fn);
      };
    },
    editMessage: (id, content) => {
      const scope = conversationScope.signal;
      return later((actions) => actions.version(scope, "edit", id, content));
    },
    regenerate: (id) => {
      const scope = conversationScope.signal;
      return later((actions) => actions.version(scope, "regenerate", id));
    },
    selectVersion: (id, index) => {
      const scope = conversationScope.signal;
      return later((actions) =>
        actions.version(scope, "select", id, undefined, index),
      );
    },
    canChangeVersions: () => !!config.versions,
    canSendFeedback: () => !!config.feedback,
    sendFeedback: (id, rating) => {
      const scope = conversationScope.signal;
      return later((actions) => actions.feedback(scope, id, rating)).then(
        (sent) => sent === true,
      );
    },
    async setDraft(draft) {
      record({
        kind: "draft",
        value: draft,
        ...editTime(),
      });
      await ready;
      await persist();
    },
    async send() {
      await ready;
      if (
        !negotiated ||
        isDisposed() ||
        state.conversationUnavailable ||
        state.sending ||
        !state.draft.trim()
      )
        return;
      const scope = conversationScope.signal;
      const draft = state.draft;
      if (formMode()) {
        if (!config.formSession) {
          report({ code: "refused", id: "form-session" });
          return;
        }
        update({ sending: true });
        try {
          const material = { text: draft, field: state.conversation?.field };
          const key = JSON.stringify([
            state.conversationId,
            material,
            config.formSession.getSnapshot().fields,
          ]);
          if (formRetry?.key !== key)
            formRetry = { key, request: config.formSession.begin(material) };
          const request = formRetry.request;
          if (
            await client.reply({
              kind: "form-fill",
              clientReplyId: request.requestId,
              request,
            })
          ) {
            if (!scope.aborted) {
              formRetry = undefined;
              if (state.draft === draft) update({ draft: "" });
            }
          }
        } finally {
          if (!scope.aborted) update({ sending: false });
        }
        return;
      }
      update({ sending: true, toolSteps: [] });
      try {
        const extensions: Record<string, unknown> = {};
        const hints: string[] = [];
        let held = false;
        for (const contribution of config.contributions ?? []) {
          const result = await contribution.evaluate({
            draft,
            conversationId: state.conversationId,
          });
          if (result.hold) held = true;
          if (result.hint) hints.push(result.hint);
          if (result.payload !== undefined)
            extensions[contribution.id] = result.payload;
        }
        update({ hints });
        if (held || scope.aborted || state.conversationUnavailable) return;
        const id = config.platform.ids();
        let outgoing: Reply = {
          kind: "message",
          protocol: state.protocol!,
          clientReplyId: id,
          clientMessageId: id,
          content: draft,
        };
        const transformed = await config.beforeSend?.(outgoing);
        if (
          transformed === false ||
          scope.aborted ||
          state.conversationUnavailable
        )
          return;
        if (transformed) outgoing = transformed;
        if (
          outgoing.kind !== "message" ||
          outgoing.clientReplyId !== id ||
          outgoing.clientMessageId !== id
        )
          throw new Error("Invalid middleware reply");
        record({
          kind: "add",
          row: {
            id,
            content: outgoing.content,
            failure: null,
            extensions,
            open: [],
          },
        });
        record({
          kind: "draft",
          value: state.draft === draft ? "" : state.draft,
          ...editTime(),
        });
        emit({
          type: "send",
          conversationId: state.conversationId,
          replyId: id,
        });
        await dispatch(id);
      } catch {
        report({ code: "refused", id: "before-send" });
      } finally {
        if (!scope.aborted) update({ sending: false });
      }
    },
    async retry(id) {
      await ready;
      if (formMode()) return;
      if (
        !negotiated ||
        isDisposed() ||
        state.conversationUnavailable ||
        state.sending
      )
        return;
      if (!viewRow(id)) return;
      emit({ type: "send", conversationId: state.conversationId, replyId: id });
      await dispatch(id);
    },
    async withdraw(id) {
      if (!viewRow(id) || state.withdrawing.includes(id)) return;
      // Nothing changes until the withdrawal commits, so its content never
      // becomes sendable when the commit fails or refuses it.
      const operation: Operation = {
        kind: "withdraw",
        id,
        restoredId: config.platform.ids(),
      };
      committing.push(operation);
      update({ withdrawing: [...state.withdrawing, id] });
      await persist();
      committing = committing.filter((queuedOp) => queuedOp !== operation);
      update({ withdrawing: state.withdrawing.filter((w) => w !== id) });
      // A message whose send is in flight or whose outcome is unknown can
      // only be resent; withdrawing it could deliver it twice.
      if (landed.has(operation) && viewRow(id))
        report({ code: "refused", id: "sending" });
    },
    async editRestored(id) {
      const item = state.restored.find((restored) => restored.id === id);
      if (!item) return;
      // Only the draft changes; the item stays until it is discarded.
      record({
        kind: "draft",
        value: [state.draft, item.content].filter(Boolean).join("\n\n"),
        ...editTime(),
      });
      await persist();
    },
    async discardRestored(id) {
      record({ kind: "discard", id });
      await persist();
    },
    async dismiss(id) {
      if (state.sending) return;
      if (viewRow(id)) record({ kind: "remove", id });
      await persist();
    },
    reply: (reply) => sendReply(undefined, reply),
    replyOutcome: (reply) => sendReplyOutcome(undefined, reply),
    refresh: () => {
      // An explicit refresh is the Retry of a stream that gave up.
      if (stream?.gaveUp && negotiated && !isDisposed()) connect();
      return negotiated && bindingStalled && !isDisposed()
        ? retryBinding()
        : !negotiated && !isDisposed()
          ? startup().then(
              (result) =>
                result ?? {
                  kind: "unavailable",
                  conversationId: state.conversationId,
                },
            )
          : state.conversationUnavailable && streamStopped
            ? client.switchConversation(state.conversationId)
            : refresh();
    },
    switchConversation: (id) => switchTo(id),
    report,
    confirmPlan() {
      const scope = conversationScope.signal;
      const plan = state.plan;
      if (formMode() || isDisposed() || !plan) return sendsNothing;
      if (readOnly(plan)) {
        report({ code: "refused", id: plan.id });
        return sendsNothing;
      }
      if (stoppedPlans.has(plan.id)) {
        report({ code: "stopped", id: plan.id });
        return sendsNothing;
      }
      // Only a plan the host issued a confirmation for can be confirmed,
      // and only by sending that record's token.
      const token = confirmationOf(plan, state.conversationId)?.token;
      if (refusedPending(plan.id) || !token) return sendsNothing;
      // A timed plan has no digest; its token alone schedules it.
      const digest = (plan.plan as { digest?: string }).digest;
      const key = `${plan.id}:${token}`;
      const existing = confirmations.get(key);
      if (existing?.active) return existing.active;
      if (plan.state !== "awaiting-confirmation") return sendsNothing;
      const attempt = existing ?? {
        id: config.platform.ids(),
        planId: plan.id,
      };
      confirmations.set(key, attempt);
      const keyEpoch = gateKey(plan.id);
      const epoch = readOnlyEpoch.get(keyEpoch);
      const stale = () =>
        readOnly(adoptedRecord(plan.id)) ||
        epoch !== readOnlyEpoch.get(keyEpoch);
      // Sending and what follows load with the client actions.
      attempt.active = later((actions) =>
        actions.confirm({
          scope,
          planId: plan.id,
          token,
          digest,
          replyId: attempt.id,
          current: () => confirmations.get(key) === attempt,
          stale,
          // A protected run starts only under its private acceptance, and an
          // acceptance for a plan that turned read-only since the press is
          // discarded: nothing starts from it.
          refused: (acceptance) =>
            (protectedPlan(plan) && !acceptance) || stale(),
        }),
      ).finally(() => {
        delete attempt.active;
      });
      return attempt.active;
    },
    async runPlan(id, confirmedDigest) {
      if (restricted()) return;
      await ready;
      if (restricted()) return;
      if (isDisposed()) return;
      if (stoppedPlans.has(id)) {
        report({ code: "stopped", id });
        return;
      }
      if (!negotiated) return;
      // A protected plan starts only through its confirmation, under the
      // private acceptance; this public entry point refuses it.
      if (
        adopted.has(gateKey(id)) ||
        (state.plan?.id === id && state.plan.recovery)
      ) {
        report({ code: "refused", id });
        return;
      }
      const scope = conversationScope.signal;
      if (id) {
        try {
          await runner?.run(id, confirmedDigest);
        } catch (error) {
          // A binding refusal belongs to the binding owner, not the plan.
          if (!scope.aborted && !isAgreementRefusal(error))
            report({ code: "invalid-plan", id });
        }
      }
    },
    stopPlan(id = state.plan?.id) {
      if (id && readOnly(adoptedRecord(id))) report({ code: "refused", id });
      else if (id) {
        // The local run and any pending handoff are inhibited at once.
        const ownRun = inhibit(id);
        // A protected plan is always one the gate adopted.
        const plan = adopted.get(gateKey(id))?.record;
        if (protectedPlan(plan))
          void submitIntent(plan!, "stop", "user", ownRun);
      }
    },
    async declinePlan() {
      const plan = state.plan;
      if (!plan) return;
      if (readOnly(plan)) return refuse();
      if (!protectedPlan(plan)) {
        report({ code: "unavailable", id: "plan-decline" });
        return;
      }
      inhibit(plan.id);
      await submitIntent(plan, "cancel-initial");
    },
    checkIntentStatus,
    checkSavedChoice: checkIntentStatus,
    checkKeepStatus: checkIntentStatus,
    retryIntent: checkIntentStatus,
    // Synchronous: answered by the intent chunk, which a protected plan
    // preloads; until it has loaded the review says so.
    keepChangesReview(id = state.plan?.id): KeepChangesReviewResult {
      if (id && readOnly(adoptedRecord(id))) return readOnlyKeep;
      if (machine)
        return machine.keepReview(
          id ? adopted.get(gateKey(id))?.record : undefined,
        );
      preload();
      return { disabled: loadFailed ? "intentUnavailable" : "loading" };
    },
    canKeepChanges(id?: string) {
      return !("disabled" in client.keepChangesReview(id));
    },
    keepChanges: (review: KeepChangesReviewResult) =>
      review === readOnlyKeep
        ? Promise.resolve(refuse())
        : (machine?.keepChanges(review) ??
          Promise.resolve(report({ code: "unavailable", id: "plan-keep" }))),
    async leavePlan(id = state.plan?.id) {
      const plan = id ? adopted.get(gateKey(id))?.record : undefined;
      if (readOnly(plan)) return refuse();
      const phase = plan?.recovery?.phase;
      // Leave needs an agreed capability and a decision to leave.
      if (
        !protectedPlan(plan) ||
        !state.capabilities.includes("plan-leave") ||
        !["readback", "left-reopened", "forward-active"].includes(phase!)
      ) {
        report({ code: "unavailable", id: "plan-leave" });
        return;
      }
      // Captured before any await; a running local execution stops at once.
      if (phase === "forward-active") inhibit(plan!.id);
      await submitIntent(plan!, "leave");
    },
    resumePlan() {
      const scope = conversationScope.signal;
      return later((actions) => actions.resumePlan(scope));
    },
    retryUndo() {
      const scope = conversationScope.signal;
      const id = state.plan?.id;
      // Owned from the press: a plan published after it supersedes it, and
      // the read is released on every outcome.
      const read = beginPlanRead(false);
      return later((actions) => actions.retryUndo(scope, read, id)).finally(
        () => finishPlanRead(read),
      );
    },
    readPlan(id = state.plan?.id) {
      const scope = conversationScope.signal;
      return later((actions) => actions.readPlan(scope, id));
    },
    setPlan(plan) {
      adoptPlan(plan);
    },
    loadFlows() {
      if (!config.flowSource) return sendsNothing;
      // A newer load supersedes this one from its call.
      flowLoad?.abort();
      const load = (flowLoad = createScope("flow-load", clientScope.signal));
      return later((actions) => actions.loadFlows(load));
    },
    selectFlowTab(tab) {
      const flowTab = flowTabId(tab);
      if (
        !(config.tabs ?? DEFAULT_FLOW_TABS).some(
          (value) => flowTabId(value) === flowTab,
        )
      )
        return;
      tabSelected = true;
      update({ flowTab });
    },
    setFavourite: (id, favourite) =>
      later((actions) => actions.setFavourite(id, favourite)),
    canPrepareFlow: () => !!config.flowSource?.load,
    keepWaiting() {
      waitUntil = config.platform.clock.now() + REPLY_STALL_MS;
      update({});
    },
    retryReply() {
      client.keepWaiting();
      return client.refresh().then(() => {});
    },
    canStopReply: () =>
      !!stoppable() && state.capabilities.includes("reply-stop"),
    // Marked at once, before the host is asked.
    stopReply() {
      const message = stoppable();
      if (!message || !client.canStopReply()) return Promise.resolve();
      stopped.add(message.id);
      setStatus(message.id, "stopped");
      return later((actions) => actions.stopReply(message.id));
    },
    prepareFlow(id) {
      const scope = conversationScope.signal;
      return later((actions) => actions.prepareFlow(scope, id));
    },
    runFlow(id, values) {
      if (restricted()) return sendsNothing;
      // A flow run owns a scope: a newer flow run or dispose aborts it, and a
      // navigation away from the conversation it started in retires it.
      flowRun?.abort();
      const run = (flowRun = createScope("flow-run", clientScope.signal));
      const origin = conversationScope.signal;
      return later((actions) => actions.runFlow(run, origin, id, values));
    },
    dispose() {
      heldFrames = [];
      heldSequences.clear();
      streamStopped = false;
      formRetry = undefined;
      config.formSession?.dispose();
      confirmations.clear();
      confirmedDigests.clear();
      runner?.dispose();
      if (replyTimer !== undefined)
        config.platform.clock.clearTimeout(replyTimer);
      clientScope.abort();
      close();
      listeners.clear();
      observers.clear();
    },
  };
  // The reply being written, if any: the last message, from the assistant.
  const stoppable = () => {
    const last = state.conversation?.messages.at(-1);
    return last?.role === "assistant" && last.status === "writing"
      ? last
      : undefined;
  };
  // A reply owned by a connection (a tool or planning result) is dropped, and
  // its side effects skipped, once that connection has closed.
  const sendReply = async (
    owner: ScopeSignal | undefined,
    reply: ReplyInput,
    delivered?: (delivery: ReplyDelivery) => void,
  ): Promise<boolean> =>
    (await sendReplyOutcome(owner, reply, delivered)).accepted;
  const sendReplyOutcome = async (
    owner: ScopeSignal | undefined,
    reply: ReplyInput,
    delivered?: (delivery: ReplyDelivery) => void,
  ): Promise<ReplyOutcome> => {
    const notSent = { accepted: false } as const;
    const conversationId = state.conversationId;
    const scope = conversationScope.signal;
    const current = () =>
      !isDisposed() &&
      !scope.aborted &&
      !owner?.aborted &&
      conversationId === state.conversationId;
    await ready;
    if (!negotiated || state.conversationUnavailable || !current())
      return notSent;
    if (restricted() && reply.kind !== "form-fill") return notSent;
    if (
      reply.kind === "form-fill" &&
      (!formMode() ||
        state.protocol !== "1.1" ||
        !state.capabilities.includes("form-fill"))
    )
      return notSent;
    emit({
      type: "reply",
      conversationId,
      replyId: reply.clientReplyId,
    });
    const bound = agreement;
    try {
      const delivery = await config.transport.send(
        { ...reply, protocol: state.protocol! },
        conversationId,
        requestContext(bound),
      );
      if (current()) delivered?.(delivery);
      if (current()) boundResponse(bound);
      if (current()) await readAfter(refresh(owner));
      return { accepted: true };
    } catch (error) {
      // A refused reply or confirmation is never resent automatically, and
      // a reply from a retired conversation cannot disturb the current one.
      const problem = asProblem(error, reply.clientReplyId);
      if (current()) report(problem);
      // Whatever the failure, the host may hold this reply or another one
      // for the same card: the read that follows shows what it holds. On
      // an agreement refusal the binding owner renegotiates and reads.
      if (current() && isAgreementRefusal(error)) void bindingRefused(bound);
      else if (current()) await readAfter(refresh(owner));
      return { accepted: false, problem };
    }
  };
  // A read after a reply, within the startup step's budget: one that never
  // answers ends as the failed read, whose Retry reads again.
  const readAfter = async (read: Promise<unknown>) => {
    if ((await within(read, STARTUP_STEP_BUDGET_MS)) === budgetExceeded)
      if (!isDisposed())
        report({ code: "unavailable", id: "conversation-read" });
  };
  // A navigation may be owned by work such as a flow run: if that owner is
  // aborted before the navigation lands, it does not navigate.
  const switchTo = async (
    id: string,
    owners: readonly ScopeSignal[] = [],
  ): Promise<ConversationReadResult> => {
    await ready;
    await persist();
    // Ownership is checked immediately before navigating; the navigation
    // below then retires the origin it was allowed to leave.
    if (owners.some((owner) => owner.aborted) || isDisposed())
      return { kind: "superseded", conversationId: id };
    const sameConversation = id === state.conversationId;
    close();
    navigate();
    knownMode = undefined;
    heldFrames = [];
    heldSequences.clear();
    streamStopped = false;
    formRetry = undefined;
    config.formSession?.cancel();
    confirmations.clear();
    confirmedDigests.clear();
    runner?.dispose();
    runner = makeRunner();
    inFlight.clear();
    if (!sameConversation) {
      storedKey = key(id);
      stored = empty;
      queued = [];
    }
    update({
      conversationId: id,
      conversation: null,
      status: "unsubscribed",
      ...(sameConversation ? {} : { conversationUnavailable: false }),
      plan: null,
      problem: null,
      sending: false,
      streamUnavailable: false,
      toolSteps: [],
    });
    derive();
    const scope = conversationScope.signal;
    if (!sameConversation) await hydrate(id, scope);
    if (isDisposed() || scope.aborted)
      return { kind: "superseded", conversationId: id };
    if (negotiated) {
      connect();
      return refresh();
    }
    return { kind: "unavailable", conversationId: id };
  };
  // Agreement binding: the client owns its current agreement. A refusal of
  // that agreement starts one coalesced renegotiation; a refusal of an older
  // agreement is an ordinary failure. If the replacement is refused before
  // any bound response succeeds, the episode ends as unavailable until an
  // explicit refresh, so refusals cannot loop.
  // Plan recovery is offered only when the plan port can deliver intents.
  const offer: NegotiationOffer = {
    capabilities: CAPABILITIES.filter(
      (capability) =>
        (capability !== "plan-recovery" &&
          capability !== "plan-leave" &&
          capability !== "plan-keep") ||
        !!config.plans?.intent,
    ),
  };
  let agreement: string | undefined;
  let rebinding: Promise<ConversationReadResult | undefined> | undefined;
  let replacementPending = false;
  let bindingStalled = false;
  const requestContext = (
    id: string | undefined = agreement,
  ): ReaderRequestContext | undefined =>
    id === undefined ? undefined : { agreementId: id };
  // Reads a plan's record for the scope that asked and shows it, unless a
  // newer read or the end of that scope superseded it.
  const showPlan = (id: string, scope: ScopeSignal) => {
    const read = beginPlanRead(true, scope);
    return planRead(id, scope).then(
      (record) => {
        if (finishPlanRead(read)) client.setPlan(record);
      },
      (error: unknown) => {
        if (finishPlanRead(read) && !isAgreementRefusal(error))
          report(readProblem(error, "plan-read"));
      },
    );
  };
  const planRead = async (id: string, scope: ScopeSignal) => {
    const bound = agreement;
    try {
      const record = await config.plans!.read(id, requestContext(bound));
      if (!scope.aborted) boundResponse(bound);
      return record;
    } catch (error) {
      if (!scope.aborted && isAgreementRefusal(error))
        void bindingRefused(bound);
      throw error;
    }
  };
  const isAgreementRefusal = (error: unknown) =>
    (error instanceof ConversationReadError
      ? error.problem?.code
      : typeof error === "object" && error !== null
        ? (error as { code?: unknown }).code
        : undefined) === "agreement-expired";
  const boundResponse = (bound: string | undefined) => {
    // A successful authenticated response lets a sign-in-blocked intent
    // be delivered once more.
    machine?.authenticated();
    // A stalled episode ends only on an explicit refresh.
    if (bindingStalled || bound === undefined || bound !== agreement) return;
    replacementPending = false;
    if (state.problem?.id === "agreement") update({ problem: null });
  };
  const stallBinding = (code: StartupFailure) => {
    bindingStalled = true;
    report({ code, id: "agreement" });
  };
  const rebind = async (): Promise<ConversationReadResult | undefined> => {
    const episode = createScope("binding", clientScope.signal);
    try {
      return await rebindIn(episode.signal);
    } finally {
      episode.end();
    }
  };
  const rebindIn = async (
    episode: ScopeSignal,
  ): Promise<ConversationReadResult | undefined> => {
    close();
    let answer: Awaited<ReturnType<TransportPort["negotiate"]>>;
    try {
      const outcome = await within(
        config.transport.negotiate(SUPPORTED_PROTOCOLS, offer),
        STARTUP_STEP_BUDGET_MS,
      );
      if (outcome === budgetExceeded) throw new Error("negotiation budget");
      answer = outcome;
    } catch (error) {
      if (!episode.aborted) stallBinding(classifyStartupFailure(error));
      return undefined;
    }
    if (episode.aborted) return undefined;
    if (!validAnswer(answer) || answer.agreementId === undefined) {
      stallBinding("unavailable");
      return undefined;
    }
    // A different protocol is a genuine incompatibility, not a silent rebind.
    if (answer.protocol !== state.protocol) {
      stallBinding("update-required");
      return undefined;
    }
    agreement = answer.agreementId;
    replacementPending = true;
    const recovered = state.capabilities.includes("plan-recovery");
    const capabilities = negotiatedCapabilities(answer, offer.capabilities);
    // Marked before the snapshot changes, so no render offers controls in
    // between.
    if (recovered !== capabilities.includes("plan-recovery")) {
      for (const [key, { record }] of adopted)
        if (record.recovery) {
          readOnlyEpoch.set(key, (readOnlyEpoch.get(key) ?? 0) + 1);
          if (!recovered) staleControl.add(record.id);
        }
    }
    update({ capabilities });
    // A successful authenticated negotiation counts as signed in.
    machine?.authenticated();
    // Listeners and a synchronous subscribe may dispose the client.
    if (episode.aborted) return undefined;
    connect();
    if (episode.aborted) return undefined;
    const settling = refresh();
    // The replacement binding owns its recovery from now on; outcomes that
    // arrive before this read settles wait for it.
    if (stream) stream.settling = settling;
    const result = await settling;
    const interruptedPlan = state.plan?.id;
    if (
      !episode.aborted &&
      !bindingStalled &&
      interruptedPlan &&
      config.plans
    ) {
      // Same ownership as frame reads: a newer read or scope wins.
      const read = beginPlanRead(true);
      void planRead(interruptedPlan, conversationScope.signal)
        .then((record) => {
          if (finishPlanRead(read) && state.plan?.id === record.id)
            client.setPlan(record);
        })
        .catch(() => finishPlanRead(read));
    }
    return result;
  };
  const bindingRefused = (
    refused: string | undefined,
  ): Promise<ConversationReadResult | undefined> | undefined => {
    if (isDisposed() || refused === undefined || refused !== agreement)
      return undefined;
    // An owned refusal retires the active legacy invocation locally: no
    // further step and no remote stop or undo.
    runner?.interrupt?.();
    if (replacementPending) {
      stallBinding("unavailable");
      return undefined;
    }
    if (rebinding) return rebinding;
    const attempt = rebind().finally(() => {
      if (rebinding === attempt) rebinding = undefined;
      scheduleRetry();
    });
    rebinding = attempt;
    return attempt;
  };
  const retryBinding = async (): Promise<ConversationReadResult> => {
    bindingStalled = false;
    replacementPending = false;
    const pending = rebinding ?? bindingRefused(agreement);
    return (
      (await pending) ?? {
        kind: "unavailable",
        conversationId: state.conversationId,
      }
    );
  };
  // One owner per client retries startup: bounded backoff, explicit refresh,
  // and online/visibility changes. It never resends a message or reply and
  // never confirms or runs a plan; it only negotiates and reads.
  const within = <T>(
    work: Promise<T>,
    ms: number,
    signal = clientScope.signal,
  ): Promise<T | typeof budgetExceeded> =>
    new Promise((resolve, reject) => {
      // The wait ends at its budget or when its scope (the client's by
      // default) aborts; the abandoned answer is consumed and never applied.
      work.catch(() => {});
      if (isDisposed()) {
        resolve(budgetExceeded);
        return;
      }
      let release = () => {};
      const timer = config.platform.clock.setTimeout(() => {
        release();
        resolve(budgetExceeded);
      }, ms);
      const finish = () => {
        config.platform.clock.clearTimeout(timer);
        release();
      };
      release = onAbort(signal, () => {
        config.platform.clock.clearTimeout(timer);
        resolve(budgetExceeded);
      });
      work.then(
        (value) => {
          finish();
          resolve(value);
        },
        (error: unknown) => {
          finish();
          reject(error);
        },
      );
    });
  let startupFailure: StartupFailure | null = null;
  let firstReadSettled = false;
  let startupAttempt: Promise<ConversationReadResult | undefined> | undefined;
  let retryTimer: unknown;
  let retryDelay = STARTUP_RETRY_FIRST_MS;
  let platformSubscriptions: (() => void)[] = [];
  const hydration = within(
    hydrate(state.conversationId, conversationScope.signal),
    HYDRATION_BUDGET_MS,
  ).catch(() => undefined);
  const awaitingStartup = () =>
    !isDisposed() &&
    !bindingStalled &&
    !rebinding &&
    (!negotiated ||
      (!firstReadSettled && appliedRead?.scope !== conversationScope.signal));
  const scheduleRetry = () => {
    if (isDisposed() || retryTimer !== undefined || startupAttempt) return;
    if (!awaitingStartup()) return;
    if (startupFailure === "update-required" || startupFailure === "sign-in")
      return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, STARTUP_RETRY_MAX_MS);
    retryTimer = config.platform.clock.setTimeout(() => {
      retryTimer = undefined;
      if (!awaitingStartup()) return;
      if (config.platform.online() && config.platform.visibility())
        void startup();
      else scheduleRetry();
    }, delay);
  };
  const attemptStartup = async (): Promise<
    ConversationReadResult | undefined
  > => {
    if (!negotiated) {
      let answer: Awaited<ReturnType<TransportPort["negotiate"]>>;
      try {
        const outcome = await within(
          config.transport.negotiate(SUPPORTED_PROTOCOLS, offer),
          STARTUP_STEP_BUDGET_MS,
        );
        if (outcome === budgetExceeded) throw new Error("negotiation budget");
        answer = outcome;
      } catch (error) {
        if (isDisposed()) return undefined;
        startupFailure = classifyStartupFailure(error);
        report({ code: startupFailure, id: "negotiation" });
        return undefined;
      }
      if (isDisposed()) return undefined;
      if (!validAnswer(answer)) {
        startupFailure = "unavailable";
        report({ code: "unavailable", id: "negotiation" });
        return undefined;
      }
      if (
        !(SUPPORTED_PROTOCOLS as readonly string[]).includes(answer.protocol)
      ) {
        startupFailure = "update-required";
        report({ code: "update-required", id: "negotiation" });
        return undefined;
      }
      negotiated = true;
      startupFailure = null;
      agreement = answer.agreementId;
      update({
        protocol: answer.protocol,
        capabilities: negotiatedCapabilities(answer, offer.capabilities),
        ...(state.problem?.id === "negotiation" ? { problem: null } : {}),
      });
      await hydration;
      if (isDisposed()) return undefined;
      connect();
      // A synchronous stream notification may have disposed the client.
      if (isDisposed()) return undefined;
    }
    const scope = conversationScope.signal;
    const id = state.conversationId;
    const result = await Promise.race([
      within(refresh(), STARTUP_STEP_BUDGET_MS),
      startupStopped.then(() => undefined),
    ]);
    if (isDisposed()) return undefined;
    if (scope.aborted) {
      // A conversation switch owns its own read from here on.
      firstReadSettled = true;
      return { kind: "superseded", conversationId: id };
    }
    if (result === budgetExceeded) {
      // A newer read in this scope already loaded or definitively missed.
      if (appliedRead?.scope === scope) return appliedRead.result;
      report({ code: "unavailable", id: "conversation-read" });
      return { kind: "unavailable", conversationId: state.conversationId };
    }
    // A loaded or definitive missing read settles startup through appliedRead;
    // a stopped stream ends it too. Only a transient read is retried.
    if (!result) firstReadSettled = true;
    return result;
  };
  const startup = (): Promise<ConversationReadResult | undefined> => {
    if (startupAttempt) return startupAttempt;
    if (retryTimer !== undefined) {
      config.platform.clock.clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    const attempt = attemptStartup()
      .catch(() => undefined)
      .finally(() => {
        if (startupAttempt === attempt) startupAttempt = undefined;
        if (!awaitingStartup()) retryDelay = STARTUP_RETRY_FIRST_MS;
        scheduleRetry();
      });
    startupAttempt = attempt;
    return attempt;
  };
  const onPlatformChange = (available: boolean) => {
    if (!available || !awaitingStartup() || startupAttempt) return;
    if (startupFailure === "update-required") return;
    if (!config.platform.online() || !config.platform.visibility()) return;
    void startup();
  };
  for (const [subscribe, listener] of [
    [
      config.platform.subscribeOnline,
      (online: boolean) => {
        onPlatformChange(online);
        // Regaining connectivity resets the stream's attempt budget.
        if (online) streamOnline();
      },
    ],
    [config.platform.subscribeVisibility, onPlatformChange],
  ] as const)
    if (subscribe)
      try {
        platformSubscriptions.push(subscribe.call(config.platform, listener));
      } catch {
        // A host that cannot notify keeps the timer fallback.
      }
  onAbort(clientScope.signal, () => {
    if (retryTimer !== undefined)
      config.platform.clock.clearTimeout(retryTimer);
    retryTimer = undefined;
    for (const unsubscribe of platformSubscriptions) unsubscribe();
    platformSubscriptions = [];
  });
  const ready = Promise.allSettled([startup(), hydration]).then(() => {});
  return client;
}
function isPending(value: unknown): value is PendingSend {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PendingSend).id === "string" &&
    typeof (value as PendingSend).content === "string"
  );
}
export function asProblem(error: unknown, id: string): Problem {
  const candidate = error as Partial<Problem> | null;
  const code = candidate?.code;
  const reason = candidate?.confirmation?.reason;
  const wait = candidate?.retryAfter;
  return PROBLEM_CODES.includes(code!)
    ? {
        code: code!,
        id,
        // A confirmation refusal keeps only its known reason.
        ...(code === "refused" &&
          REASONS.includes(reason!) && { confirmation: { reason: reason! } }),
        // A host's wait is kept only as a whole number of seconds.
        ...(Number.isInteger(wait) && wait! >= 0 && { retryAfter: wait }),
      }
    : { code: "in-doubt", id };
}
/** A failed read's problem: a host's whole-second wait makes it a rate limit. */
export function readProblem(error: unknown, id: string): Problem {
  const retryAfter = asProblem(
    error instanceof ConversationReadError ? error.problem : error,
    id,
  ).retryAfter;
  return retryAfter === undefined
    ? { code: "unavailable", id }
    : { code: "rate-limited", id, retryAfter };
}
/**
 * The plan's confirmation record, when it is bound to this plan, this
 * conversation and the plan's host revision. A record without a whole
 * revision is never a match; a legacy plan record has no revision of its
 * own to compare, so its host refuses a stale token.
 */
export function confirmationOf(
  plan: PlanRecord | null | undefined,
  conversationId: string | undefined,
): ConfirmationRecord | undefined {
  const record = plan?.confirmation;
  return record &&
    record.planId === plan!.id &&
    record.conversationId === conversationId &&
    Number.isInteger(record.revision) &&
    record.revision === (plan!.recovery ?? record).revision
    ? record
    : undefined;
}
const REASONS = ["expired", "used", "stale", "mismatch", "missing"];
const PROBLEM_CODES: readonly Problem["code"][] = [
  "update-required",
  "in-doubt",
  "replaced",
  "retryable",
  "refused",
  "closed",
  "full",
  "declined",
  "unavailable",
  "sign-in",
  "rate-limited",
  "step-up-cancelled",
  "mismatch",
  "invalid-read",
  "invalid-plan",
  "needs-attention",
  "stopped",
  "plan-changed",
  "agreement-expired",
];
/** A reply with nothing new for this long is overdue. */
const REPLY_STALL_MS = 15000;
export function replyRow(input: {
  messages: readonly Message[];
  pending: readonly PendingSend[];
  now: number;
  askedAt?: number;
  overdueAt?: number;
  heldUntil?: number;
  unavailable?: boolean;
  failed?: boolean;
  /** The stream that would carry the rest of the reply gave up. */
  streamLost?: boolean;
  /**
   * When the reply being written last made progress, on the caller's clock.
   * Without it the stall is not measured: the reply stays `writing`.
   */
  activityAt?: number;
}): ReplyState {
  const last = input.messages.at(-1);
  // A reply streaming in is being written while it streams. What the host
  // or the client knows ended it wins: a failed or unavailable reply, or a
  // stream that gave up, is never shown as being written.
  if (
    last?.role === "assistant" &&
    last.status === "writing" &&
    !input.pending.some((row) => !row.failure)
  ) {
    if (input.unavailable || input.streamLost) return "unavailable";
    if (input.failed) return "failed";
    return input.activityAt !== undefined &&
      input.now >=
        Math.max(input.activityAt + REPLY_STALL_MS, input.heldUntil ?? 0)
      ? "overdue"
      : "writing";
  }
  // The host ended the reply without finishing it: the row says so, so the
  // reply is never taken for a finished one.
  if (
    last?.role === "assistant" &&
    (last.status === "failed" || last.status === "unavailable") &&
    !input.pending.some((row) => !row.failure)
  )
    return last.status;
  if (last?.role !== "user" && !input.pending.some((row) => !row.failure))
    return "none";
  if (input.pending.some((row) => !row.failure)) return "writing";
  if (input.unavailable) return "unavailable";
  if (input.failed) return "failed";
  return input.now >=
    Math.max(
      (last?.createdAt ?? input.now) + 15000,
      (input.askedAt ?? 0) + 15000,
      input.overdueAt ?? 0,
      input.heldUntil ?? 0,
    )
    ? "overdue"
    : "writing";
}
export function versionWalk(message: {
  versionIndex?: number | null;
  versionCount?: number | null;
}): {
  index: number;
  count: number;
  previous: number | null;
  next: number | null;
} | null {
  const index = message.versionIndex ?? 1;
  const count = message.versionCount ?? 1;
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(count) ||
    count < 2 ||
    index < 1 ||
    index > count
  )
    return null;
  return {
    index,
    count,
    previous: index > 1 ? index - 1 : null,
    next: index < count ? index + 1 : null,
  };
}

export interface AttachmentPort {
  upload(
    data: Uint8Array,
    context: { conversationId: string; fileName: string; contentType: string },
  ): MaybePromise<{ id: string }>;
  remove(id: string): MaybePromise<void>;
}
