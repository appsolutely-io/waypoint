// @vitest-environment jsdom
// The composer's file picker: what it offers, what it refuses, what it
// says and where the focus goes when a file is removed.
import { it, expect, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import {
  createWaypointClient,
  type AttachmentPort,
  type WaypointClient,
} from "../../src/core/client";
import type { Message, Reply } from "../../src/protocol/generated";
import { config } from "../support/client";

afterEach(cleanup);

const file = (name: string, text: string, type = "text/plain") =>
  new File([text], name, { type });

function port(
  options: {
    accept?: readonly string[];
    maxBytes?: number;
    fail?: boolean;
    sent?: Reply[];
  } = {},
): AttachmentPort {
  return {
    accept: options.accept,
    maxBytes: options.maxBytes,
    upload: async (data, context) => {
      if (options.fail) throw new Error("no storage");
      return { id: `file-${context.fileName}` };
    },
  };
}

async function chatWith(
  client: WaypointClient,
): Promise<{ input: HTMLInputElement; status: () => string }> {
  render(<WaypointChat client={client} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy(),
  );
  return {
    input: document.querySelector<HTMLInputElement>('input[type="file"]')!,
    status: () => document.querySelector(".wp-composer-status")!.textContent!,
  };
}

it("offers attachments only when the client has an upload port", async () => {
  const plain = createWaypointClient(config());
  await plain.ready;
  render(<WaypointChat client={plain} />);
  await screen.findByRole("textbox", { name: "Message" });
  expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
  plain.dispose();
});

it("lists a picked file with its size and says it was attached", async () => {
  const client = createWaypointClient({ ...config(), attachments: port() });
  await client.ready;
  const { input, status } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  expect(screen.getByText("5 B")).toBeTruthy();
  await waitFor(() => expect(status()).toContain("Attached report.txt."));
  client.dispose();
});

it("refuses a file of a type the host does not take", async () => {
  const client = createWaypointClient({
    ...config(),
    attachments: port({ accept: ["image/png"] }),
  });
  await client.ready;
  const { input, status } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(status()).toContain("report.txt"));
  expect(screen.queryByText("report.txt")).toBeNull();
  client.dispose();
});

it("refuses a file larger than the host allows", async () => {
  const client = createWaypointClient({
    ...config(),
    attachments: port({ maxBytes: 4 }),
  });
  await client.ready;
  const { input, status } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(status()).toContain("report.txt"));
  expect(screen.queryByText("report.txt")).toBeNull();
  client.dispose();
});

it("removes a file, says so and hands the focus to the picker", async () => {
  const client = createWaypointClient({ ...config(), attachments: port() });
  await client.ready;
  const { input, status } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  const remove = screen.getByRole("button", { name: "Remove report.txt" });
  remove.focus();
  fireEvent.click(remove);
  await waitFor(() => expect(screen.queryByText("report.txt")).toBeNull());
  expect(status()).toContain("Removed report.txt.");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Attach files" }),
    ),
  );
  client.dispose();
});

it("sends the picked files with the message", async () => {
  const sent: Reply[] = [];
  const uploads: { fileName: string; clientMessageId: string }[] = [];
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: {
      upload: async (data, context) => {
        uploads.push({
          fileName: context.fileName,
          clientMessageId: context.clientMessageId,
        });
        return { id: "file-1" };
      },
    },
    transport: {
      ...base.transport,
      send: async (reply) => {
        sent.push(reply as Reply);
        return { id: "stored" };
      },
    },
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Here is the report" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await waitFor(() => expect(uploads).toHaveLength(1));
  expect(uploads[0]?.fileName).toBe("report.txt");
  expect(uploads[0]?.clientMessageId).toBe(
    (sent[0] as { clientMessageId: string }).clientMessageId,
  );
  expect((sent[0] as { attachments?: unknown }).attachments).toEqual([
    { id: "file-1", name: "report.txt", mediaType: "text/plain", size: 5 },
  ]);
  client.dispose();
});

it("shows a failed upload on the message, not below the composer", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: port({ fail: true }),
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Here is the report" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  const pending = await screen.findByRole("article", { name: "You" });
  await waitFor(() => expect(pending.textContent).toContain("Not sent"));
  expect(pending.textContent).toContain("report.txt");
  expect(pending.textContent).toContain("could not upload");
  // The refusal belongs to the message, so it is not said below the
  // composer as well.
  const alert = document.querySelector('[role="alert"]')!;
  expect(alert.textContent ?? "").not.toContain("report.txt");
  client.dispose();
});

it("names the types it takes when it refuses a file", async () => {
  const client = createWaypointClient({
    ...config(),
    attachments: port({ accept: ["image/png"] }),
  });
  await client.ready;
  const { input, status } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(status()).toContain("report.txt"));
  expect(status()).toContain("image/png");
  client.dispose();
});

it("names the size it allows when it refuses a file", async () => {
  const client = createWaypointClient({
    ...config(),
    attachments: port({ maxBytes: 4 }),
  });
  await client.ready;
  const { input, status } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(status()).toContain("report.txt"));
  expect(status()).toContain("4 B");
  client.dispose();
});

it("takes a file whose type the host takes as a wildcard", async () => {
  const uploads: string[] = [];
  const client = createWaypointClient({
    ...config(),
    attachments: {
      accept: ["image/*"],
      upload: async (data, context) => {
        uploads.push(context.fileName);
        return { id: "file-1" };
      },
    },
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("shot.png", "x", "image/png")] },
  });
  await waitFor(() => expect(screen.getByText("shot.png")).toBeTruthy());
  client.dispose();
});

it("shows the files on their way to the host", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: {
      upload: async () => {
        await gate;
        return { id: "file-1" };
      },
    },
    transport: {
      ...base.transport,
      send: async () => ({ id: "stored" }),
    },
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Here is the report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const pending = await screen.findByRole("article", { name: "You" });
  await waitFor(() => expect(pending.textContent).toContain("Uploading"));
  release();
  client.dispose();
});

it("sends the picked files with that message only", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: {
      upload: async () => {
        await gate;
        return { id: "file-1" };
      },
    },
    transport: {
      ...base.transport,
      send: async () => ({ id: "stored" }),
    },
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Here is the report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  // A file picked while the message is on its way stays for the next one.
  fireEvent.change(input, {
    target: { files: [file("notes.txt", "later")] },
  });
  await waitFor(() => expect(screen.getByText("notes.txt")).toBeTruthy());
  release();
  // The message takes only the files it was given; the late one stays.
  await waitFor(() => expect(screen.queryByText("report.txt")).toBeNull());
  expect(screen.getByText("notes.txt")).toBeTruthy();
  client.dispose();
});

it("draws only the files the protocol allows, and links only a safe url", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "Here is the report",
            blocks: [],
            createdAt: 100,
            // The host's read is untrusted: one entry is malformed.
            attachments: [
              {
                id: "file-1",
                name: "unsafe.txt",
                mediaType: "text/plain",
                size: 5,
                url: "javascript:alert(1)",
              },
              {
                id: "file-2",
                name: "notes.txt",
                mediaType: "text/plain",
                size: 5,
              },
              { name: "broken.txt", mediaType: "text/plain", size: 5 },
            ] as Message["attachments"],
          },
        ],
      }),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await screen.findByText("Here is the report");
  expect(screen.getByText("notes.txt")).toBeTruthy();
  expect(screen.queryByText("broken.txt")).toBeNull();
  expect(screen.queryByRole("link", { name: "unsafe.txt" })).toBeNull();
  expect(screen.getByText("unsafe.txt")).toBeTruthy();
  client.dispose();
});

it("keeps the picked files with the conversation they were picked in", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: port(),
    transport: {
      ...base.transport,
      read: async (id) => ({
        protocol: "1.0",
        id,
        title: "Chat",
        messages: [],
      }),
    },
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  await act(async () => {
    await client.switchConversation("conversation-b");
  });
  expect(screen.queryByText("report.txt")).toBeNull();
  client.dispose();
});

it("offers no attachments in a form-fill conversation", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: port(),
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        mode: "form-fill",
        messages: [],
      }),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await screen.findByRole("textbox", { name: "Message" });
  expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
  client.dispose();
});

it("keeps the files when the message was held back", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: port(),
    contributions: [{ id: "hold", evaluate: async () => ({ hold: "hold" }) }],
    transport: {
      ...base.transport,
      send: async () => ({ id: "stored" }),
    },
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Here is the report" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value,
    ).toBe("Here is the report"),
  );
  expect(screen.getByText("report.txt")).toBeTruthy();
  client.dispose();
});

it("removes the files with a word when the conversation takes a form", async () => {
  let formFill = false;
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: port(),
    formSession: {
      begin: () => ({ requestId: "form-1", fields: [] }),
      getSnapshot: () => ({ fields: [] }),
      cancel: () => {},
      dispose: () => {},
      // The form session's own contract is not under test here.
    } as never,
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        ...(formFill ? { mode: "form-fill" } : {}),
        messages: [],
      }),
    },
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  formFill = true;
  await act(async () => {
    await client.refresh();
  });
  expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Fill this" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await waitFor(() => expect(screen.getByText(/takes a form/)).toBeTruthy());
  expect(screen.queryByText("report.txt")).toBeNull();
  client.dispose();
});

it("drops files whose read settled after their message left", async () => {
  const base = config();
  const uploads: string[] = [];
  const client = createWaypointClient({
    ...base,
    attachments: {
      upload: async (data, context) => {
        uploads.push(context.fileName);
        return { id: "file-1" };
      },
    },
    transport: {
      ...base.transport,
      send: async () => ({ id: "stored" }),
    },
  });
  await client.ready;
  const { input } = await chatWith(client);
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Here is the report" },
  });
  // The send leaves before the file's read settles.
  fireEvent.change(input, {
    target: { files: [file("report.txt", "hello")] },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value,
    ).toBe(""),
  );
  await waitFor(() => expect(uploads).toHaveLength(0));
  expect(screen.queryByText("report.txt")).toBeNull();
  client.dispose();
});

it("carries the attachments in the bubble's part data", async () => {
  const seen: { message?: unknown; pending?: unknown }[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = config();
  const client = createWaypointClient({
    ...base,
    attachments: {
      upload: async (data, context) => {
        await gate;
        return { id: `file-${context.fileName}` };
      },
    },
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "Here is the report",
            blocks: [],
            createdAt: 100,
            attachments: [
              {
                id: "file-1",
                name: "notes.txt",
                mediaType: "text/plain",
                size: 5,
              },
            ],
          },
        ],
      }),
      send: async () => ({ id: "stored" }),
    },
  });
  await client.ready;
  render(
    <WaypointChat
      client={client}
      parts={{
        bubble: (props) => {
          seen.push(props.data as { message?: unknown; pending?: unknown });
          return props.children;
        },
      }}
    />,
  );
  await screen.findByText("Here is the report");
  const message = seen.find(
    (entry) => (entry as { message?: { id?: string } }).message?.id === "m1",
  ) as { message?: { attachments?: unknown[] } };
  expect(message.message?.attachments).toEqual([
    { id: "file-1", name: "notes.txt", mediaType: "text/plain", size: 5 },
  ]);
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Thanks" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  fireEvent.change(
    document.querySelector<HTMLInputElement>('input[type="file"]')!,
    { target: { files: [file("report.txt", "hello")] } },
  );
  await waitFor(() => expect(screen.getByText("report.txt")).toBeTruthy());
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Thanks" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => {
    const pending = seen.find((entry) => {
      const files = (entry as { pending?: { attachments?: unknown[] } }).pending
        ?.attachments;
      return Array.isArray(files) && files.length > 0;
    }) as { pending?: { attachments?: unknown[] } };
    expect(pending.pending?.attachments).toEqual([
      { name: "report.txt", mediaType: "text/plain", size: 5 },
    ]);
  });
  release();
  client.dispose();
});

it("says the too-many refusal once for a pick that overflows", async () => {
  const client = createWaypointClient({
    ...config(),
    attachments: port(),
  });
  await client.ready;
  const { input, status } = await chatWith(client);
  const many = Array.from({ length: 21 }, (_, at) =>
    file(`report-${at}.txt`, "x"),
  );
  fireEvent.change(input, { target: { files: many } });
  await waitFor(() => expect(status()).toContain("at most"));
  expect(status().match(/at most/g)).toHaveLength(1);
  expect(document.querySelectorAll(".wp-composer-files > li")).toHaveLength(20);
  client.dispose();
});
