// A chat root as the chat provides it for focus decisions: its element,
// the conversation it shows, a transcript box and its capture handlers.
import { useRef, type ReactNode } from "react";
import { ChatFocusContext, useChatFocusRoot } from "../../src/react/chat-focus";

export function TestChat({
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
/** Focus placed outside the chat, each target with how it is focused. */
export const outsideTargets: [string, () => Element][] = [
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
