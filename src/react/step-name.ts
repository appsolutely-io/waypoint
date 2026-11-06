// How a plan step is named, the same in the step list, the recovery panel
// and a host's own UI: the host's label for its resource, numbered, else
// "Change N". Never the step's id, link or internal keys. No DOM.
import type { FormatMessage } from "./i18n";

/**
 * The names a plan's steps are shown with. The protocol names a step's
 * resource and fields by their internal keys; a host that wants them shown
 * returns the words its users know, else the chat shows a neutral name
 * ("Change 1", "Value 1"), never the key.
 */
export interface PlanLabels {
  resource?(resource: string): string | undefined;
  field?(resource: string, field: string): string | undefined;
}

/** A step's name: "Task 1" with a label for its resource, else "Change 1". */
export function stepName(
  t: FormatMessage,
  labels: PlanLabels | undefined,
  step: { index: number; resource?: string },
): string {
  const name =
    step.resource === undefined ? undefined : labels?.resource?.(step.resource);
  return name
    ? t("chat.stepNamed", { name, index: step.index })
    : t("chat.stepName", { index: step.index });
}
