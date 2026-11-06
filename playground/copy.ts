import type { View } from "./state";

const english = {
  playground: "Playground",
  settings: "Preview settings",
  formHeading: "Draft an item",
  formHint:
    "Start with your own words, then focus a field to see Regenerate and try an AI draft.",
  loading: "Loading preview…",
  failed: "The preview could not be loaded.",
  retry: "Retry",
  labels: {
    skin: "Skin",
    scheme: "Colour scheme",
    layout: "Layout",
    dir: "Direction",
    lang: "Language",
    scenario: "Scenario",
    state: "Reply state",
  } satisfies Record<keyof View, string>,
  names: {
    neutral: "Neutral",
    antd: "Ant Design",
    light: "Light",
    dark: "Dark",
    system: "System",
    panel: "Panel",
    page: "Page",
    floating: "Floating",
    sheet: "Sheet",
    ltr: "Left to right",
    rtl: "Right to left",
    en: "English",
    "zh-CN": "简体中文",
    chat: "Conversation",
    "form-fill": "AI form fill",
    flows: "Saved requests",
    transcript: "Long transcript",
    idle: "Seeded conversation",
    streaming: "Reply streaming",
    done: "Reply done",
    stopped: "Reply stopped",
    overdue: "Reply overdue",
    "reply-failed": "Reply failed",
    "reply-unavailable": "Reply unavailable",
    "error-retryable": "Error: try again",
    "error-rate-limited": "Error: rate limited",
    "error-unavailable": "Error: unavailable",
    "error-refused": "Error: refused",
    "error-closed": "Error: closed",
    "error-full": "Error: full",
    "error-declined": "Error: declined",
    "error-sign-in": "Error: sign in",
    "error-in-doubt": "Error: in doubt",
    "error-replaced": "Error: replaced",
    plan: "Plan with steps",
    form: "Form in a reply",
  } as Record<string, string>,
};
const chinese: typeof english = {
  playground: "组件预览",
  settings: "预览设置",
  formHeading: "起草条目",
  formHint: "先输入自己的内容，再聚焦字段以显示“重新生成”，试用 AI 草稿。",
  loading: "正在加载预览…",
  failed: "无法加载预览。",
  retry: "重试",
  labels: {
    skin: "外观",
    scheme: "配色",
    layout: "布局",
    dir: "方向",
    lang: "语言",
    scenario: "场景",
    state: "回复状态",
  },
  names: {
    neutral: "中性",
    antd: "Ant Design",
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
    panel: "面板",
    page: "页面",
    floating: "悬浮",
    sheet: "底部面板",
    ltr: "从左到右",
    rtl: "从右到左",
    en: "English",
    "zh-CN": "简体中文",
    chat: "对话",
    "form-fill": "AI 填表",
    flows: "已保存的请求",
    transcript: "长对话",
    idle: "示例对话",
    streaming: "回复生成中",
    done: "回复完成",
    stopped: "回复已停止",
    overdue: "回复超时",
    "reply-failed": "回复失败",
    "reply-unavailable": "回复不可用",
    "error-retryable": "错误：请重试",
    "error-rate-limited": "错误：请求过多",
    "error-unavailable": "错误：暂不可用",
    "error-refused": "错误：已拒绝",
    "error-closed": "错误：已关闭",
    "error-full": "错误：已满",
    "error-declined": "错误：已谢绝",
    "error-sign-in": "错误：需要登录",
    "error-in-doubt": "错误：结果未知",
    "error-replaced": "错误：已被替换",
    plan: "带步骤的计划",
    form: "回复中的表单",
  },
};
export const previewCopy = (lang: View["lang"]) =>
  lang === "zh-CN" ? chinese : english;

export function seedTurn(at: number, long: boolean, lang: View["lang"] = "en") {
  const zh = lang === "zh-CN";
  return {
    question:
      at === 0
        ? zh
          ? "这里可以体验哪些功能？"
          : "What can I explore here?"
        : zh
          ? `我们来检查下一个细节（${at + 1}）。`
          : `Let’s review the next detail (${at + 1}).`,
    content: long
      ? zh
        ? `## 审阅记录 ${at + 1}\n\n我们可以一起完善草稿。保持摘要清晰，检查细节，并留出提问的空间。\n\n- 检查当前措辞\n- 收集反馈\n- 商定下一处修改\n\n${"有用的对话会保留每个决定的原始背景。".repeat(4)}`
        : `## Review note ${at + 1}\n\nWe can work through the draft together. Keep the summary clear, check the details, and leave room for questions.\n\n- Review the current wording\n- Gather feedback\n- Agree on the next change\n\n${"A useful conversation keeps the original context close to each decision. ".repeat(4)}`
      : at === 0
        ? zh
          ? "欢迎使用本地预览。可以发送消息、查看已保存的请求，或切换布局。"
          : "Welcome to your local preview. Try a message, explore the saved requests, or switch the layout."
        : zh
          ? "两种外观使用相同的对话行为。更改语言、方向和配色不会丢失草稿。"
          : "Both skins use the same conversation behaviour. You can change the language, direction and colour scheme without losing your draft.",
  };
}
const translations = new Map<string, string>([
  ["Local preview", "本地预览"],
  ["Saved requests", "已保存的请求"],
  ["A longer conversation", "更长的对话"],
  ["Draft an item", "起草条目"],
  ["Title", "标题"],
  ["Summary", "摘要"],
  ["Item", "条目"],
  ["Rename item", "重命名条目"],
  ["Weekly report", "每周报告"],
  ["Prepare a weekly report", "准备每周报告"],
  ["Draft Title", "标题草稿"],
  ["Draft Summary", "摘要草稿"],
  ["Review the draft", "请检查草稿"],
  ["Keep the complete value", "请保留完整内容"],
  ["Draft", "草稿"],
  ["Draft values", "草稿字段"],
]);
for (const long of [false, true])
  for (let at = 0; at < (long ? 24 : 2); at++) {
    const en = seedTurn(at, long),
      zh = seedTurn(at, long, "zh-CN");
    translations.set(en.question, zh.question);
    translations.set(en.content, zh.content);
  }
export const translatePreview = (value: string, lang: View["lang"]) =>
  lang === "zh-CN" ? (translations.get(value) ?? value) : value;
