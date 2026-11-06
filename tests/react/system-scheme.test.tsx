// @vitest-environment jsdom
// The chat follows the system colour scheme unless the host sets one or
// paints its own theme.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ConfigProvider, theme } from "antd";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import { antdSkin } from "../../src/skin-antd/index";
import { darkTheme, lightTheme } from "../../src/tokens/index";
import { showGreeting as chat } from "../support/greeting";

const original = window.matchMedia;
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

// A system preference that can change while the chat is shown.
function preferDark(dark: boolean) {
  const listeners = new Set<() => void>();
  const state = { dark };
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: dark)" && state.dark;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  })) as never;
  return (next: boolean) =>
    act(() => {
      state.dark = next;
      for (const listener of listeners) listener();
    });
}
const root = () => document.querySelector<HTMLElement>(".waypoint")!;
const background = () => root().style.getPropertyValue("--wp-background");

describe("the colour scheme", () => {
  it("follows the system preference when nothing sets one", async () => {
    preferDark(true);
    const client = await chat();
    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    expect(background()).toBe(darkTheme.background);
    client.dispose();
  });
  it("switches when the preference changes while shown", async () => {
    const change = preferDark(true);
    const client = await chat();
    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    await change(false);
    expect(root().getAttribute("data-color-scheme")).toBe("light");
    expect(background()).toBe(lightTheme.background);
    client.dispose();
  });
  it("an explicit colorScheme wins over the preference", async () => {
    preferDark(true);
    const client = await chat({ colorScheme: "light" });
    expect(root().getAttribute("data-color-scheme")).toBe("light");
    expect(background()).toBe(lightTheme.background);
    client.dispose();
  });
  it("a host's own theme wins over the preference", async () => {
    preferDark(true);
    const client = await chat(antdSkin);
    expect(root().getAttribute("data-color-scheme")).toBe("light");
    client.dispose();
  });
  // A dark host under a light system: before, a `theme` prop over a host
  // theme always gave a light chat.
  const darkHost = async (extra: Record<string, unknown>) => {
    const client = createWaypointClient(config());
    await client.ready;
    render(
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
        <WaypointChat client={client} {...antdSkin} {...extra} />
      </ConfigProvider>,
    );
    return client;
  };
  it("with waypoint's tokens over a host theme, the host's scheme still wins", async () => {
    preferDark(false);
    const client = await darkHost({ theme: {} });
    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    expect(background()).toBe(darkTheme.background);
    client.dispose();
  });
  it("an explicit colorScheme still wins over a host theme and the system", async () => {
    preferDark(true);
    const client = await darkHost({ theme: {}, colorScheme: "light" });
    expect(root().getAttribute("data-color-scheme")).toBe("light");
    expect(background()).toBe(lightTheme.background);
    client.dispose();
  });
  // A `theme` prop is tokens, not a scheme: under it, the scheme still
  // follows the system's, and the base tokens with it.
  it("a theme prop without a host theme takes the system's scheme", async () => {
    preferDark(true);
    const client = await chat({ theme: { accent: "#8fb1ff" } });
    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    expect(background()).toBe(darkTheme.background);
    client.dispose();
  });
  it("is light where the preference cannot be read", async () => {
    window.matchMedia = undefined as never;
    const client = await chat();
    expect(root().getAttribute("data-color-scheme")).toBe("light");
    client.dispose();
  });
});
