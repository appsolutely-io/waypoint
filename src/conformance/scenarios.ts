import type { Capability } from "../protocol/index";

export const CONFORMANCE_CAPABILITIES = {
  plans: "plans",
  forms: "form-fill",
  replyStop: "reply-stop",
  widgets: "widgets",
} as const satisfies Record<string, Capability>;
export const PLAN_SCENARIOS = {
  run: "plan run",
  refuse: "plan refuse",
} as const;
export const FORM_SCENARIOS = {
  replay: "form creation replay",
  refetch: "form mode survives refetch",
  filtering: "form subject filtering",
  validation: "form values and validation replay",
  sensitive: "form rejects non-low input",
  child: "form child inherits mode and values",
  wrongSubject: "form rejects wrong-subject child",
  general: "form refuses general replies",
} as const;
export const REPLY_STOP_SCENARIO = "reply stop";
export const CAPABILITY_SCENARIOS = {
  [CONFORMANCE_CAPABILITIES.plans]: Object.values(PLAN_SCENARIOS),
  [CONFORMANCE_CAPABILITIES.forms]: Object.values(FORM_SCENARIOS),
  [CONFORMANCE_CAPABILITIES.replyStop]: [REPLY_STOP_SCENARIO],
  [CONFORMANCE_CAPABILITIES.widgets]: [],
};
