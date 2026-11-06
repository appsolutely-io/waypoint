import { DIALOG_SELECTOR } from "../react/dialog-selectors";
import {
  ConfigProvider,
  Input,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  theme as antdTheme,
} from "antd";
import dayjs from "dayjs";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  ButtonProps,
  DrawerProps,
  PrimitiveComponents,
  PartProps,
  ThemeTokensHook,
} from "../react/ui";
import type { ResolvedTheme, Theme } from "../tokens/index";
import { production } from "../react/production";
function pixels(value: string, fallback: number): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed)
    ? parsed * (value.endsWith("rem") ? 16 : 1)
    : fallback;
}
const REDUCED = "(prefers-reduced-motion: reduce)";
// The user's reduced-motion preference, followed while mounted.
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof matchMedia !== "function") return () => {};
      const query = matchMedia(REDUCED);
      query.addEventListener?.("change", changed);
      return () => query.removeEventListener?.("change", changed);
    },
    () => typeof matchMedia === "function" && matchMedia(REDUCED).matches,
    () => false,
  );
}
// A colour as [r, g, b, alpha], from #rgb(a), #rrggbb(aa) or rgb(a)() in
// its comma or its space-and-slash form, with plain numbers in range;
// undefined for anything else (none, named, hsl(), percentages, a channel
// over 255 or an alpha over 1), which is never guessed at.
const NUMBER = "\\s*(\\d*\\.?\\d+)\\s*";
const RGB = new RegExp(
  `^rgba?\\((?:${NUMBER},${NUMBER},${NUMBER}(?:,${NUMBER})?|${NUMBER}\\s${NUMBER}\\s${NUMBER}(?:/${NUMBER})?)\\)$`,
  "i",
);
function rgba(value?: string | null): number[] | undefined {
  const text = value?.trim() ?? "";
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text)?.[1];
  const parts = hex
    ? (hex.length < 5 ? [...hex].map((d) => d + d) : hex.match(/../g)!).map(
        // The alpha pair is out of 255.
        (d, at) => parseInt(d, 16) / (at > 2 ? 255 : 1),
      )
    : RGB.exec(text)
        ?.slice(1)
        .filter((part) => part !== undefined)
        .map(Number);
  return parts?.every((part, at) => part <= (at > 2 ? 1 : 255))
    ? [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
    : undefined;
}
const WHITE = [255, 255, 255, 1];
// `top` painted over an opaque colour (white when none is given).
const over = (top: number[], under = WHITE): number[] =>
  [0, 1, 2].map((i) => top[i]! * top[3]! + under[i]! * (1 - top[3]!)).concat(1);
// The relative luminance (WCAG 2.2) of an opaque colour.
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
// A colour's contrast painted over an opaque one; 0 for one that cannot be
// read, which is never legible.
function contrast(color: string, under: number[]): number {
  const top = rgba(color);
  if (!top) return 0;
  const [x, y] = [luminance(over(top, under)), luminance(under)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const hexOf = (rgb: number[]) =>
  "#" +
  rgb
    .slice(0, 3)
    .map((c) => Math.round(c).toString(16).padStart(2, "0"))
    .join("");
// What the chat paints behind its text: its background over the page, a
// bubble's surface over that, and the user's bubble, the accent mixed into
// the surface with premultiplied alpha as CSS color-mix does (12% in
// light, 16% in dark), over the background. Undefined when one of them
// cannot be read.
function surfaces(
  tokens: Record<"accent" | "background" | "surface", string>,
  scheme: "light" | "dark",
  accent = tokens.accent,
): [string, number[]][] | undefined {
  const [background, surface, tint] = [
    tokens.background,
    tokens.surface,
    accent,
  ].map(rgba);
  if (!background || !surface || !tint) return;
  const page = over(background);
  const share = scheme === "dark" ? 0.16 : 0.12;
  const alpha = tint[3]! * share + surface[3]! * (1 - share);
  const mixed = [0, 1, 2].map(
    (i) =>
      (tint[i]! * tint[3]! * share + surface[i]! * surface[3]! * (1 - share)) /
      (alpha || 1),
  );
  return [
    ["background", page],
    ["surface", over(surface, page)],
    ["user surface", over([...mixed, alpha], page)],
  ];
}
const TEXT_CONTRAST = 4.5;
const DANGER_TEXT_CONTRAST = 4.6;
// The pairs every theme must meet (Table K): text (the first six),
// focus rings and input boundaries at 3:1, each against the background and
// the surface. The first three are text on the user's tinted bubble too.
const REQUIRED =
  "foreground muted accent danger success warning focusRing controlBorder".split(
    " ",
  );
const warned = new Set<string>();
// The host owns its theme: a pair under its minimum is used as given, and
// named once, outside production builds.
function warnLowContrast(
  tokens: Partial<Record<string, string>> &
    Record<"accent" | "background" | "surface", string>,
  scheme: "light" | "dark",
) {
  if (production()) return;
  const say = (text: string) => {
    if (!warned.has(text))
      console.warn(`waypoint: the host antd theme's ${text}`);
    warned.add(text);
  };
  const shown = surfaces(tokens, scheme);
  // The background and surface are only checked for being readable.
  [...REQUIRED, "background", "surface"].forEach((name, at) => {
    const value = tokens[name];
    if (!value) return;
    if (!rgba(value))
      return say(
        `${name} (${value}) is not a colour waypoint can read, so its contrast is not checked`,
      );
    const least = at < 6 ? TEXT_CONTRAST : 3;
    for (const [label, under] of shown?.slice(0, at < 3 ? 3 : at < 8 ? 2 : 0) ??
      []) {
      const ratio = contrast(value, under);
      if (ratio < least)
        say(
          `${name} (${value}) has ${ratio.toFixed(2)}:1 against its ${label} (${hexOf(under)}), under ${least}:1`,
        );
    }
  });
}
// antd's own link and status colours for a scheme, when the installed antd
// says.
const SEED = (
  antdTheme as { defaultSeed?: Parameters<typeof antdTheme.darkAlgorithm>[0] }
).defaultSeed;
function antdStatusDefaults(scheme: "light" | "dark") {
  if (!SEED) return undefined;
  const map = (
    scheme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
  )(SEED);
  return {
    accent: map.colorPrimary,
    danger: map.colorError,
    success: map.colorSuccess,
    warning: map.colorWarning,
  };
}
// A colour moved `amount` of the way to black (0) or white (255), as hex.
function towards(color: string, target: number, amount: number) {
  const rgb = rgba(color);
  return rgb && hexOf(rgb.map((c) => c * (1 - amount) + target * amount));
}
// Links and status colours are text in the chat. antd's own defaults are
// under 4.5:1 (its error red is about 3.3:1 on white, its blue under 4.5:1
// on its grey surface). Where the host left one as antd's and it is
// illegible on the host's background or surface, or a link on the user's
// tinted bubble, the first shade of it towards black (light) or white
// (dark) that meets its text contrast target is used; danger keeps a
// rounding margin. With none, it stays and
// is warned about. A host's own colour is its choice (and warned about).
function legibleDefaults(
  tokens: Partial<Record<"danger" | "success" | "warning", string>> &
    Record<"accent" | "background" | "surface", string>,
  scheme: "light" | "dark",
) {
  const defaults = antdStatusDefaults(scheme);
  for (const name of ["accent", "danger", "success", "warning"] as const) {
    const legible = (value: string) =>
      // Never legible against a surface that cannot be read.
      surfaces(tokens, scheme, value)
        ?.slice(0, name === "accent" ? 3 : 2)
        .every(
          ([, under]) =>
            contrast(value, under) >=
            (name === "danger" ? DANGER_TEXT_CONTRAST : TEXT_CONTRAST),
        );
    const value = tokens[name];
    if (
      !value ||
      defaults?.[name]?.toLowerCase() !== value.toLowerCase() ||
      legible(value)
    )
      continue;
    for (let step = 1; step <= 10; step++) {
      const shade = towards(value, scheme === "dark" ? 255 : 0, step / 10);
      if (shade && legible(shade)) {
        tokens[name] = shade;
        break;
      }
    }
  }
}
/**
 * The host's antd theme as waypoint tokens: the chat follows it unless it
 * is given a `theme` of its own.
 */
export function useHostTokens(): {
  tokens: Partial<ResolvedTheme>;
  scheme: "light" | "dark";
} {
  const { token } = antdTheme.useToken();
  return useMemo(() => {
    const scheme: "light" | "dark" =
      luminance(over(rgba(token.colorBgContainer) ?? WHITE)) < 0.5
        ? "dark"
        : "light";
    const tokens: Partial<ResolvedTheme> &
      Record<"accent" | "background" | "surface", string> = {
      accent: token.colorPrimary,
      background: token.colorBgContainer,
      surface: scheme === "dark" ? token.colorBgElevated : token.colorBgLayout,
      foreground: token.colorText,
      muted: token.colorTextSecondary,
      border: token.colorBorderSecondary,
      controlBorder: token.colorBorder,
      danger: token.colorError,
      success: token.colorSuccess,
      warning: token.colorWarning,
      focusRing: token.colorPrimary,
      radius: `${token.borderRadius}px`,
      fontFamily: token.fontFamily,
      fontSize: `${token.fontSize}px`,
    };
    // A token the host left undefined falls back to waypoint's.
    for (const name in tokens)
      if (tokens[name as keyof typeof tokens] === undefined)
        delete tokens[name as keyof typeof tokens];
    legibleDefaults(tokens, scheme);
    warnLowContrast(tokens, scheme);
    // The user's bubble is tinted only when every colour on and under it
    // can be checked; otherwise it keeps the surface, with an accent edge.
    if (
      !surfaces(tokens, scheme) ||
      !rgba(tokens.foreground!) ||
      !rgba(tokens.muted!)
    )
      Object.assign(tokens, { userTint: "0%", userEdge: "3px" });
    return { tokens, scheme };
  }, [token]);
}
export function AntdTheme({
  children,
  colorScheme,
  tokens,
  tokenSource = "waypoint",
}: {
  children?: ReactNode;
  colorScheme: "light" | "dark";
  tokens: Theme;
  tokenSource?: "host" | "waypoint";
}) {
  const still = useReducedMotion();
  if (tokenSource === "host")
    // The host's theme as it is: nothing of waypoint's own, only no motion
    // when the user asks for none.
    return (
      // Always a theme object: antd builds a different tree without one,
      // which would remount the chat when the token source changes.
      <ConfigProvider
        theme={{
          token: still
            ? {
                motionDurationFast: "0s",
                motionDurationMid: "0s",
                motionDurationSlow: "0s",
              }
            : {},
        }}
      >
        {children}
      </ConfigProvider>
    );
  return (
    <ConfigProvider
      theme={{
        algorithm:
          colorScheme === "dark"
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: tokens.accent,
          // antd draws its focus ring in this colour; its default, a light
          // tint of the primary, has under 3:1 contrast (WCAG 1.4.11).
          colorPrimaryBorder: tokens.focusRing ?? tokens.accent,
          // antd derives hover and pressed tints that fall under 4.5:1 for
          // button text (3.98:1 light hover, 4.06:1 dark pressed); the accent
          // itself passes on background and surface in both schemes, and
          // the border change still shows the state.
          colorPrimaryHover: tokens.accent,
          colorPrimaryActive: tokens.accent,
          colorBgContainer: tokens.background,
          colorText: tokens.foreground,
          // The visible boundary of inputs and the date picker; the
          // decorative border separates.
          colorBorder: tokens.controlBorder ?? tokens.border,
          colorBorderSecondary: tokens.border,
          colorSplit: tokens.border,
          borderRadius: pixels(tokens.radius, 8),
          padding: pixels(tokens.space, 12),
          fontSize: pixels(tokens.fontSize, 16),
          fontFamily: tokens.fontFamily,
          boxShadow: tokens.shadow,
          colorBgElevated: tokens.surface,
          colorTextSecondary: tokens.muted,
          colorError: tokens.danger,
          colorSuccess: tokens.success,
          colorWarning: tokens.warning,
          motionDurationFast: still
            ? "0s"
            : (tokens.motionFast ?? tokens.motion),
          motionDurationMid: still ? "0s" : tokens.motion,
          motionDurationSlow: still
            ? "0s"
            : (tokens.motionSlow ?? tokens.motion),
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
function Textarea({
  value,
  onChange,
  label,
  inputRef,
  onKeyDown,
  disabled,
  describedBy,
}: PartProps) {
  return (
    <Input.TextArea
      disabled={disabled}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      ref={(instance) => {
        const element = instance?.resizableTextArea?.textArea ?? null;
        if (typeof inputRef === "function") inputRef(element);
        else if (inputRef) inputRef.current = element;
      }}
    />
  );
}
// antd gives a button a fixed height for its size; the chat lets a long
// label wrap instead (styles.css), and keeps that height as the minimum.
// The theme's control height is passed in px without the unit; the small
// and large heights follow from it as antd derives them.
function SkinButton({
  children,
  onPress,
  disabled,
  label,
  ...attributes
}: ButtonProps) {
  const { token } = antdTheme.useToken();
  return (
    <Button
      disabled={disabled}
      onClick={onPress}
      aria-label={label}
      style={{ "--wp-btn": token.controlHeight } as CSSProperties}
      {...attributes}
    >
      {children}
    </Button>
  );
}
export const antdPrimitives: PrimitiveComponents = {
  button: SkinButton,
  textarea: Textarea,
  input: ({
    value,
    onChange,
    label,
    disabled,
    type,
    invalid,
    describedBy,
    required,
  }) => (
    <label>
      {label}
      <Input
        type={type}
        disabled={disabled}
        value={value}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        status={invalid ? "error" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  ),
  datePicker: ({ value, onChange, label, disabled }) => (
    <label>
      {label}
      <DatePicker
        showTime
        disabled={disabled}
        value={value ? dayjs(value) : null}
        onChange={(date) => onChange(date?.toISOString() ?? "")}
        aria-label={label}
      />
    </label>
  ),
  drawer: (props) => (props.open ? <AntdDrawer {...props} /> : null),
  checkbox: ({ checked, onChange, label, disabled, invalid, describedBy }) => (
    <Checkbox
      checked={checked}
      disabled={disabled}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.checked)}
    >
      {label}
    </Checkbox>
  ),
};
// The chat decides about focus, so antd's own is switched off at both ends:
// no opening autofocus, and the drawer unmounts when it closes, because
// rc-drawer's close animation callback restores focus to the element that
// was active at open without asking anyone. It renders in place, so it is
// inside the chat it belongs to.
function AntdDrawer({
  children,
  label,
  onClose,
  closeLabel,
  focusInto,
  restoreFocus,
}: DrawerProps) {
  return (
    <Drawer
      open
      title={label}
      // The press that opened the drawer never closes it: a double-click's
      // second click lands on the mask, as a click continuing a sequence
      // (detail 2 or more). A click of its own on the mask still closes it.
      onClose={(event) => {
        if (
          event?.type === "click" &&
          (event as { detail?: number }).detail! > 1
        )
          return;
        onClose();
      }}
      autoFocus={false}
      getContainer={false}
      // antd's default 378px would push a narrow chat sideways.
      width="min(378px, 100%)"
      // antd 5.0.0 names its own close button "Close" whatever the chat's
      // locale, and only later versions take a name for it; so the adapter
      // draws its own named close button in the header's extra slot.
      closable={!closeLabel}
      extra={
        closeLabel ? (
          <Button type="text" aria-label={closeLabel} onClick={onClose}>
            <span aria-hidden="true">×</span>
          </Button>
        ) : undefined
      }
    >
      <ConfigProvider
        getPopupContainer={(trigger) =>
          trigger?.closest<HTMLElement>(DIALOG_SELECTOR) ?? document.body
        }
      >
        <ReportElement
          label={label}
          focusInto={focusInto}
          restoreFocus={restoreFocus}
        />
        {children}
      </ConfigProvider>
    </Drawer>
  );
}
// Names the open dialog and reports its element.
function ReportElement({
  label,
  focusInto,
  restoreFocus,
}: Pick<DrawerProps, "label" | "focusInto" | "restoreFocus">) {
  const ref = useRef<HTMLSpanElement>(null);
  const back = useRef(restoreFocus);
  back.current = restoreFocus;
  useLayoutEffect(() => {
    // The minimum supported drawer drops ARIA naming props on its panel.
    ref.current?.closest(DIALOG_SELECTOR)?.setAttribute("aria-label", label);
  }, [label]);
  useLayoutEffect(() => {
    const dialog =
      ref.current?.closest<HTMLElement>(DIALOG_SELECTOR) ?? undefined;
    if (!dialog) return;
    // antd's dialog element is not focusable by itself.
    if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
    // The drawer's own root holds the mask: it stays reachable to clicks.
    // Its focus sentinels stay out of the Tab order, as the page does.
    const root = dialog.closest(".ant-drawer");
    root?.setAttribute("data-wp-modal-root", "");
    root
      ?.querySelectorAll(":scope > [data-sentinel]")
      .forEach((sentinel) => sentinel.setAttribute("inert", ""));
    focusInto?.(dialog);
    return () => back.current?.(dialog);
    // Once per opening: the drawer unmounts when it closes.
  }, []);
  return <span ref={ref} hidden />;
}
const useThemeTokens: ThemeTokensHook = useHostTokens;
export const antdSkin = {
  primitives: antdPrimitives,
  wrapper: AntdTheme,
  useThemeTokens,
  parts: {
    fieldAdornment: ({
      label,
      onPress,
      disabled,
      describedBy,
      "aria-disabled": guarded,
    }: PartProps) => (
      <Button
        aria-label={label}
        onClick={guarded ? undefined : onPress}
        disabled={disabled}
        aria-disabled={guarded}
        aria-describedby={describedBy}
      >
        {label}
      </Button>
    ),
  },
};
