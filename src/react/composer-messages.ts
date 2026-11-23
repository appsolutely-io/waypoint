// The composer's file picker messages, en and zh-CN, loaded with it.
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
  | "composer.tooMany";
export type ComposerCatalogue = Readonly<Record<ComposerMessageKey, string>>;
export const composerEnglish: ComposerCatalogue = {
  "composer.attach": "Attach files",
  "composer.remove": "Remove",
  "composer.removeNamed": "Remove {name}",
  "composer.added": "Attached {name}.",
  "composer.removed": "Removed {name}.",
  "composer.reading": "Reading the files…",
  "composer.readFailed": "{name} could not be read.",
  "composer.refusedType": "The site does not take {name}; it takes {types}.",
  "composer.refusedSize":
    "The site does not take {name}; it takes files up to {max}.",
  "composer.tooMany": "The site takes at most {max} files.",
};
export const composerSimplifiedChinese: ComposerCatalogue = {
  "composer.attach": "添加文件",
  "composer.remove": "移除",
  "composer.removeNamed": "移除 {name}",
  "composer.added": "已添加 {name}。",
  "composer.removed": "已移除 {name}。",
  "composer.reading": "正在读取文件……",
  "composer.readFailed": "无法读取 {name}。",
  "composer.refusedType": "本站不接受 {name}；本站接受 {types}。",
  "composer.refusedSize": "本站不接受 {name}；本站接受的文件不超过 {max}。",
  "composer.tooMany": "本站一次最多接受 {max} 个文件。",
};
