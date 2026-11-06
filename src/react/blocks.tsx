// The transcript blocks that hold form state or structured values (table,
// diff, form, choice and plan): a lazy chunk, loaded when the first one is
// shown.
import { useId, useState } from "react";
import type { PlanState } from "../protocol/generated";
import {
  blockEnglish,
  blockSimplifiedChinese,
  type BlockMessageKey,
} from "./block-messages";
import { addMessages, type FormatMessage } from "./i18n";
import { isSafeUrl } from "./urls";
import { Value } from "./value";
import { Submit } from "./submit";
import { Part, context, type PlanDiagramProps, type WidgetProps } from "./ui";

addMessages(blockEnglish, blockSimplifiedChinese);
// Whether a field or answer holds something: text other than spaces, or a
// non-empty choice.
const answered = (value: unknown) =>
  Array.isArray(value) ? value.length > 0 : String(value ?? "").trim() !== "";
const UNDO: Record<string, BlockMessageKey> = {
  "compare-and-set": "chat.block.undoCompareAndSet",
  "archive-created": "chat.block.undoArchiveCreated",
};
const stateLabel = (t: FormatMessage, state: PlanState) =>
  t("chat.block.status", {
    status: t(`chat.block.state.${state}` as BlockMessageKey),
  });
/** The steps of a plan record, each with its facts in labelled words. */
export function PlanSteps({ record, slots, view }: PlanDiagramProps) {
  const { format: t, extraUrlSchemes } = context();
  if (record.plan.kind !== "immediate")
    return <p>{stateLabel(t, record.state)}</p>;
  return (
    <ol>
      {record.plan.steps.map((step) => {
        const outcome = record.outcomes.find((each) => each.stepId === step.id);
        const undo = step.undo.startsWith("inverse:")
          ? "chat.block.undoInverse"
          : UNDO[step.undo];
        return (
          <Part
            key={step.id}
            name="planNode"
            slots={slots}
            data={view ? { view } : undefined}
          >
            <li>
              <Part
                name="stepRow"
                slots={slots}
                data={{
                  step: {
                    id: step.id,
                    operation: step.operation,
                    resource: step.resource,
                    view: step.view,
                    tier: step.tier,
                    undo: step.undo,
                    stepUp: step.stepUp,
                  },
                }}
              >
                <strong>{step.resource}</strong>
                <dl>
                  {step.fields.map((field) => (
                    <div key={field}>
                      <dt>{field}</dt>
                      <dd>
                        <Value
                          value={
                            (
                              step.before as Record<string, unknown> | undefined
                            )?.[field]
                          }
                          t={t}
                        />{" "}
                        <span aria-hidden="true">→</span>
                        <span className="wp-sr-only">
                          {t("chat.changesTo")}
                        </span>{" "}
                        <Value
                          value={
                            (
                              step.after as Record<string, unknown> | undefined
                            )?.[field]
                          }
                          t={t}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
                <ul className="wp-step-facts">
                  <li>
                    {t(
                      step.tier === "sensitive"
                        ? "chat.block.tierSensitive"
                        : "chat.block.tierLow",
                    )}
                  </li>
                  {step.undo === "none" ? (
                    <li>
                      <strong>{t("chat.irreversible")}</strong>
                    </li>
                  ) : undo ? (
                    <li>{t(undo)}</li>
                  ) : null}
                  {step.stepUp ? <li>{t("chat.verify")}</li> : null}
                  <li>
                    {outcome
                      ? t("chat.block.status", {
                          status: t(
                            outcome.status >= 200 && outcome.status < 300
                              ? "chat.block.outcomeDone"
                              : "chat.block.outcomeFailed",
                          ),
                        })
                      : stateLabel(t, record.state)}
                  </li>
                  {isSafeUrl(step.view, extraUrlSchemes) ? (
                    <li>
                      <a href={step.view}>{t("chat.view")}</a>
                    </li>
                  ) : null}
                </ul>
              </Part>
            </li>
          </Part>
        );
      })}
    </ol>
  );
}
// Submit, unavailable while the answer is incomplete but still focusable,
// with the reason said beside it.

export default function Block({ block, onReply, disabled }: WidgetProps) {
  const radioName = useId();
  const { format: t, primitives: ui } = context();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const body = block.body as Record<string, unknown>;
  switch (block.type) {
    case "table":
      return (
        <div
          data-scroll-region=""
          tabIndex={0}
          role="region"
          aria-label={t("chat.scrollRegion")}
        >
          <table>
            <thead>
              <tr>
                {((body.columns as string[]) ?? []).map((column, index) => (
                  <th key={index}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {((body.rows as unknown[][]) ?? []).map((row, index) => (
                <tr key={index}>
                  {row.map((value, i) => (
                    <td key={i}>{String(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "diff":
      return (
        <dl>
          <dt>{t("chat.before")}</dt>
          <dd>
            <Value value={body.before} t={t} />
          </dd>
          <dt>{t("chat.after")}</dt>
          <dd>
            <Value value={body.after} t={t} />
          </dd>
        </dl>
      );
    case "form": {
      const fields =
        (body.fields as {
          name: string;
          label: string;
          required?: boolean;
        }[]) ?? [];
      // One rule for the button and for Enter (implicit submission).
      const missing = fields.some(
        (field) => field.required && !answered(values[field.name]),
      );
      const send = () => {
        if (!disabled && !missing)
          onReply({ kind: "form", blockId: block.id, values });
      };
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {fields.map((field) => (
            <ui.input
              key={field.name}
              label={
                field.required
                  ? t("chat.block.required", { label: field.label })
                  : field.label
              }
              required={field.required}
              value={String(values[field.name] ?? "")}
              disabled={disabled}
              onChange={(value) =>
                setValues({ ...values, [field.name]: value })
              }
            />
          ))}
          <Submit
            disabled={disabled}
            blocked={missing}
            reason={t("chat.block.requiredMissing")}
            onPress={send}
          />
        </form>
      );
    }
    case "choice": {
      // The protocol's choice has no question field: its fallback text is
      // the question, so it names the group.
      const empty = !answered(values.answer);
      const send = () => {
        if (!disabled && !empty)
          onReply({ kind: "form", blockId: block.id, values });
      };
      return (
        <fieldset disabled={disabled}>
          {body.mode === "text" ? (
            <ui.input
              label={block.fallback}
              value={String(values.answer ?? "")}
              onChange={(answer) => setValues({ answer })}
            />
          ) : (
            <>
              <legend>{block.fallback}</legend>
              <div>
                {((body.options as string[]) ?? []).map((option) => (
                  <label key={option}>
                    <input
                      type={body.mode === "multi" ? "checkbox" : "radio"}
                      name={radioName}
                      disabled={disabled}
                      checked={
                        body.mode === "multi"
                          ? ((values.answer as string[]) ?? []).includes(option)
                          : values.answer === option
                      }
                      onChange={(e) =>
                        setValues({
                          answer:
                            body.mode === "multi"
                              ? e.target.checked
                                ? [
                                    ...((values.answer as string[]) ?? []),
                                    option,
                                  ]
                                : ((values.answer as string[]) ?? []).filter(
                                    (v) => v !== option,
                                  )
                              : option,
                        })
                      }
                    />
                    {option}
                  </label>
                ))}
              </div>
            </>
          )}
          <Submit
            disabled={disabled}
            blocked={empty}
            reason={t("chat.block.answerMissing")}
            onPress={send}
          />
        </fieldset>
      );
    }
    case "plan":
      // The plan itself is shown with the conversation; the block says
      // what it is in its own words.
      return <p>{block.fallback}</p>;
    default:
      return <p>{block.fallback}</p>;
  }
}
