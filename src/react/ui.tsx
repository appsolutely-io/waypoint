import { MODAL_SELECTOR } from "./dialog-selectors";
import type { ConfirmationRecord, Step } from "../protocol/generated";
import { ConversationRail } from "./conversation-rail";
import type {
  ConversationSource,
  ConversationSummary,
} from "../core/form-fill";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useId,
  useSyncExternalStore,
  lazy,
  Suspense,
  Component,
  type ReactNode,
  type ComponentType,
  type CSSProperties,
  type Ref,
} from "react";
import type {
  Block,
  Message,
  Problem,
  PlanRecord,
  Reply,
} from "../protocol/generated";
import { excerpt } from "./excerpt";
import { ExcerptCache, ShownCache } from "./excerpt-cache";
import { useTranscriptPosition } from "./transcript";
import { useAnnouncements, useHeldWhileInert } from "./announcements";
import {
  confirmationOf,
  flowTabId,
  type ReplyState,
  type WaypointClient,
} from "../core/client";
import type { Capability } from "../protocol/index";
import {
  ChatFocusContext,
  focusFor,
  focusRestsIn,
  ModalDrawer,
  useChatFocus,
  ownerKey,
  useChatFocusRoot,
  useDrawerFocus,
  useRetiredOnSwitch,
} from "./chat-focus";
import {
  composedContains,
  deepActiveElement,
  deepTarget,
  focusable,
  moveFocus,
  retireOrigin,
  useHandoff,
} from "./focus";
import {
  lightTheme,
  darkTheme,
  themeProperties,
  type ResolvedTheme,
  type Theme,
} from "../tokens/index";
import {
  catalogueFor,
  createFormatter,
  type FormatMessage,
  type MessageKey,
  addMessages,
} from "./i18n";
import { isSafeUrl } from "./urls";
import { usePlanView, type KeepSheet } from "./recovery";
import { ClientContext, clientOf, useWaypointSnapshot } from "./headless";
import { cardReplyId, useBlockReply } from "./block-reply";
import type { PlanLabels } from "./step-name";
export type { PlanLabels } from "./step-name";
export { clientOf, useWaypointSnapshot };
import type { ActionEntry, ActionId, PlanView, StepStatus } from "./plan-view";
import type { BlockSummary } from "./plan-view";
import type { MarkdownImagePolicy } from "./markdown";
export type { MarkdownImagePolicy } from "./markdown";
type MarkdownModule = typeof import("./markdown");
import { lazyChunk, useChunk } from "./chunks";
import { problemAction, problemView } from "./problem-view";
// The stock renderer's chunk, shared by every message: loaded once on first
// use, and tried again after a failure when a message body next asks or a
// Retry is pressed.
const markdownChunk = lazyChunk(() => import("./markdown"));
// The message bodies of one chat whose stock rendering failed: the chat
// says so once, with one Retry, and the bodies show nothing of their own.
const RenderFailures = createContext<{
  report(id: string, failed: boolean): void;
  retry: number;
} | null>(null);
// The message a body belongs to, so a chat can tell which messages show
// nothing.
const BodyOf = createContext<string | undefined>(undefined);
// Keeps the parse of the message body below it, for that message's version.
const ParseOf = createContext<
  ((parse: () => ReactNode) => ReactNode) | undefined
>(undefined);
function ReportFailure({ id }: { id: string }) {
  const failures = useContext(RenderFailures);
  useEffect(() => {
    failures?.report(id, true);
    return () => failures?.report(id, false);
  }, [failures, id]);
  return null;
}
/** The stock renderer's module once its chunk has loaded. */
function useMarkdownModule(): MarkdownModule | undefined {
  const load = useChunk(markdownChunk);
  return load.status === "ready" ? load.module : undefined;
}
// An id for an element of this component, usable in id references.
const useDomId = (name: string) =>
  `wp${useId().replace(/[^\w-]/g, "")}-${name}`;
// The recovery panel: loaded when a protected plan is shown, and asked for
// again by a Retry after a failure.
const recoveryChunk = lazyChunk(() => import("./recovery-panel"));
const LazyConfirmation = lazy(() => import("./confirmation-view"));
// The interactive and structured transcript blocks and the plan's steps,
// loaded when the first is shown (most chats never show one), and asked
// for again by a Retry after a failure.
const blocksChunk = lazyChunk(() => import("./blocks"));
// The controls of the reply being written, loaded when one is first shown.
const replyControlsChunk = lazyChunk(() => import("./reply-controls"));
function ReplyControls(props: { client: WaypointClient; row: ReplyState }) {
  const load = useChunk(replyControlsChunk);
  useEffect(() => replyControlsChunk.request(), []);
  return load.status === "ready" ? (
    <load.module.ReplyControls {...props} />
  ) : null;
}
// The default actions under each message, loaded with the first one.
const messageActionsChunk = lazyChunk(() => import("./message-actions"));
function MessageActions(props: { client: WaypointClient; message: Message }) {
  const load = useChunk(messageActionsChunk);
  useEffect(() => messageActionsChunk.request(), []);
  return load.status === "ready" ? (
    <load.module.MessageActions {...props} />
  ) : null;
}
// The saved requests' panel and parameter drawer, loaded with the tabs.
const flowsChunk = lazyChunk(() => import("./flows-panel"));
function useBlocks() {
  const load = useChunk(blocksChunk);
  useEffect(() => blocksChunk.request(), []);
  return load;
}
// What an answered card says, from the blocks chunk.
function Answered({ block }: { block: Block }) {
  const blocks = useBlocks();
  return blocks.status === "ready" ? (
    <blocks.module.Answered block={block} />
  ) : null;
}
// A block from the blocks chunk; its own fallback text if that cannot load.
function ChunkBlock(props: WidgetProps) {
  const { format: t } = context();
  const blocks = useBlocks();
  const fallback = <p>{props.block.fallback}</p>;
  if (blocks.status === "failed") return fallback;
  if (blocks.status !== "ready") return <p>{t("chat.messageLoading")}</p>;
  const Rendered = blocks.module.default;
  return (
    <RenderBoundary resetKey={props.block.id} fallback={fallback}>
      <Rendered {...props} />
    </RenderBoundary>
  );
}
export type PartName =
  | "bubble"
  | "composer"
  | "transcript"
  | "replyRow"
  | "stepRow"
  | "planNode"
  | "widgetFrame"
  | "confirmBar"
  | "confirmation"
  | "topBar"
  | "rail"
  | "flowTabs"
  | "quotaStrip"
  | "failedSendControls"
  | "emptyState"
  | "messageActions"
  | "extraPanels"
  | "actionBar"
  | "stepUpPrompt"
  | "fieldAdornment"
  | "recoveryPanel"
  | "stepStatusRow"
  | "recoveryActions";
/** A message as a bubble or its actions see it. */
export interface PartMessage {
  id: string;
  role: Message["role"];
  status?: Message["status"];
  versionIndex?: number;
  versionCount?: number;
}
/** A message still being sent, or not sent. */
export interface PartPending {
  id: string;
  content: string;
  failure: { code: Problem["code"] } | null;
}
/** A plan step as its row sees it. */
export type PartStep = Pick<
  Step,
  "id" | "operation" | "resource" | "view" | "tier" | "undo" | "stepUp"
>;
/**
 * The data each part is given, by part name: a copy, field by field, never
 * the host's or the client's own objects. A part with `undefined` is given
 * none; it draws from its children and props alone.
 */
export interface PartDataMap {
  bubble:
    | {
        message: PartMessage & {
          content: string;
          blocks: BlockSummary[];
        };
      }
    | { pending: PartPending };
  widgetFrame: { block: BlockSummary };
  messageActions: { message: PartMessage };
  composer: { sending: boolean };
  failedSendControls: { pending: PartPending };
  confirmBar: { view: PlanView; actions: ActionEntry[] };
  confirmation: { confirmation: ConfirmationRecord };
  planNode: { view: PlanView };
  stepRow: { step: PartStep };
  stepUpPrompt: { stepUpCount: number };
  recoveryPanel: { view: PlanView };
  stepStatusRow: { step: StepStatus };
  recoveryActions: { actions: ActionEntry[] };
}
/** Each part's data, `undefined` for a part that is given none. */
export type PartData = {
  [N in PartName]: N extends keyof PartDataMap ? PartDataMap[N] : undefined;
};
export interface PartProps<N extends PartName = PartName> {
  children?: ReactNode;
  value?: string;
  onChange?: (value: string) => void;
  onPress?: () => void;
  disabled?: boolean;
  /** A guarded part stays focusable and uses describedBy for its reason. */
  "aria-disabled"?: boolean;
  label?: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  /** Ids of the text that describes the field (the composer's hints). */
  describedBy?: string;
  /** The part's own data (see `PartData`); absent while there is none. */
  data?: PartData[N];
}
export interface InputProps {
  value: string;
  onChange(value: string): void;
  label: string;
  type?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Exposed as `aria-required`; the label carries the visible marker. */
  required?: boolean;
}
export interface CheckboxProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}
export interface ButtonProps {
  children?: ReactNode;
  onPress?(): void;
  disabled?: boolean;
  label?: string;
  role?: "tab";
  tabIndex?: number;
  "aria-selected"?: boolean;
  // Guarded actions stay focusable and are described, never natively disabled.
  "aria-disabled"?: boolean;
  "aria-describedby"?: string;
  "aria-busy"?: boolean;
  "aria-current"?: "page";
  /** A toggle's state. */
  "aria-pressed"?: boolean;
  id?: string;
  "data-action"?: string;
  /** A disclosure's state and the region it controls. */
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}
export interface DrawerProps {
  children?: ReactNode;
  open: boolean;
  label: string;
  onClose(): void;
  /** The close button's name, from the chat's formatter. */
  closeLabel?: string;
  /**
   * Called once the open drawer's element exists; the chat decides there
   * whether focus may move into it. A skin never moves focus itself.
   */
  focusInto?(element: HTMLElement): void;
  /**
   * Called as the drawer closes or unmounts, with its element. The skin
   * must unmount the dialog on close rather than keep it connected and
   * hidden, so the guarded removal handoff can restore focus.
   */
  restoreFocus?(element: HTMLElement): void;
}
export interface PrimitiveComponents {
  button: ComponentType<ButtonProps>;
  textarea: ComponentType<PartProps>;
  input: ComponentType<InputProps>;
  datePicker: ComponentType<InputProps>;
  drawer: ComponentType<DrawerProps>;
  /** A labelled checkbox (a boolean form field); the native one if absent. */
  checkbox?: ComponentType<CheckboxProps>;
}
export interface WidgetProps {
  block: Block;
  onReply: (reply: Pick<Reply, "kind"> & Record<string, unknown>) => void;
  disabled: boolean;
}
export interface WidgetRegistration {
  type: string;
  render: ComponentType<WidgetProps>;
}
export interface WaypointProviderProps {
  client: WaypointClient;
  /** Display names for the plan steps' resources and fields. */
  planLabels?: PlanLabels;
  children?: ReactNode;
  parts?: { [N in PartName]?: ComponentType<PartProps<N>> };
  primitives?: Partial<PrimitiveComponents>;
  widgets?: readonly WidgetRegistration[];
  renderers?: { markdown?: ComponentType<{ text: string }> };
  /**
   * Plain text for a message's excerpt (the outline, announcements) when a
   * replaced renderer, bubble or transcript means the chat cannot tell what
   * the message visibly shows. Without it those surfaces name no content.
   */
  messageExcerpt?: (message: Message) => string | undefined;
  markdownImages?: MarkdownImagePolicy;
  extraUrlSchemes?: readonly string[];
  flowTabLabel?: (labelKey: string) => string;
  /**
   * A host's words for a problem. `context.answeredElsewhere`: a card
   * answer was refused because the read after it shows the card answered
   * elsewhere (another tab, an earlier page).
   */
  problemText?: (
    problem: Problem,
    context?: { answeredElsewhere: boolean },
  ) => { text: string; action?: ReactNode };
  format?: FormatMessage;
  locale?: string;
  dir?: "ltr" | "rtl";
  /**
   * Waypoint's tokens over the scheme's base tokens, in place of a host
   * theme's tokens. It is tokens, not a scheme: without `colorScheme`, the
   * scheme is still the host theme's or the system's, so a theme picked
   * for one scheme should come with that `colorScheme`. Its colours are
   * the host's to check, so under any `theme` prop (whatever its value)
   * the user's bubble keeps the surface, with an accent start edge, rather
   * than the accent-tinted fill.
   */
  theme?: Partial<Theme>;
  /**
   * The chat's scheme. Without it: the host theme's scheme (a skin's
   * `useThemeTokens`), else the system's (`prefers-color-scheme`, followed
   * live), else light.
   */
  colorScheme?: "light" | "dark";
  wrapper?: ComponentType<{
    children?: ReactNode;
    colorScheme: "light" | "dark";
    tokens: Theme;
    /**
     * Where the tokens came from: the host's own theme (a skin's
     * `useThemeTokens`), or waypoint's, when a `theme` prop is given
     * (whatever its value) or the skin reads none.
     */
    tokenSource?: "host" | "waypoint";
  }>;
  /**
   * A skin's hook reading the host's own theme. Its tokens are used unless
   * a `theme` prop is given; its scheme is used unless `colorScheme` is,
   * also under a `theme` prop. It must be present or absent for the
   * provider's whole life.
   */
  useThemeTokens?: ThemeTokensHook;
}
/** A skin's hook reading the host's own theme as waypoint tokens. */
export type ThemeTokensHook = () =>
  { tokens: Partial<ResolvedTheme>; scheme: "light" | "dark" } | undefined;
export interface ContextValue extends Omit<WaypointProviderProps, "children"> {
  format: FormatMessage;
  /** The language of the text shown, for the chat's `lang`. */
  lang: string;
  tokens: Theme;
  primitives: PrimitiveComponents;
}
const Context = createContext<ContextValue | null>(null);
function Button({
  children,
  onPress,
  disabled,
  label,
  ...attributes
}: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      {...attributes}
    >
      {children}
    </button>
  );
}
function Textarea({
  value,
  onChange,
  label,
  inputRef,
  onKeyDown,
  disabled,
  describedBy,
}: PartProps) {
  return (
    <textarea
      ref={inputRef}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
    />
  );
}
function Input({
  value,
  onChange,
  label,
  type = "text",
  disabled,
  invalid,
  describedBy,
  required,
}: InputProps) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  invalid,
  describedBy,
}: CheckboxProps) {
  return (
    <label className="wp-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
function Drawer({
  children,
  open,
  label,
  onClose,
  closeLabel,
  focusInto,
  restoreFocus,
}: DrawerProps) {
  const t = useContext(Context)?.format ?? createFormatter();
  const ref = useRef<HTMLDivElement>(null);
  const into = useRef(focusInto);
  const back = useRef(restoreFocus);
  into.current = focusInto;
  back.current = restoreFocus;
  // The chat decides about focus; the drawer only reports its element.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    into.current?.(element);
    return () => back.current?.(element);
  }, [open]);
  const heading = useId();
  return open ? (
    <div
      ref={ref}
      className="wp-drawer"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={heading}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="wp-drawer-header">
        <h2 id={heading}>{label}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel ?? t("chat.close")}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="wp-drawer-body">{children}</div>
    </div>
  ) : null;
}
const defaults: PrimitiveComponents = {
  button: Button,
  textarea: Textarea,
  input: Input,
  checkbox: Checkbox,
  datePicker: (props) => <Input {...props} type="datetime-local" />,
  drawer: Drawer,
};
const DARK = "(prefers-color-scheme: dark)";
// The system's colour scheme, followed while shown; light where it cannot
// be read (no matchMedia, or rendering on a server).
function useSystemScheme(): "light" | "dark" {
  return useSyncExternalStore(
    (changed) => {
      const query = globalThis.matchMedia?.(DARK);
      query?.addEventListener("change", changed);
      return () => query?.removeEventListener("change", changed);
    },
    () => (globalThis.matchMedia?.(DARK).matches ? "dark" : "light"),
    () => "light",
  );
}
export function WaypointProvider(props: WaypointProviderProps) {
  // A `theme` prop, whatever its value, makes waypoint's tokens win. So
  // does an explicit scheme the host's theme does not paint: its colours
  // are for the other scheme, so waypoint's own for the requested one.
  const host = props.useThemeTokens?.();
  const tokenSource =
    props.theme === undefined &&
    host &&
    (props.colorScheme === undefined || props.colorScheme === host.scheme)
      ? "host"
      : "waypoint";
  // An explicit scheme first, then the host's theme, then the system's.
  const system = useSystemScheme();
  const colorScheme = props.colorScheme ?? host?.scheme ?? system;
  const value = useMemo<ContextValue>(
    () => ({
      ...props,
      colorScheme,
      format: props.format ?? createFormatter(props.locale),
      // The language of the text shown: the host's own when it formats.
      lang: props.format
        ? (props.locale ?? "en")
        : catalogueFor(props.locale).lang,
      tokens: {
        ...(colorScheme === "dark" ? darkTheme : lightTheme),
        ...(tokenSource === "host" ? host!.tokens : props.theme),
      },
      primitives: { ...defaults, ...props.primitives },
    }),
    [props, colorScheme, tokenSource, host],
  );
  const Wrapper = props.wrapper;
  const content = (
    <ClientContext.Provider value={props.client}>
      <Context.Provider value={value}>{props.children}</Context.Provider>
    </ClientContext.Provider>
  );
  return Wrapper ? (
    <Wrapper
      colorScheme={colorScheme}
      tokens={value.tokens}
      tokenSource={tokenSource}
    >
      {content}
    </Wrapper>
  ) : (
    content
  );
}
/** The scheme the chat draws in, for controls rendered outside its root. */
export function useColorScheme(): "light" | "dark" {
  return useContext(Context)?.colorScheme ?? "light";
}
export function context() {
  const value = useContext(Context);
  if (!value) throw new Error("WaypointProvider is required");
  return value;
}
export function useWaypointClient(): WaypointClient {
  return context().client;
}
export function useConversation(client?: WaypointClient) {
  const inherited = useContext(Context);
  const store = client ?? inherited?.client;
  const snapshot = useWaypointSnapshot(client);
  return {
    conversationId: snapshot.conversationId,
    conversation: snapshot.conversation,
    refresh: store!.refresh,
    editMessage: store!.editMessage,
    regenerate: store!.regenerate,
    selectVersion: store!.selectVersion,
    switchConversation: store!.switchConversation,
  };
}
export function useComposer(client?: WaypointClient) {
  const inherited = useContext(Context);
  const store = client ?? inherited?.client;
  const snapshot = useWaypointSnapshot(client);
  return {
    draft: snapshot.draft,
    sending: snapshot.sending,
    hints: snapshot.hints,
    setDraft: store!.setDraft,
    send: store!.send,
    retry: store!.retry,
    withdraw: store!.withdraw,
    dismiss: store!.dismiss,
  };
}
export function usePlan(client?: WaypointClient) {
  const inherited = useContext(Context);
  const store = client ?? inherited?.client;
  const snapshot = useWaypointSnapshot(client);
  const { view } = usePlanView(client);
  return {
    plan: snapshot.plan,
    setPlan: store!.setPlan,
    reply: store!.reply,
    // The same view every renderer reads (status, steps, actions, notices).
    view,
  };
}
export function useFlows(client?: WaypointClient) {
  const inherited = useContext(Context);
  const store = client ?? inherited?.client;
  const snapshot = useWaypointSnapshot(client);
  return {
    flows: snapshot.flows,
    tab: snapshot.flowTab,
    load: store!.loadFlows,
    select: store!.selectFlowTab,
    setFavourite: store!.setFavourite,
    run: store!.runFlow,
  };
}
export type Slots = {
  [N in PartName]?: (props: PartProps<N>) => ReactNode;
};
export const partNames: readonly PartName[] = [
  "bubble",
  "composer",
  "transcript",
  "replyRow",
  "stepRow",
  "planNode",
  "widgetFrame",
  "confirmBar",
  "confirmation",
  "topBar",
  "rail",
  "flowTabs",
  "quotaStrip",
  "failedSendControls",
  "emptyState",
  "messageActions",
  "extraPanels",
  "actionBar",
  "stepUpPrompt",
  "fieldAdornment",
  "recoveryPanel",
  "stepStatusRow",
  "recoveryActions",
];
/** One action as a button; an unavailable one is described and inert. */
export function ActionButton({
  action,
  onPress,
  label,
}: {
  action: ActionEntry;
  onPress(id: ActionId): void;
  // A host-supplied name, shown verbatim instead of the catalogue label.
  label?: string;
}) {
  const { format: t, primitives } = context();
  const B = primitives.button;
  const reason = useId();
  return (
    <>
      <B
        data-action={action.id}
        aria-disabled={action.available ? undefined : true}
        aria-describedby={action.reasonKey ? reason : undefined}
        aria-busy={action.busy ? true : undefined}
        onPress={action.available ? () => onPress(action.id) : undefined}
      >
        {label ??
          (action.countedLabelKey && action.labelValues
            ? t(action.countedLabelKey, action.labelValues)
            : t(action.labelKey))}
      </B>
      {action.reasonKey ? (
        <span id={reason} data-reason={action.id}>
          {t(action.reasonKey, action.reasonValues)}
        </span>
      ) : null}
    </>
  );
}

/**
 * One refresh at a time: reserved at the press, busy until it settles,
 * released on every outcome.
 */
export function useRefresh(run: () => Promise<unknown>) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const done = () => {
    running.current = false;
    setBusy(false);
  };
  const press = () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void run().then(done, done);
  };
  return { busy, press };
}
/** The one action of a default problem text. */
function ProblemAction({
  problem,
  refresh,
}: {
  problem: Problem;
  refresh: { busy: boolean; press(): void };
}) {
  const action = problemAction(problem);
  // The host's wait, fixed once for each problem received.
  const waitUntil = useMemo(
    () => Date.now() + (problem.retryAfter ?? 0) * 1000,
    [problem],
  );
  const [check, rerender] = useState(0);
  const waiting = problem.code === "rate-limited" && Date.now() < waitUntil;
  // Timers run on a monotonic clock and Date on the wall clock, so a timer
  // can fire while Date still reads before the end: each check that finds
  // the wait still running sets a timer for what is left.
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(
      () => rerender((value) => value + 1),
      Math.max(waitUntil - Date.now(), 1),
    );
    return () => clearTimeout(timer);
  }, [waiting, waitUntil, check]);
  if (!action) return null;
  return (
    <ActionButton
      action={{
        id: "status",
        labelKey: action === "retry" ? "chat.retry" : "chat.problem.refresh",
        available: !waiting && !refresh.busy,
        busy: refresh.busy,
        ...(waiting && { reasonKey: "chat.problem.rateLimited" as MessageKey }),
      }}
      onPress={refresh.press}
    />
  );
}
// The code and reference, for whoever needs them, outside the alert so it
// says only the plain words.
function ProblemDetails({ problem }: { problem: Problem }) {
  const { format: t } = context();
  if (!t("chat.problem.details")) return null;
  return (
    <details data-problem-details="">
      <summary>{t("chat.problem.details")}</summary>
      <p>{t("chat.problem.code", { code: problem.code })}</p>
      <p>{t("chat.problem.reference", { id: problem.id })}</p>
    </details>
  );
}
const retryingLoad = (load: { status: string; retrying?: true }) =>
  load.status === "loading" && !!load.retrying;
/**
 * A load that failed, and its Retry. While the new attempt runs the Retry
 * stays, busy, so focus is never dropped; it goes only when the attempt
 * succeeds, and the caller's handoff then moves focus on.
 */
export function LoadFailure(props: {
  retrying?: boolean;
  onRetry(): void;
  onFocus?(event: { target: EventTarget }): void;
}) {
  const { format: t, primitives } = context();
  const busy = props.retrying || undefined;
  // The busy status is its own region beside the alert: a live region
  // inside another may be read twice.
  return (
    <>
      <p role="alert" onFocus={props.onFocus}>
        {t("chat.failure")}{" "}
        <primitives.button
          aria-disabled={busy}
          aria-busy={busy}
          onPress={() => {
            if (!busy) props.onRetry();
          }}
        >
          {t("chat.retry")}
        </primitives.button>
      </p>
      <span role="status">{busy ? t("chat.loading") : ""}</span>
    </>
  );
}
/** The recovery panel of a protected plan (loaded on first use). */
export function RecoveryPanel(props: {
  view: PlanView;
  onPress(id: ActionId | "retry"): void;
  slots?: Slots;
  sheet?: KeepSheet | null;
  hide?: readonly ActionId[];
}) {
  const { format: t } = context();
  const load = useChunk(recoveryChunk);
  useEffect(() => recoveryChunk.request(), []);
  // A Retry that goes hands focus to the heading of the panel it loaded.
  const box = useRef<HTMLDivElement>(null);
  const handoff = useHandoff(() => [box.current?.querySelector("h3")]);
  const Panel = load.status === "ready" && load.module.default;
  return (
    <div ref={box} tabIndex={-1} data-recovery="">
      {Panel ? (
        <Panel {...props} />
      ) : load.status === "failed" || retryingLoad(load) ? (
        <LoadFailure
          retrying={retryingLoad(load)}
          onRetry={() => recoveryChunk.request(true)}
          onFocus={handoff}
        />
      ) : (
        <p>{t("chat.loading")}</p>
      )}
    </div>
  );
}
// Part data is mapped field by field, never spread from host objects.
function blockSummary(block: Block): BlockSummary {
  return { id: block.id, type: block.type, answered: Boolean(block.answered) };
}
function pendingSummary(pending: {
  id: string;
  content: string;
  failure: Problem | null;
}) {
  return {
    id: pending.id,
    content: pending.content,
    failure: pending.failure ? { code: pending.failure.code } : null,
  };
}
export function Part<N extends PartName>({
  name,
  slots,
  children,
  ...props
}: { name: N; slots?: Slots } & PartProps<N>) {
  const provider = useContext(Context);
  const Replacement = provider?.parts?.[name] as
    ComponentType<PartProps<N>> | undefined;
  const slot = slots?.[name] as
    ((props: PartProps<N>) => ReactNode) | undefined;
  const content = slot ? (
    slot({ ...props, children } as PartProps<N>)
  ) : Replacement ? (
    <Replacement {...props}>{children}</Replacement>
  ) : (
    children
  );
  return <div data-part={name}>{content}</div>;
}
class RenderBoundary extends Component<
  { resetKey: string; fallback: ReactNode; children?: ReactNode },
  { failedKey?: string }
> {
  state: { failedKey?: string } = {};
  static getDerivedStateFromError() {
    return { failedKey: "" };
  }
  componentDidCatch() {
    this.setState({ failedKey: this.props.resetKey });
  }
  render() {
    const { failedKey } = this.state;
    return failedKey === "" || failedKey === this.props.resetKey
      ? this.props.fallback
      : this.props.children;
  }
}
function StockMarkdown({
  text,
  writing,
  sources,
}: {
  text: string;
  writing?: boolean;
  sources?: Message["sources"];
}) {
  const provider = context();
  const t = provider.format;
  const failures = useContext(RenderFailures);
  const own = useId();
  const id = useContext(BodyOf) ?? own;
  const cached = useContext(ParseOf);
  // In a chat the failure is said once for the transcript; elsewhere here.
  const failed = failures ? (
    <ReportFailure id={id} />
  ) : (
    <p>{t("chat.messageUnavailable")}</p>
  );
  const load = useChunk(markdownChunk);
  useEffect(() => {
    // A message body that mounts or changes asks again after a failure;
    // unrelated renders of the chat do not.
    markdownChunk.request(true);
  }, [text]);
  if (load.status === "failed") return failed;
  if (load.status !== "ready") return <p>{t("chat.messageLoading")}</p>;
  const Rendered = load.module.default;
  return (
    <RenderBoundary
      resetKey={`${text}:${failures?.retry ?? 0}`}
      fallback={failed}
    >
      <Rendered
        text={text}
        writing={writing}
        lang={provider.lang}
        sources={sources}
        sourceNames={{
          list: (count) => t("chat.sources", { count }),
          item: (index, title) => t("chat.source", { index, title }),
        }}
        images={provider.markdownImages}
        extraSchemes={provider.extraUrlSchemes}
        scrollLabel={t("chat.scrollRegion")}
        cached={cached}
      />
    </RenderBoundary>
  );
}
function Markdown(props: {
  text: string;
  writing?: boolean;
  sources?: Message["sources"];
}) {
  const Renderer = context().renderers?.markdown;
  return Renderer ? (
    <Renderer text={props.text} />
  ) : (
    <StockMarkdown {...props} />
  );
}
export { problemAction };
export function defaultProblemText(
  problem: Problem,
  format: FormatMessage,
): { text: string; action?: ReactNode } {
  const text = format(problemView(problem).key);
  // Until the problem messages have loaded, the generic failure text.
  return { text: text || format("chat.failure") };
}
function WidgetBody({ block, onReply, disabled }: WidgetProps) {
  const { format: t, primitives: ui, extraUrlSchemes } = context();
  const B = ui.button;
  const body = block.body as Record<string, unknown>;
  switch (block.type) {
    case "form.fill":
    case "table":
    case "diff":
    case "form":
    case "choice":
    case "plan":
      return <ChunkBlock block={block} onReply={onReply} disabled={disabled} />;
    case "markdown":
      return <Markdown text={String(body.text ?? "")} />;
    case "notice":
      return <p>{String(body.text ?? "")}</p>;
    case "card":
      return (
        <section>
          <h3>{String(body.title ?? "")}</h3>
          {((body.blocks as Block[]) ?? []).map((child) => (
            <Widget
              key={child.id}
              block={child}
              disabled={disabled}
              onReply={onReply}
            />
          ))}
        </section>
      );
    case "details":
      return (
        <details>
          <summary>{String(body.summary ?? "")}</summary>
          {((body.blocks as Block[]) ?? []).map((child) => (
            <Widget
              key={child.id}
              block={child}
              disabled={disabled}
              onReply={onReply}
            />
          ))}
        </details>
      );
    case "list":
      return (
        <ul>
          {((body.items as string[]) ?? []).map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case "route-link": {
      const route = String(body.route ?? "");
      return isSafeUrl(route, extraUrlSchemes) ? (
        <a href={route}>{String(body.label ?? t("chat.view"))}</a>
      ) : (
        <span>{block.fallback}</span>
      );
    }
    case "buttons":
      return (
        <div>
          {((body.actions as { id: string; label: string }[]) ?? []).map(
            (action) => (
              <B
                key={action.id}
                disabled={disabled}
                onPress={() =>
                  onReply({
                    kind: "action",
                    blockId: block.id,
                    actionId: action.id,
                  })
                }
              >
                {action.label}
              </B>
            ),
          )}
        </div>
      );
    default:
      return <p>{block.fallback}</p>;
  }
}
export const standardWidgets: readonly WidgetRegistration[] = [
  "markdown",
  "form.fill",
  "card",
  "details",
  "list",
  "table",
  "form",
  "choice",
  "buttons",
  "diff",
  "plan",
  "route-link",
  "notice",
].map((type) => ({ type, render: WidgetBody }));
export function Widget(props: WidgetProps) {
  const { widgets, format: t } = context();
  const registration =
    widgets?.find((widget) => widget.type === props.block.type) ??
    standardWidgets.find((widget) => widget.type === props.block.type);
  if (!registration)
    return (
      <div data-fallback="true">
        <p>
          {props.block.fallback?.trim()
            ? props.block.fallback
            : t("unsupportedContent")}
        </p>
      </div>
    );
  const Renderer = registration.render;
  return <Renderer {...props} />;
}
/** The steps of a plan record (rendered by the blocks chunk). */
export function PlanDiagram(props: PlanDiagramProps) {
  const { format: t, primitives } = context();
  const blocks = useBlocks();
  const B = primitives.button;
  const box = useRef<HTMLDivElement>(null);
  // Each Retry renders the steps afresh, after a failed chunk or render.
  const [attempt, setAttempt] = useState(0);
  // Focus left on the pressed Retry, once it is gone, goes to the box
  // around the steps rather than to the page. The box has no name of its
  // own: it sits in the named plan aside. (The first call starts watching
  // focus.)
  const pressed = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const root = box.current!;
    moveFocus(root, { root, owner: "", removed: pressed.current });
  });
  // Never blank: when the steps cannot be shown, it says so, with a Retry.
  const unavailable = (
    <p role="alert">
      {t("chat.planUnavailable")}
      <B
        onPress={() => {
          pressed.current = document.activeElement;
          setAttempt(attempt + 1);
          blocksChunk.request(true);
        }}
      >
        {t("chat.retry")}
      </B>
    </p>
  );
  const Steps = blocks.status === "ready" && blocks.module.PlanSteps;
  return (
    <div ref={box} tabIndex={-1}>
      {Steps ? (
        <RenderBoundary
          resetKey={`${props.record.id}:${attempt}`}
          fallback={unavailable}
        >
          <Steps {...props} />
        </RenderBoundary>
      ) : blocks.status === "failed" ? (
        unavailable
      ) : (
        <p>{t("chat.messageLoading")}</p>
      )}
    </div>
  );
}
export interface PlanDiagramProps {
  record: PlanRecord;
  slots?: Slots;
  /** The plan's view; each step's node is given it. */
  view?: PlanView | null;
  /**
   * The host's confirmation beside the steps already lists each change;
   * the steps then leave their before and after values out.
   */
  changesShown?: boolean;
}
export interface WaypointChatProps extends Partial<
  Omit<WaypointProviderProps, "children">
> {
  slots?: Slots;
  features?: readonly Capability[];
  layout?: "panel" | "page" | "floating" | "sheet";
  shortcuts?: {
    focusComposer?: string | false;
    send?: string | false;
    /**
     * @deprecated Ignored: a shortcut never moves focus from outside the
     * chat, so there is no page-wide shortcut.
     */
    global?: boolean;
  };
  conversations?: readonly ConversationSummary[];
  conversationSource?: ConversationSource;
  quota?: ReactNode;
  onStop?: () => void;
  suggestions?: readonly string[];
}
export function WaypointChat(props: WaypointChatProps) {
  const inherited = useContext(Context);
  if (props.client)
    return (
      <WaypointProvider {...props} client={props.client}>
        <ChatBody {...props} />
      </WaypointProvider>
    );
  if (inherited) return <ChatBody {...props} />;
  return (
    <section className="waypoint" dir={props.dir ?? "ltr"}>
      <p>{createFormatter(props.locale)("chat.empty")}</p>
    </section>
  );
}
// Shown in the place of the excerpt while formatting, then split around.
const EXCERPT_SLOT = "\u{E000}";
function TranscriptOutline({
  messages,
  excerpts,
  anchor,
  open,
  onToggle,
  onNavigate,
}: {
  messages: readonly Message[];
  excerpts: readonly (string | undefined)[];
  anchor: (messageId: string) => string;
  open: boolean;
  onToggle: () => void;
  onNavigate: (messageId: string) => void;
}) {
  const { format: t, primitives } = context();
  const B = primitives.button;
  const listId = useDomId("outline");
  return (
    <nav aria-label={t("chat.outline")} data-outline="" className="wp-outline">
      <B aria-expanded={open} aria-controls={listId} onPress={onToggle}>
        {t("chat.outline")}
      </B>
      {/* No markers: each label says its position. The role keeps the list
          a list where list-style none would drop it. */}
      <ol id={listId} hidden={!open} role="list">
        {open
          ? messages.map((message, index) => {
              const values = {
                role: t(
                  message.role === "user"
                    ? "chat.roleUser"
                    : "chat.roleAssistant",
                ),
                position: index + 1,
              };
              const text = excerpts[index];
              const parts =
                text === undefined
                  ? undefined
                  : t("chat.outlineItem", {
                      ...values,
                      excerpt: EXCERPT_SLOT,
                    }).split(EXCERPT_SLOT);
              return (
                <li key={message.id}>
                  <a
                    href={`#${anchor(message.id)}`}
                    data-outline-link={message.id}
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigate(message.id);
                    }}
                  >
                    {!parts ? (
                      t("chat.outlineItemPlain", values)
                    ) : parts.length === 2 ? (
                      <>
                        {parts[0]}
                        <bdi>{text}</bdi>
                        {parts[1]}
                      </>
                    ) : (
                      // A host format that dropped or repeated the excerpt
                      // still keeps it isolated.
                      <bdi>
                        {t("chat.outlineItem", { ...values, excerpt: text! })}
                      </bdi>
                    )}
                  </a>
                </li>
              );
            })
          : null}
      </ol>
    </nav>
  );
}
// The narrow conversation list's drawer, with its guarded focus.
function RailDrawer({
  label,
  closeLabel,
  onClose,
  skipRestore,
  onFocusWithin,
  children,
}: {
  label: string;
  closeLabel: string;
  onClose(): void;
  // True when the drawer closed for a choice or for the width.
  skipRestore(): boolean;
  // Focus anywhere in the dialog: the dialog itself, its close control,
  // the list.
  onFocusWithin(target: Element): void;
  children?: ReactNode;
}) {
  const D = context().primitives.drawer;
  const focus = useDrawerFocus("rail");
  const listening = useRef<
    { element: HTMLElement; listener(event: Event): void } | undefined
  >(undefined);
  const within = useRef(onFocusWithin);
  within.current = onFocusWithin;
  return (
    <ModalDrawer
      as={D}
      open
      label={label}
      closeLabel={closeLabel}
      onClose={onClose}
      focusInto={(element) => {
        const listener = (event: Event) =>
          within.current(deepTarget(event) as Element);
        element.addEventListener("focusin", listener);
        listening.current = { element, listener };
        focus.focusInto?.(element);
      }}
      restoreFocus={(element) => {
        const was = listening.current;
        listening.current = undefined;
        was?.element.removeEventListener("focusin", was.listener);
        if (skipRestore()) focus.release?.();
        else focus.restoreFocus?.(element);
      }}
    >
      {children}
    </ModalDrawer>
  );
}
// What a message's parsed body is made from: a read that brings the same
// text and sources again keeps the parse.
const bodySource = (message: Message) =>
  message.sources?.length
    ? `${message.content}\u0000${JSON.stringify(message.sources)}`
    : message.content;
type CardAnswer = Pick<Reply, "kind"> & Record<string, unknown>;
// What every message row calls, with one identity for the chat's life.
interface RowEvents {
  respond(block: Block, messageId: string): (reply: CardAnswer) => void;
  parses: ShownCache<ReactNode>;
}
function RowActions({ slots, message }: { slots?: Slots; message: Message }) {
  const { client } = context();
  return (
    <Part
      name="messageActions"
      slots={slots}
      data={{
        message: {
          id: message.id,
          role: message.role,
          status: message.status,
          versionIndex: message.versionIndex,
          versionCount: message.versionCount,
        },
      }}
    >
      <MessageActions client={client} message={message} />
    </Part>
  );
}
// One message of the transcript. It renders again only when one of its
// props changes: a delta into another message, or a keystroke in the
// composer, leaves it as it is.
const MessageRow = memo(function MessageRow({
  message,
  slots,
  anchorId,
  writing,
  bodyUnavailable,
  disabled,
  answered,
  actions,
  rows,
}: {
  message: Message;
  slots?: Slots;
  anchorId: string;
  // Still streaming in: what it says is not final.
  writing: boolean;
  // Its stock rendering failed.
  bodyUnavailable: boolean;
  disabled: boolean;
  // Whether each of its blocks is answered, "1" or "0" in block order.
  answered: string;
  // Its actions follow it here (else after the plan).
  actions: boolean;
  rows: RowEvents;
}) {
  const t = context().format;
  const parse = useMemo(() => {
    const source = bodySource(message);
    return (made: () => ReactNode) => rows.parses.get(message.id, source, made);
  }, [rows, message]);
  const sender = t(
    message.role === "user" ? "chat.roleUser" : "chat.roleAssistant",
  );
  return (
    <article
      id={anchorId}
      tabIndex={-1}
      data-message-id={message.id}
      data-role={message.role}
      aria-busy={writing ? true : undefined}
      // Named by its sender, whatever the bubble renders.
      aria-label={sender}
      // Nothing to show: the bubble is not drawn empty.
      data-body-unavailable={bodyUnavailable ? "" : undefined}
    >
      <Part
        name="bubble"
        slots={slots}
        data={{
          message: {
            id: message.id,
            role: message.role,
            content: message.content,
            status: message.status,
            versionIndex: message.versionIndex,
            versionCount: message.versionCount,
            blocks: message.blocks.map(blockSummary),
          },
        }}
      >
        {/* Seen first in the bubble; said once, as the article's name. */}
        <span data-sender="" aria-hidden="true">
          {sender}
        </span>
        <BodyOf.Provider value={message.id}>
          <ParseOf.Provider value={parse}>
            <Markdown
              text={message.content}
              writing={writing}
              sources={message.sources}
            />
          </ParseOf.Provider>
        </BodyOf.Provider>
        {/* Seen in the bubble; said once, by the reply row. */}
        {writing ? (
          <span data-writing="" aria-hidden="true">
            {t("reply.writing")}
          </span>
        ) : message.status === "stopped" ? (
          <span data-stopped="">{t("reply.stopped")}</span>
        ) : message.status === "failed" || message.status === "unavailable" ? (
          // Seen in the reply it is about; said once, by the message region,
          // not the reply row.
          <span data-reply-ended={message.status}>
            {t(`reply.${message.status}`)}
          </span>
        ) : null}
        {message.blocks.map((block, index) => {
          const isAnswered = answered[index] === "1";
          return (
            <Part
              key={block.id}
              name="widgetFrame"
              slots={slots}
              data={{ block: blockSummary(block) }}
            >
              <div
                data-open-card={
                  block.type === "card" && !isAnswered ? "true" : undefined
                }
              >
                <Widget
                  block={block}
                  disabled={disabled || isAnswered}
                  onReply={rows.respond(block, message.id)}
                />
                {block.answered ? <Answered block={block} /> : null}
              </div>
            </Part>
          );
        })}
      </Part>
      {actions ? <RowActions slots={slots} message={message} /> : null}
    </article>
  );
});
function ChatBody({
  slots,
  features,
  layout = "panel",
  shortcuts,
  conversations = [],
  conversationSource,
  quota,
  onStop,
  suggestions = [],
}: WaypointChatProps) {
  const instanceId = useId();
  const provider = context();
  const { client, format: t, tokens } = provider;
  const state = useWaypointSnapshot();
  const root = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const transcriptContent = useRef<HTMLDivElement>(null);
  // Message bodies whose stock rendering failed, said once below. Kept in
  // place, with a version to render again, so many reports stay linear.
  const failedBodies = useRef(new Set<string>()).current;
  const [, setFailureVersion] = useState(0);
  const [renderRetry, setRenderRetry] = useState(0);
  const renderFailures = useMemo(
    () => ({
      retry: renderRetry,
      report(id: string, failed: boolean) {
        if (failedBodies.has(id) === failed) return;
        if (failed) failedBodies.add(id);
        else failedBodies.delete(id);
        setFailureVersion((version) => version + 1);
      },
    }),
    [renderRetry, failedBodies],
  );
  const { isAnswered, reply: answerCard } = useBlockReply(client);
  // The answer pressed on a card loses focus while the card waits for the
  // host. Once the card shows what the host holds, focus goes back to it
  // when the card is open, or on to the composer when it is answered.
  const pressedAnswer = useRef<Element | null>(null);
  const answeredElsewhere = useRef<Problem | null>(null);
  // Card answers sent here, by reply id, until the read after them settles:
  // a problem one of them caused waits for that read, so the alert says
  // only what it shows.
  const checking = useRef(new Set<string>());
  const [settledCards, settleCard] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // The token this window found replaced at its press.
  const [changed, setChanged] = useState<string>();
  const reload = useRefresh(() => client.refresh());
  // The problem's Retry: owned here, so a new problem keeps it reserved.
  const retrying = useRefresh(() => client.refresh());
  const recovery = usePlanView(client);
  const B = provider.primitives.button;
  const T = provider.primitives.textarea;
  // A host's own panels, beside the transcript: only when it gives some.
  const extraPanels = !!(slots?.extraPanels || provider.parts?.extraPanels);
  const hintId = useDomId("hint");
  const pendingId = useDomId("pending");
  const enabled = (capability: Capability) =>
    (state.conversation?.mode !== "form-fill" ||
      capability === "form-fill" ||
      capability === "widgets") &&
    state.capabilities.includes(capability) &&
    (!features || features.includes(capability));
  // The saved requests' lists: loading, failed (with a Retry) or done.
  const [flowList, setFlowList] = useState<
    "loading" | "failed" | "retrying" | "done"
  >("loading");
  const loadFlows = () => {
    setFlowList((old) => (old === "failed" ? "retrying" : "loading"));
    client.loadFlows().then(
      () => setFlowList("done"),
      () => setFlowList("failed"),
    );
  };
  useEffect(loadFlows, [client]);
  const [, problemsLoaded] = useState(false);
  useEffect(() => {
    void import("./problem-messages").then((messages) => {
      addMessages(messages.problemEnglish, messages.problemSimplifiedChinese);
      problemsLoaded(true);
    });
  }, []);
  // Neither mount, a conversation switch nor arriving content takes focus;
  // only a user's action in this chat does (see chat-focus).
  // Every focus decision belongs to this client and the conversation it
  // shows: a replaced client owns nothing the previous one started.
  const chatFocus = useChatFocusRoot(
    root,
    ownerKey(client, state.conversationId),
    field,
    transcript,
    (id) => ownerKey(client, id),
  );
  const messages = state.conversation?.messages ?? [];
  const shownId = state.conversation?.id;
  // The outline's disclosure is kept per shown conversation; a switch
  // collapses it.
  const [outline, setOutline] = useState<{
    conversationId?: string;
    open: boolean;
  }>({ open: false });
  if (outline.conversationId !== shownId)
    setOutline({ conversationId: shownId, open: false });
  const outlineOpen = outline.conversationId === shownId && outline.open;
  const anchorPrefix = `wp${instanceId.replace(/[^\w-]/g, "")}`;
  const anchor = (messageId: string) =>
    `${anchorPrefix}-${messageId.replace(/[^A-Za-z0-9-]/gu, (character) => `_${character.codePointAt(0)}_`)}`;
  const position = useTranscriptPosition(
    transcript,
    transcriptContent,
    shownId,
    messages.length,
    state,
  );
  // F6: the message, outline link or Back to latest that had focus, so its
  // removal can hand focus on within the same shown conversation.
  const transcriptFocus = useRef<
    | {
        kind: "message" | "link" | "latest";
        id?: string;
        element: Element;
        owner: string;
        shown?: string;
        order: string[];
      }
    | undefined
  >(undefined);
  const recordTranscriptFocus = (event: { target: EventTarget }) => {
    const target = event.target as Element;
    const order = messages.map((message) => message.id);
    const base = {
      owner: chatFocus.value.owner(),
      shown: shownId,
      order,
    };
    const link = target.closest("[data-outline-link]");
    const latest = target.closest("[data-back-to-latest]");
    const article = target.closest("article[data-message-id]");
    transcriptFocus.current = link
      ? {
          ...base,
          kind: "link",
          id: link.getAttribute("data-outline-link")!,
          element: link,
        }
      : latest
        ? { ...base, kind: "latest", element: latest }
        : article && composedContains(transcript.current!, article)
          ? {
              ...base,
              kind: "message",
              id: article.getAttribute("data-message-id")!,
              element: article,
            }
          : undefined;
  };
  useLayoutEffect(() => {
    const was = transcriptFocus.current;
    if (!was || was.element.isConnected) return;
    transcriptFocus.current = undefined;
    const box = transcript.current;
    const scope = box?.parentElement;
    // The current elements are listed once; the remembered order is then
    // walked to the first survivor after the removed one, else before it.
    const nearest = (attribute: string, container?: Element | null) => {
      const current = new Map<string, HTMLElement>();
      for (const element of container?.querySelectorAll<HTMLElement>(
        `[${attribute}]`,
      ) ?? [])
        current.set(element.getAttribute(attribute)!, element);
      const at = was.order.indexOf(was.id!);
      for (let index = at + 1; index < was.order.length; index++) {
        const found = current.get(was.order[index]!);
        if (found) return found;
      }
      for (let index = at - 1; index >= 0; index--) {
        const found = current.get(was.order[index]!);
        if (found) return found;
      }
      return undefined;
    };
    const target =
      was.kind === "message"
        ? (nearest("data-message-id", box) ?? box)
        : was.kind === "link"
          ? (nearest("data-outline-link", scope) ??
            scope?.querySelector<HTMLElement>(
              "nav[data-outline] [aria-expanded]",
            ) ??
            box)
          : box;
    focusFor(chatFocus.value, target, {
      owner: was.owner,
      stillCurrent: () =>
        chatFocus.value.owner() === was.owner &&
        client.getSnapshot().conversation?.id === was.shown,
      removed: was.element,
      fallback: box,
    });
  });
  // The narrow conversation list (Table N): below 40rem of the chat's own
  // width the rail moves behind a toggle into a drawer.
  const hasRail = conversations.length > 0 || !!conversationSource;
  const [narrow, setNarrow] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const railId = useDomId("rail");
  const railRetired = useRetiredOnSwitch(
    railOpen,
    chatFocus.value.owner(),
    () => setRailOpen(false),
  );
  // Focus last inside the drawer, for the handoff when it closes because
  // the chat became wide.
  const railFocused = useRef<
    { element: Element; id?: string; owner: string } | undefined
  >(undefined);
  // The drawer closes for a choice or for the width: neither returns focus
  // through the drawer's own way back.
  const choosing = useRef(false);
  const widening = useRef(false);
  const skipRailRestore = () => {
    const skip = choosing.current || widening.current;
    choosing.current = false;
    return skip;
  };
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver !== "function") return;
    const read = () => {
      const width = element.getBoundingClientRect().width;
      const rem = parseFloat(getComputedStyle(element).fontSize) || 16;
      // Not laid out yet (0): not narrow.
      setNarrow(width > 0 && width < 40 * rem);
    };
    const observer = new ResizeObserver(read);
    observer.observe(element);
    read();
    return () => observer.disconnect();
  }, []);
  const wasNarrow = useRef(narrow);
  useLayoutEffect(() => {
    if (wasNarrow.current && !narrow && railOpen) {
      widening.current = true;
      setRailOpen(false);
    }
    wasNarrow.current = narrow;
  }, [narrow, railOpen]);
  // N2: the drawer closed because the chat became wide while focus was in
  // it: on to the same conversation in the page rail, else the rail, else
  // the transcript box.
  useLayoutEffect(() => {
    if (!widening.current || railOpen) return;
    widening.current = false;
    const was = railFocused.current;
    railFocused.current = undefined;
    if (!was || was.element.isConnected) return;
    const rail = root.current?.querySelector<HTMLElement>(
      '[data-part="rail"] nav',
    );
    const item = was.id
      ? [
          ...(rail?.querySelectorAll<HTMLElement>("[data-conversation-id]") ??
            []),
        ]
          .find((row) => row.getAttribute("data-conversation-id") === was.id)
          ?.querySelector<HTMLElement>("button")
      : undefined;
    focusFor(chatFocus.value, item ?? rail ?? transcript.current, {
      owner: was.owner,
      stillCurrent: () => chatFocus.value.owner() === was.owner,
      removed: was.element,
      fallback: transcript.current,
    });
  });
  // FU13: how many distinct new assistant replies arrived since the
  // transcript was unpinned, for this client and conversation. The live
  // region already says each batch, so the count adds no announcement.
  const seenWhenUnpinned = useRef<
    { owner: string; ids: ReadonlySet<string> } | undefined
  >(undefined);
  const shownOwner = chatFocus.value.owner();
  if (position.pinned || !messages.length) seenWhenUnpinned.current = undefined;
  else if (seenWhenUnpinned.current?.owner !== shownOwner)
    seenWhenUnpinned.current = {
      owner: shownOwner,
      ids: new Set(messages.map((message) => message.id)),
    };
  const seen = seenWhenUnpinned.current;
  const newReplies = seen
    ? messages.filter(
        (message) => message.role === "assistant" && !seen.ids.has(message.id),
      ).length
    : 0;
  const markdownModule = useMarkdownModule();
  // A replacement that can hide message text leaves what a message visibly
  // shows unknown: only the host's own excerpt may then name its content.
  const visibilityUnknown = Boolean(
    provider.renderers?.markdown ||
    provider.parts?.bubble ||
    provider.parts?.transcript ||
    slots?.bubble ||
    slots?.transcript,
  );
  // Each shown message is projected once per source and policy; the cache
  // keeps nothing of messages, conversations or clients no longer shown.
  const projections = useRef(new ExcerptCache()).current;
  projections.begin(
    ownerKey(client, shownId ?? ""),
    [
      visibilityUnknown,
      provider.messageExcerpt,
      markdownModule,
      provider.markdownImages?.origin,
      provider.markdownImages?.allow,
      provider.extraUrlSchemes?.join(" "),
    ],
    messages.map((message) => ({
      id: message.id,
      source: visibilityUnknown ? message : message.content,
    })),
  );
  const excerptOf = (message: Message) => {
    if (visibilityUnknown)
      return projections.get(message.id, message, (shown) => {
        const host = provider.messageExcerpt?.(shown);
        return host === undefined ? undefined : excerpt(host);
      });
    if (!markdownModule) return undefined;
    return projections.get(message.id, message.content, (content) =>
      excerpt(
        markdownModule.visibleText(content, {
          images: provider.markdownImages,
          extraSchemes: provider.extraUrlSchemes,
        }),
      ),
    );
  };
  // Each shown message's body is parsed once per version of what it says
  // (its text and sources); a message no longer shown takes its parse with
  // it at the next render.
  const parses = useRef(new ShownCache<ReactNode>()).current;
  const bodies = useMemo(
    () =>
      messages.map((message) => ({
        id: message.id,
        source: bodySource(message),
      })),
    [messages],
  );
  parses.begin(
    ownerKey(client, shownId ?? ""),
    [markdownModule, provider.extraUrlSchemes?.join(" "), renderRetry],
    bodies,
  );
  // Labels are made only while the outline shows them.
  const excerpts = outlineOpen ? messages.map(excerptOf) : [];
  const liveRegion = useRef<HTMLDivElement>(null);
  const announcement = useAnnouncements(
    client,
    state.conversation,
    excerptOf,
    t,
    liveRegion,
  );
  // A flow run started by a press here. Focus moves to the composer only
  // when this run's own navigation succeeded and its conversation is
  // shown; a run that fails says so, with a Retry, and moves nothing.
  const flowTabsId = useDomId("flows");
  // A Retry that goes hands focus to the retried flow's row, else the panel.
  const retriedFlow = useRef("");
  const flowHandoff = useHandoff(() => {
    const panel = root.current?.querySelector(`[id="${flowTabsId}-panel"]`);
    return [
      panel?.querySelector(`[data-flow="${retriedFlow.current}"] button`),
      panel,
    ];
  });
  const flowsPanel = useChunk(flowsChunk);
  const showsFlows = enabled("flows");
  useEffect(() => {
    if (showsFlows) flowsChunk.request();
  }, [showsFlows]);
  const [failedFlow, setFailedFlow] = useState<
    { id: string; owner: string; values: Record<string, unknown> } | undefined
  >(undefined);
  const runFlowPress = (
    flowId: string,
    values: Record<string, unknown> = {},
  ) => {
    // The run belongs to the client it was pressed on; a replacement
    // client owns none of it.
    const pressed = client;
    const shownOwner = chatFocus.value.owner();
    const key = ownerKey(pressed, `flow:${flowId}`);
    const origin = chatFocus.value.originFor("run-flow", key);
    setFailedFlow(undefined);
    void pressed.runFlow(flowId, values).then(
      (opened) => {
        const owner = opened && ownerKey(pressed, opened);
        focusFor(chatFocus.value, field.current, {
          origin,
          owner: key,
          stillCurrent: () =>
            !!owner &&
            chatFocus.value.owner() === owner &&
            pressed.getSnapshot().conversation?.id === opened,
        });
      },
      () => {
        // A run that failed moved nothing; its Retry runs it again.
        retireOrigin(origin);
        setFailedFlow({ id: flowId, owner: shownOwner, values });
      },
    );
  };
  const row = state.replyState;
  // The reply being written, while the reply row says so: whatever ended it
  // (a failure, a lost stream) ends its busy state too.
  const last = messages.at(-1);
  const writingId =
    row === "writing" && last?.status === "writing" ? last.id : undefined;
  // The host ended the reply itself: the reply says so, and the message
  // region announces it, so the row's live region stays quiet.
  const endedInReply =
    last?.role === "assistant" &&
    (last.status === "failed" || last.status === "unavailable") &&
    row === last.status;
  // Held while a modal drawer makes the row inert; said once it is live.
  const replyRow = useRef<HTMLDivElement>(null);
  const heldRow = useHeldWhileInert(row, replyRow);
  const respond = (block: Block, messageId: string) => (reply: CardAnswer) => {
    const pressed = deepActiveElement(document);
    const id = cardReplyId(state.conversationId, messageId, block.id, reply);
    // A press while the same answer is in flight leaves the id to it;
    // otherwise this press frees it however the answer ends, a call that
    // failed outright included.
    const owned = !checking.current.has(id);
    checking.current.add(id);
    void answerCard(block, reply, messageId).then((outcome) => {
      if (owned) checking.current.delete(id);
      const now = client.getSnapshot();
      // Refused, and the read after it shows the card answered: it was
      // answered elsewhere (another tab, an earlier page), which the
      // problem then says instead of the generic refusal.
      if (
        outcome?.accepted === false &&
        outcome.problem?.code === "refused" &&
        now.conversation?.messages
          .find((message) => message.id === messageId)
          ?.blocks.find((shown) => shown.id === block.id)?.answered
      )
        answeredElsewhere.current = now.problem;
      pressedAnswer.current = pressed;
      settleCard((count) => count + 1);
    });
  };
  useLayoutEffect(() => {
    const pressed = pressedAnswer.current;
    const root = chatFocus.value.root();
    pressedAnswer.current = null;
    // Only while focus is still nowhere: not once the user went on.
    if (pressed && root)
      moveFocus(focusable(pressed) ? pressed : chatFocus.value.composer(), {
        root,
        owner: "",
        removed: pressed,
      });
  }, [settledCards]);
  const elsewhere =
    !!state.problem && state.problem === answeredElsewhere.current;
  const problem =
    state.problem && !checking.current.has(state.problem.id)
      ? (provider.problemText?.(state.problem, {
          answeredElsewhere: elsewhere,
        }) ??
        (elsewhere
          ? { text: t("chat.problem.answered") || t("chat.failure") }
          : defaultProblemText(state.problem, t)))
      : null;
  const plan = state.plan;
  const planView = recovery.view;
  // The problem the alert says, when it says one.
  const shownProblem =
    problem &&
    state.problem?.id !== "conversation-unavailable" &&
    // The recovery panel states a protected plan's stop itself.
    !(state.problem?.code === "stopped" && planView?.status) &&
    // A confirmation refusal is shown with the confirmation.
    !state.problem?.confirmation &&
    !(
      state.conversationUnavailable && state.problem?.id === "conversation-read"
    )
      ? state.problem
      : undefined;
  // Where the problem is shown: one about a message that could not be sent
  // is shown with that message; any other is about the conversation and is
  // shown after the composer.
  const messageProblem =
    shownProblem &&
    state.pending.some((row) => row.failure && row.id === shownProblem.id)
      ? shownProblem
      : undefined;
  const conversationProblem = messageProblem ? undefined : shownProblem;
  const confirmEntry = planView?.actions.find(
    (entry) => entry.id === "confirm",
  );
  const stopEntry = planView?.actions.find((entry) => entry.id === "stop");
  // Only a record bound to this plan, this conversation and its revision.
  const record = confirmationOf(plan, state.conversationId);
  // Rule: only the record shown is confirmed. The press checks, before any
  // await, that the client's current record still has the token rendered.
  const confirmShown = (token: string) => {
    if (confirming) return;
    const now = client.getSnapshot();
    if (confirmationOf(now.plan, now.conversationId)?.token !== token) {
      setChanged(token);
      return;
    }
    setChanged(undefined);
    setConfirming(true);
    void client.confirmPlan().finally(() => setConfirming(false));
  };
  // The host's refusal of the confirmation attempt for the shown record,
  // as the client recorded it: never another reply's problem.
  const answer = state.confirmationRefusal;
  const refusal =
    answer?.token === record?.token && answer?.problemId === state.problem?.id
      ? state.problem?.confirmation?.reason
      : undefined;
  const replaced = changed !== undefined && changed !== record?.token;
  // Wide, the plan has its own column after the conversation. Narrow, it
  // is read where it is decided: after the messages, before the composer,
  // as a region of the conversation rather than a top-level aside.
  const PlanRegion = narrow ? "section" : "aside";
  // The host's confirmation lists the changes; the steps then do not.
  const changesShown =
    plan?.state === "awaiting-confirmation" &&
    !planView?.readOnly &&
    record !== undefined;
  const planPanel =
    enabled("plans") && plan ? (
      <PlanRegion aria-label={t("chat.plan")} data-plan="">
        <PlanDiagram
          record={plan}
          slots={slots}
          view={planView}
          changesShown={changesShown}
        />
        <Part
          name="confirmBar"
          slots={slots}
          data={
            planView
              ? {
                  view: planView,
                  actions: planView.actions.filter((entry) =>
                    planView.status
                      ? entry.id === "confirm"
                      : entry.id === "confirm" || entry.id === "stop",
                  ),
                }
              : undefined
          }
        >
          {plan.state === "awaiting-confirmation" && !planView?.readOnly ? (
            <Part
              name="confirmation"
              slots={slots}
              data={record && { confirmation: record }}
            >
              <Suspense fallback={null}>
                <LazyConfirmation
                  record={record}
                  planId={plan.id}
                  entry={
                    confirmEntry &&
                    (confirming
                      ? { ...confirmEntry, available: false, busy: true }
                      : confirmEntry)
                  }
                  onConfirm={() => record && confirmShown(record.token)}
                  refusal={refusal}
                  override={provider.problemText && problem}
                  replaced={replaced}
                />
              </Suspense>
            </Part>
          ) : null}
          {!planView?.status && stopEntry ? (
            <ActionButton
              action={stopEntry}
              onPress={onStop ?? (() => client.stopPlan())}
            />
          ) : null}
        </Part>
        {planView?.status ? (
          <RecoveryPanel
            view={planView}
            onPress={recovery.press}
            slots={slots}
            sheet={recovery.sheet}
            hide={["confirm"]}
          />
        ) : null}
      </PlanRegion>
    ) : null;
  // Narrow, the plan follows the messages. When the reply that presents it
  // is the last message (it holds the plan's block, and nothing was sent
  // after it), that reply's actions follow the plan, so the reply reads as
  // its text, the plan, then Copy and the ratings.
  const lastMessage = messages.at(-1);
  const actionsAfterPlan =
    narrow &&
    planPanel &&
    !state.pending.length &&
    lastMessage?.blocks.some(
      (block) =>
        block.type === "plan" &&
        (block.body as { planId?: unknown } | null)?.planId === plan?.id,
    )
      ? lastMessage
      : undefined;
  // A row renders again only when what it shows changes: its message (a
  // patch keeps every other message's identity), its flags, and these
  // events, which keep one identity and call the current render's own.
  const respondNow = useRef(respond);
  respondNow.current = respond;
  const rows = useMemo<RowEvents>(
    () => ({
      respond: (block, messageId) => (reply) =>
        respondNow.current(block, messageId)(reply),
      parses,
    }),
    [parses],
  );
  const answeredOf = (message: Message) =>
    message.blocks
      .map((block) => (isAnswered(block, message.id) ? "1" : "0"))
      .join("");
  return (
    <ChatFocusContext.Provider value={chatFocus.value}>
      <section
        ref={root}
        className="waypoint"
        dir={provider.dir ?? "ltr"}
        lang={provider.lang}
        data-layout={layout}
        data-color-scheme={provider.colorScheme ?? "light"}
        // Colours the library did not choose or check (a `theme` prop).
        data-custom-theme={provider.theme ? "" : undefined}
        style={
          {
            ...themeProperties(tokens),
            // Native controls and scrollbars follow the chat's scheme.
            colorScheme: provider.colorScheme ?? "light",
          } as CSSProperties
        }
        {...chatFocus.captureProps}
        onKeyDown={(event) => {
          // Only a key pressed inside this chat's own DOM, with focus resting
          // here and not in a field, moves focus to the composer.
          if (
            shortcuts?.focusComposer === false ||
            event.key !== (shortcuts?.focusComposer ?? "/") ||
            !composedContains(
              event.currentTarget,
              deepTarget(event.nativeEvent) as Node | null,
            ) ||
            !focusRestsIn(event.currentTarget) ||
            // An open modal drawer keeps the keyboard to itself.
            event.currentTarget.querySelector(MODAL_SELECTOR)
          )
            return;
          event.preventDefault();
          field.current?.focus();
        }}
      >
        <div
          className="wp-shell"
          data-has-aside={
            (enabled("plans") && plan) || extraPanels ? "" : undefined
          }
          data-has-rail={
            hasRail || slots?.rail || provider.parts?.rail ? "" : undefined
          }
        >
          {narrow ? null : (
            <Part name="rail" slots={slots}>
              <ConversationRail
                conversations={conversations}
                source={conversationSource}
              />
            </Part>
          )}
          <main>
            <Part name="topBar" slots={slots}>
              {narrow && hasRail ? (
                <span data-rail-toggle="">
                  <B
                    aria-expanded={railOpen}
                    aria-controls={railId}
                    onPress={() => setRailOpen((open) => !open)}
                  >
                    {t("chat.rail")}
                  </B>
                </span>
              ) : null}
              <h2>{state.conversation?.title || t("chat.title")}</h2>
            </Part>
            {narrow && railOpen && !railRetired ? (
              <RailDrawer
                label={t("chat.rail")}
                closeLabel={t("chat.close")}
                onClose={() => setRailOpen(false)}
                skipRestore={skipRailRestore}
                onFocusWithin={(target) => {
                  const item = target.closest("[data-conversation-id]");
                  railFocused.current = {
                    element: target,
                    id: item?.getAttribute("data-conversation-id") ?? undefined,
                    owner: chatFocus.value.owner(),
                  };
                }}
              >
                <div id={railId}>
                  <ConversationRail
                    conversations={conversations}
                    source={conversationSource}
                    onChoose={() => {
                      // In the press: back to the toggle while the drawer's
                      // owner is still current, then the switch may move
                      // focus on to the composer once its read loads.
                      const origin = chatFocus.value.originFor("rail-choice");
                      choosing.current = true;
                      focusFor(
                        chatFocus.value,
                        root.current?.querySelector<HTMLElement>(
                          "[data-rail-toggle] button",
                        ),
                        { origin, owner: chatFocus.value.owner() },
                      );
                      setRailOpen(false);
                    }}
                  />
                </div>
              </RailDrawer>
            ) : null}
            <Part name="transcript" slots={slots}>
              <div onFocusCapture={recordTranscriptFocus}>
                {messages.length ? (
                  <TranscriptOutline
                    messages={messages}
                    excerpts={excerpts}
                    anchor={anchor}
                    open={outlineOpen}
                    onToggle={() =>
                      setOutline({
                        conversationId: shownId,
                        open: !outlineOpen,
                      })
                    }
                    onNavigate={(messageId) => {
                      const origin = chatFocus.value.originFor("outline");
                      focusFor(chatFocus.value, position.toMessage(messageId), {
                        origin,
                        owner: chatFocus.value.owner(),
                      });
                    }}
                  />
                ) : null}
                <div
                  ref={transcript}
                  className="wp-transcript"
                  role="region"
                  aria-label={t("chat.transcript")}
                  tabIndex={-1}
                >
                  <RenderFailures.Provider value={renderFailures}>
                    <div ref={transcriptContent}>
                      {!state.conversation &&
                      !state.conversationUnavailable &&
                      !state.problem ? (
                        <p>{t("chat.startupLoading")}</p>
                      ) : !messages.length ? (
                        <Part name="emptyState" slots={slots}>
                          <p>{t("chat.empty")}</p>
                        </Part>
                      ) : null}
                      {messages.map((message) => (
                        <MessageRow
                          key={message.id}
                          message={message}
                          slots={slots}
                          anchorId={anchor(message.id)}
                          writing={message.id === writingId}
                          bodyUnavailable={
                            failedBodies.has(message.id) &&
                            !message.blocks.length
                          }
                          disabled={state.conversationUnavailable}
                          answered={answeredOf(message)}
                          actions={message !== actionsAfterPlan}
                          rows={rows}
                        />
                      ))}
                      {state.pending.map((pending) => (
                        <article
                          key={pending.id}
                          data-role="pending"
                          aria-label={t("chat.roleUser")}
                        >
                          <Part
                            name="bubble"
                            slots={slots}
                            data={{ pending: pendingSummary(pending) }}
                          >
                            <span data-sender="" aria-hidden="true">
                              {t("chat.roleUser")}
                            </span>
                            <p>{pending.content}</p>
                          </Part>
                          <p
                            id={`${pendingId}-${pending.id}`}
                            data-pending-status={
                              pending.failure ? "failed" : "sending"
                            }
                          >
                            {t(
                              pending.failure
                                ? "chat.pendingFailed"
                                : "chat.pendingSending",
                            )}
                          </p>
                          {/* Its own problem, said here. Its Retry is the
                              message's own, below; a Refresh the problem
                              asks for stays with it. */}
                          {messageProblem?.id === pending.id && problem ? (
                            <p role="alert" key={state.announcement}>
                              {problem.text}
                              {problem.action ??
                                (!provider.problemText &&
                                problemAction(messageProblem) === "refresh" ? (
                                  <ProblemAction
                                    problem={messageProblem}
                                    refresh={retrying}
                                  />
                                ) : null)}
                            </p>
                          ) : null}
                          {pending.failure ? (
                            <Part
                              name="failedSendControls"
                              slots={slots}
                              data={{ pending: pendingSummary(pending) }}
                            >
                              <B
                                aria-describedby={`${pendingId}-${pending.id}`}
                                disabled={
                                  state.conversationUnavailable || state.sending
                                }
                                onPress={() => {
                                  void client.retry(pending.id);
                                }}
                              >
                                {t("chat.retry")}
                              </B>
                              <B
                                aria-describedby={`${pendingId}-${pending.id}`}
                                disabled={state.withdrawing.includes(
                                  pending.id,
                                )}
                                onPress={() => {
                                  void client.withdraw(pending.id);
                                }}
                              >
                                {t("chat.withdraw")}
                              </B>
                              <B
                                aria-describedby={`${pendingId}-${pending.id}`}
                                onPress={() => {
                                  void client.dismiss(pending.id);
                                }}
                              >
                                {t("chat.dismiss")}
                              </B>
                            </Part>
                          ) : null}
                          {messageProblem?.id === pending.id ? (
                            <ProblemDetails
                              key={state.announcement}
                              problem={messageProblem}
                            />
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </RenderFailures.Provider>
                </div>
                {failedBodies.size ? (
                  <p role="alert" data-render-failure="">
                    {t("chat.messagesUnavailable")}
                    <B
                      onPress={() => {
                        markdownChunk.request(true);
                        setRenderRetry((count) => count + 1);
                      }}
                    >
                      {t("chat.retry")}
                    </B>
                  </p>
                ) : null}
                {position.pinned ? null : (
                  <div data-back-to-latest="">
                    <B
                      onPress={() => {
                        const origin = chatFocus.value.originFor("latest");
                        position.toLatest();
                        focusFor(chatFocus.value, transcript.current, {
                          origin,
                          owner: chatFocus.value.owner(),
                        });
                      }}
                    >
                      {newReplies
                        ? t("chat.latestNew", { count: newReplies })
                        : t("chat.latest")}
                    </B>
                  </div>
                )}
              </div>
            </Part>
            <Part name="replyRow" slots={slots}>
              <div ref={replyRow} role="status" data-reply-state={row}>
                {heldRow === "none" || endedInReply ? null : (
                  <p
                    // A reply being written shows it in its bubble: the row
                    // says it once, to assistive technology only.
                    className={
                      heldRow === "writing" && writingId
                        ? "wp-sr-only"
                        : undefined
                    }
                  >
                    {t(`reply.${heldRow}`)}
                  </p>
                )}
              </div>
              {row !== "none" || state.toolSteps.length ? (
                <ReplyControls client={client} row={row} />
              ) : null}
            </Part>
            {narrow ? planPanel : null}
            {actionsAfterPlan ? (
              <RowActions slots={slots} message={actionsAfterPlan} />
            ) : null}
            {enabled("flows") ? (
              <Part name="flowTabs" slots={slots}>
                <nav aria-label={t("chat.flows")}>
                  <div
                    role="tablist"
                    onKeyDown={(event) => {
                      const tabs = state.flowTabs;
                      const index = tabs.findIndex(
                        (tab) => flowTabId(tab) === state.flowTab,
                      );
                      let next: number;
                      if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = tabs.length - 1;
                      else if (
                        event.key === "ArrowRight" ||
                        event.key === "ArrowLeft"
                      ) {
                        // Arrows follow the visual order: in a right-to-left
                        // chat, ArrowRight goes to the previous tab.
                        const direction = getComputedStyle(
                          event.currentTarget,
                        ).direction;
                        const forward =
                          (event.key === "ArrowRight") !==
                          ((direction === "rtl" || direction === "ltr"
                            ? direction
                            : provider.dir) ===
                            "rtl");
                        next =
                          (index + (forward ? 1 : tabs.length - 1)) %
                          tabs.length;
                      } else return;
                      // Only keys pressed on this tablist's own DOM, with focus
                      // in it, move between its tabs.
                      const list = event.currentTarget;
                      if (
                        !composedContains(
                          list,
                          deepTarget(event.nativeEvent) as Node | null,
                        ) ||
                        !composedContains(
                          list,
                          deepActiveElement(list.ownerDocument),
                        )
                      )
                        return;
                      event.preventDefault();
                      client.selectFlowTab(tabs[next]!);
                      event.currentTarget
                        .querySelectorAll<HTMLElement>('[role="tab"]')
                        [next]?.focus();
                    }}
                  >
                    {state.flowTabs.map((tab) => (
                      <B
                        key={flowTabId(tab)}
                        id={`${flowTabsId}-${flowTabId(tab)}`}
                        aria-controls={`${flowTabsId}-panel`}
                        role="tab"
                        aria-selected={state.flowTab === flowTabId(tab)}
                        tabIndex={state.flowTab === flowTabId(tab) ? 0 : -1}
                        label={
                          typeof tab === "string"
                            ? t(`flow.${tab}`)
                            : (provider.flowTabLabel?.(tab.labelKey) ??
                              tab.labelKey)
                        }
                        onPress={() => client.selectFlowTab(tab)}
                      >
                        {typeof tab === "string"
                          ? t(`flow.${tab}`)
                          : (provider.flowTabLabel?.(tab.labelKey) ??
                            tab.labelKey)}
                      </B>
                    ))}
                  </div>
                  {failedFlow &&
                  failedFlow.owner === chatFocus.value.owner() ? (
                    <LoadFailure
                      onFocus={(event) => {
                        retriedFlow.current = failedFlow.id;
                        flowHandoff(event);
                      }}
                      onRetry={() =>
                        runFlowPress(failedFlow.id, failedFlow.values)
                      }
                    />
                  ) : null}
                  {flowsPanel.status === "ready" ? (
                    <flowsPanel.module.FlowPanel
                      id={`${flowTabsId}-panel`}
                      labelledBy={`${flowTabsId}-${state.flowTab}`}
                      flows={state.flows[state.flowTab]}
                      all={state.flows}
                      list={flowList}
                      onRetryList={loadFlows}
                      onRunFlow={runFlowPress}
                    />
                  ) : (
                    // The panel's code is loading, or failed with a Retry.
                    <div
                      id={`${flowTabsId}-panel`}
                      role="tabpanel"
                      aria-labelledby={`${flowTabsId}-${state.flowTab}`}
                      tabIndex={-1}
                      onFocus={flowHandoff}
                    >
                      {flowsPanel.status === "failed" ||
                      retryingLoad(flowsPanel) ? (
                        <LoadFailure
                          retrying={retryingLoad(flowsPanel)}
                          onRetry={() => flowsChunk.request(true)}
                        />
                      ) : (
                        <p>{t("chat.loading")}</p>
                      )}
                    </div>
                  )}
                </nav>
              </Part>
            ) : null}
            {state.restored.length ? (
              <section aria-label={t("chat.restored")}>
                {state.restored.map((item) => (
                  <article key={item.id}>
                    <p>{item.content}</p>
                    <B
                      onPress={() => {
                        void client.editRestored(item.id);
                      }}
                    >
                      {t("chat.restoredEdit")}
                    </B>
                    <B
                      onPress={() => {
                        void client.discardRestored(item.id);
                      }}
                    >
                      {t("chat.restoredDiscard")}
                    </B>
                  </article>
                ))}
              </section>
            ) : null}
            <Part
              name="composer"
              slots={slots}
              data={{ sending: state.sending }}
              disabled={state.conversationUnavailable}
              value={state.draft}
              onChange={(value) => {
                void client.setDraft(value);
              }}
            >
              <T
                inputRef={field}
                disabled={state.conversationUnavailable}
                value={state.draft}
                onChange={(value) => {
                  void client.setDraft(value);
                }}
                label={t("chat.message")}
                describedBy={
                  state.hints.length
                    ? state.hints
                        .map((_, index) => `${hintId}-${index}`)
                        .join(" ")
                    : undefined
                }
                onKeyDown={(event) => {
                  if (shortcuts?.send === false) return;
                  if (
                    event.key === (shortcuts?.send ?? "Enter") &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
                    event.preventDefault();
                    void client.send();
                  }
                }}
              />
              <B
                disabled={
                  state.conversationUnavailable ||
                  !state.draft.trim() ||
                  state.sending
                }
                onPress={() => {
                  void client.send();
                }}
              >
                {t(state.sending ? "chat.sending" : "chat.send")}
              </B>
              {state.hints.map((hint, index) => (
                <p key={index} id={`${hintId}-${index}`}>
                  {hint}
                </p>
              ))}
            </Part>
            <Part name="actionBar" slots={slots}>
              {suggestions.map((suggestion) => (
                <B
                  key={suggestion}
                  onPress={() => {
                    void client.setDraft(suggestion);
                  }}
                >
                  {suggestion}
                </B>
              ))}
            </Part>
            <Part
              name="stepUpPrompt"
              slots={slots}
              data={
                plan?.plan.kind === "immediate" && plan.plan.stage === "final"
                  ? { stepUpCount: plan.plan.stepUpCount }
                  : undefined
              }
            />
            <Part name="quotaStrip" slots={slots}>
              {quota}
            </Part>
            <div
              ref={liveRegion}
              className="wp-sr"
              role="status"
              data-announcements=""
            >
              {announcement}
            </div>
            <div role="alert" data-announcement={state.announcement}>
              {state.conversationUnavailable && (
                <span>
                  {t("chat.conversationUnavailable")}
                  <B
                    onPress={reload.press}
                    aria-busy={reload.busy || undefined}
                    aria-disabled={reload.busy || undefined}
                  >
                    {t("chat.reload")}
                  </B>
                </span>
              )}
              {conversationProblem && problem ? (
                <span key={state.announcement}>
                  {problem.text}
                  {problem.action ??
                    (state.problem && !provider.problemText ? (
                      <ProblemAction
                        problem={state.problem}
                        refresh={retrying}
                      />
                    ) : null)}
                </span>
              ) : null}
            </div>
            {conversationProblem ? (
              <ProblemDetails
                key={state.announcement}
                problem={conversationProblem}
              />
            ) : null}
          </main>
          {narrow ? null : planPanel}
          {extraPanels ? <Part name="extraPanels" slots={slots} /> : null}
        </div>
      </section>
    </ChatFocusContext.Provider>
  );
}

export function ConfirmSheet({
  title,
  body,
  busy = false,
  onProceed,
  onCancel,
}: {
  title: string;
  body: string;
  busy?: boolean;
  onProceed(): void;
  onCancel(): void;
}) {
  const provider = useContext(Context);
  const t = provider?.format ?? createFormatter();
  const ui = provider?.primitives ?? defaults;
  const D = ui.drawer;
  const drawerFocus = useDrawerFocus("confirm-sheet");
  // Its action belongs to the conversation it opened in.
  const retired = useRetiredOnSwitch(true, useChatFocus()?.owner(), onCancel);
  const B = ui.button;
  if (retired) return null;
  return (
    <ModalDrawer
      as={D}
      open
      label={title}
      onClose={onCancel}
      closeLabel={t("chat.close")}
      {...drawerFocus}
    >
      <p>{body}</p>
      <B disabled={busy} onPress={onProceed}>
        {t("chat.confirm")}
      </B>
      <B onPress={onCancel}>{t("chat.cancel")}</B>
    </ModalDrawer>
  );
}
