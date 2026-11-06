// A chat with content that tends to overflow (a long word, a long URL, a
// wide code line and a wide table), a conversation list and a reply row,
// for reflow and target-size checks. Query parameters: skin, layout,
// width (the container's width in px), text (the root's font size in %),
// scheme (light or dark; the system's when absent), antdSize (small,
// middle, large), compact, many (60 conversations), threads (the last
// conversation has a thread),
// railFails (the conversation list cannot be read), form (a message with a
// required form field), plan (a plan in the aside), reference (an antd
// button outside the chat, at the host's size) and prose (paragraphs,
// a soft break, indented code, a wide image, a wide table and a task
// list), quote (a block quote holding a table), theme (a host `theme`
// with its own muted colour) and norail (no conversation list).
import { createRoot } from "react-dom/client";
import { Button, ConfigProvider, theme } from "antd";
import {
  createWaypointClient,
  type Conversation,
  type PlanRecord,
} from "../../src/index";
import samples from "../protocol/samples.json";
import { WaypointChat } from "../../src/react/index";
import { createTestPlatform } from "../../src/testing/transport";
import { antdSkin } from "../../src/skin-antd/index";
import "../../src/react/styles.css";

const params = new URLSearchParams(location.search);
const word = "Supercalifragilistic".repeat(10);
const conversation: Conversation = {
  protocol: "1.0",
  id: "layout",
  title: "Layout",
  messages: [
    {
      id: "u1",
      role: "user",
      // A link, which must stay legible on the user's tinted bubble.
      content: "Show me everything in [the guide](https://example.test/guide)",
      createdAt: 1,
      blocks: [],
    },
    {
      id: "a1",
      role: "assistant",
      content: [
        `A long word: ${word}`,
        "",
        `A long link: https://example.test/${"segment/".repeat(30)}`,
        "",
        "```",
        `const line = "${"x".repeat(240)}";`,
        "```",
      ].join("\n"),
      createdAt: 2,
      status: "completed",
      blocks: [
        {
          type: "table",
          id: "t1",
          fallback: "A table",
          body: {
            columns: Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`),
            rows: [Array.from({ length: 12 }, (_, i) => `Value ${i + 1}`)],
          },
        } as never,
      ],
    },
    {
      id: "u2",
      role: "user",
      content: "And a reply row?",
      createdAt: Date.now(),
      blocks: [],
    },
  ],
};
// Prose for block spacing, a soft line break, indented code and an image
// wider than any bubble.
if (params.get("prose"))
  conversation.messages.push({
    id: "a3",
    role: "assistant",
    content: [
      "First paragraph.",
      "",
      "Second paragraph.",
      "",
      "line one",
      "line two",
      "",
      "```",
      "    indented code",
      "```",
      "",
      "![A wide picture](/tests/browser/wide.svg)",
      "",
      "| Department | Responsibility | Infrastructure | Administration |",
      "| --- | --- | --- | --- |",
      "| Engineering | Supercalifragilistic | Datacentres | Procurement |",
      "",
      "- [x] Shipped",
      "- [ ] Planned",
    ].join("\n"),
    createdAt: 4,
    status: "completed",
    blocks: [],
  });
// A block quote holding a table, which must fit a narrow bubble.
if (params.get("quote"))
  conversation.messages.push({
    id: "a4",
    role: "assistant",
    content: [
      "> Quoted line.",
      ">",
      "> | Owner | Status |",
      "> | --- | --- |",
      "> | Platform | Shipped |",
    ].join("\n"),
    createdAt: 5,
    status: "completed",
    blocks: [],
  });
// A required form field, for an unavailable Submit.
if (params.get("form"))
  conversation.messages.push({
    id: "a2",
    role: "assistant",
    content: "",
    createdAt: 3,
    status: "completed",
    blocks: [
      {
        type: "form",
        id: "f1",
        fallback: "A form",
        body: { fields: [{ name: "title", label: "Title", required: true }] },
      } as never,
    ],
  });
const client = createWaypointClient({
  accountId: "layout-account",
  conversationId: "layout",
  platform: createTestPlatform(),
  transport: {
    negotiate: async () => ({
      protocol: "1.0",
      capabilities: params.get("plan") ? ["widgets", "plans"] : ["widgets"],
    }),
    read: async () => structuredClone(conversation),
    subscribe: () => () => {},
    send: async () => {
      throw new Error("Not used");
    },
  } as never,
});
await client.ready;
// A plan in the aside, for the shell's third column.
if (params.get("plan"))
  client.setPlan(structuredClone(samples.PlanRecord) as PlanRecord);
if (params.get("text"))
  document.documentElement.style.fontSize = `${params.get("text")}%`;
const chat = (
  <div
    id="container"
    style={{
      inlineSize: params.get("width") ? `${params.get("width")}px` : "100%",
    }}
  >
    <WaypointChat
      client={client}
      layout={(params.get("layout") ?? "panel") as never}
      markdownImages={{ origin: location.origin }}
      // Without a scheme parameter the chat follows the system's.
      colorScheme={(params.get("scheme") ?? undefined) as never}
      // A host theme that only lightens the muted text, still 4.5:1 on the
      // surface but not on an accent-tinted one.
      theme={
        params.get("theme")
          ? { muted: params.get("scheme") === "dark" ? "#a8a8a8" : "#6b6b6b" }
          : undefined
      }
      conversationSource={
        params.get("railFails")
          ? {
              list: () => Promise.reject(new Error("offline")),
              create: () => Promise.reject(new Error("offline")),
            }
          : undefined
      }
      conversations={
        params.get("railFails") || params.get("norail")
          ? []
          : params.get("threads")
            ? [
                { id: "layout", title: "Layout" },
                { id: "other", title: "Another conversation" },
                {
                  id: "thread",
                  title: "A thread",
                  parentConversationId: "other",
                },
              ]
            : params.get("many")
              ? Array.from({ length: 60 }, (_, i) => ({
                  id: i ? `other-${i}` : "layout",
                  title: i ? `Conversation ${i}` : "Layout",
                }))
              : [
                  { id: "layout", title: "Layout" },
                  { id: "other", title: "Another conversation" },
                ]
      }
      {...(params.get("skin") === "antd" ? antdSkin : {})}
    />
  </div>
);
createRoot(document.getElementById("root")!).render(
  params.get("antdSize") || params.get("compact") ? (
    <ConfigProvider
      componentSize={(params.get("antdSize") ?? "middle") as never}
      theme={{
        algorithm: params.get("compact")
          ? theme.compactAlgorithm
          : theme.defaultAlgorithm,
      }}
    >
      {chat}
      {/* An antd button outside the chat, at the host's size: the height
          the skin's buttons keep. */}
      {params.get("reference") ? (
        <Button data-reference="">Reference</Button>
      ) : null}
    </ConfigProvider>
  ) : (
    chat
  ),
);
