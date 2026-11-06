// The reply's steps and controls: a lazy chunk, loaded when a reply is
// first written, overdue, failed or unavailable, or reading on the host's
// behalf.
import { useContext, useId, useState } from "react";
import type { ReplyState, ToolStep, WaypointClient } from "../core/client";
import { ChatFocusContext, focusFor } from "./chat-focus";
import { addMessages } from "./i18n";
import { replyEnglish, replySimplifiedChinese } from "./reply-messages";
import { context } from "./ui";

addMessages(replyEnglish, replySimplifiedChinese);
const STATUS = {
  running: "chat.tool.running",
  done: "chat.tool.done",
  failed: "chat.tool.failed",
} as const;
// The latest step on one line; every step behind a disclosure.
function ToolSteps({ steps }: { steps: readonly ToolStep[] }) {
  const { format: t, primitives } = context();
  const B = primitives.button;
  const [open, setOpen] = useState(false);
  const list = `wp${useId().replace(/[^\w-]/g, "")}-steps`;
  const name = (step: ToolStep) => step.label ?? t("chat.tool.working");
  const latest = steps.at(-1)!;
  return (
    <div data-tool-steps="" data-status={latest.status}>
      {open ? null : <p>{name(latest)}</p>}
      {steps.length > 1 ? (
        <B
          aria-expanded={open}
          aria-controls={list}
          onPress={() => setOpen(!open)}
        >
          {t(open ? "chat.tool.hide" : "chat.tool.show", {
            count: steps.length,
          })}
        </B>
      ) : null}
      {open ? (
        <ol id={list}>
          {steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span>{name(step)}</span>
              <span>{t(STATUS[step.status])}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
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
  const steps = client.getSnapshot().toolSteps;
  // The pressed button goes away: focus moves on to the composer.
  const then = (action: () => unknown) => () => {
    const origin = focus?.originFor("reply-wait");
    void action();
    focusFor(focus, focus?.composer(), { origin, owner: focus?.owner() ?? "" });
  };
  return (
    <>
      {steps.length ? <ToolSteps steps={steps} /> : null}
      {row === "overdue" ? (
        <div data-reply-controls="">
          <B onPress={then(() => client.keepWaiting())}>
            {t("chat.reply.keepWaiting")}
          </B>
          <B onPress={then(() => client.retryReply())}>{t("chat.retry")}</B>
        </div>
      ) : row === "failed" || row === "unavailable" ? (
        <div data-reply-controls="">
          <B onPress={then(() => client.retryReply())}>{t("chat.retry")}</B>
        </div>
      ) : row === "writing" && client.canStopReply() ? (
        <div data-reply-controls="">
          <B onPress={() => void client.stopReply()}>{t("chat.reply.stop")}</B>
        </div>
      ) : null}
    </>
  );
}
