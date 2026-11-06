// Stop ends the reply being written: what it has written stays, marked as
// stopped, and the host is asked once to stop writing it.
import { it, expect } from "vitest";
import {
  createWaypointClient,
  type TransportEvent,
} from "../../src/core/client";
import type {
  Conversation,
  Message,
  Reply,
} from "../../src/protocol/generated";
import { config, flush } from "../support/client";

const writing: Message = {
  id: "a",
  role: "assistant",
  content: "The first order",
  blocks: [],
  createdAt: 1,
  status: "writing",
};

async function setup(capabilities: string[], host: Partial<Message> = {}) {
  const sent: Reply[] = [];
  let listener: ((event: TransportEvent) => void) | undefined;
  let stored: Message = { ...writing };
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      negotiate: async () => ({ protocol: "1.0", capabilities }),
      read: async (): Promise<Conversation> => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
          stored,
        ],
      }),
      send: async (reply) => {
        sent.push(reply);
        stored = { ...stored, ...host };
        return { id: reply.clientReplyId };
      },
      subscribe: (_id, next) => {
        listener = next;
        return () => {};
      },
    },
  });
  await client.ready;
  await flush();
  // Frames in the order sent.
  let sequence = 10;
  // The host holds what it streamed, until it stops.
  const delta = (text: string) => {
    if (stored.status === "writing")
      stored = { ...stored, content: stored.content + text };
    listener!({
      type: "frame",
      frame: {
        type: "text.delta",
        protocol: "1.0",
        sequence: ++sequence,
        messageId: "a",
        text,
      },
    });
  };
  const shown = () => client.getSnapshot().conversation!.messages.at(-1)!;
  // Any frame for the reply, as the host's stream would send it.
  const frame = (value: Record<string, unknown>) =>
    listener!({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: ++sequence,
        messageId: "a",
        ...value,
      } as never,
    });
  // What the host holds, as a later read shows it.
  const hold = (value: Partial<Message>) => {
    stored = { ...stored, ...value };
  };
  return { client, sent, delta, shown, frame, hold };
}

it("keeps the partial text, marks it stopped at once and asks the host once", async () => {
  const { client, sent, shown } = await setup(["reply-stop"], {
    status: "stopped",
  });
  const stopping = client.stopReply();
  expect(shown().status).toBe("stopped");
  expect(shown().content).toBe("The first order");
  expect(client.getSnapshot().replyState).toBe("none");
  await stopping;
  await client.stopReply();
  expect(sent).toEqual([
    {
      kind: "stop",
      protocol: "1.0",
      clientReplyId: expect.any(String),
      messageId: "a",
      versionIndex: 1,
    },
  ]);
  expect(shown().status).toBe("stopped");
  client.dispose();
});

it("drops text that arrives for a stopped reply", async () => {
  const { client, delta, shown } = await setup(["reply-stop"], {
    status: "stopped",
  });
  delta(" shipped");
  expect(shown().content).toBe("The first order shipped");
  await client.stopReply();
  delta(" on Monday");
  expect(shown().content).toBe("The first order shipped");
  client.dispose();
});

it("stays stopped when a read still says the host is writing", async () => {
  // The host has not yet handled the stop: its read says writing.
  const { client, shown } = await setup(["reply-stop"]);
  await client.stopReply();
  await client.refresh();
  expect(shown().status).toBe("stopped");
  expect(client.getSnapshot().replyState).toBe("none");
  client.dispose();
});

it("does nothing when the host cannot stop a reply", async () => {
  const { client, sent, shown } = await setup([]);
  expect(client.canStopReply()).toBe(false);
  await client.stopReply();
  expect(sent).toEqual([]);
  expect(shown().status).toBe("writing");
  client.dispose();
});

it("can stop only while a reply is being written", async () => {
  const { client } = await setup(["reply-stop"]);
  expect(client.canStopReply()).toBe(true);
  await client.stopReply();
  expect(client.canStopReply()).toBe(false);
  client.dispose();
});

it("the scripted host ends a reply being written as stopped and keeps its text", async () => {
  const { createScriptedTransport, createTestPlatform } =
    await import("../../src/testing/transport");
  const host = createScriptedTransport(() => 5);
  const transport = {
    ...host.transport,
    negotiate: async () => ({
      protocol: "1.0",
      capabilities: ["reply-stop"],
    }),
  };
  host.enqueue({ content: "Half an answer", writing: true });
  await transport.send(
    {
      kind: "message",
      protocol: "1.0",
      clientReplyId: "m",
      clientMessageId: "m",
      content: "Hi",
    },
    "c",
  );
  const client = createWaypointClient({
    accountId: "a",
    conversationId: "c",
    platform: createTestPlatform(),
    transport,
  });
  await client.ready;
  await client.stopReply();
  const reply = (await transport.read("c")).messages.at(-1)!;
  expect(reply.status).toBe("stopped");
  expect(reply.content).toBe("Half an answer");
  client.dispose();
});

// Each version of a reply is its own attempt: stopping a regenerated one
// is a new request, never a replay of the stop of the version before it.
async function versioned(startsOnStream: boolean) {
  const sent: Reply[] = [];
  let listener: ((event: TransportEvent) => void) | undefined;
  let stored: Message = { ...writing, versionIndex: 1, versionCount: 1 };
  const base = config();
  const start = () =>
    listener!({
      type: "frame",
      frame: {
        type: "message.start",
        protocol: "1.0",
        sequence: 100,
        messageId: "a",
        role: "assistant",
      },
    });
  const client = createWaypointClient({
    ...base,
    versions: {
      edit: async () => {},
      select: async () => {},
      regenerate: async () => {
        stored = {
          ...stored,
          content: "",
          status: "writing",
          versionIndex: 2,
          versionCount: 2,
        };
        if (startsOnStream) start();
      },
    },
    transport: {
      ...base.transport,
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: ["reply-stop"],
      }),
      read: async (): Promise<Conversation> => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
          stored,
        ],
      }),
      send: async (reply) => {
        sent.push(reply);
        if (reply.kind === "stop") stored = { ...stored, status: "stopped" };
        return { id: reply.clientReplyId };
      },
      subscribe: (_id, next) => {
        listener = next;
        return () => {};
      },
    },
  });
  await client.ready;
  await flush();
  return { client, sent };
}

it.each([
  ["the new version starts on the stream", true],
  ["a read shows the new version first", false],
])(
  "asks the host again to stop a regenerated reply when %s",
  async (_name, startsOnStream) => {
    const { client, sent } = await versioned(startsOnStream);
    await client.stopReply();
    await client.regenerate("a");
    await flush();
    expect(client.canStopReply()).toBe(true);
    await client.stopReply();
    const stops = sent.filter((reply) => reply.kind === "stop");
    expect(stops).toHaveLength(2);
    expect(stops[0]!.clientReplyId).not.toBe(stops[1]!.clientReplyId);
    expect(stops.map((stop) => stop.versionIndex)).toEqual([1, 2]);
    expect(client.getSnapshot().conversation!.messages.at(-1)!.status).toBe(
      "stopped",
    );
    client.dispose();
  },
);

it("shows a reply stopped elsewhere as stopped when its end says so", async () => {
  // Another tab stopped it: this one only sees the host's end.
  const { client, frame, shown } = await setup(["reply-stop"]);
  frame({ type: "message.end", status: "stopped" });
  await flush();
  expect(shown().status).toBe("stopped");
  client.dispose();
});

it("keeps a stopped reply stopped when the host's end says completed", async () => {
  // The host finished before it handled the stop: until a read says
  // otherwise, the text cut short is not shown as finished.
  const { client, frame, delta, shown } = await setup(["reply-stop"]);
  // Written on this stream, so its end is this stream's to apply.
  frame({ type: "message.start", role: "assistant" });
  delta("The first order");
  await client.stopReply();
  frame({ type: "message.end", status: "completed" });
  await flush();
  expect(shown().status).toBe("stopped");
  client.dispose();
});

it("keeps the text of a stopped reply when a read still says writing", async () => {
  // A host that keeps writing after the stop: its text does not grow under
  // the Stopped mark.
  const { client, hold, shown } = await setup(["reply-stop"]);
  await client.stopReply();
  hold({ content: "The first order shipped on Monday" });
  await client.refresh();
  expect(shown().status).toBe("stopped");
  expect(shown().content).toBe("The first order");
  client.dispose();
});

// A stop names the version it is for, so a host that receives it late, once
// the next version is being written, leaves that one alone.
async function regenerating(options: {
  // The host handles a stop when it arrives, or not yet.
  handles: boolean;
  // The regenerate request answers when this resolves.
  answered?: Promise<void>;
}) {
  const sent: Reply[] = [];
  const arrive: Array<() => void> = [];
  let listener: ((event: TransportEvent) => void) | undefined;
  let stored: Message = { ...writing, versionIndex: 1, versionCount: 1 };
  let sequence = 100;
  const frame = (value: Record<string, unknown>) =>
    listener!({
      type: "frame",
      frame: {
        protocol: "1.0",
        sequence: ++sequence,
        messageId: "a",
        ...value,
      } as never,
    });
  const base = config();
  const client = createWaypointClient({
    ...base,
    versions: {
      edit: async () => {},
      select: async () => {},
      regenerate: async () => {
        stored = {
          ...stored,
          content: "",
          status: "writing",
          versionIndex: 2,
          versionCount: 2,
        };
        frame({ type: "message.start", role: "assistant" });
        await options.answered;
      },
    },
    transport: {
      ...base.transport,
      negotiate: async () => ({
        protocol: "1.0",
        capabilities: ["reply-stop"],
      }),
      read: async (): Promise<Conversation> => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
          stored,
        ],
      }),
      send: (reply) => {
        sent.push(reply);
        if (reply.kind !== "stop" || !options.handles)
          return Promise.resolve({ id: reply.clientReplyId });
        // The stop travels on its own request and may arrive late. The
        // host stops only the version the stop names.
        return new Promise((resolve) =>
          arrive.push(() => {
            if (
              stored.status === "writing" &&
              (reply.versionIndex === undefined ||
                reply.versionIndex === stored.versionIndex)
            )
              stored = { ...stored, status: "stopped" };
            resolve({ id: reply.clientReplyId });
          }),
        );
      },
      subscribe: (_id, next) => {
        listener = next;
        return () => {};
      },
    },
  });
  await client.ready;
  await flush();
  const shown = () => client.getSnapshot().conversation!.messages.at(-1)!;
  const write = (text: string) => {
    if (stored.status === "writing")
      stored = { ...stored, content: stored.content + text };
    frame({ type: "text.delta", text });
  };
  return {
    client,
    sent,
    shown,
    write,
    frame,
    host: () => stored,
    hold: (value: Partial<Message>) => {
      stored = { ...stored, ...value };
    },
    arrive: () => arrive.shift()!(),
  };
}

it("a stop that reaches the host after Regenerate leaves the new version writing", async () => {
  const { client, sent, shown, write, host, arrive } = await regenerating({
    handles: true,
  });
  const stopping = client.stopReply();
  await flush();
  await client.regenerate("a");
  await flush();
  arrive();
  await stopping;
  write("A new answer");
  await client.refresh();
  expect(host().status).toBe("writing");
  expect(shown().status).toBe("writing");
  expect(shown().content).toBe("A new answer");
  expect(sent.find((reply) => reply.kind === "stop")).toMatchObject({
    versionIndex: 1,
  });
  client.dispose();
});

it("keeps a stop of the new version when Regenerate answers after it started", async () => {
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  const { client, sent, shown, write } = await regenerating({
    handles: false,
    answered,
  });
  await client.stopReply();
  const asking = client.regenerate("a");
  await flush();
  write("A new");
  await client.stopReply();
  answer();
  await asking;
  await flush();
  write(" answer");
  expect(shown().status).toBe("stopped");
  expect(shown().content).toBe("A new");
  expect(sent.filter((reply) => reply.kind === "stop").at(-1)).toMatchObject({
    versionIndex: 2,
  });
  client.dispose();
});

it("shows a newer version being written although this tab stopped the one before", async () => {
  // Another tab regenerated, and this one never saw the new version start.
  const { client, shown, hold, write } = await regenerating({
    handles: false,
  });
  await client.stopReply();
  hold({
    status: "writing",
    content: "A new",
    versionIndex: 2,
    versionCount: 2,
  });
  await client.refresh();
  expect(shown().status).toBe("writing");
  expect(shown().content).toBe("A new");
  write(" answer");
  expect(shown().content).toBe("A new answer");
  client.dispose();
});

it("names the version that started on the stream before any read shows it", async () => {
  // Another tab regenerated; reads still say the version before ended.
  const { client, sent, frame, hold } = await regenerating({ handles: false });
  hold({ status: "completed" });
  await client.refresh();
  frame({ type: "message.start", role: "assistant" });
  await client.stopReply();
  expect(sent.at(-1)).toMatchObject({ kind: "stop", versionIndex: 2 });
  client.dispose();
});

it("names no version when it cannot tell which one started", async () => {
  // Without a versions port, the client does not know how the host numbers
  // a reply that starts again, so its stop holds for whichever is written.
  const { client, sent, frame, hold } = await setup(["reply-stop"]);
  hold({ status: "completed" });
  frame({ type: "message.end", status: "completed" });
  await flush();
  frame({ type: "message.start", role: "assistant" });
  await client.stopReply();
  expect(sent.at(-1)).toEqual({
    kind: "stop",
    protocol: "1.0",
    clientReplyId: expect.any(String),
    messageId: "a",
  });
  client.dispose();
});

it("the scripted host leaves a reply writing when a stop names another version", async () => {
  const { createScriptedTransport } =
    await import("../../src/testing/transport");
  const host = createScriptedTransport(() => 5);
  host.enqueue({ content: "Half an answer", writing: true });
  const message = {
    kind: "message",
    protocol: "1.0",
    clientReplyId: "m",
    clientMessageId: "m",
    content: "Hi",
  } as const;
  await host.transport.send(message, "c");
  const id = (await host.transport.read("c")).messages.at(-1)!.id;
  const stop = { kind: "stop", protocol: "1.0", messageId: id } as const;
  await host.transport.send(
    { ...stop, clientReplyId: "s1", versionIndex: 2 },
    "c",
  );
  expect((await host.transport.read("c")).messages.at(-1)!.status).toBe(
    "writing",
  );
  await host.transport.send(
    { ...stop, clientReplyId: "s2", versionIndex: 1 },
    "c",
  );
  expect((await host.transport.read("c")).messages.at(-1)!.status).toBe(
    "stopped",
  );
});
