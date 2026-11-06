// @vitest-environment jsdom
// A form in a reply starts from what the host already knows.
import { it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Block, Reply } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

const form: Block = {
  type: "form",
  id: "order-form",
  fallback: "Order details",
  body: {
    fields: [
      { name: "order", label: "Order number", required: true, value: "1043" },
      { name: "note", label: "Note" },
    ],
  },
};

it("starts each field from its value and sends what the user leaves", async () => {
  const sent: Reply[] = [];
  const base = config();
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
            id: "a",
            role: "assistant",
            content: "I need a few details.",
            blocks: [form],
            createdAt: 0,
          },
        ],
      }),
      send: async (reply) => {
        sent.push(reply);
        return { id: reply.clientReplyId };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  const order = await screen.findByRole(
    "textbox",
    { name: "Order number (required)" },
    { timeout: 5000 },
  );
  expect(order).toHaveProperty("value", "1043");
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty(
    "value",
    "",
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(sent.at(-1)).toMatchObject({
    kind: "form",
    blockId: "order-form",
    values: { order: "1043" },
  });
  client.dispose();
});
