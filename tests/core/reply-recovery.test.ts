import { expect, it, vi } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import type {
  MessageVersionInput,
  ReplyRecoveryInput,
} from "../../src/core/client";
import type { Conversation, ReplyFailure } from "../../src/protocol/generated";
import { config, flush } from "../support/client";

const user = {
  id: "user",
  role: "user" as const,
  content: "Question",
  blocks: [],
  createdAt: 0,
};
const assistant = {
  id: "assistant",
  role: "assistant" as const,
  content: "Partial",
  blocks: [],
  createdAt: 1,
  status: "failed" as const,
  versionIndex: 1,
};
function conversation(
  failure: ReplyFailure | null,
  reply = false,
): Conversation {
  return {
    protocol: "1.0",
    id: "conversation-a",
    title: "Chat",
    messages: reply ? [user, assistant] : [user],
    replyStatus: "failed",
    replyFailure: failure,
  };
}
const failure = (kind: "regenerate" | "resend" | "none"): ReplyFailure => ({
  id: "failure-episode",
  reason: { code: "availability", qualifier: "temporary" },
  recovery:
    kind === "none"
      ? { kind }
      : { kind, messageId: kind === "regenerate" ? assistant.id : user.id },
});

it.each(["regenerate", "resend"] as const)(
  "host selects Regenerate for a failed assistant and Resend for a missing reply (%s)",
  async (kind) => {
    const base = config();
    const recover = vi.fn(async (_input: ReplyRecoveryInput) => {});
    const send = vi.fn(base.transport.send);
    const client = createWaypointClient({
      ...base,
      replies: { recover },
      transport: {
        ...base.transport,
        send,
        read: async () => conversation(failure(kind), kind === "regenerate"),
      },
    });
    await client.ready;
    expect(client.canRetryReply()).toBe(true);
    await client.retryReply();
    expect(recover).toHaveBeenCalledOnce();
    expect(recover.mock.calls[0]![0]).toMatchObject({
      conversationId: "conversation-a",
      kind,
      messageId: kind === "regenerate" ? "assistant" : "user",
    });
    expect(recover.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);
    expect(send).not.toHaveBeenCalled();
    expect(
      client
        .getSnapshot()
        .conversation!.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    client.dispose();
  },
);

it("an explicit none recovery suppresses stock Retry despite available ports", async () => {
  const base = config();
  const regenerate = vi.fn(async () => {});
  const recover = vi.fn(async () => {});
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    versions: { edit: async () => {}, select: async () => {}, regenerate },
    transport: {
      ...base.transport,
      read: async () => conversation(failure("none"), true),
    },
  });
  await client.ready;
  expect(client.canRetryReply()).toBe(false);
  await client.retryReply();
  await client.regenerate(assistant.id);
  expect(recover).not.toHaveBeenCalled();
  expect(regenerate).not.toHaveBeenCalled();
  client.dispose();
});

it.each(["regenerate", "resend"] as const)(
  "repeated reply recovery reuses its attempt id (%s)",
  async (kind) => {
    const base = config();
    let release!: () => void;
    const recover = vi.fn(
      (_input: ReplyRecoveryInput) =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const client = createWaypointClient({
      ...base,
      replies: { recover },
      transport: {
        ...base.transport,
        read: async () => conversation(failure(kind), kind === "regenerate"),
      },
    });
    await client.ready;
    const first = client.retryReply();
    const second = client.retryReply();
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
    expect(first).toBe(second);
    release();
    await first;
    client.dispose();
  },
);

it("row and message Regenerate share one attempt", async () => {
  const base = config();
  let release!: () => void;
  const recover = vi.fn(
    (_input: ReplyRecoveryInput) =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const regenerate = vi.fn(async () => {});
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    versions: { edit: async () => {}, select: async () => {}, regenerate },
    transport: {
      ...base.transport,
      read: async () => conversation(failure("regenerate"), true),
    },
  });
  await client.ready;
  const row = client.retryReply();
  const message = client.regenerate(assistant.id);
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
  expect(row).toBe(message);
  expect(regenerate).not.toHaveBeenCalled();
  release();
  await row;
  client.dispose();
});

it("host-selected Regenerate works with only the versions port", async () => {
  const base = config();
  const regenerate = vi.fn(async (_input: MessageVersionInput) => {});
  const client = createWaypointClient({
    ...base,
    versions: { edit: async () => {}, select: async () => {}, regenerate },
    transport: {
      ...base.transport,
      read: async () => conversation(failure("regenerate"), true),
    },
  });
  await client.ready;
  await client.retryReply();
  expect(regenerate).toHaveBeenCalledOnce();
  expect(regenerate.mock.calls[0]![0].messageId).toBe(assistant.id);
  expect(regenerate.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);
  client.dispose();
});

it("unknown reply recovery outcomes retain their id", async () => {
  const base = config();
  const recover = vi.fn(async (_input: ReplyRecoveryInput) => {
    throw new Error("Outcome unknown");
  });
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: {
      ...base.transport,
      read: async () => conversation(failure("resend")),
    },
  });
  await client.ready;
  await client.retryReply();
  await client.retryReply();
  expect(recover).toHaveBeenCalledTimes(2);
  expect(recover.mock.calls[0]![0].clientReplyId).toBe(
    recover.mock.calls[1]![0].clientReplyId,
  );
  client.dispose();
});

it("retry after a definitive refusal can recover once host settings change", async () => {
  const base = config();
  const recover = vi.fn(
    async (
      _input: ReplyRecoveryInput,
    ): Promise<void | {
      accepted: false;
      problem: { code: "refused"; id: string };
    }> => {},
  );
  recover.mockImplementationOnce(async () => ({
    accepted: false,
    problem: { code: "refused", id: "host-problem" },
  }));
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: {
      ...base.transport,
      read: async () => conversation(failure("resend")),
    },
  });
  await client.ready;
  await client.retryReply();
  await client.retryReply();
  expect(recover).toHaveBeenCalledTimes(2);
  expect(recover.mock.calls[0]![0].clientReplyId).not.toBe(
    recover.mock.calls[1]![0].clientReplyId,
  );
  client.dispose();
});

it("a recovery attempt from a closed conversation does not block its next visit", async () => {
  const base = config();
  const recover = vi.fn(
    (_input: ReplyRecoveryInput) => new Promise<void>(() => {}),
  );
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: {
      ...base.transport,
      read: async (id) => ({
        ...conversation(failure("regenerate"), true),
        id,
      }),
    },
  });
  await client.ready;
  const first = client.retryReply();
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
  const input = recover.mock.calls[0]![0];
  await client.switchConversation("other-conversation");
  await first;
  expect(input.signal.aborted).toBe(true);
  await client.switchConversation("conversation-a");
  const next = client.retryReply();
  await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(2));
  expect(recover.mock.calls[1]![0].clientReplyId).toBe(input.clientReplyId);
  client.dispose();
  await next;
});

it("a withdrawn recovery cannot replay a held unknown-outcome attempt", async () => {
  const base = config();
  let current = conversation(failure("resend"));
  const recover = vi.fn(async (_input: ReplyRecoveryInput) => {
    throw new Error("Unknown");
  });
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: { ...base.transport, read: async () => current },
  });
  await client.ready;
  await client.retryReply();
  current = conversation(failure("none"));
  await client.refresh();
  expect(client.canRetryReply()).toBe(false);
  await client.retryReply();
  expect(recover).toHaveBeenCalledOnce();
  client.dispose();
});

it("a newer user message does not inherit an earlier reply failure or its Resend", async () => {
  const base = config();
  let current = conversation({ ...failure("resend"), forMessageId: user.id });
  const recover = vi.fn(async () => {});
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: { ...base.transport, read: async () => current },
  });
  await client.ready;
  current = {
    ...current,
    messages: [
      user,
      { ...user, id: "new-user", content: "New question", createdAt: 100 },
    ],
  };
  await client.refresh();
  expect(client.getSnapshot().replyState).toBe("writing");
  await client.retryReply();
  expect(recover).not.toHaveBeenCalled();
  client.dispose();
});

it("disposing aborts recovery and releases its shared guard", async () => {
  const base = config();
  const recover = vi.fn(
    (_input: ReplyRecoveryInput) => new Promise<void>(() => {}),
  );
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: {
      ...base.transport,
      read: async () => conversation(failure("resend")),
    },
  });
  await client.ready;
  const pending = client.retryReply();
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
  client.dispose();
  await pending;
  expect(recover.mock.calls[0]![0].signal.aborted).toBe(true);
  await flush();
});

it("successful reply message Regenerate remains unchanged", async () => {
  const base = config();
  const regenerate = vi.fn(async () => {});
  const current: Conversation = {
    ...conversation(
      { ...failure("regenerate"), forMessageId: assistant.id },
      true,
    ),
    messages: [
      user,
      assistant,
      { ...assistant, id: "successful-assistant", status: "completed" },
    ],
  };
  const client = createWaypointClient({
    ...base,
    versions: { regenerate, edit: async () => {}, select: async () => {} },
    transport: { ...base.transport, read: async () => current },
  });
  await client.ready;
  await client.regenerate("successful-assistant");
  expect(regenerate).toHaveBeenCalledOnce();
  client.dispose();
});

it("a withdrawn recovery hides its control while its attempt finishes", async () => {
  const base = config();
  let current = conversation(failure("regenerate"), true);
  let release!: () => void;
  const recover = vi.fn(
    (_input: ReplyRecoveryInput) =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: { ...base.transport, read: async () => current },
  });
  await client.ready;
  const active = client.retryReply();
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
  current = conversation(failure("none"), true);
  await client.refresh();
  expect(client.canRetryReply()).toBe(false);
  expect(recover.mock.calls[0]![0].signal.aborted).toBe(false);
  await client.retryReply();
  expect(recover).toHaveBeenCalledOnce();
  release();
  await active;
  expect(client.canRetryReply()).toBe(false);
  client.dispose();
});

it("a stale recovery finally cannot release a new visit attempt", async () => {
  const base = config();
  const releases: (() => void)[] = [];
  const recover = vi.fn(
    (_input: ReplyRecoveryInput) =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
  );
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: {
      ...base.transport,
      read: async (id) => ({
        ...conversation(failure("regenerate"), true),
        id,
      }),
    },
  });
  await client.ready;
  const old = client.retryReply();
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
  await client.switchConversation("other-conversation");
  await old;
  await client.switchConversation("conversation-a");
  const current = client.retryReply();
  await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(2));
  releases[0]!();
  await flush();
  expect(client.retryReply()).toBe(current);
  expect(recover).toHaveBeenCalledTimes(2);
  releases[1]!();
  await current;
  client.dispose();
});

it("reoffering recovery does not automatically replay an earlier attempt", async () => {
  const base = config();
  let current = conversation(failure("resend"));
  const recover = vi.fn(async (_input: ReplyRecoveryInput) => {
    throw new Error("Unknown");
  });
  const client = createWaypointClient({
    ...base,
    replies: { recover },
    transport: { ...base.transport, read: async () => current },
  });
  await client.ready;
  await client.retryReply();
  current = conversation(failure("none"));
  await client.refresh();
  current = conversation({ ...failure("resend"), id: "new-failure-episode" });
  await client.refresh();
  expect(recover).toHaveBeenCalledOnce();
  await client.retryReply();
  expect(recover).toHaveBeenCalledTimes(2);
  expect(recover.mock.calls[0]![0].clientReplyId).not.toBe(
    recover.mock.calls[1]![0].clientReplyId,
  );
  client.dispose();
});

it.each([
  undefined,
  null,
  { id: "reason-only", reason: { code: "availability" } },
])(
  "legacy conversation failure still refreshes without explicit recovery (%j)",
  async (value) => {
    const base = config();
    const recover = vi.fn(async () => {});
    const read = vi.fn(async () => ({
      ...conversation(null),
      replyFailure: value,
    }));
    const client = createWaypointClient({
      ...base,
      replies: { recover },
      transport: { ...base.transport, read },
    });
    await client.ready;
    expect(client.canRetryReply()).toBe(true);
    await client.retryReply();
    expect(read).toHaveBeenCalledTimes(2);
    expect(recover).not.toHaveBeenCalled();
    client.dispose();
  },
);

it.each([
  { kind: "resend", messageId: "assistant" },
  { kind: "regenerate", messageId: "user" },
  { kind: "regenerate", messageId: "foreign-message" },
] as const)(
  "explicit recovery never infers a target from another message (%j)",
  async (recovery) => {
    const base = config();
    const recover = vi.fn(async () => {});
    const client = createWaypointClient({
      ...base,
      replies: { recover },
      transport: {
        ...base.transport,
        read: async () =>
          conversation({ ...failure("regenerate"), recovery }, true),
      },
    });
    await client.ready;
    expect(client.canRetryReply()).toBe(false);
    await client.retryReply();
    expect(recover).not.toHaveBeenCalled();
    client.dispose();
  },
);

it("a conversation-failed writing reply offers recovery but not Stop", async () => {
  const base = config();
  const writing = { ...assistant, status: "writing" as const };
  let current: Conversation = {
    ...conversation(null),
    replyFailure: undefined,
    replyStatus: undefined,
    messages: [user, writing],
  };
  const send = vi.fn(base.transport.send);
  const client = createWaypointClient({
    ...base,
    replies: { recover: async () => {} },
    transport: {
      ...base.transport,
      send,
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: ["reply-stop"],
      }),
      read: async () => current,
    },
  });
  await client.ready;
  expect(client.canStopReply()).toBe(true);
  current = {
    ...current,
    replyStatus: "failed",
    replyFailure: failure("regenerate"),
  };
  await client.refresh();
  expect(client.getSnapshot().replyState).toBe("failed");
  expect(client.canRetryReply()).toBe(true);
  expect(client.canStopReply()).toBe(false);
  await client.stopReply();
  expect(send).not.toHaveBeenCalled();
  client.dispose();
});
