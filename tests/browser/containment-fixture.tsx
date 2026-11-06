// Modal drawers rendered outside a chat, for focus containment checks.
// Query parameter `case`: sheet (a standalone confirm sheet), shadow (its
// buttons rendered in shadow roots), editable (a custom drawer with a
// contenteditable field) and stacked (a second sheet opens over the first).
import { createRoot } from "react-dom/client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ConfigProvider, DatePicker, Select, theme } from "antd";
import {
  ModalDrawer,
  ChatFocusContext,
  useChatFocusRoot,
  useDrawerFocus,
} from "../../src/react/chat-focus";
import { antdPrimitives } from "../../src/skin-antd/index";
import { createWaypointClient } from "../../src/index";
import {
  ConfirmSheet,
  WaypointProvider,
  type ButtonProps,
  type DrawerProps,
} from "../../src/react/index";
import { createTestPlatform } from "../../src/testing/transport";
import "../../src/react/styles.css";

const kind = new URLSearchParams(location.search).get("case") ?? "sheet";
// A button whose native element lives in the shadow root of its host.
function ShadowButton({ children, onPress, label, disabled }: ButtonProps) {
  const host = useRef<HTMLSpanElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => {
    if (host.current && !host.current.shadowRoot)
      setRoot(host.current.attachShadow({ mode: "open" }));
  }, []);
  return (
    <span ref={host}>
      {root
        ? createPortal(
            <button
              type="button"
              aria-label={label}
              disabled={disabled}
              onClick={onPress}
            >
              {children}
            </button>,
            root,
          )
        : null}
    </span>
  );
}
// A host's own drawer: its own close control first, and last a
// contenteditable field without a tabindex, reporting its element as the
// contract asks.
function EditableDrawer({
  open,
  label,
  onClose,
  closeLabel,
  children,
  focusInto,
  restoreFocus,
}: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    focusInto?.(element);
    return () => restoreFocus?.(element);
  }, [open]);
  return open ? (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
    >
      <button type="button" onClick={onClose}>
        {closeLabel}
      </button>
      {children}
      <div contentEditable suppressContentEditableWarning aria-label="Notes">
        Notes
      </div>
    </div>
  ) : null;
}
function Slotted({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = host.current!.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.textContent = "Outside slot";
    root.append(button, document.createElement("slot"));
  }, []);
  return <div ref={host}>{children}</div>;
}
const client = createWaypointClient({
  accountId: "containment-account",
  conversationId: "containment",
  platform: createTestPlatform(),
  transport: {
    negotiate: async () => ({ protocol: "1.0", capabilities: [] }),
    read: async (id: string) => ({
      protocol: "1.0",
      id,
      title: id,
      messages: [],
    }),
    subscribe: () => () => {},
    send: async () => {
      throw new Error("Not used");
    },
  } as never,
});
function ChatPage() {
  const root = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLElement>(null);
  const transcript = useRef<HTMLElement>(null);
  const focus = useChatFocusRoot(root, "stacked", composer, transcript);
  return (
    <ChatFocusContext.Provider value={focus.value}>
      <div ref={root} {...focus.captureProps}>
        <Page />
      </div>
    </ChatFocusContext.Provider>
  );
}
function Page() {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  useEffect(() => {
    if (!["stacked", "stacked-inert"].includes(kind) || !first) return;
    // A host opening a second sheet over the first, in code.
    const timer = setTimeout(() => setSecond(true), 200);
    return () => clearTimeout(timer);
  }, [first]);
  return (
    <main>
      <button type="button">Before</button>
      <button type="button" onClick={() => setFirst(true)}>
        Open
      </button>
      {first ? (
        <ConfirmSheet
          title="First"
          body="The first sheet"
          onProceed={() => {}}
          onCancel={() => setFirst(false)}
        />
      ) : null}
      <section data-second-region="">
        {second ? (
          <ConfirmSheet
            title="Second"
            body="The second sheet"
            onProceed={() => {}}
            onCancel={() => setSecond(false)}
          />
        ) : null}
      </section>
      <input aria-label="After" />
    </main>
  );
}
function FallbackSheet({
  onClose,
  fallback,
}: {
  onClose(): void;
  fallback: () => HTMLElement | null;
}) {
  const focus = useDrawerFocus("fallback", undefined, fallback);
  return (
    <ModalDrawer
      as={EditableDrawer}
      open
      label="Fallback"
      onClose={onClose}
      closeLabel="Close"
      {...focus}
    />
  );
}
function FallbackPage() {
  const root = useRef<HTMLElement>(null);
  const composer = useRef<HTMLElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const fallback = useRef<HTMLDivElement>(null);
  const focus = useChatFocusRoot(root, "fixture", composer, transcript);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setUnavailable(true), 60);
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <ChatFocusContext.Provider value={focus.value}>
      <section ref={root} {...focus.captureProps}>
        <div
          ref={transcript}
          tabIndex={-1}
          role="region"
          aria-label="Transcript"
        />
        <div
          ref={fallback}
          tabIndex={-1}
          role="region"
          aria-label="Return destination"
        />
        {!(unavailable && kind.includes("removed")) ? (
          <button
            disabled={unavailable}
            onClick={() => setTimeout(() => setOpen(true), 30)}
          >
            Open
          </button>
        ) : null}
        {open ? (
          kind.includes("provided") ? (
            <FallbackSheet
              onClose={() => setOpen(false)}
              fallback={() => fallback.current}
            />
          ) : (
            <ConfirmSheet
              title="Fallback"
              body="Synthetic request"
              onProceed={() => {}}
              onCancel={() => setOpen(false)}
            />
          )
        ) : null}
      </section>
    </ChatFocusContext.Provider>
  );
}
function PopupPage() {
  const [open, setOpen] = useState(false);
  return (
    <ConfigProvider
      theme={{
        algorithm:
          new URLSearchParams(location.search).get("scheme") === "dark"
            ? theme.darkAlgorithm
            : theme.defaultAlgorithm,
      }}
    >
      <button onClick={() => setOpen(true)}>Open</button>
      <Select
        style={{ width: "100%" }}
        aria-label="Outside choice"
        options={[{ value: "outside", label: "Outside option" }]}
      />
      {open ? (
        <ModalDrawer
          as={antdPrimitives.drawer}
          open
          label="Options"
          closeLabel="Close"
          onClose={() => setOpen(false)}
        >
          <Select
            style={{ width: "100%" }}
            aria-label="Choice"
            options={[
              { value: "first", label: "First option" },
              { value: "second", label: "Second option" },
            ]}
          />
          <DatePicker aria-label="Date" />
        </ModalDrawer>
      ) : null}
    </ConfigProvider>
  );
}
const wrap = (children: ReactNode) =>
  new URLSearchParams(location.search).get("skin") === "antd" ? (
    <WaypointProvider client={client} primitives={antdPrimitives}>
      {children}
    </WaypointProvider>
  ) : kind === "slotted" ? (
    <Slotted>{children}</Slotted>
  ) : kind === "shadow" ? (
    <WaypointProvider client={client} primitives={{ button: ShadowButton }}>
      {children}
    </WaypointProvider>
  ) : kind === "editable" ? (
    <WaypointProvider client={client} primitives={{ drawer: EditableDrawer }}>
      {children}
    </WaypointProvider>
  ) : (
    children
  );
createRoot(document.getElementById("root")!).render(
  <div className="waypoint">
    {wrap(
      kind === "popups" ? (
        <PopupPage />
      ) : kind.startsWith("fallback") ? (
        <FallbackPage />
      ) : new URLSearchParams(location.search).has("chat") ? (
        <ChatPage />
      ) : (
        <Page />
      ),
    )}
  </div>,
);
