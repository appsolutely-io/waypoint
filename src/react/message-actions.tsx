// The default actions under each message: copy, regenerate, edit and
// resend, and feedback. A lazy chunk, loaded with the first message; a
// host's `messageActions` part replaces it.
import { useContext, useEffect, useId, useRef, useState } from "react";
import type { FocusOrigin } from "./focus";
import { ChatFocusContext, focusFor } from "./chat-focus";
import type { Message } from "../protocol/generated";
import type { WaypointClient } from "../core/client";
import { addMessages } from "./i18n";
import { replyEnglish, replySimplifiedChinese } from "./reply-messages";
import { context } from "./ui";

addMessages(replyEnglish, replySimplifiedChinese);
type Rating = "positive" | "negative";
export function MessageActions({
  client,
  message,
}: {
  client: WaypointClient;
  message: Message;
}) {
  const { format: t, primitives: ui } = context();
  const B = ui.button;
  const id = `wp${useId().replace(/[^\w-]/g, "")}`;
  const field = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [rating, setRating] = useState<Rating>();
  // One call at a time from these buttons; the client also sends one
  // request for identical calls in flight.
  const [busy, setBusy] = useState(false);
  const focus = useContext(ChatFocusContext);
  // The press that opened or closed the editor: focus follows it there.
  const pressed = useRef<FocusOrigin>(undefined);
  const press = (action: string, value?: string) => {
    pressed.current = focus?.originFor(action);
    setEditing(value);
  };
  useEffect(() => {
    if (!pressed.current) return;
    const origin = pressed.current;
    pressed.current = undefined;
    focusFor(
      focus,
      editing !== undefined
        ? field.current
        : document.getElementById(`${id}-edit`),
      { origin, owner: focus?.owner() ?? "" },
    );
  }, [editing, focus, id]);
  // A reply still being written has nothing to act on yet.
  if (message.status === "writing") return null;
  const act = (call: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    // The client reports a failed call itself; this only ends the wait.
    void call()
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const reply = message.role === "assistant";
  if (editing !== undefined)
    return (
      <form
        data-message-edit=""
        onSubmit={(event) => {
          event.preventDefault();
          // Taken in the press: by the end of the call it is gone.
          const origin = focus?.originFor("message-edit-send");
          if (editing.trim())
            act(async () => {
              await client.editMessage(message.id, editing);
              pressed.current = origin;
              setEditing(undefined);
            });
        }}
      >
        <ui.textarea
          label={t("chat.message.editLabel")}
          value={editing}
          inputRef={field}
          onChange={setEditing}
        />
        <button type="submit" aria-disabled={busy || !editing.trim()}>
          {t("chat.message.resend")}
        </button>
        <B onPress={() => press("message-edit-cancel")}>{t("chat.cancel")}</B>
      </form>
    );
  const rate = (value: Rating, label: "good" | "bad") => (
    <B
      aria-pressed={rating === value}
      aria-disabled={busy}
      onPress={() =>
        act(async () => {
          if (await client.sendFeedback(message.id, value)) setRating(value);
        })
      }
    >
      {t(label === "good" ? "chat.message.good" : "chat.message.bad")}
    </B>
  );
  return (
    <div role="group" aria-label={t("chat.message.actions")}>
      <B
        onPress={() =>
          void navigator.clipboard?.writeText(message.content).then(
            () => setCopied(true),
            () => {},
          )
        }
      >
        {t("chat.message.copy")}
      </B>
      {client.canChangeVersions() ? (
        reply ? (
          <B
            aria-disabled={busy}
            onPress={() => act(() => client.regenerate(message.id))}
          >
            {t("chat.message.regenerate")}
          </B>
        ) : (
          <B
            id={`${id}-edit`}
            onPress={() => press("message-edit", message.content)}
          >
            {t("chat.message.edit")}
          </B>
        )
      ) : null}
      {reply && client.canSendFeedback() ? (
        <>
          {rate("positive", "good")}
          {rate("negative", "bad")}
        </>
      ) : null}
      <span role="status">{copied ? t("chat.message.copied") : ""}</span>
    </div>
  );
}
