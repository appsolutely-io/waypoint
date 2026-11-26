// The composer's file picker messages, en and zh-Hans, loaded with it.
export type ComposerMessageKey =
  | "composer.attach"
  | "composer.remove"
  | "composer.removeNamed"
  | "composer.added"
  | "composer.removed"
  | "composer.reading"
  | "composer.readFailed"
  | "composer.refusedType"
  | "composer.refusedSize"
  | "composer.tooMany"
  | "composer.needsText"
  | "composer.notAdded";
export type ComposerCatalogue = Readonly<Record<ComposerMessageKey, string>>;
export const composerEnglish: ComposerCatalogue = {
  "composer.attach": "Attach files",
  "composer.remove": "Remove",
  "composer.removeNamed": "Remove {name}",
  "composer.added": "Added {name}.",
  "composer.removed": "Removed {name}.",
  "composer.reading": "Reading {name}…",
  "composer.readFailed": "Not read: {name}; pick it again.",
  "composer.refusedType": "The site takes {types}, not {name}.",
  "composer.refusedSize": "The site takes up to {max}, not {name}.",
  "composer.tooMany": "A message can carry at most {max} files.",
  "composer.needsText": "A message needs text.",
  "composer.notAdded": "Not added: {name}.",
};
export const composerSimplifiedChinese: ComposerCatalogue = {
  "composer.attach": "添加文件",
  "composer.remove": "移除",
  "composer.removeNamed": "移除 {name}",
  "composer.added": "已添加 {name}。",
  "composer.removed": "已移除 {name}。",
  "composer.reading": "正在读取 {name}……",
  "composer.readFailed": "无法读取 {name}，请重新选择。",
  "composer.refusedType": "本站不接受 {name}；本站接受 {types}。",
  "composer.refusedSize": "本站接受不超过 {max} 的文件，不接受 {name}。",
  "composer.tooMany": "一条消息最多携带 {max} 个文件。",
  "composer.needsText": "消息需要文字。",
  "composer.notAdded": "未添加：{name}。",
};
