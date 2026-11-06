// @vitest-environment jsdom
// A reply being written costs what changed, not what came before: its
// finished blocks are parsed once, the reveal reads a bounded window of
// what is still to show, a host re-rendering above the chat renders no
// message again, and a hook can follow one message, a card lock or the
// plan without following every delta.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import Markdown, { nextReveal } from "../../src/react/markdown";
import { WaypointChat, type PartProps } from "../../src/react/index";
import {
  useBlockReply,
  usePlanView,
  useWaypointMessage,
  useWaypointSelector,
} from "../../src/hooks/index";
import { ClientContext } from "../../src/react/headless";
import { createWaypointClient } from "../../src/core/client";
import type { TransportEvent, WaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

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

const paragraphs = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `Paragraph ${index + 1} has **bold** and \`code\` words.`,
  ).join("\n\n");

it("while a reply is written, a finished block is parsed with no other", async () => {
  const text = paragraphs(30);
  const { container } = render(<Markdown text={text} writing />);
  await waitFor(
    () => expect(container.textContent).toContain("Paragraph 30 has"),
    { timeout: 10_000 },
  );
  // Every parse holds at most the block still open and the one it closed.
  const widest = Math.max(
    ...parses.map((parsed) => parsed.split("Paragraph ").length - 1),
  );
  expect(widest).toBeLessThanOrEqual(2);
  for (let index = 1; index < 29; index++)
    expect(
      parses.filter((parsed) => parsed.startsWith(`Paragraph ${index} has`))
        .length,
    ).toBeLessThan(12);
});

it("a fence still open keeps its blank lines in the open block", async () => {
  const text = "Before.\n\n```\nline one\n\nline two";
  const { container } = render(<Markdown text={text} writing />);
  await waitFor(() =>
    expect(container.querySelector("pre")?.textContent).toContain("line two"),
  );
  expect(container.querySelectorAll("pre")).toHaveLength(1);
  expect(container.querySelector("pre")!.textContent).toContain("line one");
});

it("the reveal reads a bounded window of what is still to show", () => {
  const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
  const long = "word ".repeat(200_000);
  const at = nextReveal(long, 10);
  expect(at).toBeGreaterThan(10);
  for (const [input] of segment.mock.calls)
    expect(input.length).toBeLessThanOrEqual(4096);
  segment.mockRestore();
});

type Listener = (event: TransportEvent) => void;
const message = (id: string, role: "user" | "assistant") =>
  ({
    id,
    role,
    content: `Message ${id}`,
    blocks: [],
    createdAt: 0,
    status: "completed",
  }) as Message;

async function streaming() {
  const base = config();
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
          messages: [message("m1", "user"), message("m2", "assistant")],
        }) as Conversation,
      subscribe: (_id: string, on: Listener) => {
        listener = on;
        on({ type: "status", status: "open" } as TransportEvent);
        return () => {};
      },
    },
  });
  await client.ready;
  const frame = async (value: object) => {
    await act(async () => {
      listener!({
        type: "frame",
        frame: { protocol: "1.0", sequence: ++sequence, ...value },
      } as TransportEvent);
    });
  };
  return { client, frame };
}

it("a host re-rendering above the chat renders no message again", async () => {
  const { client, frame } = await streaming();
  const renders: string[] = [];
  const parts = {
    bubble: (props: PartProps<"bubble">) => {
      if (props.data && "message" in props.data)
        renders.push(props.data.message.id);
      return <>{props.children}</>;
    },
  };
  let rerender: () => void = () => {};
  function Host() {
    const [, set] = useState(0);
    rerender = () => set((count) => count + 1);
    return <WaypointChat client={client} parts={parts} locale="en" />;
  }
  render(<Host />);
  await waitFor(() =>
    expect(document.querySelector('[data-message-id="m2"]')).not.toBeNull(),
  );
  await frame({ type: "message.start", messageId: "s1", role: "assistant" });
  renders.length = 0;
  await act(async () => rerender());
  await act(async () => rerender());
  expect(renders).toEqual([]);
  client.dispose();
});

function counted(client: WaypointClient, use: () => unknown) {
  const renders = { count: 0 };
  function Probe(): ReactNode {
    use();
    renders.count++;
    return null;
  }
  render(
    <ClientContext.Provider value={client}>
      <Probe />
    </ClientContext.Provider>,
  );
  return renders;
}

it("hooks follow what they read, not every delta", async () => {
  const { client, frame } = await streaming();
  await frame({ type: "message.start", messageId: "s1", role: "assistant" });
  const one = counted(client, () => useWaypointMessage("m2"));
  const writing = counted(client, () => useWaypointMessage("s1"));
  const id = counted(client, () =>
    useWaypointSelector((snapshot) => snapshot.conversationId),
  );
  const cards = counted(client, () => useBlockReply());
  const plan = counted(client, () => usePlanView());
  const before = [one, writing, id, cards, plan].map((each) => each.count);
  await frame({ type: "text.delta", messageId: "s1", text: "More" });
  await frame({ type: "text.delta", messageId: "s1", text: " words" });
  expect(one.count).toBe(before[0]);
  expect(writing.count).toBeGreaterThan(before[1]!);
  expect(id.count).toBe(before[2]);
  expect(cards.count).toBe(before[3]);
  expect(plan.count).toBe(before[4]);
  client.dispose();
});
