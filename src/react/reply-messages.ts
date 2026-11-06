// The reply controls' own messages, en and zh-CN, loaded with them.
export type ReplyMessageKey = "chat.reply.stop";
export type ReplyCatalogue = Readonly<Record<ReplyMessageKey, string>>;
export const replyEnglish: ReplyCatalogue = {
  "chat.reply.stop": "Stop",
};
export const replySimplifiedChinese: ReplyCatalogue = {
  "chat.reply.stop": "停止",
};
