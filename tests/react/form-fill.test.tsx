// @vitest-environment jsdom
import { it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import { FormFillFields, FormFillPopup } from "../../src/react/form-fill";
import { WaypointProvider } from "../../src/react/ui";
import { createFormSession } from "../../src/core/form-session";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
afterEach(cleanup);
it("shows invalid draft guidance without truncation and offers replace/cancel on the input", async () => {
  const s = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "r",
  });
  const c = createWaypointClient(config());
  render(
    <WaypointProvider client={c}>
      <FormFillFields session={s} onRegenerate={() => {}} />
    </WaypointProvider>,
  );
  const r = s.begin({ text: "Fill" });
  act(() => {
    s.receive({
      requestId: r.requestId,
      values: {
        title: {
          value: "Unabridged long title",
          validation: {
            status: "invalid",
            messages: ["Invalid title"],
            guidance: "Use fewer characters",
          },
        },
      },
    });
  });
  const input = screen.getByRole("textbox", {
    name: "Title",
  }) as HTMLInputElement;
  expect(input.value).toBe("Unabridged long title");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("Use fewer characters")).toBeDefined();
  fireEvent.change(input, { target: { value: "My edit" } });
  act(() => {
    const next = s.begin({ text: "Again" });
    s.receive({
      requestId: next.requestId,
      values: {
        title: {
          value: "Replacement",
          validation: { status: "valid", messages: [] },
        },
      },
    });
  });
  expect(input.value).toBe("My edit");
  fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
  expect(input.value).toBe("Replacement");
  c.dispose();
});
it("sends text and reference strings, uploads pasted images only through the private adapter", async () => {
  const cfg = config();
  const send = vi.fn(async () => ({ id: "reply" }));
  cfg.transport.send = send;
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async () => ({
    protocol: "1.1",
    id: "conversation-a",
    title: "Form",
    messages: [],
    mode: "form-fill",
    subject: {
      key: "draft-a",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
  });
  const c = createWaypointClient(cfg);
  await c.ready;
  const s = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "request",
  });
  const upload = vi.fn(async () => "private-reference");
  render(
    <WaypointProvider client={c}>
      <FormFillPopup
        session={s}
        open
        onClose={() => {}}
        attachments={{ upload, remove: async () => {} }}
      />
    </WaypointProvider>,
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Generate draft" })
        .getAttribute("aria-disabled"),
    ).toBeNull(),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Make a title" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Reference links" }), {
    target: { value: "https://example.test/reference" },
  });
  fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
    clipboardData: {
      files: [new File(["image"], "pasted.png", { type: "image/png" })],
    },
  });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Generate draft",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0]).toBeDefined();
  expect(JSON.stringify(send.mock.calls)).toContain("private-reference");
  expect(JSON.stringify(send.mock.calls)).toContain(
    "https://example.test/reference",
  );
  c.dispose();
});
it("renders a form.fill block with each validation result and nonblocking guidance", async () => {
  const { Widget } = await import("../../src/react/ui");
  const c = createWaypointClient(config());
  render(
    <WaypointProvider client={c}>
      <Widget
        disabled={false}
        onReply={() => {}}
        block={{
          type: "form.fill",
          id: "fill",
          fallback: "Draft values",
          body: {
            requestId: "r",
            values: {
              title: {
                value: "Complete text",
                validation: {
                  status: "invalid",
                  messages: ["Invalid field"],
                  guidance: "Suggested length",
                },
              },
            },
          },
        }}
      />
    </WaypointProvider>,
  );
  // The values render with the blocks chunk, once it has loaded.
  expect(await screen.findByText("Complete text")).toBeDefined();
  expect(screen.getByText("Invalid field")).toBeDefined();
  expect(screen.getByText("Suggested length")).toBeDefined();
  c.dispose();
});
it("regenerates in a child thread and keeps the same creation identity on a retry", async () => {
  const cfg = config();
  const subject = {
    key: "draft-a",
    resource: "items",
    label: "Item",
    route: "/items/new",
    state: "pending" as const,
  };
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async (id) => ({
    protocol: "1.1",
    id,
    title: "Form",
    messages: [],
    mode: "form-fill",
    subject,
    ...(id === "child"
      ? { parentConversationId: "conversation-a", field: "title" }
      : {}),
  });
  const c = createWaypointClient(cfg);
  await c.ready;
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue({
      protocol: "1.1",
      id: "child",
      title: "Title",
      messages: [],
      mode: "form-fill",
      subject,
      parentConversationId: "conversation-a",
      field: "title",
    });
  const s = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "request-child",
  });
  render(
    <WaypointProvider client={c}>
      <FormFillPopup
        open
        onClose={() => {}}
        session={s}
        field="title"
        source={{ create, list: async () => [] }}
      />
    </WaypointProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[0]![0].clientCreationId).toBe(
    create.mock.calls[1]![0].clientCreationId,
  );
  await waitFor(() => expect(c.getSnapshot().conversationId).toBe("child"));
  c.dispose();
});
it("keeps successful private uploads removable when a later pasted image fails", async () => {
  const c = createWaypointClient(config());
  await c.ready;
  const s = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "r",
  });
  const upload = vi
    .fn()
    .mockResolvedValueOnce("uploaded-a")
    .mockRejectedValueOnce(new Error("Upload failed"));
  const remove = vi.fn(async () => {});
  render(
    <WaypointProvider client={c}>
      <FormFillPopup
        open
        onClose={() => {}}
        session={s}
        attachments={{ upload, remove }}
      />
    </WaypointProvider>,
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Generate draft" })
        .getAttribute("aria-disabled"),
    ).toBeNull(),
  );
  fireEvent.paste(screen.getByRole("textbox", { name: "Message" }), {
    clipboardData: {
      files: [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" }),
      ],
    },
  });
  await waitFor(() =>
    expect(
      screen.getByText("b.png could not be attached.", { exact: false }),
    ).toBeDefined(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("uploaded-a"));
  c.dispose();
});
it("rearms a generation after closing and reopening a failed popup", async () => {
  const { useState } = await import("react");
  const cfg = config();
  const conversation: import("../../src/protocol/generated").Conversation = {
    protocol: "1.1",
    id: "conversation-a",
    title: "Form",
    messages: [],
    mode: "form-fill",
    subject: {
      key: "draft-a",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
  };
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async () => structuredClone(conversation);
  let attempt = 0;
  cfg.transport.send = async (reply) => {
    if (++attempt === 1) throw new Error("Unavailable");
    if (reply.kind === "form-fill")
      conversation.messages.push({
        id: "result",
        role: "assistant",
        content: "",
        createdAt: 0,
        blocks: [
          {
            type: "form.fill",
            id: "result",
            fallback: "Draft",
            body: {
              requestId: reply.request.requestId,
              values: {
                title: {
                  value: "Recovered",
                  validation: { status: "valid", messages: [] },
                },
              },
            },
          },
        ],
      });
    return { id: reply.clientReplyId };
  };
  let serial = 0;
  const s = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => `retry-${++serial}`,
  });
  const c = createWaypointClient(cfg);
  await c.ready;
  function Wrapper() {
    const [open, setOpen] = useState(true);
    return (
      <WaypointProvider client={c}>
        <button onClick={() => setOpen(true)}>Reopen</button>
        <FormFillPopup session={s} open={open} onClose={() => setOpen(false)} />
      </WaypointProvider>
    );
  }
  render(<Wrapper />);
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() =>
    expect(s.getSnapshot().fields.title?.value).toBe("Recovered"),
  );
  c.dispose();
});
it("abandons child generation when navigation changes during child loading", async () => {
  const cfg = config();
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  const subject = {
    key: "draft-a",
    resource: "items",
    label: "Item",
    route: "/items/new",
    state: "pending" as const,
  };
  const conversation = (id: string) => ({
    protocol: "1.1" as const,
    id,
    title: "Form",
    messages: [],
    mode: "form-fill" as const,
    subject,
  });
  let release: () => void = () => {};
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  cfg.transport.read = async (id) => {
    if (id === "child") await loading;
    return conversation(id);
  };
  const send = vi.spyOn(cfg.transport, "send");
  const c = createWaypointClient(cfg);
  await c.ready;
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "r",
  });
  render(
    <WaypointProvider client={c}>
      <FormFillPopup
        open
        onClose={() => {}}
        session={session}
        field="title"
        source={{
          list: async () => [],
          create: async () => ({
            ...conversation("child"),
            parentConversationId: "conversation-a",
            field: "title",
          }),
        }}
      />
    </WaypointProvider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Original form material" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(c.getSnapshot().conversationId).toBe("child"));
  await act(async () => {
    await c.switchConversation("unrelated");
    release();
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Generate draft",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(send).not.toHaveBeenCalled();
  c.dispose();
});
it("holds regeneration back, described, until the pending fill ends", () => {
  const c = createWaypointClient(config());
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "r",
  });
  const regenerate = vi.fn();
  render(
    <WaypointProvider client={c}>
      <FormFillFields session={session} onRegenerate={regenerate} />
    </WaypointProvider>,
  );
  act(() => screen.getByRole("textbox", { name: "Title" }).focus());
  const button = screen.getByRole("button", {
    name: "Regenerate Title",
  }) as HTMLButtonElement;
  act(() => {
    session.begin({ text: "Fill" });
  });
  // Focusable and described while unavailable, never natively disabled.
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(
    document.getElementById(button.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe("Wait for the draft to finish.");
  fireEvent.click(button);
  expect(regenerate).not.toHaveBeenCalled();
  act(() => session.cancel());
  expect(button.getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(button);
  expect(regenerate).toHaveBeenCalledTimes(1);
  c.dispose();
});
it("closing discards an accepted fill while its late reply remains in the transcript", async () => {
  const { useState } = await import("react");
  const { WaypointChat } = await import("../../src/react/ui");
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "Original" }],
    ids: () => "late-fill",
  });
  const cfg = config({ formSession: session });
  const conversation: import("../../src/protocol/generated").Conversation = {
    protocol: "1.1",
    id: "conversation-a",
    title: "Form",
    mode: "form-fill",
    subject: {
      key: "draft",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
    messages: [],
  };
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill", "widgets"],
  });
  cfg.transport.read = async () => structuredClone(conversation);
  const send = vi.spyOn(cfg.transport, "send");
  const c = createWaypointClient(cfg);
  await c.ready;
  function Wrapper() {
    const [open, setOpen] = useState(true);
    return (
      <WaypointProvider client={c}>
        <WaypointChat />
        <FormFillPopup
          session={session}
          open={open}
          onClose={() => setOpen(false)}
        />
      </WaypointProvider>
    );
  }
  render(<Wrapper />);
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  await act(async () => {
    await send.mock.results[0]!.value;
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Generate draft",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.getByText(
      "Closing discards this fill; the reply stays in the conversation.",
    ),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  conversation.messages.push({
    id: "late",
    role: "assistant",
    content: "Late reply",
    createdAt: 0,
    blocks: [
      {
        type: "form.fill",
        id: "late",
        fallback: "Draft",
        body: {
          requestId: "late-fill",
          values: {
            title: {
              value: "Late value",
              validation: { status: "valid", messages: [] },
            },
          },
        },
      },
    ],
  });
  await act(async () => {
    await c.refresh();
  });
  expect(session.getSnapshot().fields.title?.value).toBe("Original");
  expect(screen.getByText("Late value")).toBeDefined();
  expect(c.getSnapshot().problem).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("");
  c.dispose();
});
it("retains a child creation identity when its response arrives after close", async () => {
  const { useState } = await import("react");
  const subject = {
    key: "draft",
    resource: "items",
    label: "Item",
    route: "/items/new",
    state: "pending" as const,
  };
  const cfg = config();
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async (id) => ({
    protocol: "1.1",
    id,
    title: "Form",
    mode: "form-fill",
    subject,
    messages: [],
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const child = {
    protocol: "1.1",
    id: "child",
    title: "Title",
    mode: "form-fill" as const,
    subject,
    parentConversationId: "conversation-a",
    field: "title",
    messages: [],
  };
  const create = vi.fn(async () => {
    await gate;
    return child;
  });
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "fill",
  });
  const c = createWaypointClient(cfg);
  await c.ready;
  function Wrapper() {
    const [open, setOpen] = useState(true);
    return (
      <WaypointProvider client={c}>
        <button onClick={() => setOpen(true)}>Reopen</button>
        <FormFillPopup
          session={session}
          field="title"
          source={{ create, list: async () => [] }}
          open={open}
          onClose={() => setOpen(false)}
        />
      </WaypointProvider>
    );
  }
  render(<Wrapper />);
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => {
    release();
    await gate;
  });
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(c.getSnapshot().conversationId).toBe("child"));
  expect(create).toHaveBeenCalledOnce();
  c.dispose();
});
it("renders a form fill field label instead of its internal key", async () => {
  const { Widget } = await import("../../src/react/ui");
  const c = createWaypointClient(config());
  const block = {
    type: "form.fill",
    id: "labeled",
    fallback: "Draft",
    body: {
      requestId: "r",
      values: {
        internal_key: {
          label: "Display label <b>",
          value: "Draft value",
          validation: { status: "valid", messages: [] },
        },
      },
    },
  };
  render(
    <WaypointProvider client={c}>
      <Widget
        disabled={false}
        onReply={() => {}}
        block={block as import("../../src/protocol/generated").Block}
      />
    </WaypointProvider>,
  );
  expect(screen.getByText("Display label <b>")).toBeDefined();
  expect(screen.queryByText("internal_key")).toBeNull();
  c.dispose();
});
it("renders a fallback for null form fill entries", async () => {
  const { Widget } = await import("../../src/react/ui");
  const c = createWaypointClient(config());
  const block = {
    type: "form.fill",
    id: "null",
    fallback: "Unavailable draft",
    body: { requestId: "r", values: { title: null } },
  };
  render(
    <WaypointProvider client={c}>
      <Widget
        disabled={false}
        onReply={() => {}}
        block={block as unknown as import("../../src/protocol/generated").Block}
      />
    </WaypointProvider>,
  );
  expect(screen.getByText("Unavailable draft")).toBeDefined();
  c.dispose();
});
it("falls back to the key when a peer supplies an object label", async () => {
  const { Widget } = await import("../../src/react/ui");
  const c = createWaypointClient(config());
  const block = {
    type: "form.fill",
    id: "bad-label",
    fallback: "Draft",
    body: {
      requestId: "r",
      values: {
        title: {
          label: { text: "Bad" },
          value: "Draft",
          validation: { status: "valid", messages: [] },
        },
      },
    },
  };
  render(
    <WaypointProvider client={c}>
      <Widget
        disabled={false}
        onReply={() => {}}
        block={block as unknown as import("../../src/protocol/generated").Block}
      />
    </WaypointProvider>,
  );
  expect(screen.getByText("title")).toBeDefined();
  c.dispose();
});
it("disables the popup Generate button for an accepted pending fill", async () => {
  const cfg = config();
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  const c = createWaypointClient(cfg);
  await c.ready;
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "r",
  });
  session.begin({ text: "Accepted" });
  const send = vi.spyOn(cfg.transport, "send");
  render(
    <WaypointProvider client={c}>
      <FormFillPopup session={session} open onClose={() => {}} />
    </WaypointProvider>,
  );
  const button = screen.getByRole("button", {
    name: "Generate draft",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(send).not.toHaveBeenCalled();
  c.dispose();
});
it("retains child creation across a conditional popup unmount", async () => {
  const { useState } = await import("react");
  const subject = {
    key: "draft",
    resource: "items",
    label: "Item",
    route: "/items/new",
    state: "pending" as const,
  };
  const cfg = config();
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async (id) => ({
    protocol: "1.1",
    id,
    title: "Form",
    mode: "form-fill",
    subject,
    messages: [],
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const create = vi.fn(async () => {
    await gate;
    return {
      protocol: "1.1",
      id: "child",
      title: "Title",
      mode: "form-fill" as const,
      subject,
      parentConversationId: "conversation-a",
      field: "title",
      messages: [],
    };
  });
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "r",
  });
  const c = createWaypointClient(cfg);
  await c.ready;
  function Wrapper() {
    const [open, setOpen] = useState(true);
    return (
      <WaypointProvider client={c}>
        <button onClick={() => setOpen(true)}>Reopen</button>
        {open && (
          <FormFillPopup
            session={session}
            field="title"
            source={{ create, list: async () => [] }}
            open
            onClose={() => setOpen(false)}
          />
        )}
      </WaypointProvider>
    );
  }
  render(<Wrapper />);
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => {
    release();
    await gate;
  });
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(c.getSnapshot().conversationId).toBe("child"));
  expect(create).toHaveBeenCalledOnce();
  c.dispose();
});
it("retries a failed pending fill with the same request identity", async () => {
  const cfg = config();
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  const conversation: import("../../src/protocol/generated").Conversation = {
    protocol: "1.1",
    id: "conversation-a",
    title: "Form",
    mode: "form-fill",
    subject: {
      key: "draft",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending",
    },
    messages: [],
  };
  cfg.transport.read = async () => structuredClone(conversation);
  let serial = 0;
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => `fill-${++serial}`,
  });
  const send = vi
    .fn<import("../../src/core/client").TransportPort["send"]>()
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockImplementation(async (reply) => {
      if (reply.kind === "form-fill")
        conversation.messages.push({
          id: "recovered",
          role: "assistant",
          content: "",
          createdAt: 0,
          blocks: [
            {
              type: "form.fill",
              id: "result",
              fallback: "Draft",
              body: {
                requestId: reply.request.requestId,
                values: {
                  title: {
                    value: "Recovered",
                    validation: { status: "valid", messages: [] },
                  },
                },
              },
            },
          ],
        });
      return { id: reply.clientReplyId };
    });
  cfg.transport.send = send;
  const c = createWaypointClient(cfg);
  await c.ready;
  render(
    <WaypointProvider client={c}>
      <FormFillPopup session={session} open onClose={() => {}} />
    </WaypointProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  expect(
    (
      screen.getByRole("button", {
        name: "Generate draft",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(session.getSnapshot().fields.title?.value).toBe("Recovered"),
  );
  expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
  expect(serial).toBe(1);
  c.dispose();
});
for (const status of [404, 410])
  it(`evicts a cached child only after a definitive ${status}`, async () => {
    const { useState } = await import("react");
    const subject = {
      key: "draft",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending" as const,
    };
    const cfg = config();
    cfg.transport.negotiate = async () => ({
      protocol: "1.1",
      capabilities: ["form-fill"],
    });
    cfg.transport.read = async (id) => {
      if (id === "dead") {
        const { ConversationReadError } = await import("../../src/core/client");
        throw new ConversationReadError(id, status);
      }
      return {
        protocol: "1.1",
        id,
        title: "Form",
        mode: "form-fill",
        subject,
        messages: [],
      };
    };
    const send = vi.spyOn(cfg.transport, "send");
    const client = createWaypointClient(cfg);
    await client.ready;
    let count = 0;
    const create = vi.fn(
      async (
        _input: import("../../src/protocol/generated").CreateConversation,
      ) => ({
        protocol: "1.1",
        id: ++count === 1 ? "dead" : "healthy",
        title: "Title",
        mode: "form-fill" as const,
        subject,
        parentConversationId: "conversation-a",
        field: "title",
        messages: [],
      }),
    );
    const session = createFormSession({
      fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
      ids: () => "fill",
    });
    function Wrapper() {
      const [open, setOpen] = useState(true);
      return (
        <WaypointProvider client={client}>
          <button onClick={() => setOpen(true)}>Reopen</button>
          {open && (
            <FormFillPopup
              session={session}
              field="title"
              source={{ create, list: async () => [] }}
              open
              onClose={() => setOpen(false)}
            />
          )}
        </WaypointProvider>
      );
    }
    render(<Wrapper />);
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(send).not.toHaveBeenCalled();
    expect(session.getSnapshot().pending).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(create.mock.calls[1]![0].clientCreationId).not.toBe(
      create.mock.calls[0]![0].clientCreationId,
    );
    expect(client.getSnapshot().conversationId).toBe("healthy");
    client.dispose();
  });
