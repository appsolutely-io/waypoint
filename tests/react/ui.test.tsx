// @vitest-environment jsdom
import { it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import {
  WaypointChat,
  WaypointProvider,
  useComposer,
  useConversation,
} from "../../src/react/index";
import {
  createWaypointClient,
  ConversationReadError,
  type TransportEvent,
} from "../../src/core/client";
import { createFormSession } from "../../src/core/form-session";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
import type { ImmediateDraft } from "../../src/protocol/generated";
afterEach(cleanup);
it("sends with Enter, preserves Shift/IME input, scopes shortcuts and supports hooks-only UI", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  render(<WaypointChat client={client} />);
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Hello" } });
  fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
  expect(client.getSnapshot().draft).toBe("Hello");
  field.blur();
  fireEvent.keyDown(document.body, { key: "/" });
  expect(document.activeElement).not.toBe(field);
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(client.getSnapshot().draft).toBe(""));
  cleanup();
  function Custom() {
    const composer = useComposer();
    const conversation = useConversation();
    return (
      <>
        <p>{conversation.conversationId}</p>
        <button
          onClick={() => {
            void composer.setDraft("Custom").then(() => composer.send());
          }}
        >
          Custom send
        </button>
      </>
    );
  }
  render(
    <WaypointProvider client={client}>
      <Custom />
    </WaypointProvider>,
  );
  fireEvent.click(screen.getByText("Custom send"));
  await waitFor(() => expect(client.getSnapshot().draft).toBe(""));
  client.dispose();
});
it("capabilities hide unavailable UI and theme changes preserve draft, plan and focus", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const view = render(<WaypointChat client={client} colorScheme="light" />);
  const field = screen.getByRole("textbox", { name: "Message" });
  field.focus();
  fireEvent.change(field, { target: { value: "Keep" } });
  view.rerender(<WaypointChat client={client} colorScheme="dark" dir="rtl" />);
  expect(screen.getByRole("textbox", { name: "Message" })).toBe(field);
  expect(document.activeElement).toBe(field);
  expect(client.getSnapshot().draft).toBe("Keep");
  expect(view.container.querySelector('[dir="rtl"]')).not.toBeNull();
  client.dispose();
});
it("one announcement per failure and a replacement composer leaves unrelated markup identical", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const view = render(<WaypointChat client={client} />);
  const baseline = view.container.querySelector(
    '[data-part="topBar"]',
  )!.outerHTML;
  view.rerender(
    <WaypointChat
      client={client}
      slots={{ composer: () => <p>Replacement</p> }}
    />,
  );
  expect(view.container.querySelector('[data-part="topBar"]')!.outerHTML).toBe(
    baseline,
  );
  client.report({ code: "refused", id: "p" });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "The site refused this request.",
    ),
  );
  client.dispose();
});

it("keeps recovery visible and controls disabled after another problem replaces the notice", async () => {
  const cfg = config();
  let recovered = false;
  cfg.transport.read = async (id) => {
    if (!recovered) throw new Error("Read unavailable");
    return { protocol: "1.0", id, title: "Chat", messages: [] };
  };
  cfg.transport.send = vi.fn().mockRejectedValue(new Error("Send unavailable"));
  let listener!: (event: TransportEvent) => void;
  cfg.transport.subscribe = (_id, fn) => {
    listener = fn;
    return () => {};
  };
  const client = createWaypointClient(cfg);
  await client.ready;
  await client.setDraft("Failed row");
  await client.send();
  await client.setDraft("Keep draft");
  for (let sequence = 1; sequence <= 128; sequence++)
    listener({
      type: "frame",
      frame: {
        protocol: "1.0",
        type: "plan.draft",
        sequence,
        messageId: "held",
        plan: samples.ImmediateDraft as ImmediateDraft,
      },
    });
  render(<WaypointChat client={client} />);
  const field = screen.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;
  expect(field.disabled).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain(
    "does not stop a server turn",
  );
  act(() => client.report({ code: "unavailable", id: "storage-write" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "does not stop a server turn",
  );
  expect(
    screen.getByRole("button", { name: "Reload conversation" }),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Reload conversation" }));
  await waitFor(() =>
    expect(client.getSnapshot().problem?.id).toBe("conversation-read"),
  );
  expect(field.disabled).toBe(true);
  expect(
    screen.getByRole("button", { name: "Reload conversation" }),
  ).toBeDefined();
  recovered = true;
  fireEvent.click(screen.getByRole("button", { name: "Reload conversation" }));
  await waitFor(() => expect(field.disabled).toBe(false));
  expect(field.value).toBe("Keep draft");
  expect(
    (screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(
    screen.queryByRole("button", { name: "Reload conversation" }),
  ).toBeNull();
  client.dispose();
});

for (const mode of ["ordinary", "form-fill"] as const)
  it(`disables ${mode} controls with a reason while the conversation is missing`, async () => {
    const cfg = config();
    cfg.transport.negotiate = async () => ({
      protocol: "1.1",
      capabilities: ["form-fill"],
    });
    cfg.formSession = createFormSession({
      fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
      ids: () => "request-a",
    });
    const read = async (id: string) => ({
      protocol: "1.1",
      id,
      title: "Form",
      messages: [],
      ...(mode === "form-fill" ? { mode, field: "title" } : {}),
    });
    cfg.transport.read = read;
    cfg.transport.send = vi
      .fn()
      .mockRejectedValue(new Error("Send unavailable"));
    const client = createWaypointClient(cfg);
    await client.ready;
    await client.setDraft("Keep draft");
    await client.send();
    await client.setDraft("Keep draft");
    render(<WaypointChat client={client} />);
    await act(async () => {
      cfg.transport.read = async (id) => {
        throw new ConversationReadError(id, 404);
      };
      await client.refresh();
    });
    const field = screen.getByRole("textbox", {
      name: "Message",
    }) as HTMLTextAreaElement;
    expect(field.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    if (mode === "ordinary")
      expect(
        (screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    expect(screen.getByText(/This conversation is unavailable/)).toBeDefined();
    cfg.transport.read = read;
    fireEvent.click(
      screen.getByRole("button", { name: "Reload conversation" }),
    );
    await waitFor(() => expect(field.disabled).toBe(false));
    expect(field.value).toBe("Keep draft");
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    client.dispose();
  });

it("shows one alert for a conversation that is gone", async () => {
  const cfg = config();
  const client = createWaypointClient(cfg);
  await client.ready;
  render(<WaypointChat client={client} />);
  await act(async () => {
    cfg.transport.read = async (id) => {
      throw new ConversationReadError(id, 404);
    };
    await client.refresh();
  });
  expect(client.getSnapshot().problem?.id).toBe("conversation-read");
  const alert = screen.getByRole("alert");
  expect(alert.children).toHaveLength(1);
  expect(alert.textContent).toContain("This conversation is unavailable");
  expect(
    within(alert).getByRole("button", { name: "Reload conversation" }),
  ).toBeDefined();
  client.dispose();
});
it("marks a withdrawal as pending until its commit lands, then offers the text to edit or discard", async () => {
  let releaseWrite: (() => void) | undefined;
  let holdWrites = false;
  const values = new Map<string, string>();
  const base = config();
  const client = createWaypointClient({
    ...base,
    storage: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        if (holdWrites)
          await new Promise<void>((resolve) => (releaseWrite = resolve));
        values.set(key, value);
      },
      remove: async (key) => {
        values.delete(key);
      },
    },
    transport: {
      ...base.transport,
      send: async () => {
        throw { code: "retryable", id: "send" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Queued text");
  await client.send();
  render(<WaypointChat client={client} />);
  const withdraw = screen.getByRole("button", {
    name: "Withdraw",
  }) as HTMLButtonElement;
  holdWrites = true;
  fireEvent.click(withdraw);
  await waitFor(() => expect(withdraw.disabled).toBe(true));
  expect(client.getSnapshot().draft).toBe("");
  holdWrites = false;
  act(() => releaseWrite!());
  const restored = await screen.findByRole("region", {
    name: "Withdrawn messages",
  });
  expect(client.getSnapshot().draft).toBe("");
  expect(client.getSnapshot().pending).toEqual([]);
  expect(client.getSnapshot().withdrawing).toEqual([]);
  fireEvent.click(within(restored).getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(client.getSnapshot().draft).toBe("Queued text"));
  expect(client.getSnapshot().restored).toHaveLength(1);
  fireEvent.click(within(restored).getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(client.getSnapshot().restored).toEqual([]));
  client.dispose();
});
