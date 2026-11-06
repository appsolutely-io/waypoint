// @vitest-environment jsdom
import { it, expect } from "vitest";
import { render } from "@testing-library/react";
import Markdown from "../../src/react/markdown";
it("raw HTML remains text and script links are refused", () => {
  const view = render(
    <Markdown
      text={
        "<img src=x onerror=alert(1)> [Bad](javascript:alert) [Good](https://example.test)"
      }
    />,
  );
  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.querySelectorAll("a")).toHaveLength(1);
  expect(view.container.querySelector("a")?.href).toBe("https://example.test/");
});
it("renders CommonMark headings, emphasis and lists", () => {
  const view = render(
    <Markdown text={"# Heading\n\n**Strong**\n\n- First\n- Second"} />,
  );
  expect(view.container.querySelector("h1")?.textContent).toBe("Heading");
  expect(view.container.querySelector("strong")?.textContent).toBe("Strong");
  expect(view.container.querySelectorAll("li")).toHaveLength(2);
});
it("does not load remote Markdown images by default", () => {
  const view = render(<Markdown text="![](https://evil/?q=x)" />);
  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.querySelector("a")?.getAttribute("href")).toBe(
    "https://evil/?q=x",
  );
});
it("hosts may explicitly permit same-origin or allowlisted Markdown images", () => {
  const view = render(
    <Markdown
      images={{
        origin: "https://example.test",
        allow: (url) => url === "https://images.example.test/a.png",
      }}
      text="![Local](/a.png) ![Allowed](https://images.example.test/a.png) ![Blocked](https://evil/a.png)"
    />,
  );
  expect(
    [...view.container.querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    ),
  ).toEqual(["/a.png", "https://images.example.test/a.png"]);
});
