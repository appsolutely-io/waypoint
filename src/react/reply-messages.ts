// The reply controls' own messages, en and zh-CN, loaded with them.
export type ReplyMessageKey = "chat.reply.stop" | "chat.reply.keepWaiting";
export type ReplyCatalogue = Readonly<Record<ReplyMessageKey, string>>;
export const replyEnglish: ReplyCatalogue = {
  "chat.reply.stop": "Stop",
  "chat.reply.keepWaiting": "Keep waiting",
};
export const replySimplifiedChinese: ReplyCatalogue = {
  "chat.reply.stop": "停止",
  "chat.reply.keepWaiting": "继续等待",
};
