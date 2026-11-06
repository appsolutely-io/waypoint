// The form fill extras' own messages, en and zh-CN, loaded with them.
export type FormMessageKey =
  | "form.generating"
  | "form.ready"
  | "form.attention"
  | "form.reverted"
  | "form.revert"
  | "form.revertWait"
  | "form.suggested"
  | "form.replaceIt"
  | "form.keepMine"
  | "form.attach"
  | "form.remove"
  | "form.uploading"
  | "form.attached"
  | "form.attachFailed"
  | "form.removeFailed"
  | "form.onlyImages"
  | "form.busy"
  | "form.unusable";
export type FormCatalogue = Readonly<Record<FormMessageKey, string>>;
export const formEnglish: FormCatalogue = {
  "form.generating": "Generating draft…",
  "form.ready":
    "Draft ready{choice, plural, =0 {} one {, # field needs your choice} other {, # fields need your choice}}{invalid, plural, =0 {} one {, # field needs attention} other {, # fields need attention}}",
  "form.attention":
    "{count, plural, one {# field needs attention} other {# fields need attention}}",
  "form.reverted": "Fill reverted.",
  "form.revert": "Revert this fill ({fields})",
  "form.revertWait": "Wait for the draft to finish.",
  "form.suggested": "Suggested value for {field}",
  "form.replaceIt": "Replace",
  "form.keepMine": "Keep mine",
  "form.attach": "Attach images",
  "form.remove": "Remove {name}",
  "form.uploading":
    "{count, plural, one {Uploading # image…} other {Uploading # images…}}",
  "form.attached":
    "{count, plural, one {# image attached} other {# images attached}}",
  "form.attachFailed": "{name} could not be attached.",
  "form.removeFailed": "{name} could not be removed.",
  "form.onlyImages": "Only images can be attached.",
  "form.busy": "Wait for the current upload to finish.",
  "form.unusable": "The draft could not be used.",
};
export const formSimplifiedChinese: FormCatalogue = {
  "form.generating": "正在生成草稿……",
  "form.ready":
    "草稿已就绪{choice, plural, =0 {} other {，# 个字段需要你选择}}{invalid, plural, =0 {} other {，# 个字段需要处理}}",
  "form.attention": "{count} 个字段需要处理",
  "form.reverted": "已撤销本次填充。",
  "form.revert": "撤销本次填充（{fields}）",
  "form.revertWait": "请等待草稿完成。",
  "form.suggested": "{field}的建议值",
  "form.replaceIt": "替换",
  "form.keepMine": "保留我的",
  "form.attach": "附加图片",
  "form.remove": "移除{name}",
  "form.uploading": "正在上传 {count} 张图片……",
  "form.attached": "已附加 {count} 张图片",
  "form.attachFailed": "无法附加{name}。",
  "form.removeFailed": "无法移除{name}。",
  "form.onlyImages": "只能附加图片。",
  "form.busy": "请等待当前上传完成。",
  "form.unusable": "无法使用此草稿。",
};
