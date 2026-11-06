export const choices = {
  skin: ["neutral", "antd"],
  scheme: ["system", "light", "dark"],
  layout: ["panel", "page", "floating", "sheet"],
  dir: ["ltr", "rtl"],
  lang: ["en", "zh-CN"],
  scenario: ["chat", "form-fill", "flows", "transcript"],
  state: [
    "idle",
    "streaming",
    "done",
    "stopped",
    "versions",
    "tools",
    "sources",
    "overdue",
    "reply-failed",
    "reply-ended-failed",
    "reply-unavailable",
    "error-retryable",
    "error-rate-limited",
    "error-unavailable",
    "error-refused",
    "error-closed",
    "error-full",
    "error-declined",
    "error-sign-in",
    "error-in-doubt",
    "error-replaced",
    "plan",
    "form",
  ],
} as const;
/** The states in which the host refuses the message, one per problem code. */
export const problemStates = choices.state.filter((value) =>
  value.startsWith("error-"),
);
export type View = { [K in keyof typeof choices]: (typeof choices)[K][number] };
export function readView(search: string): View {
  const query = new URLSearchParams(search);
  const pick = <K extends keyof View>(key: K): View[K] => {
    const value = query.get(key);
    return (choices[key] as readonly string[]).includes(value ?? "")
      ? (value as View[K])
      : (choices[key][0] as View[K]);
  };
  return {
    skin: pick("skin"),
    scheme: pick("scheme"),
    layout: pick("layout"),
    dir: pick("dir"),
    lang: pick("lang"),
    scenario: pick("scenario"),
    state: pick("state"),
  };
}
