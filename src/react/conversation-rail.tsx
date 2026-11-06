import type { ReactNode } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  ConversationSource,
  ConversationSummary,
} from "../core/form-fill";
import { focusFor, useChatFocus } from "./chat-focus";
import { context } from "./ui";
import { isSafeUrl } from "./urls";
export interface ConversationRailProps {
  conversations: readonly ConversationSummary[];
  source?: ConversationSource;
  /** Called in the press of a choice, before its switch starts. */
  onChoose?(): void;
}
export function ConversationRail({
  conversations,
  source,
  onChoose,
}: ConversationRailProps) {
  const { client, format: t, primitives, extraUrlSchemes } = context();
  const { conversationId } = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const [filter, setFilter] = useState("");
  const [loaded, setLoaded] = useState<ConversationSummary[]>([]);
  const [failed, setFailed] = useState(false);
  // Pressing Retry lists again.
  const [attempt, setAttempt] = useState(0);
  const [knownTopics, setKnownTopics] = useState(
    new Map<string, NonNullable<ConversationSummary["subject"]>>(),
  );
  useEffect(() => {
    if (!source) return;
    let current = true;
    setFailed(false);
    void Promise.resolve()
      .then(() => source.list(filter || undefined))
      .then((items) => {
        if (current) {
          setLoaded(items);
          setKnownTopics(
            (old) =>
              new Map([
                ...old,
                ...items
                  .filter((item) => item.subject)
                  .map((item) => [item.subject!.key, item.subject!] as const),
              ]),
          );
        }
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [source, filter, conversationId, attempt]);
  const items = source ? loaded : conversations;
  const topics = source
    ? knownTopics
    : new Map(
        items
          .filter((item) => item.subject)
          .map((item) => [item.subject!.key, item.subject!]),
      );
  const groups = new Map<string, ConversationSummary[]>();
  for (const item of items) {
    const key = item.subject?.key ?? "";
    if (filter && key !== filter) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const Button = primitives.button;
  const focus = useChatFocus();
  const row = (item: ConversationSummary) => (
    <>
      <Button
        aria-current={item.id === conversationId ? "page" : undefined}
        onPress={() => {
          onChoose?.();
          // A switch the user starts here hands focus to the composer once
          // it settles, if it is still theirs (chat-focus).
          // Taken at the press: the owner is this client's, whatever the
          // chat shows when the switch settles.
          const owner = focus?.ownerOf(item.id) ?? item.id;
          const origin = focus?.originFor("switch", owner);
          void client.switchConversation(item.id).then((result) =>
            // Only this switch's own successful read, still shown.
            focusFor(focus, focus?.composer(), {
              origin,
              owner,
              stillCurrent: () =>
                result.kind === "loaded" &&
                focus?.owner() === owner &&
                client.getSnapshot().conversation?.id === item.id,
            }),
          );
        }}
      >
        {item.title}
      </Button>
      {item.mode === "form-fill" && <span>{t("form.marker")}</span>}
      {item.subject?.state === "unlinked" && <span>{t("form.unlinked")}</span>}
      {item.subject?.route &&
        isSafeUrl(item.subject.route, extraUrlSchemes) && (
          <a href={item.subject.route}>{t("form.return")}</a>
        )}
    </>
  );
  return (
    <nav className="wp-rail" aria-label={t("chat.rail")} tabIndex={-1}>
      {topics.size > 0 && (
        <label>
          {t("form.filter")}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t("form.all")}</option>
            {[...topics].map(([key, subject]) => (
              <option key={key} value={key}>
                {subject.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {failed && (
        <p role="alert">
          {t("chat.conversationsFailed")}{" "}
          <Button onPress={() => setAttempt((count) => count + 1)}>
            {t("chat.retry")}
          </Button>
        </p>
      )}
      {[...groups].map(([key, group]) => {
        const seen = new Set<string>();
        const tree = (item: ConversationSummary): ReactNode => {
          if (seen.has(item.id)) return null;
          seen.add(item.id);
          const children = group.filter(
            (child) =>
              child.parentConversationId === item.id && !seen.has(child.id),
          );
          return (
            <li key={item.id} data-conversation-id={item.id}>
              {row(item)}
              {children.length > 0 && (
                <details>
                  <summary>{t("form.threads")}</summary>
                  <ul>{children.map(tree)}</ul>
                </details>
              )}
            </li>
          );
        };
        const roots = group.filter(
          (item) =>
            !item.parentConversationId ||
            !group.some((parent) => parent.id === item.parentConversationId),
        );
        const nodes = roots.map(tree);
        for (const item of group)
          if (!seen.has(item.id)) nodes.push(tree(item));
        return (
          <section key={key}>
            {key && <h3>{group[0]!.subject!.label}</h3>}
            <ul>{nodes}</ul>
          </section>
        );
      })}
    </nav>
  );
}
