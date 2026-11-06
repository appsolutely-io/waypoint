// The host's confirmation record, shown verbatim with its one action: a
// lazy chunk, loaded with its messages when a confirmation is shown.
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ConfirmationRecord } from "../protocol/generated";
import {
  confirmationEnglish,
  confirmationSimplifiedChinese,
} from "./confirmation-messages";
import { addMessages, catalogueFor, type MessageKey } from "./i18n";
import { intlLocale } from "./intl-locale";
import type { ActionEntry } from "./plan-view";
import { ActionButton, context, useRefresh } from "./ui";
import { focusFor, useChatFocus } from "./chat-focus";

addMessages(confirmationEnglish, confirmationSimplifiedChinese);
const LIST_LIMIT = 10;
const REFUSAL: Record<string, MessageKey> = {
  expired: "chat.confirmation.expired",
  used: "chat.confirmation.used",
  stale: "chat.confirmation.changed",
  mismatch: "chat.confirmation.mismatch",
};
/** The host's confirmation record, shown verbatim, with its one action. */
export default function ConfirmationRecordView({
  record,
  planId,
  entry,
  onConfirm,
  refusal,
  override,
  replaced,
}: {
  // Absent when the host issued no confirmation for this plan, this
  // conversation and this revision.
  record?: ConfirmationRecord;
  // The plan shown, with or without a record.
  planId?: string;
  entry?: ActionEntry;
  onConfirm(): void;
  refusal?: string;
  // The host's own text and action for the refusal, which win over ours.
  override?: { text: string; action?: ReactNode } | null;
  replaced: boolean;
}) {
  const { format: t, primitives, locale, client } = context();
  // The refusal's Refresh reads the conversation and the plan again, one
  // refresh at a time, so the plan's factual state replaces the refusal.
  const refresh = useRefresh(() =>
    Promise.all([client.refresh(), client.readPlan()]),
  );
  const B = primitives.button;
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // A shown record replaced or removed without a press is said once; one
  // that belongs to another client or conversation is not a replacement.
  const token = record?.token;
  const owner = useChatFocus()?.owner();
  const [shown, setShown] = useState({ token, owner });
  const [swapped, setSwapped] = useState(false);
  if (shown.token !== token || shown.owner !== owner) {
    setShown({ token, owner });
    setSwapped(shown.owner === owner);
  }
  // The control that had focus inside the confirmation, with the plan and
  // conversation shown then. Appearing never takes focus; a replacement that
  // kept the control leaves focus there; one that removed it hands focus to
  // the heading only through the guarded removal handoff: focus was on it
  // until it went, and the same plan and conversation are still shown.
  const chatFocus = useChatFocus();
  const focused = useRef<
    { element: Element; planId?: string; key: string } | undefined
  >(undefined);
  const plan = useRef(planId);
  plan.current = planId;
  useLayoutEffect(() => {
    const was = focused.current;
    if (!was || was.element.isConnected || !chatFocus) return;
    focused.current = undefined;
    focusFor(chatFocus, heading.current, {
      owner: was.key,
      stillCurrent: () =>
        chatFocus.owner() === was.key && plan.current === was.planId,
      removed: was.element,
    });
  });
  const title = (
    <h3 id={`${id}-heading`} ref={heading} tabIndex={-1}>
      {t("chat.confirmation.heading")}
    </h3>
  );
  const region = (children: ReactNode, described?: string) => (
    <section
      data-confirmation=""
      aria-labelledby={`${id}-heading`}
      aria-describedby={described}
      onFocus={(event) => {
        focused.current = {
          element: event.target,
          planId,
          key: chatFocus?.owner() ?? "",
        };
      }}
    >
      {title}
      {children}
    </section>
  );
  const status = (children: ReactNode) => <p role="status">{children}</p>;
  if (!record)
    return region(
      <>
        <p>{t("chat.confirmation.unavailable")}</p>
        {status(swapped ? t("chat.confirmation.changed") : null)}
      </>,
    );
  const items =
    expanded || record.items.length <= LIST_LIMIT
      ? record.items
      : record.items.slice(0, LIST_LIMIT);
  const notice =
    replaced || (swapped && !refusal)
      ? "chat.confirmation.changed"
      : refusal
        ? (REFUSAL[refusal] ?? "chat.problem.refused")
        : undefined;
  // An expiry by the clock is said once in the status; the button already
  // shows it as its reason.
  const expired = !notice && entry?.reasonKey === "chat.confirmation.expired";
  return region(
    <>
      <p id={`${id}-summary`}>{record.heading}</p>
      <ol id={`${id}-items`}>
        {items.map((item, index) => (
          <li key={index}>
            <p>{item.label}</p>
            <dl>
              {item.before !== undefined ? (
                <>
                  <dt>{t("chat.confirmation.before")}</dt>
                  <dd>{item.before}</dd>
                </>
              ) : null}
              {item.after !== undefined ? (
                <>
                  <dt>{t("chat.confirmation.after")}</dt>
                  <dd>{item.after}</dd>
                </>
              ) : null}
            </dl>
            {item.note ? <p>{item.note}</p> : null}
          </li>
        ))}
      </ol>
      {record.items.length > LIST_LIMIT ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-items`}
          onClick={() => setExpanded((value) => !value)}
        >
          {t("chat.confirmation.showAll", { count: record.items.length })}
        </button>
      ) : null}
      <p id={`${id}-dates`}>
        {record.schedule
          ? `${record.schedule.startText} – ${record.schedule.endText}`
          : ""}
      </p>
      {record.irreversible ? (
        <p>
          <strong>{t("chat.confirmation.irreversible")}</strong>
        </p>
      ) : null}
      <p>{record.undo}</p>
      {record.verificationCount > 0 ? (
        <p>
          {t("chat.confirmation.verifications", {
            count: record.verificationCount,
          })}
        </p>
      ) : null}
      <p>
        <time data-expires="" dateTime={record.expiresAt}>
          {t("chat.confirmation.expires", {
            time: new Date(record.expiresAt).toLocaleString(
              intlLocale(
                locale ?? "en",
                catalogueFor(locale).catalogue === "zh",
              ),
            ),
          })}
        </time>
      </p>
      {entry ? (
        <ActionButton
          action={entry}
          label={record.actionLabel}
          onPress={() => {
            setSwapped(false);
            onConfirm();
          }}
        />
      ) : null}
      <p role="status">
        {notice && refusal && !replaced && override ? (
          <>
            {override.text}
            {override.action}
          </>
        ) : notice ? (
          <>
            {t(notice)}
            {notice !== "chat.confirmation.expired" &&
            notice !== "chat.problem.refused" ? (
              <B
                onPress={refresh.press}
                aria-busy={refresh.busy || undefined}
                aria-disabled={refresh.busy || undefined}
              >
                {t("chat.confirmation.refresh")}
              </B>
            ) : null}
          </>
        ) : expired ? (
          <span className="wp-sr">{t("chat.confirmation.expired")}</span>
        ) : null}
      </p>
    </>,
    `${id}-summary ${id}-dates`,
  );
}
