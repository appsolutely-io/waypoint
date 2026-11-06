// @vitest-environment jsdom
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
import type { ReactElement } from "react";
import { WaypointChat, type PartProps } from "../../src/react/ui";
import {
  createWaypointClient,
  type MessageVersionPort,
} from "../../src/core/client";
import type { Message } from "../../src/protocol/generated";
import { MessageVersionActions } from "../../docs/examples/message-versions";
import { config } from "../support/client";
afterEach(cleanup);

const messages: Message[] = [
  { id: "u1", role: "user", content: "Hello", blocks: [], createdAt: 1 },
  {
    id: "a1",
    role: "assistant",
    content: "Hi",
    blocks: [],
    createdAt: 2,
    status: "completed",
    versionIndex: 1,
    versionCount: 2,
  },
];
async function chat(
  parts: Record<string, (props: PartProps) => ReactElement>,
  versions?: MessageVersionPort,
) {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async (id) => ({
        protocol: "1.0",
        id,
        title: "Chat",
        messages: structuredClone(messages),
      }),
    },
    versions,
  });
  await client.ready;
  render(<WaypointChat client={client} parts={parts} />);
  await screen.findByText("Hi", {}, { timeout: 5000 });
  return client;
}

describe("message versions are the host's controls", () => {
  it("CK-MV1 the messageActions part receives each message's data", async () => {
    const seen: unknown[] = [];
    const client = await chat({
      messageActions: (props) => {
        seen.push(props.data);
        return <span>actions</span>;
      },
    });
    expect(seen).toContainEqual({
      message: {
        id: "a1",
        role: "assistant",
        status: "completed",
        versionIndex: 1,
        versionCount: 2,
      },
    });
    client.dispose();
  });

  it("CK-MV2 the documented example regenerates once, steps within bounds, and edits only sent user messages", async () => {
    const versions: MessageVersionPort = {
      edit: vi.fn(async () => {}),
      regenerate: vi.fn(async () => {}),
      select: vi.fn(async () => {}),
    };
    const client = await chat(
      { messageActions: (props) => <MessageVersionActions {...props} /> },
      versions,
    );
    const assistant = screen.getByText("Hi").closest("article") as HTMLElement;
    const regenerate = within(assistant).getByRole("button", {
      name: "Regenerate",
    });
    await act(async () => {
      fireEvent.click(regenerate);
      fireEvent.click(regenerate);
    });
    await waitFor(() => expect(versions.regenerate).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(versions.regenerate).toHaveBeenCalledTimes(1);
    expect(
      within(assistant)
        .getByRole("button", { name: "Previous version" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    await act(async () => {
      fireEvent.click(
        within(assistant).getByRole("button", { name: "Next version" }),
      );
    });
    await waitFor(() => expect(versions.select).toHaveBeenCalled());
    expect(versions.select).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "a1", index: 2 }),
    );
    expect(
      within(assistant).queryByRole("button", { name: "Edit" }),
    ).toBeNull();
    const user = screen.getByText("Hello").closest("article") as HTMLElement;
    expect(within(user).getByRole("button", { name: "Edit" })).toBeDefined();
    expect(
      within(user).queryByRole("button", { name: "Regenerate" }),
    ).toBeNull();
    client.dispose();
  });

  it("CK-MV2 the example's actions are unavailable while a reply is written, and a queued send has none", async () => {
    const versions: MessageVersionPort = {
      edit: vi.fn(async () => {}),
      regenerate: vi.fn(async () => {}),
      select: vi.fn(async () => {}),
    };
    messages[1] = { ...messages[1]!, status: "writing" };
    try {
      const client = await chat(
        { messageActions: (props) => <MessageVersionActions {...props} /> },
        versions,
      );
      const assistant = screen
        .getByText("Hi")
        .closest("article") as HTMLElement;
      const regenerate = within(assistant).getByRole("button", {
        name: "Regenerate",
      });
      expect(regenerate.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(regenerate);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(versions.regenerate).not.toHaveBeenCalled();
      // A queued send is a pending row: it gets no version actions.
      await act(async () => {
        await client.setDraft("Queued text");
      });
      for (const pending of document.querySelectorAll('[data-role="pending"]'))
        expect(
          within(pending as HTMLElement).queryByRole("button", {
            name: "Edit",
          }),
        ).toBeNull();
      client.dispose();
    } finally {
      messages[1] = { ...messages[1]!, status: "completed" };
    }
  });
});
