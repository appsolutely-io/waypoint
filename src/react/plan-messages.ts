// Every message the plan view, cards and problems name, for a host that
// draws them itself. The web chat registers these catalogues as its chunks
// load; a renderer-neutral host has no chunks, so its formatter registers
// them all. Data only: no DOM.
import { blockEnglish, blockSimplifiedChinese } from "./block-messages";
import {
  confirmationEnglish,
  confirmationSimplifiedChinese,
} from "./confirmation-messages";
import { formEnglish, formSimplifiedChinese } from "./form-messages";
import {
  addMessages,
  createFormatter as createChatFormatter,
  type FormatMessage,
} from "./i18n";
import { problemEnglish, problemSimplifiedChinese } from "./problem-messages";
import {
  recoveryEnglish,
  recoverySimplifiedChinese,
} from "./recovery-messages";

/**
 * A formatter with the text of every message key, in English or
 * Simplified Chinese, for the labels, statuses and reasons the plan view
 * and the card hooks give as keys.
 */
export function createFormatter(locale?: string): FormatMessage {
  addMessages(recoveryEnglish, recoverySimplifiedChinese);
  addMessages(confirmationEnglish, confirmationSimplifiedChinese);
  addMessages(blockEnglish, blockSimplifiedChinese);
  addMessages(problemEnglish, problemSimplifiedChinese);
  addMessages(formEnglish, formSimplifiedChinese);
  return createChatFormatter(locale);
}
