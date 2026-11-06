// @vitest-environment jsdom
// Drawers move focus into themselves only when an action in the chat opened
// them, and back to their opener only while focus is still theirs.
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  memo,
  StrictMode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ConfirmSheet, WaypointProvider } from "../../src/react/index";
import { FieldAdornment } from "../../src/react/field-adornment";
import { FormFillPopup } from "../../src/react/form-fill";
import { createFormSession } from "../../src/core/form-session";
import { antdPrimitives } from "../../src/skin-antd/index";
import { ChatFocusContext, useChatFocusRoot } from "../../src/react/chat-focus";
import { deepActiveElement, keptOrigins } from "../../src/react/focus";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";

// Each fixture builds its client once and the test run disposes it.
const clients: ReturnType<typeof createWaypointClient>[] = [];
const ownedClient = () => {
  const client = createWaypointClient(config());
  clients.push(client);
  return client;
};
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.dispose();
  document.body.innerHTML = "";
  document.body.removeAttribute("tabindex");
});
const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
const outside: [string, () => Element][] = [
  [
    "host button",
    () => {
      const element = document.createElement("button");
      document.body.append(element);
      element.focus();
      return element;
    },
  ],
  [
    "host link",
    () => {
      const element = document.createElement("a");
      element.href = "#host";
      document.body.append(element);
      element.focus();
      return element;
    },
  ],
  [
    "host input",
    () => {
      const element = document.createElement("input");
      document.body.append(element);
      element.focus();
      return element;
    },
  ],
  [
    "host shadow editor",
    () => {
      const host = document.createElement("div");
      document.body.append(host);
      const input = document.createElement("input");
      host.attachShadow({ mode: "open" }).append(input);
      input.focus();
      return input;
    },
  ],
  [
    "page body",
    () => {
      document.body.tabIndex = -1;
      document.body.focus();
      return document.body;
    },
  ],
];

// A chat root as the chat provides it, with a transcript box.
function Chat({
  children,
  conversationId = "c",
}: {
  children: ReactNode;
  conversationId?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const focus = useChatFocusRoot(root, conversationId, composer, transcript);
  return (
    <ChatFocusContext.Provider value={focus.value}>
      <section ref={root} {...focus.captureProps} data-testid="chat">
        <div ref={transcript} tabIndex={-1} data-testid="transcript" />
        {children}
      </section>
    </ChatFocusContext.Provider>
  );
}
interface Control {
  open?(value: boolean): void;
  conversation?(id: string): void;
  // How many times the sheet's cancel ran.
  cancelled?: number;
}
function App({
  skin,
  control,
  opener = true,
  nested = false,
  openerDisabled = false,
  openerInput,
  beforeOpenEffect,
}: {
  skin: object;
  control: Control;
  opener?: boolean;
  // The opener's label is a nested element, which the press lands on.
  nested?: boolean;
  openerDisabled?: boolean;
  // The opener is an input of this type ("button", or "hidden" once it
  // can no longer take focus).
  openerInput?: "button" | "hidden";
  // Runs in a layout effect of an ancestor after the drawer's first commit.
  beforeOpenEffect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState("c");
  control.open = setOpen;
  control.conversation = setConversation;
  const [client] = useState(ownedClient);
  useLayoutEffect(() => {
    if (open) beforeOpenEffect?.();
  }, [open, beforeOpenEffect]);
  return (
    <WaypointProvider client={client} {...skin}>
      <Chat conversationId={conversation}>
        {opener && openerInput ? (
          <input
            type={openerInput}
            value="Open"
            aria-label="Open"
            onClick={() => setOpen(true)}
          />
        ) : opener ? (
          <button
            type="button"
            disabled={openerDisabled}
            onClick={() => setOpen(true)}
          >
            {nested ? <span data-testid="opener-label">Open</span> : "Open"}
          </button>
        ) : null}
        {open ? (
          <ConfirmSheet
            title="Keep these changes"
            body="Keep them?"
            onProceed={() => setOpen(false)}
            onCancel={() => {
              control.cancelled = (control.cancelled ?? 0) + 1;
              setOpen(false);
            }}
          />
        ) : null}
      </Chat>
    </WaypointProvider>
  );
}
// A host that renders the sheet behind a memo, so a conversation change
// reaches it only through the chat's own context.
const MemoSheet = memo(function MemoSheet({
  onCancel,
}: {
  onCancel: () => void;
}) {
  return (
    <ConfirmSheet
      title="Keep these changes"
      body="Keep them?"
      onProceed={onCancel}
      onCancel={onCancel}
    />
  );
});
function MemoApp({ skin, control }: { skin: object; control: Control }) {
  const [open, setOpen] = useState(true);
  const [conversation, setConversation] = useState("c");
  control.conversation = setConversation;
  const [client] = useState(ownedClient);
  const cancel = useCallback(() => {
    control.cancelled = (control.cancelled ?? 0) + 1;
    setOpen(false);
  }, [control]);
  return (
    <WaypointProvider client={client} {...skin}>
      <Chat conversationId={conversation}>
        {open ? <MemoSheet onCancel={cancel} /> : null}
      </Chat>
    </WaypointProvider>
  );
}
// A host button primitive that draws its button inside a shadow root.
function ShadowButton({
  children,
  onPress,
}: {
  children?: ReactNode;
  onPress?(): void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const press = useRef(onPress);
  press.current = onPress;
  useLayoutEffect(() => {
    const element = host.current!;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(children);
    button.addEventListener("click", () => press.current?.());
    (
      element.shadowRoot ?? element.attachShadow({ mode: "open" })
    ).replaceChildren(button);
  }, [children]);
  return <span ref={host} data-shadow-button={String(children)} />;
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const openButton = () => screen.getByRole("button", { name: "Open" });
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe.each(skins)("drawer focus (%s)", (_, skin) => {
  it("CK-R6 a drawer opened by a press in the chat takes focus", async () => {
    render(<App skin={skin} control={{}} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.contains(deepActiveElement(document))).toBe(true);
  });
  it.each(outside)(
    "a modal the host opens enters its dialog from a %s",
    async (_, focusOutside) => {
      const control: Control = {};
      render(<App skin={skin} control={control} />);
      focusOutside();
      act(() => control.open!(true));
      await wait(0);
      expect(dialog()).not.toBeNull();
      expect(deepActiveElement(document)).toBe(dialog());
    },
  );
  it("a modal the host opens enters its dialog from inside the chat", async () => {
    const control: Control = {};
    render(<App skin={skin} control={control} />);
    openButton().focus();
    act(() => control.open!(true));
    await wait(0);
    expect(document.activeElement).toBe(dialog());
  });
  it.each(outside)(
    "CK-R7-race a host focus on a %s between the opening render and its effect keeps focus there",
    async (_, focusOutside) => {
      let focused: Element | undefined;
      render(
        <App
          skin={skin}
          control={{}}
          beforeOpenEffect={() => {
            focused = focusOutside();
          }}
        />,
      );
      openButton().focus();
      fireEvent.click(openButton());
      await wait(400);
      expect(dialog()).not.toBeNull();
      expect(deepActiveElement(document)).toBe(focused);
    },
  );
  it("preserves a programmatic opener through StrictMode replay in a chat", async () => {
    const control: Control = {};
    render(
      <StrictMode>
        <App skin={skin} control={control} />
      </StrictMode>,
    );
    openButton().focus();
    act(() => control.open!(true));
    await wait(0);
    expect(deepActiveElement(document)).toBe(dialog());
    act(() => control.open!(false));
    await wait(0);
    expect(deepActiveElement(document)).toBe(openButton());
  });
  it("CK-R8 closing from inside the drawer returns focus to its opener", async () => {
    render(<App skin={skin} control={{}} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(openButton());
  });
  it("CK-G-lifetime a drawer's origin ends with its way back, and with the chat", async () => {
    const view = render(<App skin={skin} control={{}} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    expect(keptOrigins(document)).toBe(1);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(keptOrigins(document)).toBe(0);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    expect(keptOrigins(document)).toBe(1);
    view.unmount();
    expect(keptOrigins(document)).toBe(0);
  });
  it("CK-R8-nested a press on the opener's nested label returns focus to the opener button", async () => {
    render(<App skin={skin} control={{}} nested />);
    openButton().focus();
    fireEvent.click(screen.getByTestId("opener-label"));
    await wait(0);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.contains(deepActiveElement(document))).toBe(true);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(openButton());
  });
  it("CK-R8-disabled with its opener disabled meanwhile, focus goes to the transcript box", async () => {
    const control: Control = {};
    const view = render(<App skin={skin} control={control} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    view.rerender(<App skin={skin} control={control} openerDisabled />);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(document.activeElement).toBe(screen.getByTestId("transcript"));
  });
  it("CK-R8-unfocusable an opener that can no longer take focus falls back to the transcript box", async () => {
    const control: Control = {};
    const view = render(
      <App skin={skin} control={control} openerInput="button" />,
    );
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    view.rerender(<App skin={skin} control={control} openerInput="hidden" />);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(document.activeElement).toBe(screen.getByTestId("transcript"));
  });
  it("CK-R8-css-hidden an opener hidden by CSS (not rendered) falls back to the transcript box", async () => {
    render(<App skin={skin} control={{}} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    // jsdom does no layout: the browser's own answer for a display:none
    // element is stood in for.
    const opener = openButton();
    Object.defineProperty(opener, "checkVisibility", { value: () => false });
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(document.activeElement).toBe(screen.getByTestId("transcript"));
  });
  it("CK-R8-missed an opener whose focus does not land falls back to the transcript box", async () => {
    render(<App skin={skin} control={{}} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    // It looks focusable but refuses focus, as some host controls do.
    Object.defineProperty(openButton(), "focus", { value: () => {} });
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(document.activeElement).toBe(screen.getByTestId("transcript"));
  });
  it("CK-R8-shadow closing from a Cancel button inside a shadow root returns focus to the opener", async () => {
    const shadowSkin = {
      primitives: {
        ...(("primitives" in skin ? skin.primitives : {}) as object),
        button: ShadowButton,
      },
    };
    render(<App skin={shadowSkin} control={{}} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    expect(dialog()).not.toBeNull();
    const cancel = document
      .querySelector('[data-shadow-button="Cancel"]')!
      .shadowRoot!.querySelector("button")!;
    cancel.focus();
    expect(deepActiveElement(document)).toBe(cancel);
    cancel.click();
    await wait(0);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(openButton());
  });
  it("CK-R8-gone with its opener gone, focus goes to the transcript box", async () => {
    const control: Control = {};
    const view = render(<App skin={skin} control={control} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    view.rerender(<App skin={skin} control={control} opener={false} />);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(document.activeElement).toBe(screen.getByTestId("transcript"));
  });
  it.each(outside)(
    "CK-R9 a drawer closed after the user moved to a %s does not take focus back",
    async (_, focusOutside) => {
      const control: Control = {};
      render(<App skin={skin} control={control} />);
      openButton().focus();
      fireEvent.click(openButton());
      await wait(0);
      const focused = focusOutside();
      act(() => control.open!(false));
      // Past any close animation.
      await wait(600);
      expect(deepActiveElement(document)).toBe(focused);
    },
  );
  it("CK-R9-inside a drawer closed while focus is elsewhere in the chat does not move it", async () => {
    const control: Control = {};
    render(<App skin={skin} control={control} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    const transcript = screen.getByTestId("transcript");
    transcript.focus();
    act(() => control.open!(false));
    await wait(0);
    expect(document.activeElement).toBe(transcript);
  });
  it("CK-R10 a conversation change while the drawer is open closes it, and never puts focus into the new conversation", async () => {
    const control: Control = {};
    render(<App skin={skin} control={control} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    expect(dialog()).not.toBeNull();
    // Only the conversation changes; nothing else closes the sheet.
    act(() => control.conversation!("d"));
    await wait(0);
    expect(dialog()).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(control.cancelled).toBe(1);
    expect(document.activeElement).not.toBe(openButton());
    expect(document.activeElement).not.toBe(screen.getByTestId("transcript"));
  });
  it("CK-R10-memo a sheet behind a host memo also closes on a conversation change", async () => {
    const control: Control = {};
    render(<MemoApp skin={skin} control={control} />);
    await wait(0);
    expect(dialog()).not.toBeNull();
    act(() => control.conversation!("d"));
    await wait(0);
    expect(dialog()).toBeNull();
    expect(control.cancelled).toBe(1);
  });
  it("CK-G4-drawer-shadow a drawer of a chat in a shadow root puts the page behind it out of reach, across the host", async () => {
    const before = document.createElement("button");
    before.textContent = "Before the host";
    document.body.append(before);
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    shadow.append(container);
    const view = render(<App skin={skin} control={{}} />, { container });
    const open = within(container).getByRole("button", { name: "Open" });
    open.focus();
    fireEvent.click(open);
    await wait(0);
    const sheet = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(sheet.closest("[inert]")).toBeNull();
    expect(open.closest("[inert]")).not.toBeNull();
    expect(before.closest("[inert]")).not.toBeNull();
    expect(host.closest("[inert]")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(before.closest("[inert]")).toBeNull();
    expect(open.closest("[inert]")).toBeNull();
    expect(deepActiveElement(document)).toBe(open);
    view.unmount();
    before.remove();
    host.remove();
  });
  it("CK-G4-drawer-inert while the sheet is open nothing outside it is reachable; what the host made inert stays so", async () => {
    const kept = document.createElement("div");
    kept.setAttribute("inert", "");
    document.body.append(kept);
    render(<App skin={skin} control={{}} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    expect(openButton().closest("[inert]")).not.toBeNull();
    expect(dialog()!.closest("[inert]")).toBeNull();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    await wait(0);
    expect(openButton().closest("[inert]")).toBeNull();
    expect(kept.hasAttribute("inert")).toBe(true);
    kept.remove();
  });
  it("CK-L1 the close button is named by the chat, its glyph decorative", async () => {
    render(<App skin={skin} control={{}} />);
    openButton().focus();
    fireEvent.click(openButton());
    await wait(0);
    const close = within(dialog()!).getByRole("button", { name: "Close" });
    for (const glyph of close.querySelectorAll("span"))
      if (glyph.textContent === "×")
        expect(glyph.getAttribute("aria-hidden")).toBe("true");
  });
});

// A host form field with its adornment, opening the form-fill popup.
function FormHost({
  skin,
  control,
  opens = true,
}: {
  skin: object;
  control: Control;
  // Whether pressing the adornment opens the popup at all.
  opens?: boolean;
}) {
  const [open, setOpen] = useState(false);
  control.open = setOpen;
  const [client] = useState(ownedClient);
  const [session] = useState(() =>
    createFormSession({
      fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
      ids: () => "fill",
    }),
  );
  return (
    <WaypointProvider client={client} {...skin}>
      <FieldAdornment
        label="Draft title"
        onRegenerate={() => {
          if (opens) setOpen(true);
        }}
      >
        <input aria-label="Title" />
      </FieldAdornment>
      <FormFillPopup
        session={session}
        field="title"
        open={open}
        onClose={() => setOpen(false)}
      />
    </WaypointProvider>
  );
}
describe.each(skins)("the form-fill popup's focus (%s)", (_, skin) => {
  const adornmentShown = () =>
    !screen
      .getByRole("button", { name: "Draft title", hidden: true })
      .closest("[hidden]");
  const pressAdornment = async () => {
    screen.getByRole("textbox", { name: "Title" }).focus();
    const adornment = await screen.findByRole("button", {
      name: "Draft title",
    });
    adornment.focus();
    fireEvent.click(adornment);
    return adornment;
  };
  it("CK-FU2-a a press that opens nothing ends the hold: with focus and pointer gone the adornment hides", async () => {
    render(<FormHost skin={skin} control={{}} opens={false} />);
    await pressAdornment();
    await wait(10);
    outside[0]![1]();
    await wait(10);
    expect(adornmentShown()).toBe(false);
  });
  it("CK-FU2-b a popup closed after a host focus ends the hold and the adornment hides", async () => {
    const control: Control = {};
    render(<FormHost skin={skin} control={control} />);
    await pressAdornment();
    await wait(0);
    expect(dialog()).not.toBeNull();
    outside[0]![1]();
    act(() => control.open!(false));
    await wait(10);
    expect(adornmentShown()).toBe(false);
  });
  it("CK-FU2-c a popup closed normally hands focus back and the adornment stays shown", async () => {
    render(<FormHost skin={skin} control={{}} />);
    const adornment = await pressAdornment();
    await wait(0);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Close" }));
    await wait(10);
    expect(document.activeElement).toBe(adornment);
    expect(adornmentShown()).toBe(true);
  });
  it("CK-FU2-d the field refocused ends the hold; the adornment stays while the field has focus, then hides on blur", async () => {
    render(<FormHost skin={skin} control={{}} opens={false} />);
    await pressAdornment();
    const field = screen.getByRole("textbox", { name: "Title" });
    field.focus();
    await wait(10);
    expect(adornmentShown()).toBe(true);
    outside[0]![1]();
    await wait(10);
    expect(adornmentShown()).toBe(false);
  });
  it("CK-R8-unfocusable-form-fill an adornment that can no longer take focus gives way to its field", async () => {
    render(<FormHost skin={skin} control={{}} />);
    const title = screen.getByRole("textbox", { name: "Title" });
    title.focus();
    const adornment = await screen.findByRole("button", {
      name: "Draft title",
    });
    adornment.focus();
    fireEvent.click(adornment);
    await wait(0);
    expect(dialog()).not.toBeNull();
    // jsdom does no layout: the browser's answer for a no longer rendered
    // adornment is stood in for.
    Object.defineProperty(adornment, "checkVisibility", { value: () => false });
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Close" }));
    await wait(0);
    expect(document.activeElement).toBe(title);
  });
  it("CK-R8-nested-form-fill a press on the adornment's nested label returns focus to the adornment", async () => {
    render(<FormHost skin={skin} control={{}} />);
    screen.getByRole("textbox", { name: "Title" }).focus();
    const adornment = await screen.findByRole("button", {
      name: "Draft title",
    });
    adornment.focus();
    // A label nested in the button, as a skin's button may render it.
    const label = document.createElement("span");
    label.textContent = "";
    adornment.append(label);
    fireEvent.click(label);
    await wait(0);
    expect(dialog()).not.toBeNull();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Close" }));
    await wait(0);
    expect(document.activeElement).toBe(adornment);
  });
  it("CK-R6-form-fill the field's own adornment opens the popup with focus in it, and closing returns it there", async () => {
    render(<FormHost skin={skin} control={{}} />);
    // The adornment shows once its field has focus.
    screen.getByRole("textbox", { name: "Title" }).focus();
    const adornment = await screen.findByRole("button", {
      name: "Draft title",
    });
    adornment.focus();
    fireEvent.click(adornment);
    await wait(0);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.contains(deepActiveElement(document))).toBe(true);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Close" }));
    await wait(0);
    expect(document.activeElement).toBe(adornment);
  });
  it.each(outside)(
    "CK-R9-form-fill a popup the host closes after the user moved to a %s does not take focus back",
    async (_, focusOutside) => {
      const control: Control = {};
      render(<FormHost skin={skin} control={control} />);
      screen.getByRole("textbox", { name: "Title" }).focus();
      const adornment = await screen.findByRole("button", {
        name: "Draft title",
      });
      adornment.focus();
      fireEvent.click(adornment);
      await wait(0);
      const focused = focusOutside();
      act(() => control.open!(false));
      await wait(600);
      expect(deepActiveElement(document)).toBe(focused);
    },
  );
  it("CK-R9-form-fill-field focus moved back to the field before the host closes the popup stays in the field", async () => {
    const control: Control = {};
    render(<FormHost skin={skin} control={control} />);
    const field = screen.getByRole("textbox", { name: "Title" });
    field.focus();
    const adornment = await screen.findByRole("button", {
      name: "Draft title",
    });
    adornment.focus();
    fireEvent.click(adornment);
    await wait(0);
    field.focus();
    act(() => control.open!(false));
    await wait(0);
    expect(document.activeElement).toBe(field);
  });
  it.each([false, true])(
    "returns a programmatic form popup to its opener, strict mode %s",
    async (strict) => {
      const control: Control = {};
      const content = <FormHost skin={skin} control={control} />;
      render(strict ? <StrictMode>{content}</StrictMode> : content);
      const field = screen.getByRole("textbox", { name: "Title" });
      field.focus();
      act(() => control.open!(true));
      await wait(0);
      expect(deepActiveElement(document)).toBe(dialog());
      act(() => control.open!(false));
      await wait(0);
      expect(deepActiveElement(document)).toBe(field);
    },
  );
  it("does not return a programmatic form popup after host focus", async () => {
    const control: Control = {};
    render(<FormHost skin={skin} control={control} />);
    screen.getByRole("textbox", { name: "Title" }).focus();
    act(() => control.open!(true));
    await wait(0);
    const focused = outside[0]![1]();
    act(() => control.open!(false));
    await wait(0);
    expect(deepActiveElement(document)).toBe(focused);
  });
  it.each(outside)(
    "a form popup the host opens enters its dialog from a %s",
    async (_, focusOutside) => {
      const control: Control = {};
      render(<FormHost skin={skin} control={control} />);
      focusOutside();
      act(() => control.open!(true));
      await wait(0);
      expect(dialog()).not.toBeNull();
      expect(deepActiveElement(document)).toBe(dialog());
    },
  );
});

describe("the antd drawer's own name and focus", () => {
  it("CK-L1a its close button uses the chat's locale under a host antd zh-CN locale, and a custom formatter", async () => {
    const client = createWaypointClient(config());
    const view = render(
      <ConfigProvider locale={zhCN}>
        <WaypointProvider
          client={client}
          primitives={antdPrimitives}
          locale="zh-CN"
        >
          <Chat>
            <ConfirmSheet
              title="保留"
              body="保留这些更改？"
              onProceed={() => {}}
              onCancel={() => {}}
            />
          </Chat>
        </WaypointProvider>
      </ConfigProvider>,
    );
    await wait(0);
    expect(
      within(dialog()!).getByRole("button", { name: "关闭" }),
    ).toBeTruthy();
    view.rerender(
      <ConfigProvider locale={zhCN}>
        <WaypointProvider
          client={client}
          primitives={antdPrimitives}
          format={(key) => (key === "chat.close" ? "Dismiss sheet" : key)}
        >
          <Chat>
            <ConfirmSheet
              title="Keep"
              body="Keep?"
              onProceed={() => {}}
              onCancel={() => {}}
            />
          </Chat>
        </WaypointProvider>
      </ConfigProvider>,
    );
    await wait(0);
    expect(
      within(dialog()!).getByRole("button", { name: "Dismiss sheet" }),
    ).toBeTruthy();
    client.dispose();
  });
});
