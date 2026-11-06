// The default text of each problem code, en and zh-CN, loaded when the
// chat first renders; until then a problem shows the generic failure text.
export type ProblemMessageKey =
  | "chat.problem.signIn"
  | "chat.problem.retryable"
  | "chat.problem.rateLimited"
  | "chat.problem.refused"
  | "chat.problem.closed"
  | "chat.problem.full"
  | "chat.problem.declined"
  | "chat.problem.unavailable"
  | "chat.problem.stepUp"
  | "chat.problem.invalid"
  | "chat.problem.mismatch"
  | "chat.problem.agreement"
  | "chat.problem.inDoubt"
  | "chat.problem.replaced"
  | "chat.problem.needsAttention"
  | "chat.problem.answered"
  | "chat.problem.details"
  | "chat.problem.code"
  | "chat.problem.reference"
  | "chat.problem.refresh";
export type ProblemCatalogue = Readonly<Record<ProblemMessageKey, string>>;
export const problemEnglish: ProblemCatalogue = {
  "chat.problem.signIn": "Sign in again to continue.",
  "chat.problem.retryable": "Something went wrong for a moment. Try again.",
  "chat.problem.rateLimited":
    "There are too many requests right now. Wait a moment, then try again.",
  "chat.problem.refused": "The site refused this request.",
  "chat.problem.closed": "This conversation is closed.",
  "chat.problem.full":
    "There is no room for more right now. Free some space, then try again.",
  "chat.problem.declined": "This plan was declined.",
  "chat.problem.unavailable": "The site is unavailable right now. Try again.",
  "chat.problem.stepUp": "Verification was cancelled.",
  "chat.problem.invalid":
    "This plan can't be used as it is. Ask for a new plan.",
  "chat.problem.mismatch":
    "Something changed since this plan was made. Review the current values.",
  "chat.problem.agreement":
    "The connection could not be renewed. Retry to check the current status.",
  "chat.problem.inDoubt":
    "We couldn't confirm what happened. Check the current status before trying again.",
  "chat.problem.replaced": "A newer version replaced this. Refresh to see it.",
  "chat.problem.needsAttention":
    "This plan needs your attention. Review its status.",
  "chat.problem.answered": "This question was already answered.",
  "chat.problem.details": "Details",
  "chat.problem.code": "Error code: {code}",
  "chat.problem.reference": "Reference: {id}",
  "chat.problem.refresh": "Refresh",
};
export const problemSimplifiedChinese: ProblemCatalogue = {
  "chat.problem.signIn": "请重新登录后继续。",
  "chat.problem.retryable": "刚才出了点问题，请重试。",
  "chat.problem.rateLimited": "当前请求过多。请稍等片刻再重试。",
  "chat.problem.refused": "网站拒绝了此请求。",
  "chat.problem.closed": "此对话已关闭。",
  "chat.problem.full": "目前已达上限。请先释放一些空间，再重试。",
  "chat.problem.declined": "此计划已被拒绝。",
  "chat.problem.unavailable": "网站暂时无法使用，请重试。",
  "chat.problem.stepUp": "验证已取消。",
  "chat.problem.invalid": "此计划无法按原样使用。请提出新的计划。",
  "chat.problem.mismatch": "自计划生成以来，相关内容已有变化。请查看当前的值。",
  "chat.problem.agreement": "未能更新连接。请重试以检查当前状态。",
  "chat.problem.inDoubt": "无法确认刚才的结果。请先查看当前状态，再重试。",
  "chat.problem.replaced": "已有更新的版本。请刷新查看。",
  "chat.problem.needsAttention": "此计划需要您处理。请查看它的状态。",
  "chat.problem.answered": "此问题已被回答。",
  "chat.problem.details": "详情",
  "chat.problem.code": "错误代码：{code}",
  "chat.problem.reference": "参考编号：{id}",
  "chat.problem.refresh": "刷新",
};
