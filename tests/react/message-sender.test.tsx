// @vitest-environment jsdom
// Every message shows who wrote it, first in its bubble, and its article is
// named by its sender whatever the bubble renders.
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { antdSkin } from "../../src/skin-antd/index";
import { showGreeting as chat } from "../support/greeting";
import { createWaypointClient } from "../../src/core/client";
import { WaypointChat } from "../../src/react/index";
import type { Message } from "../../src/protocol/generated";
import { config, createManualClock } from "../support/client";

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

const namedMessages = [
  {
    id: "a1",
    role: "assistant",
    content: "Reviewed",
    blocks: [],
    createdAt: 1,
    status: "completed",
    sender: { id: "r", name: "Reviewer", avatarUrl: "/reviewer.png" },
  },
  {
    id: "a2",
    role: "assistant",
    content: "Edited",
    blocks: [],
    createdAt: 2,
    status: "completed",
    sender: { id: "e", name: "Editor" },
  },
  {
    id: "n",
    role: "notice",
    content: "Review started",
    blocks: [],
    createdAt: 3,
    versionIndex: 1,
    versionCount: 2,
  },
];
it("distinct assistant senders have distinct visible and accessible names", async () => {
  const client = await chat({}, undefined, namedMessages);
  for (const name of ["Reviewer", "Editor", "Notice"]) {
    const article = await screen.findByRole("article", { name });
    expect(article.querySelector("[data-sender]")?.textContent).toBe(name);
  }
  client.dispose();
});
it("replacing a bubble preserves the article sender name", async () => {
  const client = await chat(
    { parts: { bubble: () => <p>Host body</p> } },
    undefined,
    namedMessages,
  );
  expect(
    screen
      .getByRole("article", { name: "Reviewer" })
      .querySelector('[data-part="bubble"]')?.textContent,
  ).toBe("Host body");
  client.dispose();
});
it("bubble and message actions receive independent sender data", async () => {
  const seen: { name: string; sender: { name: string } }[] = [];
  const capture =
    (name: string) =>
    (props: { data?: { message?: { sender?: { name: string } } } }) => {
      const sender = props.data?.message?.sender;
      if (sender) seen.push({ name, sender });
      return null;
    };
  const client = await chat(
    {
      parts: { bubble: capture("bubble"), messageActions: capture("actions") },
    },
    undefined,
    namedMessages,
  );
  await waitFor(() =>
    expect(seen.some((entry) => entry.name === "actions")).toBe(true),
  );
  const bubble = seen.find((entry) => entry.name === "bubble")!.sender;
  const actions = seen.find((entry) => entry.name === "actions")!.sender;
  expect(bubble).toEqual(namedMessages[0]!.sender);
  expect(actions).toEqual(bubble);
  expect(actions).not.toBe(bubble);
  bubble.name = "Changed part";
  expect(actions.name).toBe("Reviewer");
  expect(
    (
      client.getSnapshot().conversation?.messages[0] as unknown as {
        sender: { name: string };
      }
    ).sender.name,
  ).toBe("Reviewer");
  client.dispose();
});
it.each([
  [
    "unsafe avatar URLs leave the sender name visible",
    "javascript:alert(1)",
    { origin: "https://example.test" },
  ],
  [
    "disallowed cross-origin avatars leave the sender name visible",
    "https://other.test/a.png",
    { origin: "https://example.test" },
  ],
  ["avatars require explicit image permission", "/reviewer.png", undefined],
] as const)("%s", async (_name, avatarUrl, markdownImages) => {
  const client = await chat({ markdownImages }, undefined, [
    { ...namedMessages[0], sender: { id: "r", name: "Reviewer", avatarUrl } },
  ]);
  const article = screen.getByRole("article", { name: "Reviewer" });
  expect(article.querySelector("img")).toBeNull();
  expect(article.textContent).toContain("Reviewer");
  client.dispose();
});
it("avatars obey the Markdown image-origin and allow policy", async () => {
  const client = await chat(
    {
      markdownImages: {
        origin: "https://example.test",
        allow: (url: string) => url === "https://allowed.test/a.png",
      },
    },
    undefined,
    [
      {
        ...namedMessages[0],
        sender: {
          id: "r",
          name: "Reviewer",
          avatarUrl: "https://allowed.test/a.png",
        },
      },
    ],
  );
  const article = screen.getByRole("article", { name: "Reviewer" });
  expect(article.querySelector("img")?.getAttribute("src")).toBe(
    "https://allowed.test/a.png",
  );
  client.dispose();
});
it("sender avatars have empty alt and a capped token size", async () => {
  const client = await chat(
    { markdownImages: { origin: "https://example.test" } },
    undefined,
    namedMessages,
  );
  const image = screen
    .getByRole("article", { name: "Reviewer" })
    .querySelector("img");
  expect(image?.getAttribute("alt")).toBe("");
  expect(image?.getAttribute("data-avatar")).toBe("");
  expect(image?.getAttribute("width")).toBe("24");
  expect(image?.getAttribute("height")).toBe("24");
  client.dispose();
});
it("failed avatar images leave the sender name visible", async () => {
  const client = await chat(
    { markdownImages: { origin: "https://example.test" } },
    undefined,
    namedMessages,
  );
  const article = screen.getByRole("article", { name: "Reviewer" });
  const image = article.querySelector("img");
  expect(image).not.toBeNull();
  fireEvent.error(image!);
  expect(article.querySelector("img")).toBeNull();
  expect(article.textContent).toContain("Reviewer");
  client.dispose();
});
it("notice rows remain in feed positions outline anchors and storage", async () => {
  const client = await chat({}, undefined, namedMessages);
  const notice = screen.getByRole("article", { name: "Notice" });
  expect(notice.getAttribute("aria-posinset")).toBe("3");
  expect(notice.getAttribute("aria-setsize")).toBe("3");
  expect(notice.id).not.toBe("");
  expect(
    client
      .getSnapshot()
      .conversation?.messages.some((message) => message.id === "n"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Message outline" }));
  expect(
    await screen.findByRole("link", { name: /Notice.*Review started/ }),
  ).toBeTruthy();
  client.dispose();
});
it("a notice has Copy without conversational actions", async () => {
  const client = await chat({}, undefined, namedMessages);
  const notice = screen.getByRole("article", { name: "Notice" });
  await waitFor(() =>
    expect(within(notice).getByRole("button", { name: "Copy" })).toBeTruthy(),
  );
  expect(within(notice).queryByRole("button", { name: "Edit" })).toBeNull();
  expect(
    within(notice).queryByRole("button", { name: "Regenerate" }),
  ).toBeNull();
  expect(notice.querySelector("[data-version-walk]")).toBeNull();
  client.dispose();
});
it.each(["writing", "overdue"])(
  "a trailing notice preserves the %s assistant article's writing state",
  async (state) => {
    const base = config();
    const clock = createManualClock(1000);
    const client = createWaypointClient({
      ...base,
      platform: { ...base.platform, clock: clock.clock },
      transport: {
        ...base.transport,
        read: async () => ({
          protocol: "1.0",
          id: "conversation-a",
          title: "Chat",
          messages: [
            { ...namedMessages[0], status: "writing" },
            namedMessages[2]!,
          ] as Message[],
        }),
      },
    });
    await client.ready;
    render(<WaypointChat client={client} />);
    if (state === "overdue")
      await act(async () => {
        await clock.advance(15000);
      });
    expect(client.getSnapshot().replyState).toBe(
      state === "overdue" ? "overdue" : "writing",
    );
    expect(
      screen
        .getByRole("article", { name: "Reviewer" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    client.dispose();
  },
);
