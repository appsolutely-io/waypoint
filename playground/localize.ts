import type { Conversation } from "../src/protocol/generated";
import type { FormSession, FormSnapshot } from "../src/core/form-fill";
import type { View } from "./state";
import { translatePreview } from "./copy";

function translateValues(value: unknown, lang: View["lang"]): unknown {
  if (typeof value === "string") return translatePreview(value, lang);
  if (Array.isArray(value))
    return value.map((item) => translateValues(item, lang));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "label" ? item : translateValues(item, lang),
      ]),
    );
  return value;
}
export function localizeConversation(
  value: Conversation,
  lang: View["lang"],
): Conversation {
  return {
    ...value,
    title: translatePreview(value.title, lang),
    ...(value.subject
      ? {
          subject: {
            ...value.subject,
            label: translatePreview(value.subject.label, lang),
          },
        }
      : {}),
    messages: value.messages.map((message, at) => {
      const seeded =
        message.clientMessageId?.startsWith("seed-") ||
        (message.role === "assistant" &&
          value.messages[at - 1]?.clientMessageId?.startsWith("seed-"));
      return {
        ...message,
        content: seeded
          ? translatePreview(message.content, lang)
          : message.content,
        blocks: message.blocks?.map((block) =>
          block.type === "form.fill"
            ? {
                ...block,
                body: translateValues(block.body, lang),
                fallback: translatePreview(block.fallback, lang),
              }
            : block,
        ),
      };
    }),
  };
}
export function localizeForm(
  session: FormSession,
  language: () => View["lang"],
): FormSession & { refreshLabels(): void } {
  const listeners = new Set<() => void>();
  let previous: FormSnapshot | undefined;
  let locale: View["lang"] | undefined;
  let localized: FormSnapshot;
  return {
    ...session,
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribe = session.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    refreshLabels() {
      for (const listener of listeners) listener();
    },
    getSnapshot() {
      const snapshot = session.getSnapshot(),
        lang = language();
      if (snapshot !== previous || lang !== locale) {
        previous = snapshot;
        locale = lang;
        localized = {
          ...snapshot,
          fields: Object.fromEntries(
            Object.entries(snapshot.fields).map(([name, draft]) => [
              name,
              { ...draft, label: translatePreview(draft.label, lang) },
            ]),
          ),
        };
      }
      return localized;
    },
  };
}
