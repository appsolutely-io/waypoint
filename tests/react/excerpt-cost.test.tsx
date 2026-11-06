// @vitest-environment jsdom
// Naming messages costs work proportional to what changed, not to the
// whole history: excerpts are made only while the outline is shown, once
// per message text and policy, and a long text is segmented only as far
// as the excerpt needs.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { english } from "../../src/react/i18n";
import { EXCERPT_GRAPHEMES, excerpt } from "../../src/react/excerpt";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const message = (id: string): Message =>
  ({
    id,
    role: "assistant",
    content: `Reply ${id} `.repeat(100),
    blocks: [],
    createdAt: 1,
    status: "completed",
  }) as Message;
const history = Array.from({ length: 10 }, (_, i) => message(`m${i}`));
async function chat() {
  const base = config();
  let shown = history;
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async (id) =>
        ({ protocol: "1.0", id, title: id, messages: shown }) as Conversation,
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  // The stock renderer, and with it the parser, has loaded.
  await waitFor(() =>
    expect(document.querySelectorAll(".wp-markdown")).toHaveLength(10),
  );
  return {
    type: async (text: string) => {
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
        target: { value: text },
      });
      await act(async () => {});
    },
    add: async (next: Message) => {
      shown = [...shown, next];
      await act(async () => {
        await client.refresh();
      });
    },
  };
}
const toggle = () =>
  screen.getByRole("button", { name: english["chat.outline"] });

describe("excerpt cost", () => {
  it("CK-E-cost a collapsed outline makes no excerpts while the user types", async () => {
    const h = await chat();
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    for (const text of ["a", "ab", "abc"]) await h.type(text);
    expect(segment).not.toHaveBeenCalled();
  });
  it("CK-E-cost an open outline projects each message once; typing adds none, a new message adds one", async () => {
    const h = await chat();
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(document.querySelectorAll("[data-outline-link]").length).toBe(10),
    );
    expect(segment).toHaveBeenCalledTimes(10);
    for (const text of ["a", "ab", "abc"]) await h.type(text);
    expect(segment).toHaveBeenCalledTimes(10);
    await h.add(message("m10"));
    expect(segment).toHaveBeenCalledTimes(11);
  });
  it("CK-E-cost a changed image policy projects again", async () => {
    const base = config();
    const shown = [{ ...message("p1"), content: "Look ![Alt](/x.png)" }];
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id) =>
          ({ protocol: "1.0", id, title: id, messages: shown }) as Conversation,
      },
    });
    await client.ready;
    const view = render(<WaypointChat client={client} />);
    await waitFor(() =>
      expect(document.querySelectorAll(".wp-markdown")).toHaveLength(1),
    );
    fireEvent.click(toggle());
    const label = () =>
      document.querySelector("[data-outline-link]")?.textContent;
    await waitFor(() => expect(label()).toBe("Assistant, message 1: Look Alt"));
    view.rerender(
      <WaypointChat
        client={client}
        markdownImages={{ origin: window.location.origin }}
      />,
    );
    await waitFor(() => expect(label()).toBe("Assistant, message 1: Look"));
  });
  it("CK-E4-cost a long text is segmented only to the bound plus one cluster", () => {
    let taken = 0;
    const real = Intl.Segmenter.prototype.segment;
    vi.spyOn(Intl.Segmenter.prototype, "segment").mockImplementation(function (
      this: Intl.Segmenter,
      input: string,
    ) {
      const segments = real.call(this, input);
      return {
        ...segments,
        [Symbol.iterator]: function* () {
          for (const segment of segments) {
            taken++;
            yield segment;
          }
        },
      } as Intl.Segments;
    });
    expect(excerpt("a".repeat(10_000))).toBe(
      "a".repeat(EXCERPT_GRAPHEMES) + "…",
    );
    expect(taken).toBeLessThanOrEqual(EXCERPT_GRAPHEMES + 1);
  });
});
