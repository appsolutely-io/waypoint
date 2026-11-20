// The reply's steps and controls: a lazy chunk, loaded when a reply is
// first written, overdue, failed or unavailable, or reading on the host's
// behalf.
import { useContext, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReplyState, ToolStep, WaypointClient } from "../core/client";
import { ChatFocusContext, focusFor } from "./chat-focus";
import { addMessages } from "./i18n";
import {
  replyRowView,
  type HostBusyStopControl,
  type ReplyRowAction,
} from "./problem-view";
import { conversationTail } from "../core/reply-recovery";
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
  expectedReplyStop,
}: {
  client: WaypointClient;
  row: ReplyState;
  expectedReplyStop?: HostBusyStopControl;
}) {
  const { format: t, primitives } = context();
  const B = primitives.button;
  const focus = useContext(ChatFocusContext);
  const snapshot = client.getSnapshot();
  const steps = snapshot.toolSteps;
  const tail = conversationTail(snapshot.conversation?.messages ?? []);
  const failure = snapshot.replyFailures?.find((failure) => failure.active);
  const terminal =
    !snapshot.pending.some((pending) => !pending.failure) &&
    tail?.role === "assistant" &&
    (tail.status === "failed" || tail.status === "unavailable")
      ? tail.status
      : undefined;
  const controlRow =
    row === "expected" || row === "expected-overdue"
      ? (failure?.status ?? terminal ?? row)
      : row;
  const view = replyRowView(controlRow, {
    canStop: client.canStopReply(),
    canRetry: client.canRetryReply(),
    canRegenerate:
      !!tail && (client.canRegenerate?.(tail.id) ?? client.canChangeVersions()),
    recovery: failure?.failure.recovery?.kind,
    presentation: snapshot.replyPresentation,
    busy: snapshot.replyBusy,
    expectedReplyStop,
  });
  const actions =
    controlRow === "expected" || controlRow === "expected-overdue"
      ? []
      : view.actions;
  const anchor = useRef<HTMLDivElement>(null);
  const focused = useRef<{ element: Element; owner: string } | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    const before = focused.current;
    if (before && !before.element.isConnected) {
      focusFor(focus, anchor.current, {
        owner: before.owner,
        removed: before.element,
      });
      focused.current = undefined;
    }
  });
  const then = (action: () => unknown) => () => {
    const origin = focus?.originFor("reply-wait");
    void action();
    focusFor(focus, focus?.composer(), { origin, owner: focus?.owner() ?? "" });
  };
  const press = (action: ReplyRowAction) =>
    action.id === "stop"
      ? () => void client.stopReply()
      : action.id === "hostStop"
        ? () => {
            if (!expectedReplyStop?.disabled && !expectedReplyStop?.busy)
              void expectedReplyStop?.onPress();
          }
        : then(() =>
            action.id === "retry" ? client.retryReply() : client.keepWaiting(),
          );
  const button = (action: ReplyRowAction) => (
    <B
      key={action.id}
      onPress={press(action)}
      aria-disabled={
        action.id === "hostStop"
          ? !!expectedReplyStop?.disabled || !!expectedReplyStop?.busy
          : undefined
      }
      aria-busy={
        action.id === "hostStop" && expectedReplyStop?.busy ? true : undefined
      }
    >
      {action.label ?? t(action.labelKey)}
    </B>
  );
  return (
    <>
      {steps.length ? <ToolSteps steps={steps} /> : null}
      <div
        role="group"
        aria-label={t("chat.reply.recoveryGroup")}
        data-reply-recovery=""
        ref={anchor}
        tabIndex={-1}
        onFocusCapture={(event) => {
          focused.current = {
            element: event.target,
            owner: focus?.owner() ?? "",
          };
        }}
      >
        {actions.length ? (
          <div data-reply-controls="">{actions.map(button)}</div>
        ) : null}
      </div>
      {view.busy ? (
        <div
          role="group"
          aria-label={t("chat.reply.hostActivityGroup")}
          data-host-activity=""
        >
          <p role="status" data-host-busy="">
            {view.busy.label ?? t(view.busy.key)}
            {view.busy.label !== undefined &&
            view.busy.kind === "expected-overdue" ? (
              <> {t(view.busy.key)}</>
            ) : null}
          </p>
          {view.busy.actions.length ? (
            <div data-reply-controls="">{view.busy.actions.map(button)}</div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
