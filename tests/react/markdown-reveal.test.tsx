// @vitest-environment jsdom
// A reply being written appears a word at a time on animation frames,
// never a character at a time; a finished reply, or one read with reduced
// motion, appears whole.
import { it, expect, afterEach, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import Markdown, { nextReveal } from "../../src/react/markdown";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const words = "The first order shipped on Monday and arrived a day early.";

it("reveals up to whole words, and more of them the further it is behind", () => {
  const one = nextReveal(words, 0, "en");
  expect(words.slice(0, one)).toBe("The");
  const two = nextReveal(words, one, "en");
  expect(words.slice(0, two)).toBe("The first");
  // Far behind, it catches up by several words a frame.
  const long = `${words} `.repeat(20);
  const step = nextReveal(long, 0, "en");
  expect(long.slice(0, step).trim().split(/\s+/).length).toBeGreaterThan(2);
  expect(/\S$/.test(long.slice(0, step))).toBe(true);
  expect(nextReveal(words, words.length, "en")).toBe(words.length);
});

it("finds word boundaries in Chinese text", () => {
  const text = "订单周一发货，提前一天送达。";
  const next = nextReveal(text, 0, "zh-CN");
  expect(next).toBeGreaterThan(0);
  expect(next).toBeLessThan(text.length);
});

it("types a reply being written out over frames", async () => {
  const { container } = render(<Markdown text={words} writing />);
  const first = container.textContent ?? "";
  expect(first.length).toBeLessThan(words.length);
  await waitFor(() => expect(container.textContent).toBe(words), {
    timeout: 3000,
  });
});

it("shows a finished reply whole at once", () => {
  const { container } = render(<Markdown text={words} />);
  expect(container.textContent).toBe(words);
});

it("shows the text whole at once with reduced motion", () => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("reduce"),
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
  const { container } = render(<Markdown text={words} writing />);
  expect(container.textContent).toBe(words);
  expect(
    container.querySelector(".wp-markdown")?.hasAttribute("data-fade"),
  ).toBe(true);
});
