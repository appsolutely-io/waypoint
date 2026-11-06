// @vitest-environment jsdom
// A reply's sources are cited inline and can be opened; the list of them
// is supporting detail behind a disclosure.
import { it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

const reply: Message = {
  id: "a",
  role: "assistant",
  content:
    "Order 1042 shipped on Monday [1] and 1043 waits for stock [2]. See [3].",
  blocks: [],
  createdAt: 1,
  status: "completed",
  sources: [
    { id: "s1", title: "Order 1042", url: "https://example.test/orders/1042" },
    { id: "s2", title: "Stock report", url: "https://example.test/stock" },
  ],
};

async function chat(message: Message, locale?: string) {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [message],
      }),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} locale={locale} />);
  return client;
}

it("links each cited number to its source, named for assistive technology", async () => {
  const client = await chat(reply);
  const first = await screen.findByRole(
    "link",
    { name: "Source 1: Order 1042" },
    { timeout: 5000 },
  );
  expect(first.getAttribute("href")).toBe("https://example.test/orders/1042");
  expect(first.textContent).toBe("[1]");
  expect(
    screen.getByRole("link", { name: "Source 2: Stock report" }),
  ).toBeTruthy();
  // A number with no source stays text.
  expect(screen.queryByRole("link", { name: /Source 3/ })).toBeNull();
  client.dispose();
});

it("lists the sources behind a disclosure under the answer", async () => {
  const client = await chat(reply);
  const details = await screen.findByRole(
    "group",
    { name: "Sources (2)" },
    { timeout: 5000 },
  );
  expect(details.hasAttribute("open")).toBe(false);
  const links = within(details).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    "Order 1042",
    "Stock report",
  ]);
  client.dispose();
});

it("names sources in Simplified Chinese and never links an unsafe address", async () => {
  const client = await chat(
    {
      ...reply,
      sources: [{ id: "s1", title: "危险", url: "javascript:alert(1)" }],
      content: "见 [1]。",
    },
    "zh-CN",
  );
  await screen.findByRole("group", { name: "来源（1）" }, { timeout: 5000 });
  expect(screen.queryByRole("link")).toBeNull();
  client.dispose();
});

// Every address that reaches the page passes the same allow-list.
function hrefs(): string[] {
  return [...document.querySelectorAll("a[href]")].map((link) =>
    link.getAttribute("href")!,
  );
}

it.each([
  ["data:text/html,<script>alert(1)</script>"],
  ["javascript:alert(1)"],
])(
  "never turns text written as a citation link into a link to an unsafe source (%s)",
  async (url) => {
    const client = await chat({
      ...reply,
      content: "Click [here](#wp-cite-1) or cite [1], then [2].",
      sources: [
        { id: "s1", title: "Unsafe", url },
        { id: "s2", title: "Stock report", url: "https://example.test/stock" },
      ],
    });
    await screen.findByRole(
      "link",
      { name: "Source 2: Stock report" },
      { timeout: 5000 },
    );
    expect(hrefs().filter((href) => /^(data|javascript):/i.test(href))).toEqual(
      [],
    );
    // Text that only looks like a citation is not named as one.
    expect(screen.queryByRole("link", { name: /Source 1/ })).toBeNull();
    client.dispose();
  },
);

it("leaves a citation number inside code as written", async () => {
  const client = await chat({
    ...reply,
    content:
      "Use `arr[2]` here [1].\n\n```\nx = arr[2]\n```\n\nSee [the stock [2]](https://example.test/x).",
  });
  await screen.findByRole(
    "link",
    { name: "Source 1: Order 1042" },
    { timeout: 5000 },
  );
  const code = [...document.querySelectorAll(".wp-markdown code")].map(
    (node) => node.textContent,
  );
  expect(code).toEqual(["arr[2]", "x = arr[2]\n"]);
  // A number inside a link's own text is not a second link inside it.
  expect(document.querySelectorAll(".wp-markdown a a")).toHaveLength(0);
  client.dispose();
});
