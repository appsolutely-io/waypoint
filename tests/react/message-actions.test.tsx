// @vitest-environment jsdom
// Each message has its actions without a host part: copy, regenerate,
// edit and resend, and feedback, each only where the client can do it.
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointChat } from "../../src/react/ui";
import {
  createWaypointClient,
  type FeedbackInput,
  type MessageVersionPort,
} from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

const messages: Message[] = [
  { id: "u1", role: "user", content: "Hello there", blocks: [], createdAt: 1 },
  {
    id: "a1",
    role: "assistant",
    content: "Hi, how can I help?",
    blocks: [],
    createdAt: 2,
    status: "completed",
  },
];
async function chat(
  options: {
    versions?: MessageVersionPort;
    feedback?: (input: FeedbackInput) => Promise<void>;
    shown?: Message[];
    locale?: string;
  } = {},
) {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async (id) => ({
        protocol: "1.0",
        id,
        title: "Chat",
        messages: structuredClone(options.shown ?? messages),
      }),
    },
    versions: options.versions,
    ...(options.feedback && { feedback: { send: options.feedback } }),
  });
  await client.ready;
  render(<WaypointChat client={client} locale={options.locale} />);
  await screen.findByText("Hi, how can I help?", {}, { timeout: 5000 });
  return client;
}
const actionsOf = (id: string) =>
  document.querySelector<HTMLElement>(
    `[data-message-id="${id}"] [data-part="messageActions"]`,
  )!;

it("copies a message's text and says it was copied", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  const client = await chat();
  const actions = within(actionsOf("a1"));
  await userEvent.click(await actions.findByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("Hi, how can I help?");
  expect(await actions.findByRole("status")).toHaveProperty(
    "textContent",
    "Copied",
  );
  expect(
    await within(actionsOf("u1")).findByRole("button", { name: "Copy" }),
  ).toBeTruthy();
  client.dispose();
});

it("regenerates a reply and edits and resends the user's message", async () => {
  const regenerate = vi.fn(async () => {});
  const edit = vi.fn(async () => {});
  const client = await chat({
    versions: { regenerate, edit, select: async () => {} },
  });
  const reply = within(actionsOf("a1"));
  await userEvent.click(
    await reply.findByRole("button", { name: "Regenerate" }),
  );
  await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
  expect(reply.queryByRole("button", { name: "Edit" })).toBeNull();
  const own = within(actionsOf("u1"));
  expect(own.queryByRole("button", { name: "Regenerate" })).toBeNull();
  await userEvent.click(await own.findByRole("button", { name: "Edit" }));
  const field = own.getByRole("textbox", { name: "Edit message" });
  expect(field).toHaveProperty("value", "Hello there");
  expect(document.activeElement).toBe(field);
  await userEvent.clear(field);
  await userEvent.type(field, "Hello again");
  await userEvent.click(own.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "u1", content: "Hello again" }),
    ),
  );
  await waitFor(() =>
    expect(own.queryByRole("textbox", { name: "Edit message" })).toBeNull(),
  );
  expect(document.activeElement).toBe(
    own.getByRole("button", { name: "Edit" }),
  );
  client.dispose();
});

it("cancelling an edit keeps the message and returns focus to Edit", async () => {
  const edit = vi.fn(async () => {});
  const client = await chat({
    versions: { regenerate: async () => {}, edit, select: async () => {} },
  });
  const own = within(actionsOf("u1"));
  await userEvent.click(await own.findByRole("button", { name: "Edit" }));
  await userEvent.click(own.getByRole("button", { name: "Cancel" }));
  expect(edit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    own.getByRole("button", { name: "Edit" }),
  );
  client.dispose();
});

it("rates a reply through the feedback port and shows the choice", async () => {
  const sent: FeedbackInput[] = [];
  const client = await chat({
    feedback: async (input) => void sent.push(input),
  });
  const reply = within(actionsOf("a1"));
  const good = await reply.findByRole("button", { name: "Good response" });
  expect(good.getAttribute("aria-pressed")).toBe("false");
  await userEvent.click(good);
  await waitFor(() => expect(good.getAttribute("aria-pressed")).toBe("true"));
  expect(sent.map((input) => input.rating)).toEqual(["positive"]);
  expect(
    within(actionsOf("u1")).queryByRole("button", { name: "Good response" }),
  ).toBeNull();
  client.dispose();
});

it("offers only Copy without ports, and nothing while a reply is written", async () => {
  const client = await chat({
    shown: [
      ...messages,
      { id: "u2", role: "user", content: "More", blocks: [], createdAt: 3 },
      {
        id: "a2",
        role: "assistant",
        content: "Writing",
        blocks: [],
        createdAt: 4,
        status: "writing",
      },
    ],
  });
  const reply = within(actionsOf("a1"));
  await reply.findByRole("button", { name: "Copy" });
  expect(reply.queryByRole("button", { name: "Regenerate" })).toBeNull();
  expect(reply.queryByRole("button", { name: "Good response" })).toBeNull();
  expect(actionsOf("a2").querySelector("button")).toBeNull();
  client.dispose();
});

it("names the actions in Simplified Chinese", async () => {
  const client = await chat({
    locale: "zh-CN",
    versions: {
      regenerate: async () => {},
      edit: async () => {},
      select: async () => {},
    },
    feedback: async () => {},
  });
  const reply = within(actionsOf("a1"));
  for (const name of ["复制", "重新生成", "回答有帮助", "回答没有帮助"])
    expect(await reply.findByRole("button", { name })).toBeTruthy();
  expect(
    await within(actionsOf("u1")).findByRole("button", { name: "编辑" }),
  ).toBeTruthy();
  client.dispose();
});

it("a host part replaces the default actions", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async (id) => ({ protocol: "1.0", id, title: "Chat", messages }),
    },
  });
  await client.ready;
  render(
    <WaypointChat
      client={client}
      parts={{ messageActions: () => <span>Host actions</span> }}
    />,
  );
  await screen.findByText("Hi, how can I help?", {}, { timeout: 5000 });
  expect(within(actionsOf("a1")).getByText("Host actions")).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(
    within(actionsOf("a1")).queryByRole("button", { name: "Copy" }),
  ).toBeNull();
  client.dispose();
});
