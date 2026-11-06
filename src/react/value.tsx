// A value in plain words, shared by the lazy blocks and form extras.
import { Fragment, type ReactNode } from "react";
import type { FormatMessage } from "./i18n";
// A value in plain words: text as it is, an empty value as a dash, a list
// joined, and an object as its keys and values. Never JSON.
export function Value({
  value,
  t,
}: {
  value: unknown;
  t: FormatMessage;
}): ReactNode {
  if (value === null || value === undefined || value === "")
    return t("chat.block.empty");
  if (Array.isArray(value))
    return value.length ? (
      <>
        {value.map((item, index) => (
          <Fragment key={index}>
            {index ? ", " : null}
            <Value value={item} t={t} />
          </Fragment>
        ))}
      </>
    ) : (
      t("chat.block.empty")
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([key, part]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <Value value={part} t={t} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return String(value);
}
