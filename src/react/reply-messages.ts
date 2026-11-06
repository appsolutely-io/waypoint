// The reply controls' and message actions' own messages, en and zh-CN,
// loaded with them.
export type ReplyMessageKey =
  | "chat.reply.stop"
  | "chat.reply.keepWaiting"
  | "chat.message.actions"
  | "chat.message.copy"
  | "chat.message.copied"
  | "chat.message.regenerate"
  | "chat.message.edit"
  | "chat.message.editLabel"
  | "chat.message.resend"
  | "chat.message.good"
  | "chat.message.bad"
  | "chat.message.previous"
  | "chat.message.next"
  | "chat.message.version";
export type ReplyCatalogue = Readonly<Record<ReplyMessageKey, string>>;
export const replyEnglish: ReplyCatalogue = {
  "chat.reply.stop": "Stop",
  "chat.reply.keepWaiting": "Keep waiting",
  "chat.message.actions": "Message actions",
  "chat.message.copy": "Copy",
  "chat.message.copied": "Copied",
  "chat.message.regenerate": "Regenerate",
  "chat.message.edit": "Edit",
  "chat.message.editLabel": "Edit message",
  "chat.message.resend": "Send",
  "chat.message.good": "Good response",
  "chat.message.bad": "Bad response",
  "chat.message.previous": "Previous version",
  "chat.message.next": "Next version",
  "chat.message.version": "Version {index} of {count}",
};
export const replySimplifiedChinese: ReplyCatalogue = {
  "chat.reply.stop": "停止",
  "chat.reply.keepWaiting": "继续等待",
  "chat.message.actions": "消息操作",
  "chat.message.copy": "复制",
  "chat.message.copied": "已复制",
  "chat.message.regenerate": "重新生成",
  "chat.message.edit": "编辑",
  "chat.message.editLabel": "编辑消息",
  "chat.message.resend": "发送",
  "chat.message.good": "回答有帮助",
  "chat.message.bad": "回答没有帮助",
  "chat.message.previous": "上一个版本",
  "chat.message.next": "下一个版本",
  "chat.message.version": "第 {index} 个版本，共 {count} 个",
};
