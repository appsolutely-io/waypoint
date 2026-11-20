// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointChat } from "../../src/react";
import { replyRowView } from "../../src/hooks";
import { english, simplifiedChinese } from "../../src/react/i18n";
import en from "../../src/messages/en";
import zh from "../../src/messages/zh-Hans";
import {
  createWaypointClient,
  type WaypointClient,
} from "../../src/core/client";
import type { Conversation, Message } from "../../src/protocol/generated";
import { config } from "../support/client";
const clients: WaypointClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.dispose());
});
const user: Message = {
  id: "u",
  role: "user",
  content: "Question",
  createdAt: 0,
  blocks: [],
};
const writer: Message = {
  id: "a",
  role: "assistant",
  content: "Partial",
  createdAt: 1,
  blocks: [],
  status: "writing",
  versionIndex: 1,
};
async function host(fields: Record<string, unknown> = {}) {
  let current = {
    protocol: "1.0",
    id: "conversation-a",
    title: "Chat",
    messages: [user],
    replyStatus: "expected",
    replyLabel: "Discussing",
    ...fields,
  } as Conversation;
  const base = config();
  const send = vi.fn(base.transport.send);
  const recover = vi.fn(async () => {});
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    versions: {
      regenerate: async () => {},
      edit: async () => {},
      select: async () => {},
    },
    transport: {
      ...base.transport,
      send,
      read: async () => current,
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: ["reply-stop"],
      }),
    },
  });
  clients.push(client);
  await client.ready;
  return {
    client,
    send,
    recover,
    async set(fields: Record<string, unknown>) {
      current = { ...current, ...fields } as Conversation;
      await act(async () => {
        await client.refresh();
      });
    },
  };
}

it("host busy stop does not call the reply Stop endpoint", async () => {
  const h = await host();
  const stop = vi.fn(async () => {});
  render(
    <WaypointChat
      client={h.client}
      expectedReplyStop={{ label: "Stop discussion", onPress: stop }}
    />,
  );
  const group = await screen.findByRole("group", { name: "Host activity" });
  expect(group.textContent).toContain("Discussing");
  await userEvent.click(
    within(group).getByRole("button", { name: "Stop discussion" }),
  );
  expect(stop).toHaveBeenCalledOnce();
  expect(h.send).not.toHaveBeenCalled();
  expect(h.recover).not.toHaveBeenCalled();
});

it("expected without a host stop control offers none", async () => {
  const h = await host();
  render(<WaypointChat client={h.client} />);
  const group = await screen.findByRole("group", { name: "Host activity" });
  expect(within(group).queryAllByRole("button")).toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: /Retry|Regenerate|Resend/ }),
  ).toBeNull();
});

it("a host busy label is rendered as plain text", async () => {
  const h = await host({ replyLabel: "<img src=x onerror=alert(1)>" });
  render(<WaypointChat client={h.client} />);
  const group = await screen.findByRole("group", { name: "Host activity" });
  expect(within(group).getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  expect(group.querySelector("img")).toBeNull();
});

it("expected reported during an active writer keeps reply Stop and shows the host busy row", async () => {
  const h = await host({ messages: [user, writer] });
  const stop = vi.fn(async () => {});
  render(
    <WaypointChat
      client={h.client}
      expectedReplyStop={{ label: "Stop discussion", onPress: stop }}
    />,
  );
  const recovery = await screen.findByRole("group", { name: "Reply recovery" });
  const busy = screen.getByRole("group", { name: "Host activity" });
  expect(
    recovery.compareDocumentPosition(busy) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    within(recovery)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Stop"]);
  expect(
    within(busy)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Stop discussion"]);
  await userEvent.click(within(recovery).getByRole("button", { name: "Stop" }));
  await waitFor(() =>
    expect(h.send.mock.calls[0]?.[0]).toMatchObject({
      kind: "stop",
      messageId: "a",
      versionIndex: 1,
    }),
  );
  expect(stop).not.toHaveBeenCalled();
});

it.each([false, true])(
  "an overdue expected row keeps the host label and host control (%s)",
  async (withStop) => {
    const h = await host({
      replyExpectedId: "episode",
      replyOverdueFor: "episode",
      replyOverdueAt: 50,
    });
    const stop = vi.fn(async () => {});
    render(
      <WaypointChat
        client={h.client}
        expectedReplyStop={
          withStop ? { label: "Stop discussion", onPress: stop } : undefined
        }
      />,
    );
    const group = await screen.findByRole("group", { name: "Host activity" });
    expect(group.textContent).toContain("Discussing");
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(
      withStop ? ["Keep waiting", "Stop discussion"] : ["Keep waiting"],
    );
    await userEvent.click(
      within(group).getByRole("button", { name: "Keep waiting" }),
    );
    expect(h.recover).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(group.textContent).toContain("Discussing");
  },
);

it("failure and host busy controls keep separate names and one failure announcement", async () => {
  const h = await host({
    messages: [user, { ...writer, status: "failed" }],
    replyFailure: {
      id: "failure",
      forMessageId: "a",
      reason: { code: "availability" },
      recovery: { kind: "regenerate", messageId: "a" },
    },
  });
  render(
    <WaypointChat
      client={h.client}
      replyFailureText={() => ({ text: "Host failure" })}
      expectedReplyStop={{ label: "Stop discussion", onPress: async () => {} }}
    />,
  );
  const recovery = await screen.findByRole("group", { name: "Reply recovery" });
  const busy = screen.getByRole("group", { name: "Host activity" });
  expect(
    within(recovery).getByRole("button", { name: "Regenerate" }),
  ).toBeTruthy();
  expect(within(busy).queryByRole("button", { name: "Regenerate" })).toBeNull();
  expect(screen.getAllByText("Host failure")).toHaveLength(1);
  await h.set({ replyLabel: "Checking" });
  expect(screen.getAllByText("Host failure")).toHaveLength(1);
  expect(busy.textContent).toContain("Checking");
});

it("reply presentation changes preserve focus where the user is working", async () => {
  const h = await host({
    messages: [user, { ...writer, status: "failed" }],
    replyFailure: {
      id: "failure",
      forMessageId: "a",
      recovery: { kind: "regenerate", messageId: "a" },
    },
  });
  render(<WaypointChat client={h.client} />);
  const group = await screen.findByRole("group", { name: "Reply recovery" });
  const action = within(group).getByRole("button", { name: "Regenerate" });
  action.focus();
  await h.set({
    replyFailure: {
      id: "failure",
      forMessageId: "a",
      recovery: { kind: "none" },
    },
  });
  expect(document.activeElement).toBe(group);
  const composer = screen.getByRole("textbox");
  composer.focus();
  await h.set({ replyLabel: "Checking" });
  expect(document.activeElement).toBe(composer);
});

it.each(["regenerate", "resend", "none"] as const)(
  "expected turning overdue keeps the retained failure and its recovery (%s)",
  async (kind) => {
    const target = kind === "resend" ? "u" : "a";
    const h = await host({
      messages:
        kind === "resend" ? [user] : [user, { ...writer, status: "failed" }],
      replyStatus: "failed",
      replyFailure: {
        id: "failure",
        forMessageId: target,
        reason: { code: "availability" },
        recovery: kind === "none" ? { kind } : { kind, messageId: target },
      },
    });
    render(
      <WaypointChat
        client={h.client}
        replyFailureText={() => ({ text: "Host failure" })}
      />,
    );
    await screen.findByRole("group", { name: "Reply recovery" });
    await h.set({
      replyStatus: "expected",
      replyExpectedId: "episode",
      replyOverdueFor: "episode",
      replyOverdueAt: 50,
    });
    const recovery = screen.getByRole("group", { name: "Reply recovery" });
    const busy = screen.getByRole("group", { name: "Host activity" });
    expect(
      within(busy)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Keep waiting"]);
    expect(
      within(recovery)
        .queryAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(
      kind === "none" ? [] : [kind === "regenerate" ? "Regenerate" : "Resend"],
    );
  },
);

it("headless busy view reports the host label and stop control", () => {
  const stop = { label: "Stop discussion", onPress: vi.fn(async () => {}) };
  const view = replyRowView("expected-overdue", {
    replyLabel: "Discussing",
    expectedReplyStop: stop,
  });
  expect(view.busy).toMatchObject({
    kind: "expected-overdue",
    label: "Discussing",
    stop,
  });
  expect(view.actions.map((action) => action.id)).toEqual([
    "keepWaiting",
    "hostStop",
  ]);
});
it("headless busy view reports no stop when the host supplies none", () => {
  expect(replyRowView("expected").busy?.stop).toBeUndefined();
  expect(
    replyRowView("expected-overdue").actions.map((action) => action.id),
  ).toEqual(["keepWaiting"]);
});

it.each([
  [
    "writing overdue copy says the reply is still being written",
    "writing",
    "reply.writingOverdue",
  ],
  [
    "user-wait overdue copy says no reply has started",
    "waiting",
    "reply.waitOverdue",
  ],
  [
    "kindless overdue views use neutral compatibility copy",
    undefined,
    "reply.overdue",
  ],
] as const)("%s", (_name, presentation, key) => {
  expect(replyRowView("overdue", { presentation }).key).toBe(key);
});

it("all reply and notice UI keys exist in both shipped locales", () => {
  const rows = [
    ["reply.expected", "Waiting for a reply", "等待回复"],
    [
      "reply.expected-overdue",
      "Still waiting for a reply; this is taking longer than expected.",
      "仍在等待回复，等待时间比预期更长。",
    ],
    ["reply.waiting", "Waiting for a reply", "等待回复"],
    [
      "reply.writingOverdue",
      "The reply is still being written and is taking longer than expected.",
      "仍在回复，等待时间比预期更长。",
    ],
    [
      "reply.waitOverdue",
      "No reply yet; this is taking longer than expected.",
      "尚未收到回复，等待时间比预期更长。",
    ],
    [
      "reply.overdue",
      "This is taking longer than expected.",
      "等待时间比预期更长。",
    ],
    ["chat.roleNotice", "Notice", "通知"],
    ["chat.resend", "Resend", "重新发送"],
    ["chat.reply.recoveryGroup", "Reply recovery", "回复恢复操作"],
    ["chat.reply.hostActivityGroup", "Host activity", "后台活动"],
  ];
  for (const [key, englishText, chineseText] of rows)
    for (const [catalogue, expected] of [
      [english, englishText],
      [en, englishText],
      [simplifiedChinese, chineseText],
      [zh, chineseText],
    ] as const)
      expect((catalogue as Record<string, unknown>)[key!]).toBe(expected);
});
