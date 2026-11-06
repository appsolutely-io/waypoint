// @vitest-environment jsdom
// What the transcript shows about each message: the outline's labels and
// excerpts (only text the rendered message shows), unknown widgets, step
// arrows, and the catalogue texts they use.
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
import userEvent from "@testing-library/user-event";
import { WaypointChat, type PartProps } from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { english, simplifiedChinese } from "../../src/react/i18n";
import { excerpt } from "../../src/react/excerpt";
import StockMarkdown, { visibleText } from "../../src/react/markdown";
import { createWaypointClient } from "../../src/core/client";
import type {
  Block,
  Conversation,
  Message,
  PlanRecord,
} from "../../src/protocol/generated";
import samples from "../protocol/samples.json";
import { config } from "../support/client";

afterEach(cleanup);
const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
let next = 0;
const message = (
  content: string,
  role: Message["role"] = "assistant",
  blocks: Block[] = [],
): Message =>
  ({
    id: `m-${++next}`,
    role,
    content,
    blocks,
    createdAt: next,
    status: "completed",
  }) as Message;
async function chat(
  messages: Message[],
  props: object = {},
  conversationId = "conversation-a",
) {
  const base = config();
  let shown = messages;
  const client = createWaypointClient({
    ...base,
    conversationId,
    transport: {
      ...base.transport,
      read: async (id) =>
        ({
          protocol: "1.0",
          id,
          title: id,
          messages: id === conversationId ? shown : [],
        }) as Conversation,
    },
  });
  await client.ready;
  const view = render(<WaypointChat client={client} {...props} />);
  await waitFor(() =>
    expect(client.getSnapshot().conversation?.id).toBe(conversationId),
  );
  return {
    client,
    view,
    set: async (messages: Message[]) => {
      shown = messages;
      await act(async () => {
        await client.refresh();
      });
    },
  };
}
const outlineToggle = () =>
  screen.queryByRole("button", { name: english["chat.outline"] });
const outlineLinks = () => [
  ...document.querySelectorAll<HTMLAnchorElement>(
    `#${outlineToggle()!.getAttribute("aria-controls")} a`,
  ),
];
const openOutline = () => {
  if (outlineToggle()!.getAttribute("aria-expanded") !== "true")
    fireEvent.click(outlineToggle()!);
};
const linkLabels = () => outlineLinks().map((link) => link.textContent);

describe.each(skins)("the outline (%s)", (_, skin) => {
  it("CK-O1 the outline is a collapsed disclosure, opened with Enter and closed with Space", async () => {
    await chat([message("Hello")], skin);
    const toggle = outlineToggle()!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(list).not.toBeNull();
    expect(outlineLinks()).toEqual([]);
    const user = userEvent.setup();
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(outlineLinks()).toHaveLength(1);
    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
  it("CK-O2 one link per message, in order, with role, position and excerpt, distinct for repeated and empty texts", async () => {
    const messages = [
      message("Hi   there", "user"),
      message("Hello **world**"),
      message("", "assistant", [
        { type: "notice", id: "n", fallback: "Note", body: {} } as never,
      ]),
      message(""),
      message("Hello **world**"),
    ];
    await chat(messages, skin);
    openOutline();
    await waitFor(() =>
      expect(linkLabels()).toEqual([
        "You, message 1: Hi there",
        "Assistant, message 2: Hello world",
        "Assistant, message 3",
        "Assistant, message 4",
        "Assistant, message 5: Hello world",
      ]),
    );
    const targets = outlineLinks().map((link) => link.getAttribute("href"));
    expect(new Set(targets).size).toBe(5);
    for (const [index, target] of targets.entries())
      expect(
        document.querySelector(target!)?.getAttribute("data-message-id"),
      ).toBe(messages[index]!.id);
  });
  it("CK-O2-zh labels in Simplified Chinese", async () => {
    await chat([message("你好", "user")], { ...skin, locale: "zh-CN" });
    const toggle = screen.getByRole("button", {
      name: simplifiedChinese["chat.outline"],
    });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        document.querySelector(`#${toggle.getAttribute("aria-controls")} a`)
          ?.textContent,
      ).toBe("你，第 1 条：你好"),
    );
  });
  it("CK-O3 no messages, no outline", async () => {
    await chat([], skin);
    expect(outlineToggle()).toBeNull();
  });
  it("CK-O4 an expanded outline stays expanded while the conversation is shown, and collapses on a switch", async () => {
    const { client, set } = await chat([message("One")], skin);
    openOutline();
    await set([message("One"), message("Two")]);
    expect(outlineToggle()!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      await client.switchConversation("conversation-a");
    });
    await act(async () => {
      await client.switchConversation("conversation-b");
    });
    await act(async () => {
      await client.switchConversation("conversation-a");
    });
    expect(outlineToggle()?.getAttribute("aria-expanded") ?? "false").toBe(
      "false",
    );
  });
});

describe("visible text and excerpts", () => {
  it("CK-E1 only text the stock renderer shows: no comments, raw HTML, reference definitions, link or image destinations", () => {
    const source = [
      "<!-- HIDDEN-COMMENT -->",
      // An HTML block is one raw node the renderer skips; text between inline
      // tags is shown, so it is visible text.
      "<div>HIDDEN-HTML</div>",
      "",
      "Public reply with `code` and a [long link label](https://example.com/HIDDEN-LINK/very/long).",
      "",
      "![Chart alt](https://images.invalid/HIDDEN-IMAGE.png)",
      "",
      "[unused]: https://example.com/HIDDEN-DEFINITION",
      "",
      "Inline <b>tagged</b> text",
    ].join("\n");
    const text = visibleText(source);
    expect(text).toContain("Public reply with code and a long link label.");
    expect(text).toContain("Chart alt");
    expect(text).toContain("Inline tagged text");
    expect(text).not.toMatch(/HIDDEN/);
    // Every word of it is shown by the renderer itself.
    const { container } = render(<StockMarkdown text={source} />);
    const shown = container.textContent ?? "";
    for (const word of text.split(" ")) expect(shown).toContain(word);
  });
  it("CK-E1-shown an image the renderer shows contributes no alt text", () => {
    expect(
      visibleText("Look ![Secret alt](/same-origin.png)", {
        images: { origin: "https://app.test" },
      }),
    ).toBe("Look");
  });
  it.each([
    ["full", "Look ![Secret alt][image]\n\n[image]: /same-origin.png"],
    ["collapsed", "Look ![Secret alt][]\n\n[secret ALT]: /same-origin.png"],
    ["shortcut", "Look ![Secret alt]\n\n[Secret Alt]: /same-origin.png"],
  ])(
    "CK-E1-reference a %s image reference the renderer shows contributes no alt text",
    (_, source) => {
      const policy = { images: { origin: "https://app.test" } };
      expect(visibleText(source, policy)).toBe("Look");
      // Shown as a link (no image policy): its alt text is its label.
      expect(visibleText(source)).toBe("Look Secret alt");
      // The renderer agrees: an image, and no alt text in the body.
      const { container } = render(<StockMarkdown text={source} {...policy} />);
      expect(container.querySelector("img")).not.toBeNull();
      expect(container.textContent).not.toContain("Secret alt");
    },
  );
  it.each([
    [
      "an inline destination with a space",
      "Look ![Secret alt](</image one.png>)",
    ],
    [
      "an inline destination with a backslash",
      "Look ![Secret alt](</image\\one.png>)",
    ],
    [
      "a reference destination with a space",
      "Look ![Secret alt][i]\n\n[i]: </image one.png>",
    ],
    ["an encoded destination", "Look ![Secret alt](/image%20one.png)"],
  ])(
    "CK-E1-normalized %s, shown as an image, contributes no alt text",
    (_, source) => {
      const policy = { images: { origin: "https://app.test" } };
      const { container } = render(<StockMarkdown text={source} {...policy} />);
      expect(container.querySelector("img")).not.toBeNull();
      expect(visibleText(source, policy)).toBe("Look");
    },
  );
  it("CK-E3 whitespace collapsed and directional formatting removed", () => {
    expect(excerpt("  a‮b \n\t c⁦d⁩  ")).toBe("ab cd");
  });
  it.each([
    ["a combining sequence", "é"],
    ["a skin-tone modifier", "👍🏽"],
    ["a flag", "🇳🇿"],
    ["a ZWJ family", "👨‍👩‍👧"],
    ["a surrogate pair", "𝄞"],
  ])("CK-E4 a cut at %s keeps the whole grapheme", (_, cluster) => {
    const text = "a".repeat(119) + cluster + "tail";
    expect(excerpt(text)).toBe("a".repeat(119) + cluster + "…");
    expect(excerpt("a".repeat(120))).toBe("a".repeat(120));
  });
  it("CK-E5 without Intl.Segmenter there is no excerpt", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
    try {
      // A runtime without it.
      Reflect.deleteProperty(Intl, "Segmenter");
      expect(excerpt("Hello")).toBeUndefined();
    } finally {
      Object.defineProperty(Intl, "Segmenter", descriptor);
    }
  });
  it("CK-E6 nothing visible, no excerpt", () => {
    expect(excerpt("   ")).toBeUndefined();
    expect(excerpt(visibleText("<!-- only a comment -->"))).toBeUndefined();
  });
  it("CK-E7 the outline isolates each excerpt's direction", async () => {
    await chat([message("مرحبا ⁧abc")]);
    openOutline();
    await waitFor(() =>
      expect(outlineLinks()[0]!.querySelector("bdi")?.textContent).toBe(
        "مرحبا abc",
      ),
    );
  });
});

const hidden = "Visible start HIDDEN-REDACTED";
describe("a normalized image destination in the outline", () => {
  it("CK-E1-normalized a shown image written with a space gives its label no alt text", async () => {
    await chat([message("Look ![Secret alt](</image one.png>)")], {
      markdownImages: { origin: window.location.origin },
    });
    openOutline();
    await waitFor(() =>
      expect(linkLabels()).toEqual(["Assistant, message 1: Look"]),
    );
  });
});

describe("an image reference in the outline", () => {
  it("CK-E1-reference a displayed referenced image's alt text is not in its label; a link's is", async () => {
    const source = "Look ![Secret alt][image]\n\n[image]: /same-origin.png";
    await chat([message(source)], {
      markdownImages: { origin: window.location.origin },
    });
    openOutline();
    await waitFor(() =>
      expect(linkLabels()).toEqual(["Assistant, message 1: Look"]),
    );
    cleanup();
    await chat([message(source)]);
    openOutline();
    await waitFor(() =>
      expect(linkLabels()).toEqual(["Assistant, message 1: Look Secret alt"]),
    );
  });
});

describe.each(skins)("visibility-unknown boundaries (%s)", (_, skin) => {
  const cases: [string, object][] = [
    [
      "a host Markdown renderer",
      {
        renderers: {
          markdown: ({ text }: { text: string }) => (
            <span>{text.replace(/HIDDEN-\w+/, "")}</span>
          ),
        },
      },
    ],
    [
      "a bubble part",
      {
        parts: {
          bubble: () => <span>Redacted</span>,
        },
      },
    ],
    [
      "a bubble slot",
      {
        slots: {
          bubble: () => <span>Redacted</span>,
        },
      },
    ],
    [
      "a transcript slot keeping the stock children with a withheld bubble",
      {
        slots: {
          transcript: (props: PartProps) => <>{props.children}</>,
          bubble: () => <span>Redacted</span>,
        },
      },
    ],
  ];
  it.each(cases)(
    "CK-E2 %s: the outline shows the plain label, never the hidden text",
    async (_, extra) => {
      await chat([message(hidden)], { ...skin, ...extra });
      openOutline();
      await waitFor(() => expect(outlineLinks()).toHaveLength(1));
      const link = outlineLinks()[0]!;
      expect(link.textContent).toBe("Assistant, message 1");
      expect(link.getAttribute("aria-label") ?? "").not.toMatch(/HIDDEN/);
      expect(document.body.textContent).not.toMatch(/HIDDEN-REDACTED/);
    },
  );
  it.each([
    [
      "a transcript slot",
      { slots: { transcript: (props: PartProps) => <>{props.children}</> } },
    ],
    [
      "a transcript part",
      { parts: { transcript: (props: PartProps) => <>{props.children}</> } },
    ],
  ])(
    "CK-E2 %s alone: the chat cannot tell what is shown, so the outline is plain",
    async (_, extra) => {
      await chat([message(hidden)], { ...skin, ...extra });
      openOutline();
      await waitFor(() => expect(outlineLinks()).toHaveLength(1));
      // Give the parser time to load: the label must stay plain.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const link = outlineLinks()[0]!;
      expect(link.textContent).toBe("Assistant, message 1");
      expect(link.getAttribute("aria-label") ?? "").not.toMatch(/HIDDEN/);
    },
  );
  it.each(cases)(
    "CK-E2-host %s with messageExcerpt: the outline uses only the host text",
    async (_, extra) => {
      await chat([message(hidden)], {
        ...skin,
        ...extra,
        messageExcerpt: () => "Host summary",
      });
      openOutline();
      await waitFor(() =>
        expect(linkLabels()).toEqual(["Assistant, message 1: Host summary"]),
      );
    },
  );
});

describe.each(skins)("widgets without a renderer (%s)", (_, skin) => {
  const unknown = (fallback: string): Block =>
    ({
      type: "x-unknown",
      id: "x",
      fallback,
      body: { html: "<img src=x>HOSTILE-BODY" },
    }) as unknown as Block;
  it("CK-W1 a registered widget renders", async () => {
    await chat([message("", "assistant", [unknown("Readable")])], {
      ...skin,
      widgets: [{ type: "x-unknown", render: () => <p>Custom widget</p> }],
    });
    await waitFor(() => expect(screen.getByText("Custom widget")).toBeTruthy());
  });
  it("CK-W2 a usable fallback is shown as text and nothing else", async () => {
    await chat(
      [message("", "assistant", [unknown("Readable fallback")])],
      skin,
    );
    await waitFor(() =>
      expect(screen.getByText("Readable fallback")).toBeTruthy(),
    );
    expect(document.body.textContent).not.toContain(english["chat.update"]);
    expect(document.body.textContent).not.toContain(english.unsupportedContent);
    expect(document.body.innerHTML).not.toContain("HOSTILE-BODY");
  });
  it.each([
    ["empty", ""],
    ["whitespace only", "  \n "],
  ])(
    "CK-W3 a fallback that is %s shows the unsupported-content guidance",
    async (_, fallback) => {
      await chat([message("", "assistant", [unknown(fallback)])], skin);
      await waitFor(() =>
        expect(screen.getByText(english.unsupportedContent)).toBeTruthy(),
      );
      expect(document.body.textContent).not.toContain(english["chat.update"]);
      expect(document.body.innerHTML).not.toContain("HOSTILE-BODY");
    },
  );
  it("CK-W4 markup in a fallback stays text", async () => {
    await chat([message("", "assistant", [unknown("<b>Bold?</b>")])], skin);
    await waitFor(() => expect(screen.getByText("<b>Bold?</b>")).toBeTruthy());
    expect(document.querySelector("b")).toBeNull();
  });
});

describe("names and catalogue texts", () => {
  it("CK-L2 the arrow between before and after values is decorative, read as 'changes to'", async () => {
    const base = config();
    const client = createWaypointClient(base);
    await client.ready;
    const record = structuredClone(samples.PlanRecord) as PlanRecord;
    client.setPlan(record);
    render(<WaypointChat client={client} />);
    const row = await waitFor(() => {
      const found = document.querySelector('[data-part="stepRow"] dd');
      expect(found).not.toBeNull();
      return found!;
    });
    const arrow = [...row.querySelectorAll("span")].find(
      (span) => span.textContent === "→",
    );
    expect(arrow?.getAttribute("aria-hidden")).toBe("true");
    expect(
      within(row as HTMLElement).getByText(english["chat.changesTo"]),
    ).toBeTruthy();
  });
  const zh: Record<string, string> = {
    "chat.transcript": "消息",
    "chat.outlineItem": "{role}，第 {position} 条：{excerpt}",
    "chat.outlineItemPlain": "{role}，第 {position} 条",
    "chat.roleUser": "你",
    "chat.roleAssistant": "助手",
    "chat.messageLoading": "正在加载消息……",
    "chat.messageUnavailable": "暂时无法显示此消息。",
    "chat.arrival": "收到新回复",
    "chat.arrivalExcerpt": "收到新回复：{excerpt}",
    "chat.arrivalFailed": "有一条回复未能完成。",
    "chat.arrivalMany": "收到 {count} 条新回复。最新一条：{excerpt}",
    "chat.arrivalManyPlain": "收到 {count} 条新回复",
    "chat.arrivalManyFailed":
      "收到 {count} 条新回复，其中 {failed} 条未能完成。",
    "chat.arrivalAllFailed": "{count} 条回复未能完成。",
    "chat.changesTo": "改为",
    unsupportedContent: "此处无法显示部分内容。请联系站点管理员。",
    "chat.update": "此对话需要更新后才能继续使用。",
    "chat.conversationUnavailable":
      "此对话暂时无法使用。请重新加载后继续；重新加载不会停止服务器正在处理的回复。",
    "form.threads": "子对话",
  };
  it("CK-L3 every new and changed key reads in English and natural Simplified Chinese", () => {
    for (const [key, text] of Object.entries(zh)) {
      expect([
        key,
        simplifiedChinese[key as keyof typeof simplifiedChinese],
      ]).toEqual([key, text]);
      expect(english[key as keyof typeof english]).toBeTruthy();
    }
    expect(english["chat.arrival"]).toBe("New reply");
    expect(english.unsupportedContent).toBe(
      "Some content cannot be shown here. Contact the site administrator.",
    );
  });
});

describe("the host excerpt option", () => {
  it("CK-U2 messageExcerpt is trimmed, cut and isolated like any excerpt", async () => {
    await chat([message("x")], {
      renderers: { markdown: () => <span>x</span> },
      messageExcerpt: () => "  Host ‮" + "b".repeat(130) + "  ",
    });
    openOutline();
    await waitFor(() => expect(outlineLinks()).toHaveLength(1));
    const bdi = outlineLinks()[0]!.querySelector("bdi")!;
    expect(bdi.textContent).toBe("Host " + "b".repeat(115) + "…");
  });
});
