import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Part, useColorScheme, type Slots } from "./ui";
import { recordFieldPress } from "./chat-focus";
import { composedContains } from "./focus";
export interface FieldAdornmentProps {
  children: ReactNode;
  label: string;
  onRegenerate(): void;
  disabled?: boolean;
  /**
   * Why the action is unavailable now. The stock control stays focusable
   * and is described by this text, and a press does nothing. A replacement
   * `fieldAdornment` part then gets no `onPress`, and `aria-disabled` and
   * `describedBy`; it keeps the control focusable and described only if it
   * passes both on to its control.
   */
  reason?: string;
  slots?: Slots;
  /** The field's wrapper element, as it mounts and unmounts. */
  wrapper?: (element: HTMLDivElement | null) => void;
}
export function FieldAdornment({
  children,
  label,
  onRegenerate,
  disabled,
  reason,
  slots,
  wrapper,
}: FieldAdornmentProps) {
  const reasonId = useId();
  // The host's form may sit outside the chat: its native controls are
  // drawn in the chat's scheme.
  const colorScheme = useColorScheme();
  const [visible, show] = useState(false);
  // Said only when focus brings it, never on hover.
  const [announced, announce] = useState(false);
  const hovered = useRef(false),
    focused = useRef(false),
    // Pressed: what it opened (the popup) will hand focus back here, so it
    // stays shown, and focusable, until focus has come back into the field.
    pressed = useRef(false),
    adornment = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => cancel, []);
  return (
    <div
      ref={wrapper}
      className="wp-field-parent"
      style={{ colorScheme }}
      // A press here may open the form-fill popup, which then takes focus.
      onClickCapture={(event) => {
        const onAdornment =
          !!adornment.current &&
          composedContains(adornment.current, event.target as Node);
        if (onAdornment) pressed.current = true;
        // The hold ends once the press's popup lifecycle is over; then the
        // ordinary rule decides (shown while focused or hovered).
        recordFieldPress(event, event.currentTarget, () => {
          if (!onAdornment) return;
          pressed.current = false;
          if (!focused.current && !hovered.current) {
            cancel();
            show(false);
          }
        });
      }}
      onPointerEnter={() => {
        hovered.current = true;
        cancel();
        show(true);
      }}
      onPointerLeave={() => {
        hovered.current = false;
        cancel();
        timer.current = setTimeout(() => {
          if (!focused.current && !pressed.current) show(false);
        }, 400);
      }}
      onFocus={() => {
        focused.current = true;
        pressed.current = false;
        cancel();
        show(true);
        announce(true);
      }}
      onBlur={(e) => {
        // Focus moving within the field, a shadow tree in it included.
        if (composedContains(e.currentTarget, e.relatedTarget as Node | null))
          return;
        focused.current = false;
        announce(false);
        if (!hovered.current && !pressed.current) {
          cancel();
          show(false);
        }
      }}
    >
      {children}
      <span ref={adornment} className="wp-field-adornment" hidden={!visible}>
        <Part
          name="fieldAdornment"
          slots={slots}
          label={label}
          onPress={reason ? undefined : onRegenerate}
          disabled={disabled}
          aria-disabled={reason ? true : undefined}
          describedBy={reason ? reasonId : undefined}
        >
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            aria-disabled={reason ? true : undefined}
            aria-describedby={reason ? reasonId : undefined}
            onClick={() => {
              if (!reason) onRegenerate();
            }}
          >
            {label}
          </button>
        </Part>
        {reason ? (
          <span id={reasonId} className="wp-sr-only">
            {reason}
          </span>
        ) : null}
      </span>
      <span role="status" className="wp-sr-only">
        {visible && announced ? label : ""}
      </span>
    </div>
  );
}
