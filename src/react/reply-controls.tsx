// The controls of the reply being written: a lazy chunk, loaded when a
// reply is first written or overdue.
import { useContext } from "react";
import { ChatFocusContext, focusFor } from "./chat-focus";
import type { ReplyState, WaypointClient } from "../core/client";
import { addMessages } from "./i18n";
import { replyEnglish, replySimplifiedChinese } from "./reply-messages";
import { context } from "./ui";

addMessages(replyEnglish, replySimplifiedChinese);
export function ReplyControls({
  client,
  row,
}: {
  client: WaypointClient;
  row: ReplyState;
}) {
  const { format: t, primitives } = context();
  const B = primitives.button;
  const focus = useContext(ChatFocusContext);
  // The pressed button goes away: focus moves on to the composer.
  const then = (action: () => unknown) => () => {
    const origin = focus?.originFor("reply-wait");
    void action();
    focusFor(focus, focus?.composer(), { origin, owner: focus?.owner() ?? "" });
  };
  if (row === "overdue")
    return (
      <div data-reply-controls="">
        <B onPress={then(() => client.keepWaiting())}>
          {t("chat.reply.keepWaiting")}
        </B>
        <B onPress={then(() => client.retryReply())}>{t("chat.retry")}</B>
      </div>
    );
  return row === "writing" && client.canStopReply() ? (
    <div data-reply-controls="">
      <B onPress={() => void client.stopReply()}>{t("chat.reply.stop")}</B>
    </div>
  ) : null;
}
