// @vitest-environment jsdom
// The event listeners a chat holds do not grow with its history: rows with
// forms and disclosures (whose controls React listens to one by one) are
// mounted only near the visible part of a long transcript.
import { afterEach, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

afterEach(cleanup);

const history = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const base = {
      id: `m${index}`,
      createdAt: index,
      status: "completed",
    };
    if (index % 2 === 0)
      return {
        ...base,
        role: "user",
        content: `Question ${index}`,
        blocks: [],
      } as Message;
    return {
      ...base,
      role: "assistant",
      content: "An answer with a form and a disclosure.",
      blocks: [
        {
          type: "form",
          id: `form-${index}`,
          fallback: "A form",
          body: {
            fields: [
              { name: "order", label: "Order", required: true, value: "1" },
              { name: "note", label: "Note" },
            ],
          },
        },
        {
          type: "details",
          id: `details-${index}`,
          fallback: "How",
          body: {
            summary: "How",
            blocks: [
              {
                type: "list",
                id: `list-${index}`,
                fallback: "a; b",
                body: { items: ["a", "b"] },
              },
            ],
          },
        },
      ],
    } as Message;
  });

// The listeners added and not removed while the chat renders `count`
// messages.
async function listenersFor(count: number) {
  let net = 0;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    net++;
    return add.apply(this, args);
  };
  EventTarget.prototype.removeEventListener = function (...args) {
    net--;
    return remove.apply(this, args);
  };
  try {
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        read: async (id) =>
          ({
            protocol: "1.0",
            id,
            title: id,
            messages: history(count),
          }) as Conversation,
      },
    });
    await client.ready;
    render(<WaypointChat client={client} />);
    await waitFor(
      () =>
        expect(
          document.querySelector(`[data-message-id="m${count - 1}"] input`),
        ).not.toBeNull(),
      { timeout: 10_000 },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const held = net;
    client.dispose();
    cleanup();
    return held;
  } finally {
    EventTarget.prototype.addEventListener = add;
    EventTarget.prototype.removeEventListener = remove;
  }
}

it("holds as many listeners for 2,000 messages as for 300", async () => {
  const short = await listenersFor(300);
  const long = await listenersFor(2000);
  expect(long).toBeLessThanOrEqual(short + 10);
}, 60_000);
