// @vitest-environment jsdom
// A press's origin is the event being handled now. A real browser drains
// microtasks between the native listeners of one trusted event (React's
// capture listener and its bubble listener are two) and commits the press's
// update in a microtask, so the press must still count after microtasks,
// and no longer once its task is over.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRef, type SyntheticEvent } from "react";
import { useChatFocusRoot } from "../../src/react/chat-focus";

afterEach(cleanup);
type Root = ReturnType<typeof useChatFocusRoot>;
function Harness({ expose }: { expose: (chat: Root) => void }) {
  const root = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  expose(useChatFocusRoot(root, "c", composer, transcript));
  return (
    <section ref={root}>
      <button type="button">Inside</button>
    </section>
  );
}

describe("the origin of the press being handled", () => {
  it("survives microtask checkpoints and ends with its task", async () => {
    let chat!: Root;
    const view = render(<Harness expose={(value) => (chat = value)} />);
    const button = view.getByRole("button", { name: "Inside" });
    const native = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(native, "composedPath", {
      value: () => [button, button.parentElement, document.body, document],
    });
    // React's capture listener: the chat sees the press.
    chat.captureProps.onClickCapture({
      nativeEvent: native,
    } as unknown as SyntheticEvent);
    // The browser's microtask checkpoints before React's bubble listener
    // and before the commit the press caused.
    await Promise.resolve();
    await Promise.resolve();
    expect(chat.value.originFor("probe")).toBeDefined();
    // A later task is no longer handling the press.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chat.value.originFor("probe")).toBeUndefined();
  });
});
