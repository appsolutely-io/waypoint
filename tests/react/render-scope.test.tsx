// @vitest-environment jsdom
// What a change re-renders: a delta renders the message it writes into and
// no other, a keystroke in the composer renders no message, and a message's
// markdown is parsed once for each version of it.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { WaypointChat, type PartProps } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { TransportEvent } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

// Every parse of the stock renderer, by the text parsed.
const parses = vi.hoisted(() => [] as string[]);
vi.mock("react-markdown", async (original) => {
  const actual = await original<typeof import("react-markdown")>();
  const counted = (options: { children?: string }) => {
    parses.push(options.children ?? "");
    return actual.default(options);
  };
  return { ...actual, default: counted, Markdown: counted };
});

afterEach(cleanup);
beforeEach(() => {
  parses.length = 0;
});

type Listener = (event: TransportEvent) => void;
const message = (id: string, role: "user" | "assistant", content: string) =>
  ({
    id,
    role,
    content,
    blocks: [],
    createdAt: 0,
    status: "completed",
  }) as Message;
const history = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    message(
      `m${index}`,
      index % 2 ? "assistant" : "user",
      `Message **${index}** with \`code\``,
    ),
  );

async function chat(messages: Message[]) {
  const base = config();
  const shown: Record<string, Message[]> = { a: messages, b: history(2) };
  let listener: Listener | undefined;
  let sequence = 0;
  const client = createWaypointClient({
    ...base,
    conversationId: "a",
    transport: {
      ...base.transport,
      read: async (id) =>
        ({
          protocol: "1.0",
          id,
          title: id,
          messages: structuredClone(shown[id] ?? []),
        }) as Conversation,
      subscribe: (_id: string, on: Listener) => {
        listener = on;
        on({ type: "status", status: "open" } as TransportEvent);
        return () => {};
      },
    },
  });
  // Each bubble's renders, by message id.
  const renders = new Map<string, number>();
  const Bubble = (props: PartProps<"bubble">) => {
    const id =
      props.data && "message" in props.data ? props.data.message.id : "";
    if (id) renders.set(id, (renders.get(id) ?? 0) + 1);
    return <>{props.children}</>;
  };
  await client.ready;
  render(<WaypointChat client={client} parts={{ bubble: Bubble }} />);
  await waitFor(() =>
    expect(
      document.querySelectorAll("article[data-message-id] .wp-markdown").length,
    ).toBe(client.getSnapshot().conversation!.messages.length),
  );
  return {
    client,
    renders,
    rendered: () =>
      [...renders].filter(([, count]) => count > 0).map(([id]) => id),
    reset: () => renders.clear(),
    frame: async (frame: object) => {
      await act(async () => {
        listener!({
          type: "frame",
          frame: { protocol: "1.0", sequence: ++sequence, ...frame },
        } as TransportEvent);
      });
    },
  };
}

it("a delta renders the message it writes into and no other", async () => {
  const h = await chat(history(20));
  await h.frame({ type: "message.start", messageId: "s1", role: "assistant" });
  await h.frame({ type: "text.delta", messageId: "s1", text: "First" });
  h.reset();
  await h.frame({ type: "text.delta", messageId: "s1", text: " words" });
  expect(h.rendered()).toEqual(["s1"]);
  h.client.dispose();
});

it("a keystroke in the composer renders no message", async () => {
  const h = await chat(history(20));
  h.reset();
  await act(async () => {
    h.client.setDraft("h");
  });
  await act(async () => {
    h.client.setDraft("he");
  });
  expect(document.querySelector("textarea")!.value).toBe("he");
  expect(h.rendered()).toEqual([]);
  h.client.dispose();
});

it("an unchanged message's markdown is parsed once, through deltas and keystrokes", async () => {
  const h = await chat(history(10));
  await h.frame({ type: "message.start", messageId: "s1", role: "assistant" });
  for (const text of ["One", " two", " three"])
    await h.frame({ type: "text.delta", messageId: "s1", text });
  await act(async () => {
    h.client.setDraft("typing");
  });
  for (const shown of history(10))
    expect(parses.filter((text) => text === shown.content)).toHaveLength(1);
  h.client.dispose();
});

it("a message shown again after a switch is parsed again: its parse left with it", async () => {
  const h = await chat(history(4));
  await act(async () => {
    await h.client.switchConversation("b");
  });
  await act(async () => {
    await h.client.switchConversation("a");
  });
  await waitFor(() =>
    expect(document.querySelector('[data-message-id="m3"]')).not.toBeNull(),
  );
  await waitFor(() =>
    expect(
      parses.filter((text) => text === history(4)[3]!.content),
    ).toHaveLength(2),
  );
  h.client.dispose();
});
