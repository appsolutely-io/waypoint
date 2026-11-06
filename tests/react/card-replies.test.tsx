// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
afterEach(cleanup);
it("a refused card answer can be corrected and retried instead of staying disabled", async () => {
  const base = config();
  let attempts = 0;
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
              },
            ],
          },
        ],
      }),
      send: async () => {
        attempts++;
        if (attempts === 1) throw { id: "p", code: "refused" };
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
  expect(
    (screen.getByRole("button", { name: "No" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  client.dispose();
});
