// @vitest-environment jsdom
// The antd skin follows the host's antd theme unless the chat is given a
// waypoint theme (Table T): its antd controls and its own CSS tokens take
// the host's values, live; any `theme` prop, whatever its value, makes the
// waypoint tokens win.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ConfigProvider, DatePicker, Input, theme } from "antd";
import type { ReactNode } from "react";
import { WaypointChat, WaypointProvider } from "../../src/react/index";
import { antdSkin } from "../../src/skin-antd/index";
import { darkTheme, lightTheme } from "../../src/tokens/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const PURPLE = "#722ed1";
function Probe({ seen }: { seen: (token: Record<string, unknown>) => void }) {
  const { token } = theme.useToken();
  seen(token as never);
  return null;
}
const host = (children: ReactNode, primary = PURPLE, dark = false) => (
  <ConfigProvider
    theme={{
      // Status colours unlike waypoint's, so a missed mapping shows.
      token: {
        colorPrimary: primary,
        colorSuccess: "#00ff00",
        colorWarning: "#ff00ff",
      },
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    }}
  >
    {children}
  </ConfigProvider>
);
const root = () => document.querySelector<HTMLElement>(".waypoint")!;
async function chat(element: ReactNode) {
  const view = render(element);
  await waitFor(() => expect(root()).not.toBeNull());
  return view;
}

describe("CK-T1 following the host antd theme", () => {
  it("antd controls and the chat's tokens take the host's values, and follow a change", async () => {
    const client = createWaypointClient(config());
    let token: Record<string, unknown> = {};
    const tree = (primary: string) =>
      host(
        <WaypointProvider client={client} {...antdSkin}>
          <Probe seen={(value) => (token = value)} />
        </WaypointProvider>,
        primary,
      );
    const view = render(tree(PURPLE));
    expect(token.colorPrimary).toBe(PURPLE);
    view.rerender(tree("#13c2c2"));
    expect(token.colorPrimary).toBe("#13c2c2");
    cleanup();
    const shown = await chat(
      host(<WaypointChat client={client} {...antdSkin} />),
    );
    expect(root().style.getPropertyValue("--wp-accent")).toBe(PURPLE);
    shown.rerender(
      host(<WaypointChat client={client} {...antdSkin} />, "#13c2c2"),
    );
    expect(root().style.getPropertyValue("--wp-accent")).toBe("#13c2c2");
    client.dispose();
  });
});

describe("CK-T2 an explicit waypoint theme wins", () => {
  it.each([
    ["an empty theme", {}],
    ["a complete theme equal to the defaults", { ...lightTheme }],
    ["a custom theme", { accent: "#0b6e4f" }],
  ])("%s", async (_, given) => {
    const client = createWaypointClient(config());
    let token: Record<string, unknown> = {};
    render(
      host(
        <WaypointProvider client={client} {...antdSkin} theme={given}>
          <Probe seen={(value) => (token = value)} />
          <Input aria-label="Field" />
          <DatePicker aria-label="When" />
        </WaypointProvider>,
      ),
    );
    const accent = (given as { accent?: string }).accent ?? lightTheme.accent;
    expect(token.colorPrimary).toBe(accent);
    expect(token.colorBorder).toBe(lightTheme.controlBorder);
    expect(token.colorPrimaryBorder).toBe(lightTheme.focusRing);
    expect(token.colorSuccess).toBe(lightTheme.success);
    expect(token.colorWarning).toBe(lightTheme.warning);
    cleanup();
    await chat(
      host(<WaypointChat client={client} {...antdSkin} theme={given} />),
    );
    expect(root().style.getPropertyValue("--wp-accent")).toBe(accent);
    client.dispose();
  });
});

describe("CK-T3 the scheme", () => {
  it("a dark host gives a dark chat; an explicit colorScheme wins", async () => {
    const client = createWaypointClient(config());
    const view = await chat(
      host(<WaypointChat client={client} {...antdSkin} />, PURPLE, true),
    );
    expect(root().style.colorScheme).toBe("dark");
    view.rerender(
      host(
        <WaypointChat client={client} {...antdSkin} colorScheme="light" />,
        PURPLE,
        true,
      ),
    );
    expect(root().style.colorScheme).toBe("light");
    // A scheme the host's theme does not paint: waypoint's own tokens for
    // it, never the host's colours of the other scheme.
    expect(root().style.getPropertyValue("--wp-background")).toBe(
      lightTheme.background,
    );
    client.dispose();
  });
  it("an explicit dark scheme with a light host (antd's defaults) paints dark, antd controls included", async () => {
    const client = createWaypointClient(config());
    let token: Record<string, unknown> = {};
    await chat(
      <WaypointChat client={client} {...antdSkin} colorScheme="dark" />,
    );
    expect(root().style.colorScheme).toBe("dark");
    expect(root().style.getPropertyValue("--wp-background")).toBe(
      darkTheme.background,
    );
    expect(root().style.getPropertyValue("--wp-foreground")).toBe(
      darkTheme.foreground,
    );
    cleanup();
    render(
      <WaypointProvider client={client} {...antdSkin} colorScheme="dark">
        <Probe seen={(value) => (token = value)} />
      </WaypointProvider>,
    );
    expect(token.colorBgContainer).toBe(darkTheme.background);
    expect(token.colorText).toBe(darkTheme.foreground);
    client.dispose();
  });
  it("an explicit scheme equal to the host's keeps following the host", async () => {
    const client = createWaypointClient(config());
    const view = await chat(
      host(<WaypointChat client={client} {...antdSkin} />, PURPLE, true),
    );
    const followed = root().style.getPropertyValue("--wp-accent");
    expect(followed).not.toBe(darkTheme.accent);
    view.rerender(
      host(
        <WaypointChat client={client} {...antdSkin} colorScheme="dark" />,
        PURPLE,
        true,
      ),
    );
    expect(root().style.getPropertyValue("--wp-accent")).toBe(followed);
    client.dispose();
  });
});

describe("CK-T4 a host theme with low contrast", () => {
  it("is used as given, with one warning naming the pair", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    const view = await chat(
      host(<WaypointChat client={client} {...antdSkin} />, "#e6f4ff"),
    );
    expect(root().style.getPropertyValue("--wp-accent")).toBe("#e6f4ff");
    view.rerender(
      host(<WaypointChat client={client} {...antdSkin} />, "#e6f4ff"),
    );
    // Once per pair: against the background, the surface and the user's
    // tinted bubble, where links are text too.
    const warnings = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.includes("accent (#e6f4ff)"));
    expect(warnings).toHaveLength(3);
    expect(
      warnings.some((text) => text.includes("against its user surface")),
    ).toBe(true);
    expect(
      warnings.some((text) => text.includes("against its background")),
    ).toBe(true);
    expect(warnings.some((text) => text.includes("against its surface"))).toBe(
      true,
    );
    client.dispose();
  });
  it("checks every required pair: status colours and the focus ring too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider
        theme={{ token: { colorPrimary: "#e8f7ff", colorSuccess: "#d9f7be" } }}
      >
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    const said = warn.mock.calls.map((call) => String(call[0]));
    expect(said.some((text) => text.includes("success (#d9f7be)"))).toBe(true);
    expect(said.some((text) => text.includes("focusRing (#e8f7ff)"))).toBe(
      true,
    );
    client.dispose();
  });
  it("its production check is the expression a bundler replaces", () => {
    // Consumers' bundlers replace the literal `process.env.NODE_ENV`; read any
    // other way, a browser build has no process and always warns.
    // The skin and the message formatter share it.
    const source = readFileSync("src/react/production.ts", "utf8");
    expect(source).toMatch(/process\.env\.NODE_ENV/);
    expect(source).not.toMatch(/process\?\.env/);
  });
  it("says nothing in a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = createWaypointClient(config());
      await chat(
        host(<WaypointChat client={client} {...antdSkin} />, "#fff1f0"),
      );
      expect(warn).not.toHaveBeenCalled();
      client.dispose();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// Relative luminance and contrast (WCAG 2.2) of #rrggbb colours.
function ratio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => {
      const v = parseInt(hex.slice(at, at + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const property = (name: string) =>
  root().style.getPropertyValue(`--wp-${name}`);

describe("host surface elevation", () => {
  it("raises dark bubbles to antd's elevated tier above the panel", async () => {
    const client = createWaypointClient(config());
    let token: Record<string, unknown> = {};
    await chat(
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
        <Probe seen={(value) => (token = value)} />
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    expect(property("background")).toBe(token.colorBgContainer);
    expect(property("surface")).toBe(token.colorBgElevated);
    expect(
      surfaceShown().every((channel, index) => channel > page()[index]!),
    ).toBe(true);
    for (const name of ["foreground", "muted", "accent"])
      for (const under of [page(), surfaceShown(), userSurfaceShown(true)])
        expect(on(property(name), under)).toBeGreaterThanOrEqual(4.5);
    client.dispose();
  });
  it("keeps the light layout tier and follows the host's selected surface live", async () => {
    const client = createWaypointClient(config());
    const tree = (dark: boolean) => (
      <ConfigProvider
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorBgLayout: "#ececec",
            colorBgElevated: "#303030",
          },
        }}
      >
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>
    );
    const view = await chat(tree(false));
    expect(property("surface")).toBe("#ececec");
    view.rerender(tree(true));
    expect(property("surface")).toBe("#303030");
    view.rerender(tree(false));
    expect(property("surface")).toBe("#ececec");
    client.dispose();
  });
  it("keeps an explicit waypoint surface over the dark host's elevated tier", async () => {
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: { colorBgElevated: "#303030" },
        }}
      >
        <WaypointChat
          client={client}
          {...antdSkin}
          theme={{ surface: "#253545" }}
        />
      </ConfigProvider>,
    );
    expect(property("surface")).toBe("#253545");
    expect(property("background")).toBe(darkTheme.background);
    client.dispose();
  });
});

describe("status text under the host's theme", () => {
  it.each([
    ["light", false],
    ["dark", true],
  ] as const)(
    "under antd's own %s defaults every status colour reaches 4.5:1 on the host's background and surface",
    async (_, dark) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = createWaypointClient(config());
      await chat(
        <ConfigProvider
          theme={{
            algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          }}
        >
          <WaypointChat client={client} {...antdSkin} />
        </ConfigProvider>,
      );
      for (const name of ["danger", "success", "warning"] as const) {
        expect(
          ratio(property(name), property("background")),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          ratio(property(name), property("surface")),
        ).toBeGreaterThanOrEqual(4.5);
      }
      client.dispose();
    },
  );
  it("default danger keeps a contrast margin on a grey host", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider
        theme={{
          token: { colorBgContainer: "#c8c8c8", colorBgLayout: "#c8c8c8" },
        }}
      >
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    expect(ratio(property("danger"), "#c8c8c8")).toBeGreaterThanOrEqual(4.6);
    client.dispose();
  });
  it("on a grey host surface every status colour still reaches 4.5:1 there", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider theme={{ token: { colorBgLayout: "#c0c0c0" } }}>
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    expect(property("surface")).toBe("#c0c0c0");
    for (const name of ["danger", "success", "warning"] as const) {
      expect(ratio(property(name), "#c0c0c0")).toBeGreaterThanOrEqual(4.5);
      expect(
        ratio(property(name), property("background")),
      ).toBeGreaterThanOrEqual(4.5);
    }
    const said = warn.mock.calls.map((call) => String(call[0]));
    expect(
      said.filter((text) =>
        /danger|success|warning/.test(text.split(" has ")[0]!),
      ),
    ).toEqual([]);
    client.dispose();
  });
  it("where no shade can reach 4.5:1 on both, the colour shown is warned about", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider theme={{ token: { colorBgLayout: "#555555" } }}>
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    const danger = property("danger");
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes(`danger (${danger})`),
      ),
    ).toBe(true);
    client.dispose();
  });
  it("a host's own status colour is used as given, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    // The host's error colour as its antd derives it (antd 5.0 derives a
    // lighter shade from the seed than later versions do).
    let hosts = "";
    await chat(
      <ConfigProvider theme={{ token: { colorError: "#ff7875" } }}>
        <Probe seen={(token) => (hosts = String(token.colorError))} />
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    expect(hosts).toMatch(/^#/);
    expect(property("danger")).toBe(hosts);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes(`danger (${hosts})`),
      ),
    ).toBe(true);
    client.dispose();
  });
});

// Colours as the browser paints them, alpha included: [r, g, b, alpha]
// from #rgb(a), #rrggbb(aa) or rgb(a)().
function rgbaOf(colour: string): number[] {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(colour.trim());
  if (hex) {
    const pairs =
      hex[1]!.length <= 4
        ? [...hex[1]!].map((d) => d + d)
        : hex[1]!.match(/../g)!;
    const [r, g, b, a = "ff"] = pairs;
    return [r!, g!, b!]
      .map((d) => parseInt(d, 16))
      .concat(parseInt(a, 16) / 255);
  }
  const parts = /^rgba?\(([^)]+)\)$/i
    .exec(colour.trim())![1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(parseFloat);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}
// `top` painted over an opaque colour.
const over = (top: number[], under: number[]) =>
  [0, 1, 2].map((i) => top[i]! * top[3]! + under[i]! * (1 - top[3]!));
const hexOf = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
// The chat's background over a white page, and a bubble's fill over it.
const page = () => over(rgbaOf(property("background")), [255, 255, 255]);
const surfaceShown = () => over(rgbaOf(property("surface")), page());
// The user's bubble as the stylesheet draws it: the accent mixed into the
// surface in sRGB with premultiplied alpha (CSS Color 5 color-mix), by the
// share the stylesheet sets for the scheme, painted over the background.
const css = readFileSync("src/react/styles.css", "utf8");
const tintShare = (dark: boolean) =>
  Number(
    new RegExp(
      `\\.waypoint${dark ? '\\[data-color-scheme="dark"\\]' : ""} \\{\\s*--wp-user-tint: (\\d+)%`,
    ).exec(css)![1],
  ) / 100;
const userSurfaceShown = (dark: boolean) => {
  const share = tintShare(dark);
  const [a, s] = [rgbaOf(property("accent")), rgbaOf(property("surface"))];
  const alpha = a[3]! * share + s[3]! * (1 - share);
  const mixed = [0, 1, 2].map(
    (i) => (a[i]! * a[3]! * share + s[i]! * s[3]! * (1 - share)) / alpha,
  );
  return over([...mixed, alpha], page());
};
const on = (text: string, under: number[]) =>
  ratio(hexOf(over(rgbaOf(text), under)), hexOf(under));

describe("text on the user's tinted bubble", () => {
  it.each([
    ["light", false],
    ["dark", true],
  ] as const)(
    "under antd's own %s defaults, text, muted text and links reach 4.5:1 there, on the background and on the surface",
    async (_, dark) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = createWaypointClient(config());
      await chat(
        <ConfigProvider
          theme={{
            algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          }}
        >
          <WaypointChat client={client} {...antdSkin} />
        </ConfigProvider>,
      );
      for (const name of ["foreground", "muted", "accent"])
        for (const surface of [userSurfaceShown(dark), page(), surfaceShown()])
          expect([name, hexOf(surface), on(property(name), surface)]).toEqual([
            name,
            hexOf(surface),
            expect.toSatisfy((value: number) => value >= 4.5),
          ]);
      client.dispose();
    },
  );
  it("the stylesheet tints 12% in light and 16% in dark", () => {
    expect([tintShare(false), tintShare(true)]).toEqual([0.12, 0.16]);
  });
  it.each([
    ["light", false],
    ["dark", true],
  ] as const)(
    "under a %s host, the warning names the user's bubble as the stylesheet draws it",
    async (_, dark) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = createWaypointClient(config());
      await chat(
        <ConfigProvider
          theme={{
            algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
            token: { colorPrimary: "#245ad1", colorTextSecondary: "#777777" },
          }}
        >
          <WaypointChat client={client} {...antdSkin} />
        </ConfigProvider>,
      );
      const tint = hexOf(userSurfaceShown(dark));
      const said = warn.mock.calls.map((call) => String(call[0]));
      expect(
        said.some(
          (text) =>
            text.includes(`muted (#777777) has`) &&
            text.includes(`against its user surface (${tint})`),
        ),
      ).toBe(true);
      client.dispose();
    },
  );
  it("on a translucent host surface, antd's blue is still made legible on what is painted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider theme={{ token: { colorBgLayout: "rgba(0,0,0,0.04)" } }}>
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    for (const surface of [userSurfaceShown(false), page(), surfaceShown()])
      expect(on(property("accent"), surface)).toBeGreaterThanOrEqual(4.5);
    client.dispose();
  });
  it("a translucent host accent still lets the warning check the user's bubble", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider
        theme={{
          token: {
            // Translucent and coloured, so the mix must premultiply.
            colorPrimary: "rgba(36,90,209,0.8)",
            // Not the next test's muted colour: a warning is said once
            // per text, and antd 5.0 drops the seed's alpha, which
            // made both texts the same.
            colorTextSecondary: "#6c6c6c",
          },
        }}
      >
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    const tint = userSurfaceShown(false);
    expect(on("#6c6c6c", tint)).toBeLessThan(4.5);
    const said = warn.mock.calls.map((call) => String(call[0]));
    expect(
      said.some(
        (text) =>
          text.includes("muted (#6c6c6c) has") &&
          text.includes(`against its user surface (${hexOf(tint)})`),
      ),
    ).toBe(true);
    client.dispose();
  });
  it("a host's own colour that is legible on the surface but not on the tint is warned about", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider
        theme={{
          token: { colorPrimary: "#245ad1", colorTextSecondary: "#6b6b6b" },
        }}
      >
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    expect(property("muted")).toBe("#6b6b6b");
    const said = warn.mock.calls.map((call) => String(call[0]));
    expect(said.filter((text) => text.includes("muted (#6b6b6b)"))).toEqual([
      expect.stringContaining("against its user surface"),
    ]);
    client.dispose();
  });
});

// Host colours in any CSS form reach the skin as written. One it cannot
// read fully is never taken for another colour: nothing is shaded or
// certified from it, and the user's bubble takes the plain surface with an
// accent edge instead of the tint.
describe("host colours the skin cannot read", () => {
  const forms = [
    "rgb(none none none)",
    "rgb(10% 20% 30%)",
    "rgb(0 0 0 / 50%)",
    "rgb(0 0 0 / 0.5)",
    "rgba(1, 2, 3, 0.5)",
    "rgb(1, 2)",
    "rgb()",
    "rgb(a, b, c)",
    "rgb(1 2 3 4 5)",
    "hsl(0 0% 70%)",
    "hsla(0, 0%, 70%, 0.5)",
    "silver",
    "transparent",
    "#12",
    "#12345",
    "",
  ];
  it.each(forms)(
    "%s as a surface or a text colour never throws",
    async (form) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      for (const token of [
        { colorBgLayout: form },
        { colorTextSecondary: form },
        { colorText: form },
        { colorBgContainer: form },
      ]) {
        const client = createWaypointClient(config());
        await chat(
          <ConfigProvider theme={{ token }}>
            <WaypointChat client={client} {...antdSkin} />
          </ConfigProvider>,
        );
        expect(root()).not.toBeNull();
        client.dispose();
        cleanup();
      }
    },
  );
  const plain = () => ({
    tint: property("user-tint"),
    edge: property("user-edge"),
  });
  // antd turns its seed colours, the primary (the link colour) among them,
  // into hex, so an unreadable link colour cannot reach the skin; the
  // alias tokens below arrive as written.
  it.each([
    ["an unreadable surface", { colorBgLayout: "hsl(0, 0%, 70%)" }],
    ["a percentage surface", { colorBgLayout: "rgb(70% 70% 70%)" }],
    ["a surface missing a channel", { colorBgLayout: "rgb(240, 240)" }],
    [
      "a surface with too many numbers",
      { colorBgLayout: "rgb(240 240 240 1 1)" },
    ],
    [
      "a surface with a malformed number",
      { colorBgLayout: "rgb(240 2.4.0 240)" },
    ],
    ["a channel over 255", { colorBgLayout: "rgb(300,0,0)" }],
    ["an alpha over 1", { colorBgLayout: "rgb(0 0 0 / 2)" }],
    ["four numbers without a slash", { colorBgLayout: "rgb(240 240 240 1)" }],
    // Each value is new here: a warning is said once per value.
    ["an unreadable background", { colorBgContainer: "gainsboro" }],
  ])(
    "with %s, antd's blue is not shaded from a guess, the colour is named as unchecked and the bubble is plain",
    async (_, token) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = createWaypointClient(config());
      await chat(
        <ConfigProvider theme={{ token }}>
          <WaypointChat client={client} {...antdSkin} />
        </ConfigProvider>,
      );
      expect(property("accent")).toBe(antdBlue());
      const value = Object.values(token)[0]!;
      const said = warn.mock.calls.map((call) => String(call[0]));
      expect(
        said.some((text) => text.includes(`(${value}) is not a colour`)),
      ).toBe(true);
      expect(
        said.some((text) => / has \d/.test(text) && text.includes("accent")),
      ).toBe(false);
      expect(plain()).toEqual({ tint: "0%", edge: "3px" });
      client.dispose();
    },
  );
  it("with an unreadable text colour, it is named as unchecked, never as passing or failing, and the bubble is plain", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(
      <ConfigProvider theme={{ token: { colorTextSecondary: "darkgray" } }}>
        <WaypointChat client={client} {...antdSkin} />
      </ConfigProvider>,
    );
    const said = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.includes("muted"));
    expect(said).toEqual([
      expect.stringContaining(
        "muted (darkgray) is not a colour waypoint can read",
      ),
    ]);
    expect(plain()).toEqual({ tint: "0%", edge: "3px" });
    client.dispose();
  });
  it("readable colours keep the tint", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createWaypointClient(config());
    await chat(<WaypointChat client={client} {...antdSkin} />);
    expect(plain()).toEqual({ tint: "", edge: "" });
    client.dispose();
  });
});
// antd's own primary for the light algorithm, as the installed antd says.
const antdBlue = () =>
  theme.defaultAlgorithm(
    (
      theme as unknown as {
        defaultSeed: Parameters<typeof theme.defaultAlgorithm>[0];
      }
    ).defaultSeed,
  ).colorPrimary;

// antd keeps a token the host sets to undefined as undefined.
describe("host tokens left undefined", () => {
  it.each([
    ["colorText", "foreground"],
    ["colorTextSecondary", "muted"],
    ["colorBgContainer", "background"],
    ["colorBgLayout", "surface"],
    ["colorPrimary", "accent"],
  ])(
    "%s undefined: the chat renders, on waypoint's value for it",
    async (name, token) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      // Whether the installed antd itself derives a theme without this
      // token: antd 5.0 cannot without its primary seed, and then the
      // host's own app cannot render either, before the skin is reached.
      let antdError: unknown;
      try {
        theme.defaultAlgorithm({
          ...(theme as unknown as { defaultSeed: object }).defaultSeed,
          [name]: undefined,
        } as never);
      } catch (error) {
        antdError = error;
      }
      const client = createWaypointClient(config());
      const shown = chat(
        <ConfigProvider theme={{ token: { [name]: undefined } }}>
          <WaypointChat client={client} {...antdSkin} />
        </ConfigProvider>,
      );
      if (antdError) {
        vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(shown).rejects.toThrow((antdError as Error).message);
        client.dispose();
        return;
      }
      await shown;
      expect(root()).not.toBeNull();
      expect(property(token)).not.toBe("");
      client.dispose();
    },
  );
});
