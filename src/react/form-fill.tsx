import { ModalDrawer, usePopupFocus } from "./chat-focus";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ConversationSource, FormSession } from "../core/form-fill";
import { context, LoadFailure, useColorScheme, type Slots } from "./ui";
import { lazyChunk, useChunk } from "./chunks";
import { FieldAdornment } from "./field-adornment";
import { useHandoff } from "./focus";
// Suggestions, fill reverts, the popup's status and attachments: loaded
// with the first form, tried again by a Retry after a failure. The fields
// and the popup work without them.
const extrasChunk = lazyChunk(() => import("./form-extras"));
function useExtras() {
  const load = useChunk(extrasChunk);
  useEffect(() => extrasChunk.request(), []);
  return load;
}
const asNumber = (text: string) => {
  const value = text.trim() === "" ? NaN : Number(text);
  return Number.isFinite(value) ? value : undefined;
};
export interface PrivateAttachmentPort {
  upload(file: File): Promise<string>;
  remove(reference: string): Promise<void>;
}
export function useFormFill(session: FormSession) {
  return useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
}
export interface FormFillFieldsProps {
  session: FormSession;
  onRegenerate(field: string): void;
  slots?: Slots;
  renderField?: (props: {
    name: string;
    label: string;
    value: unknown;
    onChange(value: unknown): void;
    invalid: boolean;
    describedBy: string;
  }) => ReactNode;
}
export function FormFillFields({
  session,
  onRegenerate,
  slots,
  renderField,
}: FormFillFieldsProps) {
  const snapshot = useFormFill(session);
  const { fields, pending } = snapshot;
  const { format: t, primitives } = context();
  const prefix = useId();
  const extras = useExtras();
  const X = extras.status === "ready" ? extras.module : undefined;
  const Input = primitives.input,
    Check = primitives.checkbox!;
  // An entry that is not a value yet holds every send back.
  const unfinished = Object.values(fields).some((draft) => draft.localInvalid);
  const [said, say] = useState("");
  const wrappers = useRef(new Map<string, HTMLElement | null>());
  // A suggestion answered by keyboard hands focus to its field.
  const lastField = useRef("");
  const handoff = useHandoff(() => [
    wrappers.current
      .get(lastField.current)
      ?.querySelector("input,textarea,select,button,[tabindex]"),
  ]);
  return (
    <>
      {Object.entries(fields).map(([name, draft], index) => {
        const description = `${prefix}-${index}`;
        const invalid =
          draft.validation?.status === "invalid" || !!draft.localInvalid;
        const value = draft.value;
        const common = {
          label: draft.label,
          invalid,
          describedBy: description,
        };
        return (
          <FieldAdornment
            key={name}
            reason={
              !X
                ? t(
                    extras.status === "failed"
                      ? "form.toolsFailed"
                      : "form.toolsLoading",
                  )
                : unfinished
                  ? t("form.fixFirst")
                  : pending
                    ? t("form.revertWait")
                    : undefined
            }
            label={t("form.regenerate", { field: draft.label })}
            slots={slots}
            onRegenerate={() => onRegenerate(name)}
            wrapper={(element) => wrappers.current.set(name, element)}
          >
            {renderField ? (
              renderField({
                name,
                label: draft.label,
                value,
                onChange: (next) => session.edit(name, next),
                invalid,
                describedBy: description,
              })
            ) : typeof value === "string" ? (
              <Input
                {...common}
                value={value}
                onChange={(next) => session.edit(name, next)}
              />
            ) : typeof value === "number" ? (
              <Input
                {...common}
                type="number"
                value={draft.localText ?? String(value)}
                onChange={(text) => {
                  const next = asNumber(text);
                  if (next === undefined) session.markEdited(name, text);
                  else session.edit(name, next);
                }}
              />
            ) : typeof value === "boolean" ? (
              <Check
                {...common}
                checked={value}
                onChange={(next) => session.edit(name, next)}
              />
            ) : (
              <div>
                {draft.label}: {X ? <X.Value value={value} t={t} /> : null}{" "}
                {t("form.editInForm")}
              </div>
            )}
            <div
              id={description}
              className={invalid ? "wp-invalid" : undefined}
            >
              {invalid ? <strong>{t("form.invalid")}</strong> : null}
              {draft.localInvalid ? <p>{t("form.number")}</p> : null}
              {draft.validation?.messages.map((message, i) => (
                <p key={i}>{message}</p>
              ))}
              {draft.validation?.guidance && <p>{draft.validation.guidance}</p>}
            </div>
            <div
              onFocus={(event) => {
                lastField.current = name;
                handoff(event);
              }}
            >
              {draft.replacement && X ? (
                <X.Suggestion
                  name={name}
                  draft={draft}
                  session={session}
                  t={t}
                  primitives={primitives}
                  onReplace={() =>
                    say(X.attentionText(session.getSnapshot(), t))
                  }
                />
              ) : null}
            </div>
          </FieldAdornment>
        );
      })}
      {X ? <X.FieldsStatus text={said} /> : null}
    </>
  );
}
export interface FormFillPopupProps {
  session: FormSession;
  open: boolean;
  onClose(): void;
  field?: string;
  source?: ConversationSource;
  attachments?: PrivateAttachmentPort;
}
export function FormFillPopup({
  session,
  open,
  onClose,
  field,
  source,
  attachments,
}: FormFillPopupProps) {
  const { format: t, primitives } = context();
  const [text, setText] = useState("");
  const [references, setReferences] = useState("");
  const [notice, setNotice] = useState("");
  const extras = useExtras();
  const X = extras.status === "ready" ? extras.module : undefined;
  const body = useRef<HTMLDivElement>(null);
  // The popup's scope: closing it or changing what it fills retires work
  // started before.
  const scope = useRef(0);
  // Uploads, once the extras have loaded.
  const upload = useRef<((files: File[]) => void) | undefined>(undefined);
  const Button = primitives.button,
    Drawer = primitives.drawer,
    Textarea = primitives.textarea;
  const popupFocus = usePopupFocus();
  const reason = useId();
  useEffect(() => {
    scope.current++;
    return () => {
      scope.current++;
      session.cancel();
    };
  }, [open, session, field]);
  const close = () => {
    scope.current++;
    session.cancel();
    onClose();
  };
  // Images by paste, drop or picker; never into the page.
  const images = (files: readonly File[]) => {
    if (!files.some((file) => file.type.startsWith("image/"))) return false;
    if (upload.current) upload.current([...files]);
    else setNotice(t(attachments ? "form.imagesNow" : "form.imagesHere"));
    return true;
  };
  // The extras' Retry, once gone, hands focus to the Message field.
  const handoff = useHandoff(() => [body.current?.querySelector("textarea")]);
  const colorScheme = useColorScheme();
  return (
    <ModalDrawer
      as={Drawer}
      open={open}
      label={t("form.title")}
      onClose={close}
      closeLabel={t("chat.close")}
      {...popupFocus}
    >
      <div
        ref={body}
        style={{ colorScheme }}
        onPasteCapture={(e) => {
          // The image goes to the attachments; otherwise the text is still
          // pasted.
          if (
            images(Array.from(e.clipboardData.files)) &&
            attachments &&
            upload.current
          )
            e.preventDefault();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          const dropped = Array.from(e.dataTransfer.files);
          if (!images(dropped)) upload.current?.(dropped);
        }}
      >
        <p>{t("chat.message")}</p>
        <Textarea label={t("chat.message")} value={text} onChange={setText} />
        <p>{t("form.references")}</p>
        <Textarea
          label={t("form.references")}
          value={references}
          onChange={setReferences}
        />
      </div>
      {/* One status: the extras' own once they have loaded. */}
      {X ? null : <p role="status">{notice}</p>}
      {X ? (
        <X.PopupBody
          session={session}
          open={open}
          field={field}
          source={source}
          attachments={attachments}
          text={text}
          references={references}
          scope={scope}
          upload={upload}
          messageField={() => body.current?.querySelector("textarea") ?? null}
        />
      ) : (
        <>
          {extras.status === "failed" ||
          (extras.status === "loading" && extras.retrying) ? (
            <LoadFailure
              retrying={extras.status === "loading"}
              onRetry={() => extrasChunk.request(true)}
              onFocus={handoff}
            />
          ) : null}
          <Button aria-disabled aria-describedby={reason}>
            {t("form.generate")}
          </Button>
          <span id={reason}>
            {t(
              extras.status === "failed"
                ? "form.toolsFailed"
                : "form.toolsLoading",
            )}
          </span>
        </>
      )}
    </ModalDrawer>
  );
}
