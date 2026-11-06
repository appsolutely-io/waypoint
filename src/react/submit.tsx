// A guarded Submit, shared by the lazy blocks and the flow parameter form:
// focusable and described while it is unavailable.
import { useId } from "react";
import { context } from "./ui";
export function Submit({
  disabled,
  blocked,
  reason,
  label,
  onPress,
}: {
  disabled: boolean;
  blocked: boolean;
  reason: string;
  label?: string;
  onPress(): void;
}) {
  const { format: t, primitives: ui } = context();
  const B = ui.button;
  const id = useId();
  const shown = blocked && !disabled;
  return (
    <>
      <B
        disabled={disabled}
        aria-disabled={shown || undefined}
        aria-describedby={shown ? id : undefined}
        onPress={onPress}
      >
        {label ?? t("chat.submit")}
      </B>
      {shown ? (
        <span id={id} data-reason="submit">
          {reason}
        </span>
      ) : null}
    </>
  );
}
