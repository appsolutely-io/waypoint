// @vitest-environment jsdom
// While a reply is written, markers it has opened but not yet closed are
// closed for display, so no raw syntax flashes before its end arrives.
import { it, expect, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Markdown, { closeOpenMarkdown } from "../../src/react/markdown";
afterEach(cleanup);

it.each([
  ["Here is **bold", "Here is **bold**"],
  ["Some `code", "Some `code`"],
  ["A ~~struck", "A ~~struck~~"],
  ["```ts\nconst a = 1;", "```ts\nconst a = 1;\n```"],
  ["Done **bold** and `x`", "Done **bold** and `x`"],
  ["- a list\n- with **open", "- a list\n- with **open**"],
  ["```\n**not closed inside a fence", "```\n**not closed inside a fence\n```"],
  ["Escaped \\*\\* stays", "Escaped \\*\\* stays"],
])("closes %j for display", (text, closed) => {
  expect(closeOpenMarkdown(text)).toBe(closed);
});

it("renders an open bold as bold while writing, never as raw stars", async () => {
  const { container, rerender } = render(
    <Markdown text="Here is **bold" writing />,
  );
  expect(container.textContent).not.toContain("**");
  rerender(<Markdown text="Here is **bold and more" writing />);
  await vi.waitFor(() =>
    expect(container.querySelector("strong")?.textContent).toBe("bold"),
  );
  expect(container.textContent).not.toContain("**");
});

it("renders the text as it is once the reply is finished", () => {
  const { container } = render(<Markdown text="Here is **bold" />);
  expect(container.querySelector("strong")).toBeNull();
  expect(container.textContent).toContain("**bold");
});
