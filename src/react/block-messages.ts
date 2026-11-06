// The transcript blocks' own messages, en and zh-CN, loaded with them.
export type BlockMessageKey =
  | "chat.block.required"
  | "chat.block.requiredMissing"
  | "chat.block.answerMissing"
  | "chat.block.empty"
  | "chat.block.tierLow"
  | "chat.block.tierSensitive"
  | "chat.block.undoCompareAndSet"
  | "chat.block.undoArchiveCreated"
  | "chat.block.undoInverse"
  | "chat.block.status"
  | "chat.block.outcomeDone"
  | "chat.block.outcomeFailed"
  | "chat.block.retryable"
  | "chat.block.notRetryable"
  | "chat.block.state.proposed"
  | "chat.block.state.awaiting-confirmation"
  | "chat.block.state.running"
  | "chat.block.state.undoing"
  | "chat.block.state.completed"
  | "chat.block.state.submitted"
  | "chat.block.state.undone"
  | "chat.block.state.needs-attention"
  | "chat.block.state.cancelled"
  | "chat.block.run"
  | "chat.block.runMissing"
  | "chat.block.favourite"
  | "chat.block.flowLoading"
  | "chat.block.flowsLoading"
  | "chat.block.flowsEmpty"
  | "chat.block.answered"
  | "chat.block.answeredWith";
export type BlockCatalogue = Readonly<Record<BlockMessageKey, string>>;
export const blockEnglish: BlockCatalogue = {
  "chat.block.required": "{label} (required)",
  "chat.block.requiredMissing": "Fill in the required fields to submit.",
  "chat.block.answerMissing": "Answer the question to submit.",
  "chat.block.empty": "—",
  "chat.block.tierLow": "Low risk",
  "chat.block.tierSensitive": "Sensitive",
  "chat.block.undoCompareAndSet": "Undo restores the previous values",
  "chat.block.undoArchiveCreated": "Undo archives what was created",
  "chat.block.undoInverse": "Undo runs a reverse step",
  "chat.block.status": "Status: {status}",
  "chat.block.outcomeDone": "Done",
  "chat.block.outcomeFailed": "Failed",
  "chat.block.retryable": "It can be tried again",
  "chat.block.notRetryable": "It cannot be tried again",
  "chat.block.state.proposed": "Proposed",
  "chat.block.state.awaiting-confirmation": "Waiting for confirmation",
  "chat.block.state.running": "Running",
  "chat.block.state.undoing": "Undoing",
  "chat.block.state.completed": "Completed",
  "chat.block.state.submitted": "Submitted",
  "chat.block.state.undone": "Undone",
  "chat.block.state.needs-attention": "Needs attention",
  "chat.block.state.cancelled": "Cancelled",
  "chat.block.run": "Run",
  "chat.block.runMissing": "Fill in the required fields to run.",
  "chat.block.favourite": "Favourite: {title}",
  "chat.block.flowLoading": "Loading request…",
  "chat.block.flowsLoading": "Loading saved requests…",
  "chat.block.flowsEmpty": "No saved requests here yet.",
  "chat.block.answered": "Answered",
  "chat.block.answeredWith": "Answered: {answer}",
};
export const blockSimplifiedChinese: BlockCatalogue = {
  "chat.block.required": "{label}（必填）",
  "chat.block.requiredMissing": "请填写必填项后再提交。",
  "chat.block.answerMissing": "请先回答问题再提交。",
  "chat.block.empty": "—",
  "chat.block.tierLow": "低风险",
  "chat.block.tierSensitive": "敏感",
  "chat.block.undoCompareAndSet": "撤销会恢复原来的值",
  "chat.block.undoArchiveCreated": "撤销会归档已创建的内容",
  "chat.block.undoInverse": "撤销会执行反向步骤",
  "chat.block.status": "状态：{status}",
  "chat.block.outcomeDone": "已完成",
  "chat.block.outcomeFailed": "失败",
  "chat.block.retryable": "可以重试",
  "chat.block.notRetryable": "无法重试",
  "chat.block.state.proposed": "已提议",
  "chat.block.state.awaiting-confirmation": "等待确认",
  "chat.block.state.running": "运行中",
  "chat.block.state.undoing": "正在撤销",
  "chat.block.state.completed": "已完成",
  "chat.block.state.submitted": "已提交",
  "chat.block.state.undone": "已撤销",
  "chat.block.state.needs-attention": "需要处理",
  "chat.block.state.cancelled": "已取消",
  "chat.block.run": "运行",
  "chat.block.runMissing": "请先填写必填字段再运行。",
  "chat.block.favourite": "收藏：{title}",
  "chat.block.flowLoading": "正在加载请求……",
  "chat.block.flowsLoading": "正在加载已保存的请求……",
  "chat.block.flowsEmpty": "这里还没有已保存的请求。",
  "chat.block.answered": "已回答",
  "chat.block.answeredWith": "已回答：{answer}",
};
