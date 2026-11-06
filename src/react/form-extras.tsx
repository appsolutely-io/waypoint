// The form fill's extras, loaded with the first form: suggestions, fill
// reverts, the popup's status and its attachments. The fields and the
// popup work without them.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type ComponentType,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { FormDraft, FormSession, FormSnapshot } from "../core/form-fill";
import { addMessages, type FormatMessage } from "./i18n";
import { formEnglish, formSimplifiedChinese } from "./form-messages";
import { useHandoff } from "./focus";
import { Value } from "./value";
import { blockEnglish, blockSimplifiedChinese } from "./block-messages";
import { context, type ButtonProps, type PrimitiveComponents } from "./ui";
import type { PrivateAttachmentPort } from "./form-fill";
import type { FormSubject } from "../protocol/generated";
import type { WaypointClient } from "../core/client";
import type { ConversationSource } from "../core/form-fill";
addMessages(formEnglish, formSimplifiedChinese);
// The value words (an empty value as a dash) are the blocks' own.
addMessages(blockEnglish, blockSimplifiedChinese);
export { Value };
interface ChildCreationAttempt {
  id: string;
  parent: string;
  field: string;
  subject: FormSubject;
  conversationId?: string;
  inFlight: number;
}
const MAX_CREATION_ATTEMPTS = 100;
const creationAttempts = new WeakMap<
  WaypointClient,
  Map<string, ChildCreationAttempt>
>();
function creationsFor(client: WaypointClient) {
  let attempts = creationAttempts.get(client);
  if (!attempts) {
    attempts = new Map();
    creationAttempts.set(client, attempts);
  }
  return attempts;
}
function pruneCreations(attempts: Map<string, ChildCreationAttempt>) {
  for (const [key, attempt] of attempts) {
    if (attempts.size <= MAX_CREATION_ATTEMPTS) break;
    if (attempt.inFlight === 0) attempts.delete(key);
  }
}

const invalidCount = (snapshot: FormSnapshot) =>
  Object.values(snapshot.fields).filter(
    (draft) => draft.validation?.status === "invalid" || draft.localInvalid,
  ).length;

/** A fill's value for an edited field, with its own validation. */
export function Suggestion({
  name,
  draft,
  session,
  t,
  primitives,
  onReplace,
}: {
  name: string;
  draft: FormDraft;
  session: FormSession;
  t: FormatMessage;
  primitives: PrimitiveComponents;
  onReplace(): void;
}) {
  const B = primitives.button;
  const replacement = draft.replacement!;
  const invalid = replacement.validation.status === "invalid";
  const label = useId();
  return (
    <div role="group" aria-labelledby={label} data-suggestion="">
      <p id={label}>{t("form.suggested", { field: draft.label })}</p>
      <div>
        <Value value={replacement.value} t={t} />
      </div>
      {replacement.validation.messages.length ? (
        <div className={invalid ? "wp-invalid" : undefined}>
          {invalid ? <strong>{t("form.invalid")}</strong> : null}
          {replacement.validation.messages.map((message, i) => (
            <p key={i}>{message}</p>
          ))}
        </div>
      ) : null}
      <div className="wp-actions">
        <B
          onPress={() => {
            if (session.replace(name, replacement.revision)) onReplace();
          }}
        >
          {t("form.replaceIt")}
        </B>
        <B onPress={() => session.cancelReplacement(name)}>
          {t("form.keepMine")}
        </B>
      </div>
    </div>
  );
}

/** The fields' own polite status: validation after a Replace. */
export function FieldsStatus({ text }: { text: string }) {
  return (
    <span role="status" className="wp-sr-only">
      {text}
    </span>
  );
}
export const attentionText = (snapshot: FormSnapshot, t: FormatMessage) => {
  const count = invalidCount(snapshot);
  return count ? t("form.attention", { count }) : "";
};

interface Attachment {
  reference: string;
  name: string;
}
/** What the popup lends its extras. */
interface PopupControl {
  session: FormSession;
  t: FormatMessage;
  primitives: PrimitiveComponents;
  attachments?: PrivateAttachmentPort;
  files: Attachment[];
  setFiles: Dispatch<SetStateAction<Attachment[]>>;
  removalBlocked(): boolean;
  // One upload or removal at a time; the popup's own guard.
  claim(): boolean;
  release(): void;
  // The popup's scope: an older scope's result is dropped.
  scope(): number;
  // The request this popup sent and the host accepted, if it is pending.
  accepted?: string;
  // The request this popup sent, if any.
  sent?: string;
  generate(): void;
  say(text: string): void;
  status: string;
  // This popup's request whose draft could not be used.
  unusable?: string;
  // Why no request can be sent now (an unfinished entry), if any.
  blocked?: string;
  // Where focus goes when nothing of the extras is left to take it.
  messageField(): Element | null;
}
// A guarded action: focusable and described while unavailable.
function Guarded({
  B,
  reason,
  onPress,
  children,
}: {
  B: ComponentType<ButtonProps>;
  reason?: string;
  onPress(): void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <B
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? id : undefined}
        onPress={reason ? undefined : onPress}
      >
        {children}
      </B>
      {reason ? <span id={id}>{reason}</span> : null}
    </>
  );
}

/** A name for each file, unique among those listed. */
const uniqueName = (taken: readonly Attachment[], name: string) => {
  let candidate = name;
  for (let n = 2; taken.some((file) => file.name === candidate); n++)
    candidate = `${name} (${n})`;
  return candidate;
};
/** Uploads images one by one; a failure does not stop the rest. */
async function upload(control: PopupControl, files: readonly File[]) {
  const { t, attachments } = control;
  if (!files.length) return;
  const images = files.filter((file) => file.type.startsWith("image/"));
  // Files that are not images are skipped, and every status that follows
  // still says so.
  const skipped = images.length < files.length ? t("form.onlyImages") : "";
  const say = (...parts: string[]) =>
    control.say([...parts, skipped].filter(Boolean).join(" "));
  if (!images.length) return say();
  if (!attachments) return say(t("form.imagesHere"));
  if (!control.claim()) return say(t("form.busy"));
  const scope = control.scope();
  say(t("form.uploading", { count: images.length }));
  const added: Attachment[] = [];
  const failed: string[] = [];
  for (const image of images)
    try {
      const reference = await attachments.upload(image);
      added.push({ reference, name: image.name || "image" });
    } catch {
      failed.push(image.name || "image");
    }
  if (scope !== control.scope()) {
    await Promise.allSettled(
      added.map((file) => attachments.remove(file.reference)),
    );
    return;
  }
  control.setFiles((old) => {
    const next = [...old];
    for (const file of added)
      if (!next.some((kept) => kept.reference === file.reference))
        next.push({ ...file, name: uniqueName(next, file.name) });
    return next;
  });
  control.release();
  say(
    added.length ? t("form.attached", { count: added.length }) : "",
    ...failed.map((name) => t("form.attachFailed", { name })),
  );
}

/** The popup's status, fill reverts, attachments and unusable drafts. */
function PopupExtras({ control }: { control: PopupControl }) {
  const { session, t, primitives, attachments, files, accepted, sent } =
    control;
  const B = primitives.button;
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const removalReason = useId();
  const removalBlocked = control.removalBlocked();
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const reverts = useRef<HTMLDivElement>(null);
  // "Generating" once the host accepted this popup's request.
  const said = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (accepted && accepted !== said.current)
      control.say(t("form.generating"));
    said.current = accepted;
  }, [accepted, control, t]);
  // "Draft ready" once, when this popup's own request was filled.
  const pendingWas = useRef(snapshot.pending);
  useLayoutEffect(() => {
    const ended = pendingWas.current && !snapshot.pending;
    pendingWas.current = snapshot.pending;
    if (!ended || !sent) return;
    const applied = snapshot.fills?.some((fill) => fill.id === sent);
    const choice = Object.values(snapshot.fields).filter(
      (draft) => draft.replacement?.fill === sent,
    ).length;
    if (applied || choice)
      control.say(t("form.ready", { choice, invalid: invalidCount(snapshot) }));
  }, [snapshot, sent, control, t]);
  // A removed row hands focus to the row now at its place, else the one
  // before it, else the picker (attachments) or the Message field (reverts).
  const at = useRef(0);
  const near = (box: Element | null | undefined) => {
    const buttons = box?.querySelectorAll("button") ?? [];
    return [buttons[at.current], buttons[at.current - 1]];
  };
  const index = (event: { target: EventTarget; currentTarget: Element }) => {
    at.current = [...event.currentTarget.querySelectorAll("button")].indexOf(
      event.target as HTMLButtonElement,
    );
  };
  const recordList = useHandoff(() => [
    ...near(list.current),
    picker.current?.querySelector("button"),
  ]);
  const recordRevert = useHandoff(() => [
    ...near(reverts.current),
    control.messageField(),
  ]);
  const recordAlert = useHandoff(() => [control.messageField()]);
  const labels = (fields: readonly string[]) =>
    fields.map((name) => snapshot.fields[name]?.label ?? name).join(", ");
  const remove = (file: Attachment) => {
    if (!attachments) return;
    if (control.removalBlocked()) return control.say(t("form.revertWait"));
    if (!control.claim()) return control.say(t("form.busy"));
    const scope = control.scope();
    void attachments.remove(file.reference).then(
      () => {
        if (scope !== control.scope()) return;
        control.setFiles((old) =>
          old.filter((kept) => kept.reference !== file.reference),
        );
        control.release();
      },
      () => {
        if (scope !== control.scope()) return;
        control.release();
        control.say(t("form.removeFailed", { name: file.name }));
      },
    );
  };
  return (
    <>
      <p role="status" className="wp-form-status">
        {control.status}
      </p>
      <div onFocus={recordAlert}>
        {control.unusable && control.unusable === sent ? (
          <p role="alert">
            {t("form.unusable")}{" "}
            <Guarded B={B} reason={control.blocked} onPress={control.generate}>
              {t("chat.retry")}
            </Guarded>
          </p>
        ) : null}
      </div>
      <div
        ref={reverts}
        onFocus={(event) => {
          index(event);
          recordRevert(event);
        }}
      >
        {(snapshot.fills ?? []).map((fill) => (
          <Guarded
            key={fill.id}
            B={B}
            reason={snapshot.pending ? t("form.revertWait") : undefined}
            onPress={() => {
              if (session.revert(fill.id)) control.say(t("form.reverted"));
            }}
          >
            {t("form.revert", { fields: labels(fill.fields) })}
          </Guarded>
        ))}
      </div>
      {attachments ? (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];
              event.target.value = "";
              void upload(control, chosen);
            }}
          />
          <div ref={picker}>
            <B onPress={() => input.current?.click()}>{t("form.attach")}</B>
          </div>
          {removalBlocked && files.length ? (
            <span id={removalReason} className="wp-sr-only">
              {t("form.revertWait")}
            </span>
          ) : null}
          <ul
            ref={list}
            onFocus={(event) => {
              index(event);
              recordList(event);
            }}
            className="wp-attachments"
          >
            {files.map((file) => (
              <li key={file.reference}>
                <span>{file.name}</span>
                <B
                  aria-disabled={removalBlocked || undefined}
                  aria-describedby={removalBlocked ? removalReason : undefined}
                  onPress={() => remove(file)}
                >
                  {t("form.remove", { name: file.name })}
                </B>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
export interface PopupBodyProps {
  session: FormSession;
  open: boolean;
  field?: string;
  source?: ConversationSource;
  attachments?: PrivateAttachmentPort;
  text: string;
  references: string;
  scope: MutableRefObject<number>;
  upload: MutableRefObject<((files: File[]) => void) | undefined>;
  messageField(): Element | null;
}
/** What the popup does once its extras have loaded: generation and more. */
export function PopupBody({
  session,
  open,
  field,
  source,
  attachments,
  text,
  references,
  scope,
  upload: bindUpload,
  messageField,
}: PopupBodyProps) {
  const { client, format: t, primitives } = context();
  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const { pending } = snapshot;
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState(false);
  // What the popup says (one polite status), the request it sent, the one
  // the host accepted, and one whose draft could not be used.
  const [status, setStatus] = useState("");
  const [sent, setSent] = useState<string | undefined>(undefined);
  const [accepted, setAccepted] = useState<string | undefined>(undefined);
  const [unusable, setUnusable] = useState<string | undefined>(undefined);
  const active = useRef(false);
  const attachmentActive = useRef(false);
  const creation = creationsFor(client);
  const origin = useRef<ChildCreationAttempt | undefined>(undefined);
  const retry = useRef<
    | {
        request: ReturnType<FormSession["begin"]>;
        conversationId: string;
        creationKey?: string;
        creationAttempt?: ChildCreationAttempt;
        failed?: boolean;
      }
    | undefined
  >(undefined);
  const serial = useRef(0);
  const prefix = useId();
  const reason = useId();
  const nextId = () => `${state.conversationId}:${prefix}:${++serial.current}`;
  const Button = primitives.button;
  useEffect(() => {
    active.current = false;
    attachmentActive.current = false;
    setBusy(false);
    setSending(false);
    return () => {
      retry.current = undefined;
    };
  }, [open, session, field]);
  useEffect(() => {
    if (state.conversation?.mode === "form-fill")
      for (const message of state.conversation.messages)
        for (const block of message.blocks)
          if (block.type === "form.fill") {
            const id = (block.body as { requestId?: unknown } | undefined)
              ?.requestId;
            // A draft for this popup's pending request that cannot be used
            // ends that request.
            if (
              !session.receive(block.body) &&
              id === retry.current?.request.requestId &&
              session.getSnapshot().pending
            ) {
              session.failRequest(id as string);
              retry.current = undefined;
              setUnusable(id as string);
            }
          }
  }, [state.conversation, session]);
  const generate = async (retryFailed = false) => {
    if (
      active.current ||
      attachmentActive.current ||
      !open ||
      (session.getSnapshot().pending && !retryFailed)
    )
      return;
    if (
      retryFailed &&
      (!retry.current?.failed ||
        retry.current.conversationId !== client.getSnapshot().conversationId)
    )
      return;
    active.current = true;
    setSending(true);
    setProblem(false);
    setUnusable(undefined);
    const token = scope.current;
    let creationKey: string | undefined;
    let creationAttempt: ChildCreationAttempt | undefined;
    try {
      await client.ready;
      const current = client.getSnapshot();
      if (
        retryFailed &&
        retry.current?.conversationId !== current.conversationId
      )
        return;
      const matches = (attempt: ChildCreationAttempt) =>
        attempt.field === field &&
        attempt.conversationId === current.conversationId;
      const cached = field
        ? ([...creation.values()].find(matches) ??
          (origin.current && matches(origin.current)
            ? origin.current
            : undefined))
        : undefined;
      const subject = current.conversation?.subject ?? cached?.subject;
      if (
        current.protocol !== "1.1" ||
        !current.capabilities.includes("form-fill") ||
        (current.conversation
          ? current.conversation.mode !== "form-fill"
          : !cached) ||
        !subject
      )
        throw new Error("Form unavailable");
      if (token !== scope.current) return;
      if (retryFailed) {
        creationAttempt = retry.current?.creationAttempt;
        if (creationAttempt) {
          creationAttempt.inFlight++;
          pruneCreations(creation);
        }
      }
      if (field && !retryFailed) {
        if (!source) throw new Error("Subthreads unavailable");
        const parent =
          current.conversation?.parentConversationId ??
          cached?.parent ??
          current.conversationId;
        const key = JSON.stringify([parent, field]);
        creationKey = key;
        if (!creation.has(key)) {
          creation.set(key, {
            id: nextId(),
            parent,
            field,
            subject,
            inFlight: 0,
          });
        }
        const attempt = creation.get(key)!;
        creationAttempt = attempt;
        attempt.inFlight++;
        pruneCreations(creation);
        if (!attempt.conversationId) {
          const child = await source.create({
            protocol: current.protocol,
            title: field,
            mode: "form-fill",
            subject,
            parentConversationId: parent,
            field,
            clientCreationId: attempt.id,
          });
          if (
            child.mode !== "form-fill" ||
            child.parentConversationId !== parent ||
            child.subject?.key !== subject.key
          )
            throw new Error("Invalid child");
          attempt.conversationId = child.id;
        }
        if (
          token !== scope.current ||
          client.getSnapshot().conversationId !== current.conversationId
        )
          return;
        origin.current = attempt;
        const snapshot = client.getSnapshot();
        const selected =
          snapshot.conversationId === attempt.conversationId &&
          snapshot.conversation?.id === attempt.conversationId &&
          snapshot.status === "open" &&
          !snapshot.conversationUnavailable &&
          snapshot.problem?.id !== "conversation-read"
            ? {
                kind: "loaded" as const,
                conversationId: attempt.conversationId,
                conversation: snapshot.conversation,
              }
            : await client.switchConversation(attempt.conversationId);
        if (
          token !== scope.current ||
          client.getSnapshot().conversationId !== attempt.conversationId
        )
          return;
        if (
          selected?.kind === "missing" &&
          selected.conversationId === attempt.conversationId &&
          creation.get(key) === attempt
        )
          creation.delete(key);
        if (
          selected?.kind !== "loaded" ||
          selected.conversationId !== attempt.conversationId ||
          selected.conversation.id !== attempt.conversationId ||
          selected.conversation.mode !== "form-fill" ||
          selected.conversation.subject?.key !== attempt.subject.key
        )
          throw new Error("Child unavailable");
      }
      if (token !== scope.current) return;
      const material = {
        text,
        field: field ?? client.getSnapshot().conversation?.field,
        references: references.split(/\r?\n/).filter(Boolean),
        attachments: files.map((file) => file.reference),
      };
      if (!retryFailed)
        retry.current = {
          request: session.begin(material),
          conversationId: client.getSnapshot().conversationId,
          creationKey,
          creationAttempt,
        };
      const attempt = retry.current!;
      const request = attempt.request;
      attempt.failed = false;
      setSent(request.requestId);
      const delivered = await client.reply({
        kind: "form-fill",
        clientReplyId: request.requestId,
        request,
      });
      if (token !== scope.current) return;
      if (!delivered) {
        attempt.failed = true;
        throw new Error("Form send failed");
      }
      setAccepted(request.requestId);
      if (
        attempt.creationKey &&
        creation.get(attempt.creationKey) === attempt.creationAttempt
      )
        creation.delete(attempt.creationKey);
    } catch {
      if (token === scope.current) setProblem(true);
    } finally {
      if (creationAttempt) {
        creationAttempt.inFlight--;
        pruneCreations(creation);
      }
      if (token === scope.current) {
        active.current = false;
        setSending(false);
      }
    }
  };
  // One guard for every send: each entry must be a value, and no upload
  // is running. A guarded send stays focusable and says why.
  const blocked = Object.values(snapshot.fields).some(
    (draft) => draft.localInvalid,
  )
    ? t("form.fixFirst")
    : busy
      ? t("form.busy")
      : undefined;
  const control: PopupControl = {
    session,
    t,
    primitives,
    attachments,
    files,
    setFiles,
    removalBlocked: () => active.current || session.getSnapshot().pending,
    claim: () => {
      if (attachmentActive.current) return false;
      attachmentActive.current = true;
      setBusy(true);
      return true;
    },
    release: () => {
      attachmentActive.current = false;
      setBusy(false);
    },
    scope: () => scope.current,
    accepted: pending ? accepted : undefined,
    sent,
    generate: () => {
      if (!blocked) void generate();
    },
    say: setStatus,
    status,
    unusable,
    blocked,
    messageField,
  };
  // The popup's paste, drop and picker upload through here.
  bindUpload.current = (chosen) => void upload(control, chosen);
  useEffect(() => () => (bindUpload.current = undefined), [bindUpload]);
  return (
    <>
      <PopupExtras control={control} />
      {pending && <p>{t("form.closeHint")}</p>}
      {problem && <p role="alert">{t("chat.failure")}</p>}
      {pending && retry.current?.failed && (
        <Button
          disabled={
            sending || retry.current.conversationId !== state.conversationId
          }
          aria-disabled={blocked ? true : undefined}
          aria-describedby={blocked ? reason : undefined}
          onPress={() => {
            if (!blocked) void generate(true);
          }}
        >
          {t("chat.retry")}
        </Button>
      )}
      <Button
        disabled={
          sending || pending || !state.capabilities.includes("form-fill")
        }
        aria-disabled={blocked ? true : undefined}
        aria-describedby={blocked ? reason : undefined}
        onPress={() => {
          if (!blocked) void generate();
        }}
      >
        {t("form.generate")}
      </Button>
      {blocked ? <span id={reason}>{blocked}</span> : null}
    </>
  );
}
