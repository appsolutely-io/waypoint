/* Generated from schema.json. */

export type WaypointProtocol =
  | Problem
  | Negotiation
  | NegotiationOfferWire
  | Negotiated
  | CanonicalRequest
  | ReadTemplate
  | Step
  | ImmediateDraft
  | ImmediatePlan
  | TimedPlan
  | Plan
  | PlanState
  | Outcome
  | ConfirmationItem
  | ConfirmationSchedule
  | ConfirmationRecord
  | PlanRecord
  | RecoveryPhase
  | IntentKind
  | WinnerKind
  | IntentCause
  | IntentWinner
  | RecoveryView
  | IntentTarget
  | IntentRequest
  | PlanIntentReply
  | ExecutionAcceptance
  | ReplyDecline
  | CardAnswer
  | BlockMarkdown
  | BlockCard
  | BlockDetails
  | BlockList
  | BlockTable
  | BlockForm
  | BlockChoice
  | BlockButtons
  | BlockDiff
  | BlockPlan
  | BlockRouteLink
  | BlockNotice
  | ExtensionBlock
  | Block
  | Message
  | Source
  | Conversation
  | ReplyMessage
  | ReplyConfirm
  | ReplyForm
  | ReplyAction
  | ReplyToolResult
  | ReplyPlanValues
  | Reply
  | ReplyStop
  | ManifestEntry
  | ToolCall
  | FrameMessageStart
  | FrameTextDelta
  | FrameBlock
  | FramePlanDraft
  | FramePlanFinal
  | FramePlanStep
  | FrameToolCall
  | FramePlanningRead
  | FrameMessageEnd
  | FrameStale
  | FrameProblem
  | Frame
  | FlowParameter
  | Flow
  | CreateConversation
  | PlanCommand
  | RunFlow
  | PatchFlow
  | FormSubject
  | FormValidation
  | FormFillValue
  | FormFillField
  | FormFillRequest
  | BlockFormFill
  | ReplyFormFill
  | LeaveAcknowledgment
  | DecisionVersions
  | KeptFact
  | FinalHistory;
export type Plan = ImmediateDraft | ImmediatePlan | TimedPlan;
export type PlanState =
  | 'proposed'
  | 'awaiting-confirmation'
  | 'running'
  | 'undoing'
  | 'completed'
  | 'submitted'
  | 'undone'
  | 'needs-attention'
  | 'cancelled';
export type WinnerKind = 'stop' | 'cancel-initial' | 'cancel-review' | 'leave' | 'keep';
export type IntentCause =
  | 'user'
  | 'connection-lost'
  | 'renewal-refused'
  | 'step-failed'
  | 'step-up-failed'
  | 'identity-lost'
  | 'attribution-missing'
  | 'plan-changed'
  | 'adapter-configuration';
export type RecoveryPhase =
  | 'proposal'
  | 'initial-review'
  | 'forward-active'
  | 'readback'
  | 'completed'
  | 'cancelled'
  | 'left-known'
  | 'left-unconfirmed'
  | 'left-reopened';
export type IntentKind = 'stop' | 'cancel-initial' | 'cancel-review' | 'leave' | 'keep';
/**
 * The answer the host applied to a card, as it was sent without its protocol; only with answered. A host may leave out a form's values.
 */
export type CardAnswer =
  | {
      kind: 'action';
      clientReplyId: string;
      blockId: string;
      actionId: string;
    }
  | {
      kind: 'form';
      clientReplyId: string;
      blockId: string;
      values?: {};
    };
export type Block =
  | BlockMarkdown
  | BlockCard
  | BlockDetails
  | BlockList
  | BlockTable
  | BlockForm
  | BlockChoice
  | BlockButtons
  | BlockDiff
  | BlockPlan
  | BlockRouteLink
  | BlockNotice
  | BlockFormFill
  | ExtensionBlock;
export type Conversation = {
  [k: string]: unknown;
} & {
  protocol: string;
  id: string;
  title: string;
  messages: Message[];
  replyOverdueAt?: number | null;
  replyStatus?: 'expected' | 'unavailable' | 'failed' | 'complete';
  mode?: 'form-fill';
  subject?: FormSubject;
  parentConversationId?: string;
  field?: string;
};
export type FormSubject = {
  [k: string]: unknown;
} & {
  key: string;
  resource: string;
  label: string;
  route: string;
  state: 'pending' | 'bound' | 'unlinked';
  record?: string;
};
export type Reply =
  ReplyMessage | ReplyConfirm | ReplyForm | ReplyAction | ReplyToolResult | ReplyPlanValues | ReplyFormFill | ReplyStop;
export type Frame =
  | FrameMessageStart
  | FrameTextDelta
  | FrameBlock
  | FramePlanDraft
  | FramePlanFinal
  | FramePlanStep
  | FrameToolCall
  | FramePlanningRead
  | FrameMessageEnd
  | FrameStale
  | FrameProblem;
export type Flow = {
  [k: string]: unknown;
} & {
  format: '1.0';
  id: string;
  title: string;
  kind: 'structured' | 'prompt';
  parameters: FlowParameter[];
  steps?: {
    operation: string;
    arguments: {};
  }[];
  tags: string[];
  body: string;
};
export type CreateConversation = {
  [k: string]: unknown;
} & {
  protocol: string;
  title: string;
  mode?: 'form-fill';
  subject?: FormSubject;
  parentConversationId?: string;
  field?: string;
  clientCreationId?: string;
};

export interface Problem {
  code:
    | 'update-required'
    | 'in-doubt'
    | 'replaced'
    | 'retryable'
    | 'refused'
    | 'closed'
    | 'full'
    | 'declined'
    | 'unavailable'
    | 'sign-in'
    | 'rate-limited'
    | 'step-up-cancelled'
    | 'mismatch'
    | 'invalid-read'
    | 'invalid-plan'
    | 'needs-attention'
    | 'stopped'
    | 'plan-changed'
    | 'agreement-expired';
  id: string;
  retryAfter?: number;
  /**
   * Why a confirmation was refused; only with code refused.
   */
  confirmation?: {
    reason: 'expired' | 'used' | 'stale' | 'mismatch' | 'missing';
  };
}
export interface Negotiation {
  protocol: string;
  supported: string[];
  offer?: NegotiationOfferWire;
}
export interface NegotiationOfferWire {
  capabilities: string[];
}
export interface Negotiated {
  protocol: string;
  capabilities: string[];
  agreementId?: string;
}
export interface CanonicalRequest {
  method: 'POST' | 'PUT' | 'PATCH' | 'GET';
  path: string;
  body: string;
  headers: {
    [k: string]: string;
  };
  digest: string;
}
export interface ReadTemplate {
  method: 'GET';
  path: string;
  rows: string[];
  fields: string[];
}
export interface Step {
  id: string;
  operation: string;
  resource: string;
  rows: string[];
  fields: string[];
  view: string;
  tier: 'low' | 'sensitive';
  undo: string;
  stepUp: boolean;
  request?: CanonicalRequest;
  before?: {};
  after?: {};
  planningRead?: ReadTemplate;
}
export interface ImmediateDraft {
  kind: 'immediate';
  stage: 'draft';
  id: string;
  steps: (Step & {
    [k: string]: unknown;
  })[];
}
export interface ImmediatePlan {
  kind: 'immediate';
  stage: 'final';
  id: string;
  digest: string;
  steps: (Step & {
    [k: string]: unknown;
  })[];
  stepUpCount: number;
}
export interface TimedPlan {
  kind: 'timed';
  id: string;
  values: {
    [k: string]: {
      [k: string]: unknown;
    };
  };
  start: string | null;
  end: string | null;
}
export interface Outcome {
  stepId: string;
  status: number;
  attributed: boolean;
  version?: string;
  /**
   * The host's plain words for why the step failed, shown to the user; only for a failed step. Optional.
   */
  reason?: string;
  /**
   * Whether the failed step can be tried again. Optional.
   */
  retryable?: boolean;
}
export interface ConfirmationItem {
  label: string;
  before?: string;
  after?: string;
  note?: string;
}
export interface ConfirmationSchedule {
  start: string | null;
  end: string | null;
  startText: string;
  endText: string;
}
/**
 * What the host will apply, issued and worded by the host; confirmed only by sending its single-use token.
 */
export interface ConfirmationRecord {
  token: string;
  expiresAt: string;
  planId: string;
  conversationId: string;
  revision: number;
  heading: string;
  /**
   * @maxItems 1000
   */
  items: ConfirmationItem[];
  schedule?: ConfirmationSchedule;
  irreversible: boolean;
  undo: string;
  verificationCount: number;
  actionLabel?: string;
}
export interface PlanRecord {
  protocol: string;
  id: string;
  state: PlanState;
  plan: Plan;
  outcomes: Outcome[];
  undoPlanId?: string;
  reason?: string;
  recovery?: RecoveryView;
  confirmation?: ConfirmationRecord;
}
export interface RecoveryView {
  profile: 'plan-recovery-v1' | (string & {});
  phase: RecoveryPhase | (string & {});
  generation: string;
  round: number;
  revision: number;
  conversationId: string;
  reviewId?: string;
  executionId?: string;
  slots: {
    stop: number;
    'cancel-initial': number;
    'cancel-review': number;
    leave: number;
    keep: number;
  };
  winner?: IntentWinner;
  steps?: {
    stepId: string;
    truth: 'done' | 'not-done' | 'unknown';
  }[];
  versions: DecisionVersions;
  decisionKey?: string;
  evidenceDigest?: string;
  unknownCount?: number;
  remaining?: number;
  sealed?: boolean;
  /**
   * @maxItems 256
   */
  contradictedAfterSeal?: string[];
}
export interface IntentWinner {
  kind: WinnerKind;
  cause: IntentCause;
}
export interface DecisionVersions {
  evidence: number;
  winner: number;
  decisionResolution: number;
}
export interface IntentTarget {
  type: 'generation' | 'review' | 'execution';
  id: string;
}
export interface IntentRequest {
  kind: IntentKind;
  planId: string;
  target: IntentTarget;
  capturedRound: number;
  expectedSlotVersion: number;
  correlation: string;
  cause: IntentCause;
  payload?: string;
  acknowledgment?: LeaveAcknowledgment;
  review?: 'forward-only' | 'end-retention';
}
export interface LeaveAcknowledgment {
  sourceDecisionKey: string;
  evidenceVersion: number;
  winnerVersion: number;
  decisionResolutionVersion: number;
  evidenceDigest: string;
  unknownCount: number;
}
export interface PlanIntentReply {
  planId: string;
  kind: IntentKind;
  capturedRound: number;
  correlation: string;
  effectiveRound: number;
  slotVersion: number;
  resolvedTarget?: string;
  requestedTargetApplied?: boolean;
  replacement?: IntentTarget;
  result:
    | 'applied'
    | 'replaced'
    | 'already-closed'
    | 'already-stopped'
    | 'defeated'
    | 'superseded'
    | 'needs-review'
    | 'conflict'
    | 'unavailable'
    | 'invalid-target'
    | 'refused'
    | 'kept'
    | 'already-kept'
    | 'sealed';
  keys: string[];
  winner?: IntentWinner;
  phase: RecoveryPhase;
  safetyApplied?: boolean;
  dispositionApplied?: boolean;
  forwardClosed?: boolean;
  count?: number;
  requestKey?: 'requestAlreadyStopped' | 'requestTargetStopped';
  savedDisposition?: {
    phase: 'left-known' | 'left-unconfirmed';
    count: number;
  };
  finalHistory?: FinalHistory;
}
export interface FinalHistory {
  winner: IntentWinner;
  keptFact: KeptFact;
  relation?: 'keptElsewhere' | 'leaveCompletedByKeep' | 'leaveCoveredByKeep';
  requestedTargetApplied?: boolean;
  /**
   * @maxItems 256
   */
  contradictedAfterSeal?: string[];
}
export interface KeptFact {
  keepEffect: 'forward-closed' | 'decision-closed' | 'retention-ended' | 'leave-completed';
  actorCause: IntentCause;
  round: number;
}
export interface ExecutionAcceptance {
  planId: string;
  executionId: string;
  fence: number;
}
export interface ReplyDecline {
  kind: 'decline';
  planId: string;
  clientReplyId: string;
}
export interface BlockMarkdown {
  type: 'markdown';
  id: string;
  fallback: string;
  body: {
    text: string;
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockCard {
  type: 'card';
  id: string;
  fallback: string;
  body: {
    title: string;
    blocks: Block[];
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
/**
 * Supporting detail behind a disclosure: closed until the user opens it, so the answer comes first.
 */
export interface BlockDetails {
  /**
   * The block's type: `details`.
   */
  type: 'details';
  /**
   * The block's id, unique in its message.
   */
  id: string;
  /**
   * Plain text shown by a client that does not know the type.
   */
  fallback: string;
  /**
   * The disclosure's words and what it holds.
   */
  body: {
    /**
     * The words on the closed disclosure.
     */
    summary: string;
    /**
     * The supporting detail, shown when the disclosure is open.
     */
    blocks: Block[];
  };
  /**
   * Whether the host holds an answer to a card nested in this block, named in `answer`. An answer marks the message's own block, so a details block that holds a form or buttons is the one marked (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockList {
  type: 'list';
  id: string;
  fallback: string;
  body: {
    items: string[];
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockTable {
  type: 'table';
  id: string;
  fallback: string;
  body: {
    columns: string[];
    rows: unknown[][];
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockForm {
  type: 'form';
  id: string;
  fallback: string;
  body: {
    fields: {
      name: string;
      label: string;
      required?: boolean;
      /**
       * What the host already knows for the field: the form starts with it, and the user may change it. Optional.
       */
      value?: string;
    }[];
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockChoice {
  type: 'choice';
  id: string;
  fallback: string;
  body: {
    mode: 'single' | 'multi' | 'text';
    options: string[];
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockButtons {
  type: 'buttons';
  id: string;
  fallback: string;
  body: {
    actions: {
      id: string;
      label: string;
    }[];
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockDiff {
  type: 'diff';
  id: string;
  fallback: string;
  body: {
    before: unknown;
    after: unknown;
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockPlan {
  type: 'plan';
  id: string;
  fallback: string;
  body: {
    planId: string;
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockRouteLink {
  type: 'route-link';
  id: string;
  fallback: string;
  body: {
    label: string;
    route: string;
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockNotice {
  type: 'notice';
  id: string;
  fallback: string;
  body: {
    text: string;
    tone?: 'info' | 'warning' | 'error';
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface BlockFormFill {
  type: 'form.fill';
  id: string;
  fallback: string;
  body: {
    requestId: string;
    values: {
      [k: string]: FormFillValue;
    };
  };
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface FormFillValue {
  label?: string;
  value: unknown;
  validation: FormValidation;
}
export interface FormValidation {
  status: 'valid' | 'invalid';
  messages: string[];
  guidance?: string;
}
export interface ExtensionBlock {
  type: string;
  id: string;
  fallback: string;
  body: unknown;
  /**
   * Whether the host holds an answer to this card; it holds one at most (see the README's Card answers).
   */
  answered?: boolean;
  answer?: CardAnswer;
}
export interface Message {
  id: string;
  clientMessageId?: string;
  role: 'user' | 'assistant';
  content: string;
  blocks: Block[];
  createdAt: number;
  status?: 'writing' | 'completed' | 'failed' | 'unavailable' | 'stopped';
  versionIndex?: number;
  versionCount?: number;
  /**
   * What the reply drew on. `[n]` in its content cites the n-th source. Optional.
   *
   * @maxItems 50
   */
  sources?: Source[];
}
export interface Source {
  id: string;
  title: string;
  url: string;
}
export interface ReplyMessage {
  kind: 'message';
  protocol: string;
  clientReplyId: string;
  content: string;
  clientMessageId: string;
}
export interface ReplyConfirm {
  kind: 'confirm';
  protocol: string;
  clientReplyId: string;
  planId: string;
  digest?: string;
  confirmationToken: string;
}
export interface ReplyForm {
  kind: 'form';
  protocol: string;
  clientReplyId: string;
  blockId: string;
  values: {};
}
export interface ReplyAction {
  kind: 'action';
  protocol: string;
  clientReplyId: string;
  blockId: string;
  actionId: string;
}
export interface ReplyToolResult {
  kind: 'tool-result';
  protocol: string;
  clientReplyId: string;
  callId: string;
  result: unknown;
  problem?: Problem;
}
export interface ReplyPlanValues {
  kind: 'plan.values';
  protocol: string;
  clientReplyId: string;
  planId: string;
  steps: {
    stepId: string;
    rows: {};
    versions: {
      [k: string]: string;
    };
  }[];
}
export interface ReplyFormFill {
  kind: 'form-fill';
  protocol: string;
  clientReplyId: string;
  request: FormFillRequest;
}
export interface FormFillRequest {
  requestId: string;
  text: string;
  references: string[];
  attachments: string[];
  field?: string;
  /**
   * @minItems 1
   */
  fields: [FormFillField, ...FormFillField[]];
}
export interface FormFillField {
  name: string;
  label: string;
  tier: 'low';
  value: unknown;
}
/**
 * Asks the host to stop writing a reply. Sent only under the negotiated `reply-stop` capability.
 */
export interface ReplyStop {
  kind: 'stop';
  protocol: string;
  clientReplyId: string;
  messageId: string;
  /**
   * The version of the message the stop is for, numbered as the message's `versionIndex` (1 for a message with one version). A host ignores a stop for a version it is not writing. Optional: without it, the stop is for the version being written when it arrives.
   */
  versionIndex?: number;
}
export interface ManifestEntry {
  id: string;
  kind: 'read' | 'planning-read' | 'update' | 'create' | 'action' | 'bulk';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  resource: string;
  fields: {
    [k: string]: 'low' | 'sensitive' | 'human-only';
  };
  returns: string[];
  filterable: string[];
  permission: string;
  view: string;
  undo: string;
}
export interface ToolCall {
  id: string;
  operation: string;
  method: string;
  path: string;
  query?: {
    [k: string]: string;
  };
  /**
   * The host's plain words for the read, shown to the user while it runs, for example "Reading 3 orders…". Optional.
   */
  label?: string;
}
export interface FrameMessageStart {
  type: 'message.start';
  protocol: string;
  sequence: number;
  messageId: string;
  role: 'user' | 'assistant';
}
export interface FrameTextDelta {
  type: 'text.delta';
  protocol: string;
  sequence: number;
  messageId: string;
  text: string;
}
export interface FrameBlock {
  type: 'block';
  protocol: string;
  sequence: number;
  messageId: string;
  block: Block;
}
export interface FramePlanDraft {
  type: 'plan.draft';
  protocol: string;
  sequence: number;
  messageId: string;
  plan: ImmediateDraft;
}
export interface FramePlanFinal {
  type: 'plan.final';
  protocol: string;
  sequence: number;
  messageId: string;
  plan: ImmediatePlan | TimedPlan;
}
export interface FramePlanStep {
  type: 'plan.step';
  protocol: string;
  sequence: number;
  planId: string;
  outcome: Outcome;
}
export interface FrameToolCall {
  type: 'tool.call';
  protocol: string;
  sequence: number;
  call: ToolCall;
}
export interface FramePlanningRead {
  type: 'planning-read';
  protocol: string;
  sequence: number;
  planId: string;
  stepId: string;
  template: ReadTemplate;
}
export interface FrameMessageEnd {
  type: 'message.end';
  protocol: string;
  sequence: number;
  messageId: string;
  status: 'completed' | 'failed' | 'unavailable' | 'stopped';
}
export interface FrameStale {
  type: 'stale';
  protocol: string;
  sequence: number;
  reads: ('conversation' | 'conversations' | 'plans' | 'flows')[];
}
export interface FrameProblem {
  type: 'problem';
  protocol: string;
  sequence: number;
  problem: Problem;
}
export interface FlowParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  label: string;
  required: boolean;
  default?: unknown;
}
export interface PlanCommand {
  protocol: string;
  action: 'stop' | 'heartbeat' | 'resume' | 'retry-undo';
  planId: string;
}
export interface RunFlow {
  protocol: string;
  flowId: string;
  values: {};
}
export interface PatchFlow {
  protocol: string;
  flowId: string;
  favourite: boolean;
  title: string;
}
