// @vitest-environment jsdom
// Every message shows who wrote it, first in its bubble, and its article is
// named by its sender whatever the bubble renders.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { antdSkin } from "../../src/skin-antd/index";
import { showGreeting as chat } from "../support/greeting";

afterEach(cleanup);

describe.each([
  ["neutral", {}],
  ["antd", antdSkin],
])("the sender of each message (%s)", (_, skin) => {
  const senderOf = (article: HTMLElement) => {
    const bubble = article.querySelector('[data-part="bubble"]')!;
    return bubble.firstElementChild as HTMLElement;
  };
  it("shows the sender first in the bubble, and names the article by it", async () => {
    const client = await chat(skin);
    // The text comes from the markdown chunk, loaded on first use.
    await screen.findByText("Hello", {}, { timeout: 5000 });
    await screen.findByText("Hi there");
    for (const [name, text] of [
      ["You", "Hello"],
      ["Assistant", "Hi there"],
    ]) {
      const article = screen.getByRole("article", { name });
      const sender = senderOf(article);
      expect(sender.textContent).toBe(name);
      // Shown, but said once: the article's name already says it.
      expect(sender.getAttribute("aria-hidden")).toBe("true");
      expect(
        sender.parentElement!.textContent!.startsWith(`${name}${text}`),
      ).toBe(true);
    }
    client.dispose();
  });
  it("a message being sent shows its sender too", async () => {
    const client = await chat(skin);
    await screen.findByText("Hello");
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Ship it" },
    });
    await act(async () => {
      void client.send();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const pending = document.querySelector<HTMLElement>(
      'article[data-role="pending"]',
    )!;
    const sender = senderOf(pending);
    expect(sender.textContent).toBe("You");
    expect(sender.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByRole("article", { name: "You" })).toContain(pending);
    client.dispose();
  });
});

// Message ids are any strings: one may end the way another's derived ids do.
describe.each([
  ["assistant first", ["u-sender", "u"]],
  ["user first", ["u", "u-sender"]],
])("ids that could collide (%s)", (_, ids) => {
  it("each article keeps its own sender's name", async () => {
    const byId: Record<string, object> = {
      u: { id: "u", role: "user", content: "Hello", blocks: [], createdAt: 1 },
      "u-sender": {
        id: "u-sender",
        role: "assistant",
        content: "Hi there",
        blocks: [],
        createdAt: 2,
        status: "completed",
      },
    };
    const client = await chat(
      {},
      undefined,
      ids.map((id) => byId[id]!),
    );
    await screen.findByText("Hello", {}, { timeout: 5000 });
    expect(screen.getByRole("article", { name: "You" }).textContent).toContain(
      "Hello",
    );
    expect(
      screen.getByRole("article", { name: "Assistant" }).textContent,
    ).toContain("Hi there");
    client.dispose();
  });
});

// A host's own bubble may render the message without the stock children.
describe.each([
  [
    "slot",
    {
      slots: {
        bubble: (props: { data?: { message?: { content: string } } }) => (
          <p>{props.data?.message?.content}</p>
        ),
      },
    },
  ],
  [
    "part",
    {
      parts: {
        bubble: (props: { data?: { message?: { content: string } } }) => (
          <p>{props.data?.message?.content}</p>
        ),
      },
    },
  ],
])("a replaced bubble (%s)", (_, extra) => {
  it("leaves each article named by its sender", async () => {
    const client = await chat(extra);
    await screen.findByText("Hello");
    expect(screen.getByRole("article", { name: "You" }).textContent).toContain(
      "Hello",
    );
    expect(
      screen.getByRole("article", { name: "Assistant" }).textContent,
    ).toContain("Hi there");
    client.dispose();
  });
});
