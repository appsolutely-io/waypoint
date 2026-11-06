// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import { createCardHost } from "../support/card-host";
afterEach(cleanup);
it("a refused card answer can be corrected and retried instead of staying disabled", async () => {
  const base = config();
  let attempts = 0;
  // The host marks the card answered once it applied an answer.
  let answered = false;
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          {
            id: "assistant-a",
            role: "assistant",
            content: "",
            createdAt: 0,
            blocks: [
              {
                type: "buttons",
                id: "question-a",
                fallback: "Answer",
                body: { actions: [{ id: "accept", label: "Accept" }] },
                answered,
              },
            ],
          },
        ],
      }),
      send: async () => {
        attempts++;
        if (attempts === 1) throw { id: "p", code: "refused" };
        answered = true;
        return { id: "stored" };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(attempts).toBe(2));
  expect(
    (screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  client.dispose();
});
it("nested replies name the actual form block while one answer disables the whole card", async () => {
  const base = config();
  let target = "";
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          {
            id: "assistant-a",
            role: "assistant",
            content: "",
            createdAt: 0,
            blocks: [
              {
                type: "card",
                id: "card-a",
                fallback: "Card",
                body: {
                  title: "Question",
                  blocks: [
                    {
                      type: "buttons",
                      id: "child-a",
                      fallback: "Answer",
                      body: { actions: [{ id: "yes", label: "Yes" }] },
                    },
                    {
                      type: "buttons",
                      id: "child-b",
                      fallback: "Other",
                      body: { actions: [{ id: "no", label: "No" }] },
                    },
                  ],
                },
                // The host marks the whole card answered.
                answered: target !== "",
              },
            ],
          },
        ],
      }),
      send: async (reply) => {
        if (reply.kind === "action") target = reply.blockId;
        return { id: "stored" };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(target).toBe("child-a"));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "No" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  client.dispose();
});
// A browser moves focus off a control that becomes disabled (jsdom does
// not, and does not blur a disabled control, so the test does it for it).
const pressAndLoseFocus = async (name: string) => {
  const button = screen.getByRole("button", { name }) as HTMLButtonElement;
  button.focus();
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  await act(async () => {
    button.disabled = false;
    button.blur();
    button.disabled = true;
  });
};
it("after a lost response the card shows the answer the host holds, and focus goes to the composer", async () => {
  const host = createCardHost({ lose: (send) => send === 1 });
  const client = host.client();
  await client.ready;
  render(<WaypointChat client={client} />);
  await screen.findByRole("button", { name: "Accept" });
  await pressAndLoseFocus("Accept");
  const composer = screen.getByRole("textbox");
  await waitFor(() => expect(document.activeElement).toBe(composer));
  expect(host.applied).toEqual(["accept"]);
  for (const name of ["Accept", "Decline"])
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "Send answer again" }),
  ).toBeNull();
  client.dispose();
});
it("after a refusal that leaves the card open, focus returns to the pressed answer", async () => {
  const host = createCardHost({
    refuse: (send) =>
      send === 1 ? { error: { id: "p", code: "declined" } } : undefined,
  });
  const client = host.client();
  await client.ready;
  render(<WaypointChat client={client} />);
  await screen.findByRole("button", { name: "Accept" });
  await pressAndLoseFocus("Accept");
  const pressed = screen.getByRole("button", {
    name: "Accept",
  }) as HTMLButtonElement;
  await waitFor(() => expect(pressed.disabled).toBe(false));
  await waitFor(() => expect(document.activeElement).toBe(pressed));
  client.dispose();
});
