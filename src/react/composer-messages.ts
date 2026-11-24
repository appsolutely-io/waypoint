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
  | "composer.notAdded";
export type ComposerCatalogue = Readonly<Record<ComposerMessageKey, string>>;
export const composerEnglish: ComposerCatalogue = {
  "composer.attach": "Attach",
  "composer.remove": "Remove",
  "composer.removeNamed": "Remove {name}",
  "composer.added": "Added {name}.",
  "composer.removed": "Removed {name}.",
  "composer.reading": "Reading…",
  "composer.readFailed": "Could not read {name}.",
  "composer.refusedType": "The site takes {types}, not {name}.",
  "composer.refusedSize": "The site takes files up to {max}, not {name}.",
  "composer.tooMany": "At most {max} files per message.",
  "composer.notAdded": "Not added: {name}.",
};
export const composerSimplifiedChinese: ComposerCatalogue = {
  "composer.attach": "添加",
  "composer.remove": "移除",
  "composer.removeNamed": "移除 {name}",
  "composer.added": "已添加 {name}。",
  "composer.removed": "已移除 {name}。",
  "composer.reading": "正在读取文件……",
  "composer.readFailed": "无法读取 {name}。",
  "composer.refusedType": "本站不接受 {name}；本站接受 {types}。",
  "composer.refusedSize": "本站接受不超过 {max} 的文件，不接受 {name}。",
  "composer.tooMany": "每条消息最多 {max} 个文件。",
  "composer.notAdded": "未添加：{name}。",
};
