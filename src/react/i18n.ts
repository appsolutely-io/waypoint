import { IntlMessageFormat } from "intl-messageformat";
import { intlLocale } from "./intl-locale";
import type { RecoveryCatalogue } from "./recovery-messages";
import type { BlockCatalogue } from "./block-messages";
import type { ConfirmationCatalogue } from "./confirmation-messages";
import type { ProblemCatalogue } from "./problem-messages";
import type { ReplyCatalogue } from "./reply-messages";
import type { FormCatalogue } from "./form-messages";
export const english = {
  "form.valid": "Valid",
  "form.invalid": "Invalid",
  "form.title": "Fill this form",
  "form.closeHint":
    "Closing discards this fill; the reply stays in the conversation.",
  "form.generate": "Generate draft",
  "form.references": "Reference links",
  "form.attachment": "Private attachment",
  "form.regenerate": "Regenerate {field}",
  "form.replace": "Replace your edit?",
  "form.marker": "Form",
  "form.filter": "Filter by topic",
  "form.all": "All topics",
  "form.threads": "Sub-threads",
  "form.return": "Back to form or record",
  "form.unlinked": "Saved, not linked",
  "form.toolsLoading": "Draft tools are still loading.",
  "form.toolsFailed": "Draft tools couldn't load. Retry first.",
  "form.fixFirst": "Fix the highlighted fields first.",
  "form.number": "Enter a number.",
  "form.editInForm": "Edit this value in the form.",
  "form.imagesNow": "Images can't be attached right now.",
  "form.imagesHere": "Images can't be attached here.",

  "chat.title": "Conversation",
  "chat.empty": "Start a conversation",
  "chat.message": "Message",
  "chat.send": "Send",
  "chat.sending": "Sending",
  "chat.pendingSending": "Sending…",
  "chat.pendingFailed": "Not sent",
  "chat.planUnavailable": "The plan's steps could not be loaded.",
  "chat.arrival": "New reply",
  "chat.arrivalExcerpt": "New reply: {excerpt}",
  "chat.arrivalFailed": "A reply could not be completed.",
  "chat.arrivalMany": "{count} new replies. Latest: {excerpt}",
  "chat.arrivalManyPlain": "{count} new replies",
  "chat.arrivalManyFailed":
    "{count} new replies; {failed} could not be completed.",
  "chat.arrivalAllFailed": "{count} replies could not be completed.",
  "chat.transcript": "Messages",
  "chat.outlineItem": "{role}, message {position}: {excerpt}",
  "chat.outlineItemPlain": "{role}, message {position}",
  "chat.roleUser": "You",
  "chat.roleAssistant": "Assistant",
  "chat.messageLoading": "Loading message…",
  "chat.messageUnavailable": "This message cannot be shown right now.",
  "chat.changesTo": "changes to",
  "chat.stepName": "Change {index}",
  "chat.stepNamed": "{name} {index}",
  "chat.fieldName": "Value {index}",
  "chat.scrollRegion": "Scrollable content",
  "chat.conversationReadFailed": "This conversation could not be loaded.",
  "chat.conversationsFailed": "Your conversations could not be loaded.",
  "chat.messagesUnavailable": "Some messages cannot be shown right now.",
  unsupportedContent:
    "Some content cannot be shown here. Contact the site administrator.",
  "chat.failure": "The request could not be completed.",
  "chat.update": "This chat needs an update.",
  "chat.conversationUnavailable":
    "This conversation is unavailable. Reload to continue; this does not stop a server turn.",
  "chat.reload": "Reload conversation",
  "chat.retry": "Retry",
  "chat.withdraw": "Withdraw",
  "chat.restored": "Withdrawn messages",
  "chat.restoredEdit": "Edit",
  "chat.restoredDiscard": "Discard",
  "chat.dismiss": "Dismiss",
  "chat.latest": "Back to latest",
  "chat.latestNew":
    "{count, plural, one {Back to latest, # new reply} other {Back to latest, # new replies}}",
  "chat.outline": "Message outline",
  "chat.rail": "Conversations",
  "chat.close": "Close",
  "chat.quota": "Usage",
  "chat.actions": "Actions",
  "chat.panels": "Extra panels",
  "chat.submit": "Submit",
  "chat.confirm": "Confirm",
  "chat.cancel": "Cancel",
  "chat.stop": "Stop",
  "chat.planChanged": "The plan changed; confirm again.",
  "chat.stopped": "The plan was stopped. Start a new plan to continue.",
  "chat.scheduleUnavailable": "Scheduling is unavailable in this chat.",
  "chat.start": "Start time",
  "chat.end": "End time",
  "chat.view": "View change",
  "chat.irreversible": "Cannot be undone",
  "chat.stepUp":
    "{count, plural, one {# verification prompt} other {# verification prompts}}",
  "chat.stepUpLabel": "Verification code",
  "chat.plan": "Plan",
  "chat.favourite": "Favourite",
  "chat.run": "Run",
  "chat.flows": "Saved requests",
  "flow.favourites": "Favourites",
  "flow.most-used": "Most used",
  "flow.recent": "Recent",
  "flow.presets": "Presets",
  "reply.writing": "Writing",
  "reply.stopped": "Stopped",
  "chat.sources": "Sources ({count})",
  "chat.source": "Source {index}: {title}",
  "reply.unavailable": "Reply unavailable",
  "reply.failed": "Reply failed",
  "reply.overdue": "Reply overdue",
  "chat.loading": "Loading",
  "chat.before": "Before",
  "chat.after": "After",
  "chat.undo": "Undo",
  "chat.verify": "Verification required",
  "chat.startupLoading": "Loading this conversation…",
} as const;
// The recovery panel's messages live in its lazy chunk and join every
// formatter when that chunk loads.
export type MessageKey =
  | keyof typeof english
  | keyof RecoveryCatalogue
  | keyof ConfirmationCatalogue
  | keyof BlockCatalogue
  | keyof ProblemCatalogue
  | keyof ReplyCatalogue
  | keyof FormCatalogue;
const added: { en: Record<string, string>; zh: Record<string, string> } = {
  en: {},
  zh: {},
};
export function addMessages(
  en: Record<string, string>,
  zh: Record<string, string>,
): void {
  Object.assign(added.en, en);
  Object.assign(added.zh, zh);
}
export type MessageValues = Record<string, string | number | boolean>;
export type FormatMessage = (key: MessageKey, values?: MessageValues) => string;
export const simplifiedChinese: Record<keyof typeof english, string> = {
  "form.valid": "有效",
  "form.invalid": "无效",
  "form.title": "填写此表单",
  "form.closeHint": "关闭将丢弃本次填充；回复仍保留在对话中。",
  "form.generate": "生成草稿",
  "form.references": "参考链接",
  "form.attachment": "私有附件",
  "form.regenerate": "重新生成{field}",
  "form.replace": "替换你的修改吗？",
  "form.marker": "表单",
  "form.filter": "按主题筛选",
  "form.all": "所有主题",
  "form.threads": "子对话",
  "form.return": "返回表单或记录",
  "form.unlinked": "已保存，未关联",
  "form.toolsLoading": "草稿工具仍在加载。",
  "form.toolsFailed": "草稿工具无法加载，请先重试。",
  "form.fixFirst": "请先修正标出的字段。",
  "form.number": "请输入数字。",
  "form.editInForm": "请在表单中编辑此值。",
  "form.imagesNow": "现在无法附加图片。",
  "form.imagesHere": "此处无法附加图片。",

  "chat.title": "对话",
  "chat.empty": "开始对话",
  "chat.message": "消息",
  "chat.send": "发送",
  "chat.sending": "正在发送",
  "chat.pendingSending": "正在发送……",
  "chat.pendingFailed": "未发送",
  "chat.planUnavailable": "无法加载此计划的步骤。",
  "chat.arrival": "收到新回复",
  "chat.arrivalExcerpt": "收到新回复：{excerpt}",
  "chat.arrivalFailed": "有一条回复未能完成。",
  "chat.arrivalMany": "收到 {count} 条新回复。最新一条：{excerpt}",
  "chat.arrivalManyPlain": "收到 {count} 条新回复",
  "chat.arrivalManyFailed": "收到 {count} 条新回复，其中 {failed} 条未能完成。",
  "chat.arrivalAllFailed": "{count} 条回复未能完成。",
  "chat.transcript": "消息",
  "chat.outlineItem": "{role}，第 {position} 条：{excerpt}",
  "chat.outlineItemPlain": "{role}，第 {position} 条",
  "chat.roleUser": "你",
  "chat.roleAssistant": "助手",
  "chat.messageLoading": "正在加载消息……",
  "chat.messageUnavailable": "暂时无法显示此消息。",
  "chat.changesTo": "改为",
  "chat.stepName": "更改 {index}",
  "chat.stepNamed": "{name} {index}",
  "chat.fieldName": "值 {index}",
  "chat.scrollRegion": "可滚动内容",
  "chat.conversationReadFailed": "无法加载此对话。",
  "chat.conversationsFailed": "无法加载你的对话列表。",
  "chat.messagesUnavailable": "部分消息暂时无法显示。",
  unsupportedContent: "此处无法显示部分内容。请联系站点管理员。",
  "chat.failure": "无法完成请求。",
  "chat.update": "此对话需要更新后才能继续使用。",
  "chat.conversationUnavailable":
    "此对话暂时无法使用。请重新加载后继续；重新加载不会停止服务器正在处理的回复。",
  "chat.reload": "重新加载对话",
  "chat.retry": "重试",
  "chat.withdraw": "撤回",
  "chat.restored": "已撤回的消息",
  "chat.restoredEdit": "编辑",
  "chat.restoredDiscard": "丢弃",
  "chat.dismiss": "关闭",
  "chat.latest": "回到最新消息",
  "chat.latestNew": "{count, plural, other {回到最新消息，# 条新回复}}",
  "chat.outline": "消息大纲",
  "chat.rail": "对话列表",
  "chat.close": "关闭",
  "chat.quota": "使用量",
  "chat.actions": "操作",
  "chat.panels": "附加面板",
  "chat.submit": "提交",
  "chat.confirm": "确认",
  "chat.cancel": "取消",
  "chat.stop": "停止",
  "chat.planChanged": "计划已更改，请重新确认。",
  "chat.stopped": "计划已停止。请创建新计划以继续。",
  "chat.scheduleUnavailable": "此聊天不支持排期。",
  "chat.start": "开始时间",
  "chat.end": "结束时间",
  "chat.view": "查看修改",
  "chat.irreversible": "无法撤销",
  "chat.stepUp": "{count, plural, other {# 次验证}}",
  "chat.stepUpLabel": "验证码",
  "chat.plan": "计划",
  "chat.favourite": "收藏",
  "chat.run": "运行",
  "chat.flows": "已保存的请求",
  "flow.favourites": "收藏",
  "flow.most-used": "最常用",
  "flow.recent": "最近",
  "flow.presets": "预设",
  "reply.writing": "正在回复",
  "reply.stopped": "已停止",
  "chat.sources": "来源（{count}）",
  "chat.source": "来源 {index}：{title}",
  "reply.unavailable": "无法回复",
  "reply.failed": "回复失败",
  "reply.overdue": "回复已超时",
  "chat.loading": "加载中",
  "chat.before": "修改前",
  "chat.after": "修改后",
  "chat.undo": "撤销",
  "chat.verify": "需要验证",
  "chat.startupLoading": "正在加载此对话…",
};
// Regions where Chinese is written in Traditional characters: there is no
// catalogue for them, so they fall back to English.
const TRADITIONAL = /^(tw|hk|mo)$/;
// Mandarin, written in Simplified characters when no script or a
// Traditional region says otherwise: `zh` (the macrolanguage, Mandarin by
// default) and `cmn`.
const MANDARIN = /^(zh|cmn)$/;
// RFC 5646 section 2.1, the langtag production: language (with up to three
// extended language subtags), script, region, variants, extensions and
// private use. A private-use-only or irregular grandfathered tag does not
// fit it and falls back like any tag that is not well formed, which is
// also what it would get: none names a catalogue.
const LANGTAG =
  /^([a-z]{2,3}(-[a-z]{3}){0,3}|[a-z]{4,8})(-[a-z]{4})?(-([a-z]{2}|\d{3}))?(-([a-z\d]{5,8}|\d[a-z\d]{3}))*(-[\da-wyz](-[a-z\d]{2,8})+)*(-x(-[a-z\d]{1,8})+)?$/;
// The regular grandfathered tags that fit the langtag shape but name a
// Chinese language other than Mandarin (zh-guoyu is Mandarin).
const NOT_MANDARIN = /^zh-(hakka|min|xiang)\b/;
/**
 * The catalogue a BCP 47 tag gets. A tag that is not well formed under the
 * RFC 5646 grammar gets English, and so do the grandfathered Chinese tags
 * of languages other than Mandarin. Otherwise the language is the extended
 * language subtag when there is one, else the primary one; the script is
 * read right after the language and the region right after that, never
 * from extensions or private use. Mandarin with the Hans script, or with no
 * script and a region that is not Traditional, gets Simplified Chinese;
 * every other script and language gets English. `lang` is the tag itself
 * when its catalogue matches it, `en` otherwise.
 */
export function catalogueFor(locale = "en"): {
  catalogue: "en" | "zh";
  lang: string;
} {
  const fallback = { catalogue: "en", lang: "en" } as const;
  const tag = locale.toLowerCase();
  if (!LANGTAG.test(tag) || NOT_MANDARIN.test(tag)) return fallback;
  const subtags = tag.split("-");
  let language = subtags[0]!;
  let at = 1;
  // The grammar admits a three-letter subtag here only as an extended
  // language subtag, which names the language, and a two-letter one right
  // after the language only as the region. A missing subtag tests as
  // "undefined", which no pattern matches.
  while (/^[a-z]{3}$/.test(subtags[at]!)) language = subtags[at++]!;
  if (MANDARIN.test(language)) {
    const next = subtags[at]!;
    // A script decides; without one, the region after the language does.
    const simplified = /^[a-z]{4}$/.test(next)
      ? next === "hans"
      : !TRADITIONAL.test(next);
    return simplified ? { catalogue: "zh", lang: locale } : fallback;
  }
  return language === "en" ? { catalogue: "en", lang: locale } : fallback;
}
export function createFormatter(locale = "en"): FormatMessage {
  const chosen = catalogueFor(locale);
  const simplified = chosen.catalogue === "zh";
  const catalogue: Record<string, string> = simplified
    ? simplifiedChinese
    : english;
  const extra = simplified ? added.zh : added.en;
  // Plural and number rules follow the language of the text shown.
  const formatLocale = intlLocale(chosen.lang, simplified);
  const cache = new Map<MessageKey, IntlMessageFormat>();
  return (key, values) => {
    let formatter = cache.get(key);
    if (!formatter) {
      const message = catalogue[key] ?? extra[key];
      // A key of a chunk that has not loaded yet renders as nothing.
      if (message === undefined) return "";
      formatter = new IntlMessageFormat(message, formatLocale);
      cache.set(key, formatter);
    }
    return String(formatter.format(values));
  };
}
