// The confirmation's whole messages, en and zh-CN, loaded with it.
export type ConfirmationMessageKey =
  | "chat.confirmation.heading"
  | "chat.confirmation.apply"
  | "chat.confirmation.schedule"
  | "chat.confirmation.unavailable"
  | "chat.confirmation.expired"
  | "chat.confirmation.used"
  | "chat.confirmation.changed"
  | "chat.confirmation.mismatch"
  | "chat.confirmation.irreversible"
  | "chat.confirmation.before"
  | "chat.confirmation.after"
  | "chat.confirmation.refresh"
  | "chat.confirmation.verifications"
  | "chat.confirmation.expires"
  | "chat.confirmation.showAll";
export type ConfirmationCatalogue = Readonly<
  Record<ConfirmationMessageKey, string>
>;
export const confirmationEnglish: ConfirmationCatalogue = {
  "chat.confirmation.heading": "Review these changes",
  "chat.confirmation.apply": "Apply these changes",
  "chat.confirmation.schedule": "Schedule these changes",
  "chat.confirmation.unavailable":
    "This plan can't be confirmed in this app. Ask the site administrator to update it.",
  "chat.confirmation.expired":
    "This confirmation has expired. Ask for the plan again to review it.",
  "chat.confirmation.used":
    "This confirmation was already used. Check the plan's status below before doing anything else.",
  "chat.confirmation.changed":
    "This plan changed. Review it again before you confirm.",
  "chat.confirmation.mismatch":
    "This confirmation belongs to a different plan. Open the current plan and review it.",
  "chat.confirmation.irreversible": "This change cannot be undone.",
  "chat.confirmation.before": "Before",
  "chat.confirmation.after": "After",
  "chat.confirmation.refresh": "Refresh",
  "chat.confirmation.verifications":
    "{count, plural, one {# verification is needed} other {# verifications are needed}}.",
  "chat.confirmation.expires": "Valid until {time}",
  "chat.confirmation.showAll": "Show all {count} items",
};
export const confirmationSimplifiedChinese: ConfirmationCatalogue = {
  "chat.confirmation.heading": "请核对以下修改",
  "chat.confirmation.apply": "应用这些修改",
  "chat.confirmation.schedule": "安排执行这些修改",
  "chat.confirmation.unavailable":
    "此应用无法确认这个计划。请联系网站管理员更新应用。",
  "chat.confirmation.expired": "此确认已过期。请重新获取计划后再核对。",
  "chat.confirmation.used":
    "此确认已经使用过。请先检查下方的计划状态，再进行其他操作。",
  "chat.confirmation.changed": "计划已有变化。请重新核对后再确认。",
  "chat.confirmation.mismatch":
    "此确认属于另一个计划。请打开当前计划并重新核对。",
  "chat.confirmation.irreversible": "此修改无法撤销。",
  "chat.confirmation.before": "修改前",
  "chat.confirmation.after": "修改后",
  "chat.confirmation.refresh": "刷新",
  "chat.confirmation.verifications": "需要完成 {count} 次验证。",
  "chat.confirmation.expires": "有效期至 {time}",
  "chat.confirmation.showAll": "显示全部 {count} 项",
};
