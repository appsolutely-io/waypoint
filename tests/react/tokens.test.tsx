// @vitest-environment jsdom
// The token set (Table K): new tokens with values in both schemes, their
// custom properties, the contrast of every text and boundary pair, the
// chat's color-scheme, and an old complete theme still accepted.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  darkTheme,
  lightTheme,
  themeProperties,
  type Theme,
} from "../../src/tokens/index";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";

afterEach(cleanup);
// WCAG 2.2 relative luminance contrast of two #rrggbb colours.
const ratio = (a: string, b: string) => {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const added = [
  "space1",
  "space2",
  "space3",
  "space4",
  "fontSizeSm",
  "fontSizeLg",
  "motionFast",
  "motionSlow",
  "easing",
  "focusRing",
  "success",
  "warning",
  "controlBorder",
] as const;

describe("CK-K1 the token set", () => {
  it("has every new token in both schemes, emitted as a custom property", () => {
    for (const key of added) {
      expect(lightTheme[key]).toBeTruthy();
      expect(darkTheme[key]).toBeTruthy();
    }
    const properties = themeProperties(lightTheme);
    expect(properties["--wp-space1"]).toBe("0.25rem");
    expect(properties["--wp-control-border"]).toBe(lightTheme.controlBorder);
    expect(properties["--wp-font-size-sm"]).toBe("0.875rem");
  });
  it("keeps the old tokens' names and values", () => {
    expect(lightTheme.space).toBe("0.75rem");
    expect(lightTheme.border).toBe("#ccd4df");
    expect(lightTheme.motion).toBe("120ms");
  });
});

describe("CK-K4 contrast pairs", () => {
  for (const [scheme, theme] of [
    ["light", lightTheme],
    ["dark", darkTheme],
  ] as const) {
    for (const ground of ["background", "surface"] as const) {
      it.each([
        "foreground",
        "muted",
        "accent",
        "danger",
        "success",
        "warning",
      ] as const)(
        `${scheme}: %s text on ${ground} is at least 4.5:1`,
        (text) => {
          expect(ratio(theme[text]!, theme[ground])).toBeGreaterThanOrEqual(
            4.5,
          );
        },
      );
      it.each(["focusRing", "controlBorder"] as const)(
        `${scheme}: %s on ${ground} is at least 3:1`,
        (boundary) => {
          expect(ratio(theme[boundary]!, theme[ground])).toBeGreaterThanOrEqual(
            3,
          );
        },
      );
    }
  }
});

describe("CK-K2 an old theme", () => {
  it("a complete old 13-key theme is still a Theme, and the new tokens default", async () => {
    const old: Theme = {
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
    };
    const client = createWaypointClient(config());
    const view = render(<WaypointChat client={client} theme={old} />);
    const root = () => view.container.querySelector<HTMLElement>(".waypoint")!;
    await waitFor(() => expect(root()).not.toBeNull());
    expect(root().style.getPropertyValue("--wp-control-border")).toBe(
      lightTheme.controlBorder,
    );
    client.dispose();
  });
});

describe("CK-K3 color-scheme", () => {
  it.each(["light", "dark"] as const)(
    "the root declares color-scheme %s",
    async (scheme) => {
      const client = createWaypointClient(config());
      const view = render(
        <WaypointChat client={client} colorScheme={scheme} />,
      );
      await waitFor(() =>
        expect(
          view.container.querySelector<HTMLElement>(".waypoint")?.style
            .colorScheme,
        ).toBe(scheme),
      );
      client.dispose();
    },
  );
});
