// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointChat } from "../../src/react";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation, ReplyFailure } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const user = {
  id: "user",
  role: "user" as const,
  content: "Question",
  createdAt: 0,
  blocks: [],
};
const assistant = {
  id: "assistant",
  role: "assistant" as const,
  content: "Partial answer",
  status: "writing" as const,
  createdAt: 1,
  blocks: [],
};
const failure: ReplyFailure = {
  id: "failure-episode",
  forMessageId: "assistant",
  reason: { code: "availability", qualifier: "temporary" },
  recovery: { kind: "regenerate", messageId: "assistant" },
};
const failed = (value: ReplyFailure | null = failure): Conversation => ({
  protocol: "1.0",
  id: "conversation-a",
  title: "Chat",
  messages: [user, assistant],
  replyStatus: "failed",
  replyFailure: value,
});

it("host failure is shown below partial assistant text exactly once", async () => {
  await import("../../src/react/markdown");
  const base = config();
  const recover = vi.fn(async () => {});
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: { ...base.transport, read: async () => failed() },
  });
  await client.ready;
  render(
    <WaypointChat
      client={client}
      replyFailureText={(value) => ({
        text: `${value.reason!.code}:${value.reason!.qualifier}`,
        action: <button>Open settings</button>,
      })}
    />,
  );
  const text = await screen.findByText("availability:temporary");
  await screen.findByText("Partial answer");
  const article = text.closest('article[data-message-id="assistant"]')!;
  expect(article).not.toBeNull();
  expect(article.textContent).toContain("Partial answer");
  expect(article.getAttribute("aria-busy")).toBeNull();
  expect(screen.getAllByText("availability:temporary")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Open settings" }).closest("article"),
  ).toBe(article);
  await userEvent.click(
    await screen.findByRole("button", { name: "Regenerate" }),
  );
  await waitFor(() => expect(recover).toHaveBeenCalledOnce());
  expect(client.canStopReply()).toBe(false);
  client.dispose();
});

it.each([null, undefined])(
  "null reply reasons erase earlier host wording and render neutral copy (%s)",
  async (reason) => {
    const base = config();
    let current = failed();
    const text = vi.fn(() => ({ text: "Host explanation" }));
    const client = createWaypointClient({
      ...base,
      transport: { ...base.transport, read: async () => current },
    });
    await client.ready;
    render(<WaypointChat client={client} replyFailureText={text} />);
    expect(await screen.findByText("Host explanation")).toBeTruthy();
    text.mockClear();
    current = failed({ ...failure, reason });
    await act(async () => {
      await client.refresh();
    });
    expect(screen.queryByText("Host explanation")).toBeNull();
    expect(screen.getAllByText("Reply failed")).toHaveLength(1);
    expect(text).not.toHaveBeenCalled();
    client.dispose();
  },
);

it("Resend does not append a second user message", async () => {
  const base = config();
  const recover = vi.fn(async () => {});
  const send = vi.fn(base.transport.send);
  const current = {
    ...failed({
      ...failure,
      forMessageId: user.id,
      recovery: { kind: "resend", messageId: user.id },
    }),
    messages: [user],
  };
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: { ...base.transport, send, read: async () => current },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await userEvent.click(await screen.findByRole("button", { name: "Resend" }));
  await waitFor(() => expect(recover).toHaveBeenCalledOnce());
  expect(send).not.toHaveBeenCalled();
  expect(document.querySelectorAll('article[data-role="user"]')).toHaveLength(
    1,
  );
  client.dispose();
});

it("an explicit none recovery hides the failed message Regenerate", async () => {
  await import("../../src/react/markdown");
  const base = config();
  const client = createWaypointClient({
    ...base,
    versions: {
      regenerate: async () => {},
      edit: async () => {},
      select: async () => {},
    },
    transport: {
      ...base.transport,
      read: async () => failed({ ...failure, recovery: { kind: "none" } }),
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await screen.findByText("Partial answer");
  await waitFor(() =>
    expect(
      document
        .querySelector("[data-reply-state]")
        ?.getAttribute("data-reply-state"),
    ).toBe("failed"),
  );
  expect(
    screen.queryByRole("button", { name: /Regenerate|Retry|Resend/ }),
  ).toBeNull();
  client.dispose();
});

it("host failure changes use one existing message announcement owner", async () => {
  await import("../../src/react/markdown");
  const base = config();
  let current: Conversation = {
    ...failed(),
    replyFailure: undefined,
    replyStatus: undefined,
  };
  const client = createWaypointClient({
    ...base,
    transport: { ...base.transport, read: async () => current },
  });
  await client.ready;
  render(
    <WaypointChat
      client={client}
      replyFailureText={(value) => ({
        text: `${value.reason!.code}:${value.reason!.qualifier}`,
      })}
    />,
  );
  await screen.findByText("Partial answer");
  vi.useFakeTimers();
  current = failed();
  await act(async () => {
    await client.refresh();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  const region = document.querySelector("[data-announcements]")!;
  expect(region.textContent).toBe("availability:temporary");
  const visible = document.querySelector("article [data-reply-failure]")!;
  expect(visible.getAttribute("role")).toBeNull();
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => {
    mutations.push(...records);
  });
  observer.observe(region, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  await act(async () => {
    await client.setDraft("Typing elsewhere");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(mutations).toHaveLength(0);
  expect(region.textContent).toBe("availability:temporary");
  observer.disconnect();
  current = failed({ ...failure, reason: null });
  await act(async () => {
    await client.refresh();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(region.textContent).toBe("Reply failed");
  expect(visible.textContent).toBe("Reply failed");
  client.dispose();
});
