// The controls of the reply being written: a lazy chunk, loaded when a
// reply is first written.
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
  return row === "writing" && client.canStopReply() ? (
    <div data-reply-controls="">
      <B onPress={() => void client.stopReply()}>{t("chat.reply.stop")}</B>
    </div>
  ) : null;
}
