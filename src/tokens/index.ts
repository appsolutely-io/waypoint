export const lightTheme = {
  background: "#ffffff",
  foreground: "#18212f",
  muted: "#526071",
  accent: "#245ad1",
  border: "#ccd4df",
  surface: "#f2f5f9",
  danger: "#b42318",
  space: "0.75rem",
  radius: "0.5rem",
  fontSize: "1rem",
  fontFamily: "system-ui, sans-serif",
  shadow: "0 0.25rem 1rem #0002",
  motion: "120ms",
  // The scales around the defaults above.
  space1: "0.25rem",
  space2: "0.5rem",
  space3: "1rem",
  space4: "1.5rem",
  fontSizeSm: "0.875rem",
  fontSizeLg: "1.125rem",
  motionFast: "80ms",
  motionSlow: "200ms",
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  // Focus rings and the boundaries of inputs: at least 3:1 on background
  // and surface; `border` stays decorative.
  focusRing: "#245ad1",
  controlBorder: "#6b7889",
  // Status text: at least 4.5:1 on background and surface.
  success: "#1a7f37",
  warning: "#8a5c00",
} as const;
/** The name of a theme token. */
export type ThemeToken = keyof typeof lightTheme;
// The tokens a theme had before the scales and status colours were added;
// they stay required, the newer ones default when a theme leaves them out.
export type RequiredThemeToken =
  | "background"
  | "foreground"
  | "muted"
  | "accent"
  | "border"
  | "surface"
  | "danger"
  | "space"
  | "radius"
  | "fontSize"
  | "fontFamily"
  | "shadow"
  | "motion";
export type Theme = { [K in RequiredThemeToken]: string } & {
  [K in Exclude<ThemeToken, RequiredThemeToken>]?: string;
};
/** A theme with every token present, as the chat uses it. */
export type ResolvedTheme = { [K in ThemeToken]: string };
export const darkTheme: ResolvedTheme = {
  ...lightTheme,
  background: "#141b25",
  foreground: "#eef2f7",
  muted: "#aebbc9",
  accent: "#8fb1ff",
  border: "#465363",
  surface: "#202b39",
  danger: "#ffaaa4",
  focusRing: "#8fb1ff",
  controlBorder: "#8593a5",
  success: "#6fdd8b",
  warning: "#f2cc60",
};
export function themeProperties(
  theme: Partial<ResolvedTheme>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(theme)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [
        `--wp-${key.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase())}`,
        value,
      ]),
  );
}
