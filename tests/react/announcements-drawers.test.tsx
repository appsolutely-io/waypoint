// @vitest-environment jsdom
// What the chat says while a modal drawer makes its live regions inert:
// the form-fill popup (outside the chat), the flow drawer and a record
// drawer a host renders in place inside the chat.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import {
  ConfirmSheet,
  WaypointChat,
  WaypointProvider,
} from "../../src/react/ui";
import { FormFillPopup } from "../../src/react/form-fill";
import { createFormSession } from "../../src/core/form-session";
import { ANNOUNCEMENT_BATCH_MS } from "../../src/react/announcements";
import { createWaypointClient } from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);
vi.setConfig({ testTimeout: 30000 });

const user: Message = {
  id: "u1",
  role: "user",
  content: "Question",
  blocks: [],
  createdAt: 100,
};
const reply = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
  blocks: [],
  createdAt: 100,
  status: "completed",
});
// A host panel inside the chat that opens a record's confirmation sheet.
function RecordPanel() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Archive record
      </button>
      {open ? (
        <ConfirmSheet
          title="Archive this record"
          body="Archive it?"
          onProceed={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
async function setup(withFlows = false) {
  const base = config();
  let shown: Message[] = [];
  const client = createWaypointClient({
    ...base,
    tabs: ["presets"],
    transport: {
      ...base.transport,
      read: async (id) => ({
        protocol: "1.0",
        id,
        title: "Chat",
        messages: structuredClone(shown),
      }),
    },
    ...(withFlows && {
      flowSource: {
        list: () => [{ id: "flow-a", title: "Rename" }],
        setFavourite: () => {},
        load: async () => ({
          format: "1.0" as const,
          id: "flow-a",
          title: "Rename",
          kind: "prompt" as const,
          parameters: [
            { name: "t", type: "string" as const, required: true, label: "T" },
          ],
          tags: [],
          body: "",
        }),
        run: async () => ({ conversationId: "conversation-a" }),
      },
    }),
  });
  await client.ready;
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    ids: () => "fill",
  });
  let setOpen!: (open: boolean) => void;
  function App() {
    const [open, set] = useState(false);
    setOpen = set;
    return (
      <WaypointProvider client={client}>
        <WaypointChat
          client={client}
          slots={{ extraPanels: () => <RecordPanel /> }}
        />
        <FormFillPopup session={session} open={open} onClose={() => {}} />
      </WaypointProvider>
    );
  }
  render(<App />);
  const region = () =>
    document.querySelector<HTMLElement>("[data-announcements]")!;
  const row = () => document.querySelector<HTMLElement>("[data-reply-state]")!;
  const said: string[] = [];
  new MutationObserver(() => {
    const text = region().textContent ?? "";
    if (text) said.push(text);
  }).observe(region(), { childList: true, characterData: true, subtree: true });
  const show = async (messages: Message[]) => {
    shown = messages;
    await act(async () => {
      await client.refresh();
    });
  };
  const quiet = () =>
    act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, ANNOUNCEMENT_BATCH_MS + 300),
      );
    });
  return {
    client,
    said,
    row,
    show,
    quiet,
    open: (value: boolean) => act(async () => setOpen(value)),
  };
}

describe("announcements held behind a modal drawer", () => {
  it("CK-DR2 a reply that completes while the form-fill popup is open is said once it closes", async () => {
    const h = await setup();
    await h.show([user]);
    await h.quiet();
    const before = h.said.length;
    await h.open(true);
    await h.show([user, reply("a1", "Behind the popup")]);
    await h.quiet();
    expect(h.said.length).toBe(before);
    await h.open(false);
    await waitFor(() => expect(h.said.length).toBe(before + 1));
    expect(h.said.at(-1)).toContain("Behind the popup");
    h.client.dispose();
  });

  it("CK-DR2 a reply removed while the popup is open is never said", async () => {
    const h = await setup();
    await h.show([user]);
    await h.quiet();
    const before = h.said.length;
    await h.open(true);
    await h.show([user, reply("a1", "Gone soon")]);
    await h.show([user]);
    await h.open(false);
    await h.quiet();
    expect(h.said.length).toBe(before);
    h.client.dispose();
  });

  it("CK-DR2 the reply row keeps what it said while held, then shows the latest state", async () => {
    const h = await setup();
    await h.show([]);
    const held = h.row().textContent;
    await h.open(true);
    await h.show([user]);
    expect(h.row().textContent).toBe(held);
    await h.open(false);
    await waitFor(() => expect(h.row().textContent).toBe("Writing"));
    h.client.dispose();
  });

  it("CK-DR2 a reply that completes while the flow drawer is open is said once it closes", async () => {
    const h = await setup(true);
    await h.show([user]);
    await h.quiet();
    const before = h.said.length;
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("button", { name: "Run" });
    await h.show([user, reply("a1", "Behind the drawer")]);
    await h.quiet();
    expect(h.said.length).toBe(before);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(h.said.length).toBe(before + 1));
    h.client.dispose();
  });

  it("CK-DR2 a reply that completes while a record drawer in the chat is open is said once it closes", async () => {
    const h = await setup();
    await h.show([user]);
    await h.quiet();
    const before = h.said.length;
    fireEvent.click(screen.getByRole("button", { name: "Archive record" }));
    const dialog = screen.getByRole("dialog", { name: "Archive this record" });
    await h.show([user, reply("a1", "Behind the record")]);
    await h.quiet();
    expect(h.said.length).toBe(before);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(h.said.length).toBe(before + 1));
    expect(h.said.at(-1)).toContain("Behind the record");
    h.client.dispose();
  });

  it("CK-DR2 two reply-state changes while a drawer is open: only the latest is shown", async () => {
    const h = await setup();
    await h.show([]);
    const states: string[] = [];
    new MutationObserver(() => states.push(h.row().textContent ?? "")).observe(
      h.row(),
      { childList: true, characterData: true, subtree: true },
    );
    await h.open(true);
    await h.show([user]);
    await h.show([user, reply("a1", "Done")]);
    await h.open(false);
    await h.quiet();
    expect(states).not.toContain("Writing");
    expect(h.row().textContent).toBe("");
    h.client.dispose();
  });
});
