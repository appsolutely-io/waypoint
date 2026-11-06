// @vitest-environment jsdom
// Under reduced motion the antd skin's motion tokens are 0s, following the
// preference while mounted (Table M2).
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { theme } from "antd";
import { AntdTheme } from "../../src/skin-antd/index";
import { lightTheme } from "../../src/tokens/index";

afterEach(cleanup);
function preference(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("prefers-reduced-motion") ? matches : false;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
  })) as never;
  return (next: boolean) => {
    matches = next;
    for (const listener of listeners) listener();
  };
}
function Probe({ seen }: { seen: (durations: string[]) => void }) {
  const { token } = theme.useToken();
  seen([
    String(token.motionDurationFast),
    String(token.motionDurationMid),
    String(token.motionDurationSlow),
  ]);
  return null;
}
describe("CK-M2 antd motion tokens", () => {
  it("are 0s under reduced motion, and follow a change while mounted", () => {
    const change = preference(false);
    let durations: string[] = [];
    render(
      <AntdTheme colorScheme="light" tokens={lightTheme}>
        <Probe seen={(value) => (durations = value)} />
      </AntdTheme>,
    );
    expect(durations).toEqual(["80ms", "120ms", "200ms"]);
    act(() => change(true));
    expect(durations).toEqual(["0s", "0s", "0s"]);
    act(() => change(false));
    expect(durations).toEqual(["80ms", "120ms", "200ms"]);
  });
});
