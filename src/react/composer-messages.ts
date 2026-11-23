// The composer's file picker messages, en and zh-CN, loaded with it.
export type ComposerMessageKey =
  | "composer.attach"
  | "composer.remove"
  | "composer.fileSize"
  | "composer.added"
  | "composer.removed"
  | "composer.refusedType"
  | "composer.refusedSize";
export type ComposerCatalogue = Readonly<Record<ComposerMessageKey, string>>;
export const composerEnglish: ComposerCatalogue = {
  "composer.attach": "Attach files",
  "composer.remove": "Remove {name}",
  "composer.fileSize": "{size}",
  "composer.added": "Attached {name}.",
  "composer.removed": "Removed {name}.",
  "composer.refusedType": "{name} is not a file type this site takes.",
  "composer.refusedSize": "{name} is larger than this site allows.",
};
export const composerSimplifiedChinese: ComposerCatalogue = {
  "composer.attach": "添加文件",
  "composer.remove": "移除 {name}",
  "composer.fileSize": "{size}",
  "composer.added": "已添加 {name}。",
  "composer.removed": "已移除 {name}。",
  "composer.refusedType": "{name} 不是本站接受的文件类型。",
  "composer.refusedSize": "{name} 超过本站允许的大小。",
};
