// @vitest-environment jsdom
// A host that writes its slots and its provider objects inline gives new
// objects on every render with the same contents: the chat treats them as
// unchanged, so no message renders again.
import { afterEach, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { WaypointChat, type PartProps } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";

afterEach(cleanup);

const message = (id: string, role: "user" | "assistant") =>
  ({
    id,
    role,
    content: `Message ${id}`,
    blocks: [],
    createdAt: 0,
    status: "completed",
  }) as Message;

it("inline slots and provider objects with the same contents render no message again", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    conversationId: "a",
    transport: {
      ...base.transport,
      read: async (id) =>
        ({
          protocol: "1.0",
          id,
          title: id,
          messages: [message("m1", "user"), message("m2", "assistant")],
        }) as Conversation,
    },
  });
  await client.ready;
  const renders: string[] = [];
  const bubble = (props: PartProps<"bubble">) => {
    if (props.data && "message" in props.data)
      renders.push(props.data.message.id);
    return <>{props.children}</>;
  };
  const empty = () => <p>Nothing yet</p>;
  let rerender: () => void = () => {};
  function Host() {
    const [, set] = useState(0);
    rerender = () => set((count) => count + 1);
    return (
      <WaypointChat
        client={client}
        locale="en"
        // Both written inline: new objects, same contents, each render.
        slots={{ emptyState: empty }}
        parts={{ bubble }}
      />
    );
  }
  render(<Host />);
  await waitFor(() =>
    expect(document.querySelector('[data-message-id="m2"]')).not.toBeNull(),
  );
  renders.length = 0;
  await act(async () => rerender());
  await act(async () => rerender());
  expect(renders).toEqual([]);
  client.dispose();
});
