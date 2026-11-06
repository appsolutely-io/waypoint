// @vitest-environment jsdom
// The chat never takes focus from anything outside it, arriving content
// never takes focus, and only explicit user actions in the chat move it.
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
import { createPortal } from "react-dom";
import type { ComponentType } from "react";
import { WaypointChat, type ButtonProps } from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { english } from "../../src/react/i18n";
import { deepActiveElement, keptOrigins } from "../../src/react/focus";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.body.removeAttribute("tabindex");
});
const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
// Focus placed outside the chat: each target and how to focus it.
type Outside = { name: string; focus(): Element };
const outside = (): Outside[] => [
  {
    name: "host button",
    focus: () => {
      const element = document.createElement("button");
      element.textContent = "Host";
      document.body.append(element);
      element.focus();
      return element;
    },
  },
  {
    name: "host link",
    focus: () => {
      const element = document.createElement("a");
      element.href = "#host";
      element.textContent = "Host link";
      document.body.append(element);
      element.focus();
      return element;
    },
  },
  {
    name: "host input",
    focus: () => {
      const element = document.createElement("input");
      document.body.append(element);
      element.focus();
      return element;
    },
  },
  {
    name: "host shadow editor",
    focus: () => {
      const host = document.createElement("div");
      document.body.append(host);
      const input = document.createElement("input");
      host.attachShadow({ mode: "open" }).append(input);
      input.focus();
      return input;
    },
  },
  {
    name: "page body",
    focus: () => {
      document.body.tabIndex = -1;
      document.body.focus();
      return document.body;
    },
  },
];
const conversation = (id: string, messages: Message[] = []): Conversation =>
  ({ protocol: "1.0", id, title: id, messages }) as Conversation;
const card = (id: string): Message =>
  ({
    id,
    role: "assistant",
    content: "",
    createdAt: 0,
    status: "completed",
    blocks: [
      {
        type: "card",
        id: `${id}-card`,
        fallback: "Question",
        body: {
          title: "Question",
          blocks: [
            {
              type: "choice",
              id: `${id}-choice`,
              fallback: "Pick",
              body: { mode: "single", options: ["One"] },
            },
          ],
        },
      },
    ],
  }) as unknown as Message;
const composer = () => screen.getByRole("textbox", { name: "Message" });

describe.each(skins)("focus around the chat (%s)", (_, skin) => {
  it.each(outside().map((target) => [target.name, target] as const))(
    "CK-F1 mount does not take focus from a %s",
    async (_, target) => {
      const focused = target.focus();
      const client = createWaypointClient(config());
      render(<WaypointChat client={client} {...skin} />);
      await act(async () => {
        await client.ready;
      });
      expect(deepActiveElement(document)).toBe(focused);
      client.dispose();
    },
  );
  it("CK-F1-nothing with nothing focused, mount focuses nothing", async () => {
    const client = createWaypointClient(config());
    render(<WaypointChat client={client} {...skin} />);
    await act(async () => {
      await client.ready;
    });
    expect(document.activeElement).toBe(document.body);
    client.dispose();
  });
  it("CK-F2 a switch the user starts from the rail focuses the composer", async () => {
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id) => conversation(id),
      },
    });
    render(
      <WaypointChat
        client={client}
        {...skin}
        conversations={[{ id: "conversation-b", title: "Other" }]}
      />,
    );
    await act(async () => {
      await client.ready;
    });
    const item = screen.getByRole("button", { name: "Other" });
    item.focus();
    fireEvent.click(item);
    await waitFor(() =>
      expect(client.getSnapshot().conversationId).toBe("conversation-b"),
    );
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    client.dispose();
  });
  it("CK-F2-held focus that moved to the host while the switch settles stays there", async () => {
    const base = config();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id) => {
          if (id === "conversation-b") await held;
          return conversation(id);
        },
      },
    });
    render(
      <WaypointChat
        client={client}
        {...skin}
        conversations={[{ id: "conversation-b", title: "Other" }]}
      />,
    );
    await act(async () => {
      await client.ready;
    });
    const item = screen.getByRole("button", { name: "Other" });
    item.focus();
    fireEvent.click(item);
    const host = outside()[2]!.focus();
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(client.getSnapshot().conversationId).toBe("conversation-b");
    expect(document.activeElement).toBe(host);
    client.dispose();
  });
  it("CK-F2-superseded a rail switch overtaken by a host switch before it settles moves no focus", async () => {
    const base = config();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id) => {
          if (id === "conversation-b") await held;
          return conversation(id);
        },
      },
    });
    render(
      <WaypointChat
        client={client}
        {...skin}
        conversations={[{ id: "conversation-b", title: "Other" }]}
      />,
    );
    await act(async () => {
      await client.ready;
    });
    const item = screen.getByRole("button", { name: "Other" });
    item.focus();
    fireEvent.click(item);
    await act(async () => {
      const host = client.switchConversation("conversation-c");
      release();
      await host;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(client.getSnapshot().conversationId).toBe("conversation-c");
    expect(document.activeElement).not.toBe(composer());
    client.dispose();
  });
  it("CK-F3 a switch the host starts moves no focus, even from inside the chat", async () => {
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id) => conversation(id),
      },
    });
    render(<WaypointChat client={client} {...skin} />);
    await act(async () => {
      await client.ready;
    });
    const tab = screen.getAllByRole("tab")[0]!;
    tab.focus();
    await act(async () => {
      await client.switchConversation("conversation-b");
    });
    expect(document.activeElement).toBe(tab);
    client.dispose();
  });
  it.each([
    ...outside().map((target) => [target.name, target] as const),
    [
      "a control inside the chat",
      {
        name: "inside",
        focus: () => {
          const tab = screen.getAllByRole("tab")[0]!;
          tab.focus();
          return tab;
        },
      },
    ] as const,
  ])(
    "CK-F4 an arriving card does not take focus from %s",
    async (_, target) => {
      const base = config();
      let messages: Message[] = [];
      const client = createWaypointClient({
        ...base,
        transport: {
          ...base.transport,
          read: async (id) => conversation(id, messages),
        },
      });
      render(<WaypointChat client={client} {...skin} />);
      await act(async () => {
        await client.ready;
      });
      const focused = target.focus();
      messages = [card("message-b")];
      await act(async () => {
        await client.refresh();
      });
      expect(screen.getByText("Question")).toBeTruthy();
      expect(deepActiveElement(document)).toBe(focused);
      client.dispose();
    },
  );
  it.each([
    ...outside()
      .filter((target) => target.name !== "host input")
      .map((target) => [target.name, target] as const),
  ])(
    "CK-F7 a / pressed on a %s outside the chat moves nothing",
    async (_, target) => {
      const client = createWaypointClient(config());
      render(<WaypointChat client={client} {...skin} />);
      await act(async () => {
        await client.ready;
      });
      const focused = target.focus();
      fireEvent.keyDown(focused, { key: "/", composed: true, bubbles: true });
      expect(deepActiveElement(document)).toBe(focused);
      client.dispose();
    },
  );
  it("CK-F7-inside a / pressed on a chat control focuses the composer; in a chat input it does nothing", async () => {
    const client = createWaypointClient(config());
    render(<WaypointChat client={client} {...skin} />);
    await act(async () => {
      await client.ready;
    });
    const tab = screen.getAllByRole("tab")[0]!;
    tab.focus();
    fireEvent.keyDown(tab, { key: "/" });
    expect(document.activeElement).toBe(composer());
    fireEvent.keyDown(composer(), { key: "/" });
    expect(document.activeElement).toBe(composer());
    client.dispose();
  });
  it("CK-U1 shortcuts.global no longer moves focus from the host", async () => {
    const client = createWaypointClient(config());
    render(
      <WaypointChat client={client} {...skin} shortcuts={{ global: true }} />,
    );
    await act(async () => {
      await client.ready;
    });
    const host = outside()[0]!.focus();
    fireEvent.keyDown(host, { key: "/" });
    expect(document.activeElement).toBe(host);
    const shadowEditor = outside()[3]!.focus();
    fireEvent.keyDown(shadowEditor, {
      key: "/",
      composed: true,
      bubbles: true,
    });
    expect(deepActiveElement(document)).toBe(shadowEditor);
    client.dispose();
  });
  it("CK-F8-portal a flow tab portalled outside the chat moves nothing on arrow keys; the root shortcut neither", async () => {
    const away = document.createElement("div");
    document.body.append(away);
    const Base = (
      skin as { primitives?: { button?: ComponentType<ButtonProps> } }
    ).primitives?.button;
    const Button = (props: ButtonProps) => {
      const button = Base ? (
        <Base {...props} />
      ) : (
        <button
          type="button"
          role={props.role}
          aria-selected={props["aria-selected"]}
          tabIndex={props.tabIndex}
          aria-label={props.label}
          onClick={() => props.onPress?.()}
        >
          {props.children}
        </button>
      );
      return props.role === "tab" && props.label === "Favourites"
        ? createPortal(button, away)
        : button;
    };
    const client = createWaypointClient(config());
    render(
      <WaypointChat
        client={client}
        {...skin}
        primitives={{
          ...((skin as { primitives?: object }).primitives ?? {}),
          button: Button,
        }}
      />,
    );
    await act(async () => {
      await client.ready;
    });
    const portalled = away.querySelector<HTMLElement>('[role="tab"]')!;
    portalled.focus();
    for (const key of ["ArrowRight", "Home", "End", "/"]) {
      fireEvent.keyDown(portalled, { key });
      expect(document.activeElement).toBe(portalled);
    }
    client.dispose();
  });
  it("CK-F8-guards each guard alone stops a move: a key from outside while focus is inside, and a key on the chat while focus is outside", async () => {
    const away = document.createElement("button");
    document.body.append(away);
    const client = createWaypointClient(config());
    render(<WaypointChat client={client} {...skin} />);
    await act(async () => {
      await client.ready;
    });
    const tabs = screen.getAllByRole("tab");
    // A key event that started outside, while focus rests on a chat tab.
    tabs[0]!.focus();
    const list = tabs[0]!.closest('[role="tablist"]')!;
    const fromOutside = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    });
    Object.defineProperty(fromOutside, "composedPath", {
      value: () => [away, list],
    });
    list.dispatchEvent(fromOutside);
    expect(document.activeElement).toBe(tabs[0]);
    const slash = new KeyboardEvent("keydown", { key: "/", bubbles: true });
    Object.defineProperty(slash, "composedPath", {
      value: () => [away, list],
    });
    list.dispatchEvent(slash);
    expect(document.activeElement).toBe(tabs[0]);
    // A key on the chat's own tab while focus is on the host.
    away.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(away);
    fireEvent.keyDown(tabs[0]!, { key: "/" });
    expect(document.activeElement).toBe(away);
    client.dispose();
  });
  it("CK-F2-flow a flow run the user starts from the flow tabs focuses the composer in the conversation it opens", async () => {
    const base = config();
    const client = createWaypointClient({
      ...base,
      tabs: ["presets"],
      transport: {
        ...base.transport,
        read: async (id) => conversation(id),
      },
      flowSource: {
        list: () => [{ id: "flow-a", title: "Run report" }],
        setFavourite: () => {},
        run: () => ({ conversationId: "conversation-b" }),
      },
    });
    await client.ready;
    await client.loadFlows();
    render(<WaypointChat client={client} {...skin} />);
    const run = screen.getByRole("button", { name: "Run report" });
    run.focus();
    fireEvent.click(run);
    await waitFor(() =>
      expect(client.getSnapshot().conversationId).toBe("conversation-b"),
    );
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    client.dispose();
  });
  it.each(["a host switch", "a newer flow that fails"])(
    "CK-F2-flow-superseded a flow overtaken by %s before its result moves no focus",
    async (overtaken) => {
      const base = config();
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const client = createWaypointClient({
        ...base,
        tabs: ["presets"],
        transport: {
          ...base.transport,
          read: async (id) => conversation(id),
        },
        flowSource: {
          list: () => [
            { id: "flow-a", title: "Run report" },
            { id: "flow-b", title: "Run other" },
          ],
          setFavourite: () => {},
          run: async (id) => {
            if (id === "flow-b") throw new Error("flow failed");
            await held;
            return { conversationId: "conversation-b" };
          },
        },
      });
      await client.ready;
      await client.loadFlows();
      render(<WaypointChat client={client} {...skin} />);
      const run = screen.getByRole("button", { name: "Run report" });
      run.focus();
      fireEvent.click(run);
      await act(async () => {
        if (overtaken === "a host switch")
          await client.switchConversation("conversation-c");
        else {
          const other = screen.getByRole("button", { name: "Run other" });
          other.focus();
          fireEvent.click(other);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        release();
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      expect(document.activeElement).not.toBe(composer());
      client.dispose();
    },
  );
  it("CK-F2-flow-client a flow held on a replaced client moves no focus in its replacement", async () => {
    const base = config();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const old = createWaypointClient({
      ...base,
      tabs: ["presets"],
      transport: { ...base.transport, read: async (id) => conversation(id) },
      flowSource: {
        list: () => [{ id: "flow-a", title: "Run report" }],
        setFavourite: () => {},
        run: async () => {
          await held;
          return { conversationId: "conversation-b" };
        },
      },
    });
    const next = createWaypointClient({
      ...base,
      conversationId: "conversation-b",
      tabs: ["presets"],
      transport: { ...base.transport, read: async (id) => conversation(id) },
      flowSource: {
        list: () => [{ id: "flow-a", title: "Run report" }],
        setFavourite: () => {},
        run: () => ({ conversationId: "conversation-b" }),
      },
    });
    await old.ready;
    await old.loadFlows();
    await next.ready;
    await next.loadFlows();
    const view = render(<WaypointChat client={old} {...skin} />);
    const run = screen.getByRole("button", { name: "Run report" });
    run.focus();
    fireEvent.click(run);
    view.rerender(<WaypointChat client={next} {...skin} />);
    await waitFor(() =>
      expect(next.getSnapshot().conversation?.id).toBe("conversation-b"),
    );
    const before = document.activeElement;
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(document.activeElement).toBe(before);
    expect(document.activeElement).not.toBe(composer());
    old.dispose();
    next.dispose();
  });
  it("CK-FU10 a flow run that fails says so with a Retry that runs it again; focus stays on the button", async () => {
    const base = config();
    let runs = 0;
    const client = createWaypointClient({
      ...base,
      tabs: ["presets"],
      transport: { ...base.transport, read: async (id) => conversation(id) },
      flowSource: {
        list: () => [{ id: "flow-a", title: "Run report" }],
        setFavourite: () => {},
        run: async () => {
          runs++;
          throw new Error("flow failed");
        },
      },
    });
    await client.ready;
    await client.loadFlows();
    render(<WaypointChat client={client} {...skin} />);
    const run = screen.getByRole("button", { name: "Run report" });
    run.focus();
    await act(async () => {
      fireEvent.click(run);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const alert = await screen.findByRole("alert", {
      name: (_, element) =>
        element.textContent?.includes(english["chat.failure"]) ?? false,
    });
    expect(document.activeElement).toBe(run);
    await act(async () => {
      fireEvent.click(
        within(alert).getByRole("button", { name: english["chat.retry"] }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(runs).toBe(2);
    client.dispose();
  });
  it("CK-FU3 flow runs that open nothing, or a conversation not shown, keep no origin", async () => {
    const base = config();
    let next: string | undefined;
    const client = createWaypointClient({
      ...base,
      tabs: ["presets"],
      transport: { ...base.transport, read: async (id) => conversation(id) },
      flowSource: {
        list: () => [{ id: "flow-a", title: "Run report" }],
        setFavourite: () => {},
        run: () => (next ? { conversationId: next } : undefined) as never,
      },
    });
    await client.ready;
    await client.loadFlows();
    render(<WaypointChat client={client} {...skin} />);
    const before = keptOrigins(document);
    for (const target of [undefined, "conversation-a", undefined]) {
      next = target;
      const run = screen.getByRole("button", { name: "Run report" });
      run.focus();
      await act(async () => {
        fireEvent.click(run);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    expect(keptOrigins(document)).toBe(before);
    client.dispose();
  });
  it.each(["a transient failure", "a missing conversation"])(
    "CK-F2-failed a rail switch whose read ends in %s moves no focus",
    async (outcome) => {
      const base = config();
      const client = createWaypointClient({
        ...base,
        transport: {
          ...base.transport,
          read: async (id) => {
            if (id !== "conversation-b") return conversation(id);
            if (outcome === "a transient failure") throw new Error("offline");
            throw Object.assign(new Error("gone"), { status: 404 });
          },
        },
      });
      render(
        <WaypointChat
          client={client}
          {...skin}
          conversations={[{ id: "conversation-b", title: "Other" }]}
        />,
      );
      await act(async () => {
        await client.ready;
      });
      const item = screen.getByRole("button", { name: "Other" });
      item.focus();
      fireEvent.click(item);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      expect(client.getSnapshot().conversation?.id).not.toBe("conversation-b");
      expect(document.activeElement).not.toBe(composer());
      client.dispose();
    },
  );
  it("CK-F8-inside arrow keys on the chat's own tablist move between its tabs", async () => {
    const client = createWaypointClient(config());
    render(<WaypointChat client={client} {...skin} />);
    await act(async () => {
      await client.ready;
    });
    const tabs = screen.getAllByRole("tab");
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[1]);
    client.dispose();
  });
});
