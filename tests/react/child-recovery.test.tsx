// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
  within,
} from "@testing-library/react";
import { WaypointProvider } from "../../src/react/ui";
import { FormFillPopup } from "../../src/react/form-fill";
import {
  createWaypointClient,
  ConversationReadError,
  type TransportEvent,
} from "../../src/core/client";
import { createFormSession } from "../../src/core/form-session";
import { config } from "../support/client";
afterEach(cleanup);
// The draft tools load before Generate is available.
const toolsReady = () =>
  waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Generate draft" })
        .getAttribute("aria-disabled"),
    ).toBeNull(),
  );
for (const failure of ["transient", "switch"] as const)
  it(`keeps the child creation identity after a ${failure} failure and retries its read`, async () => {
    const cfg = config();
    const subject = {
      key: "draft",
      resource: "items",
      label: "Item",
      route: "/items/new",
      state: "pending" as const,
    };
    const conversation = (id: string) => ({
      protocol: "1.1",
      id,
      title: "Form",
      mode: "form-fill" as const,
      subject,
      messages: [],
      ...(id === "child"
        ? { parentConversationId: "conversation-a", field: "title" }
        : {}),
    });
    cfg.transport.negotiate = async () => ({
      protocol: "1.1",
      capabilities: ["form-fill"],
    });
    let reads = 0;
    cfg.transport.read = async (id) => {
      if (id === "child") {
        if (++reads === 1 && failure !== "switch") {
          throw new Error("Network unavailable");
        }
      }
      return conversation(id);
    };
    const send = vi.spyOn(cfg.transport, "send");
    const client = createWaypointClient(cfg);
    await client.ready;
    if (failure === "switch")
      vi.spyOn(client, "switchConversation").mockRejectedValueOnce(
        new Error("Switch failed"),
      );
    const create = vi.fn(async () => conversation("child"));
    const session = createFormSession({
      fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
      ids: () => "fill",
    });
    render(
      <WaypointProvider client={client}>
        <FormFillPopup
          session={session}
          field="title"
          source={{ create, list: async () => [] }}
          open
          onClose={() => {}}
        />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(send).not.toHaveBeenCalled();
    expect(session.getSnapshot().pending).toBe(false);
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledOnce();
    expect(client.getSnapshot().conversationId).toBe("child");
    client.dispose();
  });

const subject = {
  key: "draft",
  resource: "items",
  label: "Item",
  route: "/items/new",
  state: "pending" as const,
};
const conversation = (id: string) => ({
  protocol: "1.1",
  id,
  title: "Form",
  mode: "form-fill" as const,
  subject,
  messages: [],
  ...(id === "conversation-a"
    ? {}
    : { parentConversationId: "conversation-a", field: "title" }),
});
function formConfig() {
  const cfg = config();
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  cfg.transport.read = async (id) => conversation(id);
  return cfg;
}
function formSession() {
  let serial = 0;
  return createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => `fill-${++serial}`,
  });
}
for (const outcome of ["missing", "loaded"] as const)
  it(`uses the newest ${outcome} child read without a false selection failure`, async () => {
    const cfg = formConfig();
    let listener!: (event: TransportEvent) => void;
    cfg.transport.subscribe = (_id, fn) => {
      listener = fn;
      return () => {};
    };
    let fail!: () => void, settle!: () => void;
    const first = new Promise<void>((resolve) => {
      fail = resolve;
    });
    const next = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let reads = 0;
    cfg.transport.read = async (id) => {
      if (id === "child") {
        if (++reads === 1) {
          await first;
          throw new ConversationReadError(id, 404);
        }
        await next;
        if (outcome === "missing") throw new ConversationReadError(id, 404);
      }
      return conversation(id);
    };
    const send = vi.spyOn(cfg.transport, "send");
    const client = createWaypointClient(cfg);
    await client.ready;
    let creations = 0;
    const create = vi.fn(
      async (
        _input: import("../../src/protocol/generated").CreateConversation,
      ) => conversation(++creations === 1 ? "child" : "replacement"),
    );
    render(
      <WaypointProvider client={client}>
        <FormFillPopup
          session={formSession()}
          field="title"
          source={{ create, list: async () => [] }}
          open
          onClose={() => {}}
        />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(reads).toBe(1));
    act(() => listener({ type: "status", status: "reconnecting" }));
    await act(async () => {
      fail();
      await first;
    });
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      settle();
      await next;
    });
    if (outcome === "missing") {
      await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
      await toolsReady();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
      await waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[1]![0].clientCreationId).not.toBe(
        create.mock.calls[0]![0].clientCreationId,
      );
    } else {
      await waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(create).toHaveBeenCalledOnce();
    }
    client.dispose();
  });
for (const status of [
  "open",
  "unavailable",
  "connecting",
  "reconnecting",
] as const)
  it(`generates in a loaded child with stream status ${status}`, async () => {
    const cfg = formConfig();
    let listener!: (event: TransportEvent) => void;
    cfg.transport.subscribe = (_id, fn) => {
      listener = fn;
      return () => {};
    };
    const subscribe = vi.spyOn(cfg.transport, "subscribe");
    const send = vi
      .spyOn(cfg.transport, "send")
      .mockRejectedValue(new Error("Unavailable"));
    const session = formSession();
    cfg.formSession = session;
    const client = createWaypointClient(cfg);
    await client.ready;
    const select = vi.spyOn(client, "switchConversation");
    const cancel = vi.spyOn(session, "cancel");
    const create = vi.fn(async () => conversation("child"));
    render(
      <WaypointProvider client={client}>
        <FormFillPopup
          session={session}
          field="title"
          source={{ create, list: async () => [] }}
          open
          onClose={() => {}}
        />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    await act(async () => {
      listener({ type: "status", status });
      await client.refresh();
      session.cancel();
    });
    cancel.mockClear();
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(select).toHaveBeenCalledTimes(status === "open" ? 1 : 2);
    expect(subscribe).toHaveBeenCalledTimes(status === "open" ? 2 : 3);
    expect(cancel).toHaveBeenCalledTimes(status === "open" ? 0 : 1);
    expect(create).toHaveBeenCalledOnce();
    client.dispose();
  });
it("retains 100 attempts per client and evicts the oldest before the next insertion", async () => {
  const cfg = formConfig();
  const client = createWaypointClient(cfg);
  await client.ready;
  const create = vi.fn(
    async (
      _input: import("../../src/protocol/generated").CreateConversation,
    ) => {
      throw new Error("Uncertain creation");
    },
  );
  const session = formSession();
  const popup = (field: string) => (
    <WaypointProvider client={client}>
      <FormFillPopup
        session={session}
        field={field}
        source={{ create, list: async () => [] }}
        open
        onClose={() => {}}
      />
    </WaypointProvider>
  );
  const view = render(popup("field-0"));
  const generate = async (field: string) => {
    view.rerender(popup(field));
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Generate draft",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  };
  for (let i = 0; i < 100; i++) await generate(`field-${i}`);
  const oldest = create.mock.calls[0]![0].clientCreationId;
  const second = create.mock.calls[1]![0].clientCreationId;
  await generate("field-0");
  expect(create.mock.lastCall![0].clientCreationId).toBe(oldest);
  await generate("field-100");
  await generate("field-1");
  expect(create.mock.lastCall![0].clientCreationId).toBe(second);
  await generate("field-0");
  expect(create.mock.lastCall![0].clientCreationId).not.toBe(oldest);
  client.dispose();
});

for (const invalid of ["ordinary", "subject"] as const)
  it(`refuses a read-confirmed ${invalid} child instead of trusting creation metadata`, async () => {
    const cfg = formConfig();
    cfg.transport.read = async (id) =>
      id === "child"
        ? {
            ...conversation(id),
            ...(invalid === "ordinary"
              ? { mode: undefined }
              : { subject: { ...subject, key: "other" } }),
          }
        : conversation(id);
    const send = vi.spyOn(cfg.transport, "send");
    const client = createWaypointClient(cfg);
    await client.ready;
    const create = vi.fn(async () => conversation("child"));
    render(
      <WaypointProvider client={client}>
        <FormFillPopup
          session={formSession()}
          field="title"
          source={{ create, list: async () => [] }}
          open
          onClose={() => {}}
        />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(send).not.toHaveBeenCalled();
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
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
    expect(create).toHaveBeenCalledOnce();
    client.dispose();
  });
for (const operation of ["creation", "send", "retry"] as const)
  it(`prunes settled attempts while retaining an in-flight ${operation}`, async () => {
    const cfg = formConfig();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi
      .spyOn(cfg.transport, "send")
      .mockImplementation(async (reply) => {
        if (operation === "retry" && send.mock.calls.length === 1)
          throw new Error("Send unavailable");
        if (operation !== "creation") await gate;
        return { id: reply.clientReplyId };
      });
    const client = createWaypointClient(cfg);
    await client.ready;
    const create = vi.fn(
      async (
        input: import("../../src/protocol/generated").CreateConversation,
      ) => {
        if (input.field === "title") {
          if (operation === "creation") await gate;
          return conversation("child");
        }
        throw new Error("Uncertain creation");
      },
    );
    const source = { create, list: async () => [] };
    const original = render(
      <WaypointProvider client={client}>
        <FormFillPopup
          session={formSession()}
          field="title"
          source={source}
          open
          onClose={() => {}}
        />
      </WaypointProvider>,
    );
    fireEvent.click(
      within(original.container).getByRole("button", {
        name: "Generate draft",
      }),
    );
    await waitFor(() =>
      expect(operation === "creation" ? create : send).toHaveBeenCalledOnce(),
    );
    if (operation === "retry") {
      await waitFor(() =>
        expect(
          within(original.container).getByRole("button", { name: "Retry" }),
        ).toBeDefined(),
      );
      fireEvent.click(
        within(original.container).getByRole("button", { name: "Retry" }),
      );
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    }
    const identity = create.mock.calls[0]![0].clientCreationId;
    const session = formSession();
    const popup = (field: string) => (
      <WaypointProvider client={client}>
        <FormFillPopup
          session={session}
          field={field}
          source={source}
          open
          onClose={() => {}}
        />
      </WaypointProvider>
    );
    const replacement = render(popup("field-0"));
    const button = () =>
      within(replacement.container).getByRole("button", {
        name: "Generate draft",
      }) as HTMLButtonElement;
    const generate = async (field: string) => {
      replacement.rerender(popup(field));
      fireEvent.click(button());
      await waitFor(() => expect(button().disabled).toBe(false));
    };
    for (let i = 0; i < 100; i++) await generate(`field-${i}`);
    const oldestSettled = create.mock.calls[1]![0].clientCreationId;
    await generate("field-0");
    expect(create.mock.lastCall![0].clientCreationId).not.toBe(oldestSettled);
    const calls = create.mock.calls.length;
    replacement.rerender(popup("title"));
    fireEvent.click(button());
    if (operation === "creation") {
      await waitFor(() => expect(create).toHaveBeenCalledTimes(calls + 1));
      expect(create.mock.lastCall![0].clientCreationId).toBe(identity);
    } else {
      await waitFor(() =>
        expect(send).toHaveBeenCalledTimes(operation === "retry" ? 3 : 2),
      );
      expect(create).toHaveBeenCalledTimes(calls);
    }
    replacement.unmount();
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(send).toHaveBeenCalled());
    client.dispose();
  });
it("allows all-active overflow and prunes only after the last operation settles", async () => {
  const cfg = formConfig();
  const client = createWaypointClient(cfg);
  await client.ready;
  const failures = new Map<string, (() => void)[]>();
  const create = vi.fn(
    (input: import("../../src/protocol/generated").CreateConversation) =>
      new Promise<ReturnType<typeof conversation>>((_resolve, reject) => {
        const releases = failures.get(input.field!) ?? [];
        releases.push(() => reject(new Error("Uncertain creation")));
        failures.set(input.field!, releases);
      }),
  );
  const source = { create, list: async () => [] };
  const popup = (field: string) => (
    <FormFillPopup
      session={formSession()}
      field={field}
      source={source}
      open
      onClose={() => {}}
    />
  );
  const view = render(
    <WaypointProvider client={client}>
      {Array.from({ length: 101 }, (_, i) => (
        <div key={i} data-field={`field-${i}`}>
          {popup(`field-${i}`)}
        </div>
      ))}
    </WaypointProvider>,
  );
  const original = within(
    view.container.querySelector('[data-field="field-0"]')! as HTMLElement,
  ).getByRole("button", { name: "Generate draft" }) as HTMLButtonElement;
  for (const button of within(view.container).getAllByRole("button", {
    name: "Generate draft",
  }))
    fireEvent.click(button);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(101));
  const identity = create.mock.calls[0]![0].clientCreationId;
  const duplicate = render(
    <WaypointProvider client={client}>{popup("field-0")}</WaypointProvider>,
  );
  fireEvent.click(
    within(duplicate.container).getByRole("button", { name: "Generate draft" }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledTimes(102));
  expect(create.mock.lastCall![0].clientCreationId).toBe(identity);
  await act(async () => failures.get("field-0")![0]!());
  await waitFor(() => expect(original.disabled).toBe(false));
  const third = render(
    <WaypointProvider client={client}>{popup("field-0")}</WaypointProvider>,
  );
  fireEvent.click(
    within(third.container).getByRole("button", { name: "Generate draft" }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledTimes(103));
  expect(create.mock.lastCall![0].clientCreationId).toBe(identity);
  await act(async () => failures.get("field-0")!.forEach((fail) => fail()));
  fireEvent.click(original);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(104));
  expect(create.mock.lastCall![0].clientCreationId).not.toBe(identity);
  await act(async () => {
    for (const releases of failures.values())
      releases.forEach((fail) => fail());
  });
  client.dispose();
});
it("keeps abandoned identities isolated between clients", async () => {
  const clients = [
    createWaypointClient(formConfig()),
    createWaypointClient(formConfig()),
  ];
  await Promise.all(clients.map((client) => client.ready));
  const create = vi.fn(
    async (
      _input: import("../../src/protocol/generated").CreateConversation,
    ) => {
      throw new Error("Uncertain creation");
    },
  );
  const sessions = clients.map(() => formSession());
  const popup = (i: number) => (
    <WaypointProvider client={clients[i]!}>
      <FormFillPopup
        session={sessions[i]!}
        field="title"
        source={{ create, list: async () => [] }}
        open
        onClose={() => {}}
      />
    </WaypointProvider>
  );
  const view = render(popup(0));
  const generate = async () => {
    const button = screen.getByRole("button", {
      name: "Generate draft",
    }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(false));
  };
  await generate();
  const identity = create.mock.lastCall![0].clientCreationId;
  view.rerender(popup(1));
  await generate();
  expect(create.mock.lastCall![0].clientCreationId).not.toBe(identity);
  view.rerender(popup(0));
  await generate();
  expect(create.mock.lastCall![0].clientCreationId).toBe(identity);
  clients.forEach((client) => client.dispose());
});

for (const status of [404, 410, 503])
  for (const failureFirst of [false, true])
    it(`resolves a just-loaded child when the newer ${status} finishes ${failureFirst ? "first" : "last"}`, async () => {
      const cfg = formConfig();
      let listener!: (event: TransportEvent) => void;
      cfg.transport.subscribe = (_id, fn) => {
        listener = fn;
        return () => {};
      };
      let load!: () => void, fail!: () => void;
      const loaded = new Promise<void>((resolve) => {
        load = resolve;
      });
      const failed = new Promise<void>((resolve) => {
        fail = resolve;
      });
      let reads = 0;
      cfg.transport.read = async (id) => {
        if (id === "child") {
          if (++reads === 1) await loaded;
          else if (reads === 2) {
            await failed;
            throw new ConversationReadError(id, status);
          }
        }
        return conversation(id);
      };
      const send = vi
        .spyOn(cfg.transport, "send")
        .mockRejectedValueOnce(new Error("Send unavailable"));
      const client = createWaypointClient(cfg);
      await client.ready;
      const create = vi.fn(async () => conversation("child"));
      const session = formSession();
      render(
        <WaypointProvider client={client}>
          <FormFillPopup
            session={session}
            field="title"
            source={{ create, list: async () => [] }}
            open
            onClose={() => {}}
          />
        </WaypointProvider>,
      );
      await toolsReady();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
      await waitFor(() => expect(reads).toBe(1));
      act(() => listener({ type: "status", status: "open" }));
      if (failureFirst) {
        await act(async () => {
          fail();
          await failed;
        });
        await waitFor(() =>
          expect(client.getSnapshot().problem?.id).toBe("conversation-read"),
        );
        await act(async () => {
          load();
          await loaded;
        });
      } else {
        await act(async () => {
          load();
          await loaded;
        });
        await waitFor(() =>
          expect(client.getSnapshot().conversation?.id).toBe("child"),
        );
        await act(async () => {
          fail();
          await failed;
        });
      }
      await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
      if (status === 404 || status === 410) {
        expect(send).not.toHaveBeenCalled();
        expect(client.getSnapshot().conversation).toBeNull();
      } else {
        expect(send).toHaveBeenCalledOnce();
        act(() => session.cancel());
      }
      await toolsReady();
      fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
      await waitFor(() =>
        expect(send).toHaveBeenCalledTimes(status === 503 ? 2 : 1),
      );
      expect(create).toHaveBeenCalledTimes(status === 503 ? 1 : 2);
      client.dispose();
    });

for (const status of [404, 410, 503, "network"] as const)
  it(`reselects a loaded child after a subsequent ${status} read failure`, async () => {
    const cfg = formConfig();
    let listener!: (event: TransportEvent) => void;
    cfg.transport.subscribe = (_id, fn) => {
      listener = fn;
      return () => {};
    };
    let failing = false;
    cfg.transport.read = async (id) => {
      if (id === "child" && failing) {
        if (typeof status === "number")
          throw new ConversationReadError(id, status);
        throw new Error("Network unavailable");
      }
      return conversation(id);
    };
    const send = vi
      .spyOn(cfg.transport, "send")
      .mockRejectedValueOnce(new Error("Send unavailable"));
    const client = createWaypointClient(cfg);
    await client.ready;
    const select = vi.spyOn(client, "switchConversation");
    const create = vi.fn(async () => conversation("child"));
    const session = formSession();
    render(
      <WaypointProvider client={client}>
        <FormFillPopup
          session={session}
          field="title"
          source={{ create, list: async () => [] }}
          open
          onClose={() => {}}
        />
      </WaypointProvider>,
    );
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    await act(async () => {
      listener({ type: "status", status: "open" });
      await client.refresh();
      session.cancel();
      failing = true;
      await client.refresh();
    });
    expect(client.getSnapshot().conversation?.id).toBe(
      status === 404 || status === 410 ? undefined : "child",
    );
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(select).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(send).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    failing = false;
    await toolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledTimes(
      status === 404 || status === 410 ? 2 : 1,
    );
    client.dispose();
  });

it("reselects a loaded child while its replacement subscription has no status", async () => {
  const cfg = formConfig();
  let listener!: (event: TransportEvent) => void;
  cfg.transport.subscribe = (_id, fn) => {
    listener = fn;
    return () => {};
  };
  const send = vi
    .spyOn(cfg.transport, "send")
    .mockRejectedValueOnce(new Error("Send unavailable"));
  const client = createWaypointClient(cfg);
  await client.ready;
  const select = vi.spyOn(client, "switchConversation");
  const create = vi.fn(async () => conversation("child"));
  const session = formSession();
  render(
    <WaypointProvider client={client}>
      <FormFillPopup
        session={session}
        field="title"
        source={{ create, list: async () => [] }}
        open
        onClose={() => {}}
      />
    </WaypointProvider>,
  );
  await toolsReady();
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  await act(async () => {
    listener({ type: "status", status: "open" });
    await client.refresh();
    await client.switchConversation("child");
    session.cancel();
  });
  await toolsReady();
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(select).toHaveBeenCalledTimes(3);
  expect(create).toHaveBeenCalledOnce();
  client.dispose();
});
