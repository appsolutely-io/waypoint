// The text of the keys the renderer-neutral hooks return, for a host that
// draws its own UI: a formatter over the catalogue the host imports for its
// language (`./messages/en`, `./messages/zh-Hans`). No React, no DOM. The
// web chat formats its own text and loads its catalogues itself.
import { IntlMessageFormat } from "intl-messageformat";
import type { FormatMessage, MessageKey } from "../react/i18n";
import { intlLocale } from "../react/intl-locale";
import { production } from "../react/production";

/** A language's text, by message key, as a locale entry exports it. */
export type Catalogue = Readonly<Partial<Record<MessageKey, string>>>;

/**
 * A formatter for one language: ICU messages from `catalogue`, with that
 * locale's plural rules. A key the catalogue lacks throws in development,
 * so a host finds the gap; in production it shows the key itself.
 */
export function createFormatter(
  locale: string,
  catalogue: Catalogue,
): FormatMessage {
  const intl = intlLocale(locale, /^zh/i.test(locale));
  const cache = new Map<MessageKey, IntlMessageFormat>();
  return (key, values) => {
    const text = catalogue[key];
    if (text === undefined) {
      if (production()) return key;
      throw new Error(`waypoint: the ${locale} catalogue has no "${key}"`);
    }
    let format = cache.get(key);
    if (!format) cache.set(key, (format = new IntlMessageFormat(text, intl)));
    return String(format.format(values));
  };
}
export { stepName } from "../react/step-name";
export type { PlanLabels } from "../react/step-name";
export type {
  FormatMessage,
  MessageKey,
  MessageValues,
  english,
} from "../react/i18n";
export type {
  RecoveryCatalogue,
  RecoveryMessageKey,
} from "../react/recovery-messages";
export type {
  ConfirmationCatalogue,
  ConfirmationMessageKey,
} from "../react/confirmation-messages";
export type { BlockCatalogue, BlockMessageKey } from "../react/block-messages";
export type { ReplyCatalogue, ReplyMessageKey } from "../react/reply-messages";
export type {
  ProblemCatalogue,
  ProblemMessageKey,
} from "../react/problem-messages";
export type { FormCatalogue, FormMessageKey } from "../react/form-messages";
