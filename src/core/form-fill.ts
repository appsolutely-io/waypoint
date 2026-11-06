import type {
  FormFillRequest,
  FormValidation,
  FormSubject,
  Conversation,
  CreateConversation,
  Problem,
} from "../protocol/generated";
import type { MaybePromise } from "./client";
export interface FormField {
  name: string;
  label: string;
  tier: "low" | "sensitive" | "human-only";
  value: unknown;
}
export interface FormDraft {
  label: string;
  value: unknown;
  revision: number;
  edited: boolean;
  validation?: FormValidation;
  replacement?: {
    value: unknown;
    validation: FormValidation;
    revision: number;
    /** The fill that suggested it. */
    fill?: string;
  };
  /**
   * The user's entry does not parse as the field's type yet (`localText`
   * holds it); `value` is still the last valid one. A host's own submit
   * should refuse while it is set.
   */
  localInvalid?: true;
  localText?: string;
}
export interface FormSnapshot {
  pending: boolean;
  fields: Readonly<Record<string, FormDraft>>;
  /** Applied fills that still own at least one field, oldest first. */
  fills?: readonly { id: string; fields: readonly string[] }[];
}
export interface FormSession {
  getSnapshot(): FormSnapshot;
  subscribe(listener: () => void): () => void;
  begin(material: FormMaterial): FormFillRequest;
  receive(body: unknown): boolean;
  edit(field: string, value: unknown): void;
  replace(field: string, revision: number): boolean;
  cancelReplacement(field: string): void;
  /** Records an entry that does not parse yet: an edit that keeps `value`. */
  markEdited(field: string, text: string): void;
  /**
   * Takes back a fill: each field it still owns gets its value and
   * validation from before the fill, and its suggestions are withdrawn.
   * Refused while a request is pending.
   */
  revert(fill: string): boolean;
  /** Ends the pending request when its draft cannot be used. */
  failRequest(requestId: string): void;
  cancel(): void;
  dispose(): void;
}
export interface FormMaterial {
  text: string;
  references?: string[];
  attachments?: string[];
  field?: string;
}
export interface ConversationSource {
  list(subjectKey?: string): MaybePromise<ConversationSummary[]>;
  create(input: CreateConversation): MaybePromise<Conversation>;
}
export interface ConversationSummary {
  id: string;
  title: string;
  mode?: "form-fill";
  subject?: FormSubject;
  parentConversationId?: string;
  field?: string;
}
export interface FormSessionConfig {
  fields: readonly FormField[];
  ids(): string;
}
/** The problem a failed load of the form session code rejects with. */
export const FORM_SESSION_UNAVAILABLE = {
  code: "retryable",
  id: "form-session-load",
} as const satisfies Problem;
/**
 * Creates a form session. Its code is loaded on first use, outside the core
 * bundle. If loading fails the promise rejects with
 * `FORM_SESSION_UNAVAILABLE`, nothing is kept, and calling again retries.
 */
export async function loadFormSession(
  config: FormSessionConfig,
): Promise<FormSession> {
  let module: typeof import("./form-session");
  try {
    module = await import("./form-session");
  } catch {
    throw { ...FORM_SESSION_UNAVAILABLE };
  }
  return module.createFormSession(config);
}
