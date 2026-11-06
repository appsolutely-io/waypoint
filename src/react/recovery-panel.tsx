// The recovery panel of a protected plan: a lazy chunk, loaded with its
// messages when a protected plan is shown. Rendering only: what is shown is
// computed by plan-view, and every press goes through the client.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { IntentKind } from "../protocol/generated";
import { addMessages, type FormatMessage } from "./i18n";
import type { ActionId, PlanView, ViewMessage } from "./plan-view";
import type { KeepSheet } from "./recovery";
import {
  recoveryEnglish,
  recoverySimplifiedChinese,
} from "./recovery-messages";
import { ActionButton, Part, context, type Slots } from "./ui";
import { stepName } from "./step-name";
import { blockEnglish, blockSimplifiedChinese } from "./block-messages";
import {
  focusFor,
  isEditable,
  ModalDrawer,
  useChatFocus,
  useDrawerFocus,
  useRetiredOnSwitch,
} from "./chat-focus";
import {
  composedContains,
  deepActiveElement,
  focusable,
  retireOrigin,
  type FocusOrigin,
} from "./focus";

addMessages(recoveryEnglish, recoverySimplifiedChinese);
// A read-only plan's recorded state uses the blocks' state words.
addMessages(blockEnglish, blockSimplifiedChinese);
const text = (t: FormatMessage, message: ViewMessage) =>
  t(message.key, message.values);
// The intents a press in the panel can produce an alert for; Retry and the
// status check answer for whichever intent is pending.
const PRESSED_KINDS: Partial<Record<ActionId | "retry", IntentKind[]>> = {
  stop: ["stop"],
  decline: ["cancel-initial", "cancel-review"],
  leave: ["leave"],
  keep: ["keep"],
};
const PENDING_LINE: Record<IntentKind, ViewMessage["key"]> = {
  stop: "chat.recovery.stopping",
  "cancel-initial": "chat.recovery.cancelling",
  "cancel-review": "chat.recovery.cancelling",
  leave: "chat.recovery.leavePending",
  keep: "chat.recovery.keepPending",
};
// Everything a polite update may announce, as one comparable string.
const pendingLine = (view: PlanView) =>
  view.intent?.status === "sending"
    ? PENDING_LINE[view.intent.kind]
    : undefined;
const announced = (view: PlanView, t: FormatMessage) =>
  [
    text(t, view.status!.label),
    ...(pendingLine(view) ? [t(pendingLine(view)!)] : []),
    ...view.steps.map((step) => `${step.stepId}:${step.truth}`),
    ...view.lines.map((line) => text(t, line)),
    ...view.notice.map((line) => text(t, line)),
  ].join("\n");

export default function RecoveryPanel({
  view,
  onPress,
  slots,
  sheet,
  hide = [],
}: {
  view: PlanView;
  onPress(id: ActionId | "retry"): void;
  slots?: Slots;
  sheet?: KeepSheet | null;
  // Actions another part renders (the confirm bar's Confirm).
  hide?: readonly ActionId[];
}) {
  const { format: t, primitives, planLabels } = context();
  const B = primitives.button;
  const D = primitives.drawer;
  const sheetFocus = useDrawerFocus("keep-sheet");
  // The sheet's Keep belongs to the conversation it opened in.
  const sheetRetired = useRetiredOnSwitch(
    Boolean(sheet),
    useChatFocus()?.owner(),
    () => sheet?.onCancel(),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLElement>(null);
  const chatFocus = useChatFocus();
  // The press in this panel an alert may answer, and the move R1 made.
  const pressed = useRef<
    { origin: FocusOrigin; kinds: readonly IntentKind[] } | undefined
  >(undefined);
  const moved = useRef<
    | { origin: FocusOrigin; target: HTMLElement; previous: Element | null }
    | undefined
  >(undefined);
  const alerted = useRef<number | undefined>(undefined);
  const restored = useRef<number | undefined>(undefined);
  const last = useRef<string | undefined>(undefined);
  const lastOwner = useRef<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState<{
    serial: number;
    text: string;
  } | null>(null);
  const retryReason = useId();
  const status = view.status!;
  const alert = view.alert;
  // One polite update when a step, the status, an evidence line or a notice
  // changes; nothing on an unchanged render.
  useEffect(() => {
    // Another client, conversation or plan shown here is a first appearance.
    const owner = `${chatFocus?.owner()}|${view.planId}`;
    if (lastOwner.current !== owner) {
      lastOwner.current = owner;
      last.current = undefined;
    }
    const now = announced(view, t);
    const before = last.current;
    last.current = now;
    if (before === now) return;
    // A panel that first appears announces only a request it is sending,
    // not the history it shows.
    if (before === undefined) {
      const sending = pendingLine(view);
      if (sending)
        setAnnouncement((current) => ({
          serial: (current?.serial ?? 0) + 1,
          text: t(sending),
        }));
      return;
    }
    const parts: string[] = [];
    const old = new Set(before.split("\n"));
    if (view.steps.some((step) => !old.has(`${step.stepId}:${step.truth}`)))
      parts.push(t("chat.recovery.stepStatusChanged"));
    const label = text(t, status.label);
    if (!old.has(label)) parts.push(label);
    const sending = pendingLine(view);
    if (sending && !old.has(t(sending)) && t(sending) !== label)
      parts.push(t(sending));
    for (const line of [...view.lines, ...view.notice]) {
      const value = text(t, line);
      if (!old.has(value)) parts.push(value);
    }
    if (parts.length)
      setAnnouncement((current) => ({
        serial: (current?.serial ?? 0) + 1,
        text: parts.join(" "),
      }));
  });
  // What this panel holds for one plan ends with it: when the panel goes,
  // or shows another plan, its press and its way back authorize nothing.
  useEffect(
    () => () => {
      retireOrigin(pressed.current?.origin);
      retireOrigin(moved.current?.origin);
      pressed.current = undefined;
      moved.current = undefined;
    },
    [view.planId],
  );
  // A pressed intent that settled without an alert answers nothing later.
  const pendingKind = view.intent?.kind;
  useEffect(() => {
    if (!pendingKind && !alert) {
      retireOrigin(pressed.current?.origin);
      pressed.current = undefined;
    }
  }, [pendingKind, alert]);
  // Focus moves once to a new alert only when it answers a press made in
  // this panel; a resolved request returns it only while focus is still
  // where that move put it (chat-focus).
  useEffect(() => {
    if (!alert) return;
    const document = root.current?.ownerDocument;
    if (!document || !chatFocus) return;
    if (alert.restoreFocus) {
      if (restored.current === alert.serial) return;
      restored.current = alert.serial;
      const was = moved.current;
      moved.current = undefined;
      if (!was) return;
      const active = deepActiveElement(document);
      // Its target removed counts only when focus went nowhere with it.
      const gone =
        !was.target.isConnected && (!active || active === document.body)
          ? was.target
          : null;
      if (!composedContains(root.current!, active) && !gone)
        return retireOrigin(was.origin);
      const back =
        focusable(was.previous) &&
        composedContains(chatFocus.root()!, was.previous)
          ? was.previous
          : heading.current;
      const key = was.origin.owner;
      focusFor(chatFocus, back, {
        origin: was.origin,
        owner: key,
        stillCurrent: () => chatFocus.owner() === key,
        removed: gone,
        fallback: heading.current,
      });
      return;
    }
    if (alerted.current === alert.serial) return;
    alerted.current = alert.serial;
    const press = pressed.current;
    if (!press || !pendingKind || !press.kinds.includes(pendingKind)) return;
    pressed.current = undefined;
    const previous = deepActiveElement(document);
    if (isEditable(previous)) return retireOrigin(press.origin);
    const target = root.current?.querySelector<HTMLElement>(
      alert.action === "checkStatus"
        ? '[data-action="status"]'
        : alert.action === "retry" || alert.action === "wait"
          ? '[data-action="retry"]'
          : "[data-guidance]",
    );
    const key = press.origin.owner;
    if (
      target &&
      focusFor(chatFocus, target, {
        origin: press.origin,
        owner: key,
        stillCurrent: () => chatFocus.owner() === key,
        // Kept for the way back once the request resolves.
        keep: true,
      })
    ) {
      retireOrigin(moved.current?.origin);
      moved.current = { origin: press.origin, target, previous };
    }
  }, [alert, chatFocus, pendingKind]);
  // A press here records the origin a later alert may answer.
  const press = (id: ActionId | "retry") => {
    const origin = chatFocus?.originFor(`intent:${view.planId}:${id}`);
    const kinds = PRESSED_KINDS[id] ?? (pendingKind ? [pendingKind] : []);
    retireOrigin(pressed.current?.origin);
    pressed.current = origin ? { origin, kinds } : undefined;
    onPress(id);
  };
  const intentLine = pendingLine(view);
  const actions = view.actions.filter((action) => !hide.includes(action.id));
  let alertBody: ReactNode = null;
  if (alert && !alert.restoreFocus) {
    const guidance =
      alert.action === "signIn"
        ? t("chat.recovery.signInRequired")
        : alert.action === "hostGuidance"
          ? t("chat.recovery.hostGuidance")
          : null;
    alertBody = (
      <>
        {alert.message ? <span>{text(t, alert.message)}</span> : null}
        {guidance ? (
          <span tabIndex={-1} data-guidance="">
            {guidance}
          </span>
        ) : null}
        {alert.action === "retry" || alert.action === "wait" ? (
          <>
            <B
              data-action="retry"
              aria-disabled={alert.retryAvailable ? undefined : true}
              aria-describedby={alert.retryReasonKey ? retryReason : undefined}
              onPress={alert.retryAvailable ? () => press("retry") : undefined}
            >
              {t("chat.retry")}
            </B>
            {alert.retryReasonKey ? (
              <span id={retryReason}>
                {t(alert.retryReasonKey, alert.retryValues)}
              </span>
            ) : null}
          </>
        ) : null}
      </>
    );
  }
  return (
    <Part name="recoveryPanel" slots={slots} data={{ view }}>
      <section
        ref={root}
        aria-labelledby={`${view.planId}-recovery`}
        data-status={status.dataStatus}
        data-wire-state={status.wireState}
        data-attention={String(status.attention)}
        data-tone={status.tone}
        data-result={status.result}
        data-intent-kind={view.intent?.kind}
        data-intent-status={view.intent?.status}
      >
        <h3 id={`${view.planId}-recovery`} ref={heading} tabIndex={-1}>
          {text(t, status.label)}
        </h3>
        <p role="status" aria-live="polite">
          {announcement ? (
            <span
              key={announcement.serial}
              data-announcement={announcement.serial}
            >
              {announcement.text}
            </span>
          ) : null}
        </p>
        {intentLine ? <p data-intent-line="">{t(intentLine)}</p> : null}
        {view.lines.map((line) => (
          <p key={line.key} data-line={line.key}>
            {text(t, line)}
          </p>
        ))}
        {view.steps.length ? (
          <ol>
            {view.steps.map((step) => (
              <Part
                key={step.stepId}
                name="stepStatusRow"
                slots={slots}
                data={{ step }}
              >
                <li data-status={step.truth} data-late={step.lateReport}>
                  {stepName(t, planLabels, step)}: {t(step.textKey)}
                  {step.lateReport ? (
                    <> ({t("chat.recovery.reportedDifferently")})</>
                  ) : null}
                </li>
              </Part>
            ))}
          </ol>
        ) : null}
        {view.notice.length ? (
          <div data-notice="">
            {view.notice.map((line) => (
              <p key={line.key}>{text(t, line)}</p>
            ))}
          </div>
        ) : null}
        <div role="alert">{alertBody}</div>
        <Part name="recoveryActions" slots={slots} data={{ actions }}>
          {actions.map((action) => (
            <ActionButton key={action.id} action={action} onPress={press} />
          ))}
        </Part>
        {sheet && !sheetRetired ? (
          <ModalDrawer
            as={D}
            open
            label={t("chat.recovery.keepChanges")}
            onClose={sheet.onCancel}
            closeLabel={t("chat.close")}
            {...sheetFocus}
          >
            {sheet.messages.map((line) => (
              <p key={line.key}>{text(t, line)}</p>
            ))}
            <ActionButton
              action={{
                id: "keep",
                labelKey: "chat.recovery.keepChanges",
                ...sheet.proceed,
              }}
              onPress={() => {
                // Proceeding sends Keep; an alert for it answers this press.
                const origin = chatFocus?.originFor(
                  `intent:${view.planId}:keep`,
                );
                retireOrigin(pressed.current?.origin);
                pressed.current = origin
                  ? { origin, kinds: ["keep"] }
                  : undefined;
                sheet.onProceed();
              }}
            />
            <B onPress={sheet.onCancel}>{t("chat.cancel")}</B>
          </ModalDrawer>
        ) : null}
      </section>
    </Part>
  );
}
