import { expect, it, vi } from "vitest";
import {
  createWaypointClient,
  type ConversationPageInput,
  type TransportEvent,
} from "../../src/core/client";
import type {
  ConversationPage,
  Message,
  OutlineMessage,
  Frame,
} from "../../src/protocol/generated";
import { config, flush } from "../support/client";

const ids = ["old", "middle", "latest"];
function message(id: string, content = id): Message {
  return { id, role: "assistant", content, blocks: [], createdAt: 1 };
}
function outline(revisions: Record<string, string> = {}): OutlineMessage[] {
  return ids.map((id) => ({
    id,
    role: "assistant",
    text: id,
    revision: revisions[id] ?? "1",
  }));
}
function page(
  messages = [message("latest")],
  extra: Partial<Exclude<ConversationPage, { stale: true }>> = {},
): ConversationPage {
  return {
    conversation: {
      protocol: "1.0",
      id: "conversation-a",
      title: "Latest title",
      messages,
    },
    snapshotId: "snapshot-a",
    olderCursor: "middle-cursor",
    outline: outline(),
    heldClientMessageIds: [],
    ...extra,
  };
}
function setup() {
  const cfg = config();
  let listener: (event: TransportEvent) => void = () => {};
  cfg.transport.subscribe = (_id, next) => {
    listener = next;
    return () => {};
  };
  let sequence = 0;
  const readPage = vi.fn(
    async (
      _id: string,
      input: ConversationPageInput,
    ): Promise<ConversationPage> => {
      if (input.cursor === "middle-cursor")
        return page([message("middle"), message("latest")], {
          olderCursor: "old-cursor",
        });
      if (input.cursor === "old-cursor")
        return page([message("old"), message("middle")], { olderCursor: null });
      return page();
    },
  );
  cfg.transport.readPage = readPage;
  return {
    cfg,
    readPage,
    frame(frame: Record<string, unknown>) {
      listener({
        type: "frame",
        frame: { protocol: "1.0", sequence: ++sequence, ...frame } as Frame,
      });
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("latest page keeps every outline entry without loading older bodies", async () => {
  const h = setup();
  const fullRead = vi.spyOn(h.cfg.transport, "read");
  const client = createWaypointClient(h.cfg);
  await client.ready;
  expect(
    client.getSnapshot().history?.outline.map((entry) => entry.id),
  ).toEqual(ids);
  expect(
    client.getSnapshot().conversation?.messages.map((entry) => entry.id),
  ).toEqual(["latest"]);
  expect(h.readPage).toHaveBeenCalledOnce();
  expect(fullRead).not.toHaveBeenCalled();
  expect(h.readPage.mock.calls[0]![1]).toMatchObject({
    clientMessageIds: [],
    signal: { aborted: false },
  });
  client.dispose();
});
it("scrolling older merges one complete page without duplicate messages", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  expect(await client.loadOlder()).toBe(true);
  expect(
    client.getSnapshot().conversation?.messages.map((entry) => entry.id),
  ).toEqual(["middle", "latest"]);
  expect(h.readPage).toHaveBeenCalledTimes(2);
  expect(await client.loadOlder()).toBe(true);
  expect(
    client.getSnapshot().conversation?.messages.map((entry) => entry.id),
  ).toEqual(ids);
  expect(client.getSnapshot().history?.hasOlder).toBe(false);
  client.dispose();
});
it("an unloaded outline target loads before navigation", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  expect(await client.loadMessage("old")).toBe(true);
  expect(h.readPage.mock.calls.slice(1).map((call) => call[1].cursor)).toEqual([
    "middle-cursor",
    "old-cursor",
  ]);
  expect(client.getSnapshot().conversation?.messages[0]?.id).toBe("old");
  client.dispose();
});
it("latest refresh retains loaded history and streamed text", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  await client.loadOlder();
  h.frame({ type: "text.delta", messageId: "latest", text: " streamed" });
  h.readPage.mockImplementationOnce(async () =>
    page([message("latest", "latest streamed")], { snapshotId: "snapshot-b" }),
  );
  await client.refresh();
  expect(
    client.getSnapshot().conversation?.messages.map((entry) => entry.id),
  ).toEqual(["middle", "latest"]);
  expect(client.getSnapshot().conversation?.messages.at(-1)?.content).toBe(
    "latest streamed",
  );
  expect(h.readPage).toHaveBeenCalledTimes(3);
  client.dispose();
});
it("paged receipts acknowledge an older pending send without duplicating it", async () => {
  const h = setup();
  h.cfg.transport.send = async () => {
    throw { code: "in-doubt" };
  };
  const client = createWaypointClient(h.cfg);
  await client.ready;
  await client.setDraft("Request");
  await client.send();
  const id = client.getSnapshot().pending[0]!.id;
  h.readPage.mockImplementationOnce(async (_id, input) => {
    expect(input.clientMessageIds).toEqual([id]);
    return page(undefined, { heldClientMessageIds: [id] });
  });
  await client.refresh();
  expect(client.getSnapshot().pending).toEqual([]);
  expect(client.getSnapshot().conversation?.messages).toHaveLength(1);
  client.dispose();
});
it.each([
  "duplicate outline",
  "foreign receipt",
  "foreign conversation",
  "body outside outline",
])(
  "failed pages cannot partially publish messages or settle the outbox (%s)",
  async (fault) => {
    const h = setup();
    h.cfg.transport.send = async () => {
      throw { code: "in-doubt" };
    };
    const client = createWaypointClient(h.cfg);
    await client.ready;
    await client.setDraft("Request");
    await client.send();
    const before = client.getSnapshot().conversation;
    const id = client.getSnapshot().pending[0]!.id;
    h.readPage.mockImplementationOnce(async () => {
      const result = page(undefined, { heldClientMessageIds: [id] });
      if ("stale" in result) throw new Error("fixture shape");
      result.conversation.title = "Must not publish";
      if (fault === "duplicate outline")
        result.outline.push(result.outline[0]!);
      if (fault === "foreign receipt")
        result.heldClientMessageIds.push("not-requested");
      if (fault === "foreign conversation") result.conversation.id = "another";
      if (fault === "body outside outline")
        result.conversation.messages.push(message("not-indexed"));
      return result;
    });
    expect((await client.refresh()).kind).toBe("unavailable");
    expect(client.getSnapshot().conversation).toBe(before);
    expect(client.getSnapshot().pending.map((entry) => entry.id)).toEqual([id]);
    client.dispose();
  },
);
it("stale page requests cancel and cannot alter the next conversation", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  const held = deferred<ConversationPage>();
  let input: ConversationPageInput | undefined;
  h.readPage.mockImplementationOnce(async (_id, next) => {
    input = next;
    return held.promise;
  });
  const loading = client.loadOlder();
  await vi.waitFor(() => expect(input).toBeDefined());
  h.readPage.mockImplementationOnce(async (id) => {
    const next = page();
    if (!("stale" in next)) next.conversation.id = id;
    return next;
  });
  await client.switchConversation("another");
  expect(input!.signal.aborted).toBe(true);
  expect(await loading).toBe(false);
  held.resolve(page([message("old")], { olderCursor: null }));
  await flush();
  expect(client.getSnapshot().conversation?.id).toBe("another");
  client.dispose();
});
it("a page fetched before a frame edit cannot replace the newer body", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  const held = deferred<ConversationPage>();
  h.readPage.mockImplementationOnce(async () => held.promise);
  const loading = client.loadOlder();
  await vi.waitFor(() => expect(h.readPage).toHaveBeenCalledTimes(2));
  h.frame({ type: "text.delta", messageId: "latest", text: " streamed" });
  held.resolve(
    page([message("middle"), message("latest")], { olderCursor: "old-cursor" }),
  );
  expect(await loading).toBe(true);
  expect(client.getSnapshot().conversation?.messages.at(-1)?.content).toBe(
    "latest streamed",
  );
  client.dispose();
});
it("editing or selecting an older loaded message adopts its authoritative version after a latest-page refresh", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  await client.loadOlder();
  const before = client.getSnapshot().conversation;
  const changed = outline({ middle: "2" });
  const held = deferred<ConversationPage>();
  h.readPage.mockImplementationOnce(async () =>
    page(undefined, { snapshotId: "snapshot-b", outline: changed }),
  );
  h.readPage.mockImplementationOnce(async (_id, input) => {
    expect(input.aroundMessageId).toBe("middle");
    return held.promise;
  });
  const snapshots: string[] = [];
  const off = client.subscribe(() =>
    snapshots.push(client.getSnapshot().conversation?.title ?? ""),
  );
  const refreshing = client.refresh();
  await vi.waitFor(() => expect(h.readPage).toHaveBeenCalledTimes(4));
  expect(client.getSnapshot().conversation).toBe(before);
  held.resolve(
    page([message("middle", "Edited"), message("latest")], {
      snapshotId: "snapshot-b",
      outline: changed,
    }),
  );
  await refreshing;
  expect(client.getSnapshot().conversation?.messages[0]?.content).toBe(
    "Edited",
  );
  expect(snapshots.every((title) => title === "Latest title")).toBe(true);
  off();
  client.dispose();
});
it("invalid cursor chains stop without losing loaded history", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  const before = client.getSnapshot().conversation;
  h.readPage.mockImplementationOnce(async () =>
    page([message("middle"), message("latest")]),
  );
  expect(await client.loadMessage("old")).toBe(false);
  expect(h.readPage).toHaveBeenCalledTimes(2);
  expect(client.getSnapshot().conversation).toBe(before);
  expect(client.getSnapshot().history?.failed).toBe(true);
  client.dispose();
});
it("an older page from a superseded snapshot cannot replace a newer body", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  const held = deferred<ConversationPage>();
  let input: ConversationPageInput | undefined;
  h.readPage.mockImplementationOnce(async (_id, next) => {
    input = next;
    return held.promise;
  });
  const loading = client.loadOlder();
  await vi.waitFor(() => expect(input).toBeDefined());
  h.readPage.mockImplementationOnce(async () =>
    page([message("latest", "New body")], {
      snapshotId: "snapshot-b",
      outline: outline({ latest: "2" }),
    }),
  );
  await client.refresh();
  expect(input!.signal.aborted).toBe(true);
  held.resolve(page([message("middle"), message("latest")]));
  await loading;
  expect(client.getSnapshot().conversation?.messages.at(-1)?.content).toBe(
    "New body",
  );
  client.dispose();
});
it("whole-conversation hosts preserve their read behavior", async () => {
  const cfg = config();
  const read = vi.spyOn(cfg.transport, "read");
  const client = createWaypointClient(cfg);
  await client.ready;
  expect(read).toHaveBeenCalledWith("conversation-a", undefined);
  expect(client.getSnapshot().history).toBeUndefined();
  client.dispose();
});

it("paged receipt adoption publishes messages and outbox together", async () => {
  const h = setup();
  h.cfg.transport.send = async () => {
    throw { code: "in-doubt" };
  };
  const client = createWaypointClient(h.cfg);
  await client.ready;
  await client.setDraft("Request");
  await client.send();
  const id = client.getSnapshot().pending[0]!.id;
  const seen: { title?: string; pending: number }[] = [];
  const off = client.subscribe(() =>
    seen.push({
      title: client.getSnapshot().conversation?.title,
      pending: client.getSnapshot().pending.length,
    }),
  );
  h.readPage.mockImplementationOnce(async () => {
    const result = page(undefined, { heldClientMessageIds: [id] });
    if (!("stale" in result)) result.conversation.title = "Adopted";
    return result;
  });
  await client.refresh();
  expect(
    seen.some((state) => state.title === "Adopted" && state.pending === 0),
  ).toBe(true);
  expect(
    seen.some((state) => state.title === "Adopted" && state.pending > 0),
  ).toBe(false);
  off();
  client.dispose();
});
it("changed history bodies on one page share an around read", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  await client.loadMessage("old");
  const changed = outline({ old: "2", middle: "2" });
  h.readPage.mockImplementationOnce(async () =>
    page(undefined, { snapshotId: "snapshot-b", outline: changed }),
  );
  h.readPage.mockImplementationOnce(async () =>
    page([message("old", "Old edited"), message("middle", "Middle edited")], {
      snapshotId: "snapshot-b",
      outline: changed,
    }),
  );
  const before = h.readPage.mock.calls.length;
  await client.refresh();
  expect(h.readPage.mock.calls.length - before).toBe(2);
  expect(
    client.getSnapshot().conversation?.messages.map((entry) => entry.content),
  ).toEqual(["Old edited", "Middle edited", "latest"]);
  client.dispose();
});
it("a failed private body refresh retains the complete visible snapshot and receipts", async () => {
  const h = setup();
  h.cfg.transport.send = async () => {
    throw { code: "in-doubt" };
  };
  const client = createWaypointClient(h.cfg);
  await client.ready;
  await client.loadOlder();
  await client.setDraft("Request");
  await client.send();
  const id = client.getSnapshot().pending[0]!.id;
  const before = client.getSnapshot().conversation;
  h.readPage.mockImplementationOnce(async () =>
    page(undefined, {
      snapshotId: "snapshot-b",
      outline: outline({ middle: "2" }),
      heldClientMessageIds: [id],
    }),
  );
  h.readPage.mockImplementationOnce(async () => {
    throw new Error("Body unavailable");
  });
  expect((await client.refresh()).kind).toBe("unavailable");
  expect(client.getSnapshot().conversation).toBe(before);
  expect(client.getSnapshot().pending.map((entry) => entry.id)).toEqual([id]);
  client.dispose();
});
it("equivalent outline and sender objects do not depend on JSON key order", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  h.readPage.mockImplementationOnce(async () =>
    page([message("middle"), message("latest")], {
      outline: outline().map(
        (entry) =>
          Object.fromEntries(Object.entries(entry).reverse()) as OutlineMessage,
      ),
      olderCursor: "old-cursor",
    }),
  );
  expect(await client.loadOlder()).toBe(true);
  client.dispose();
});
it("a typed stale cursor preserves history and allows an explicit retry", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  const before = client.getSnapshot().conversation;
  h.readPage.mockImplementationOnce(async () => ({ stale: true }));
  expect(await client.loadOlder()).toBe(false);
  expect(client.getSnapshot().conversation).toBe(before);
  expect(await client.loadOlder()).toBe(true);
  client.dispose();
});
it("historical pages cannot overwrite newer conversation metadata", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  h.readPage.mockImplementationOnce(async () => {
    const result = page([message("middle"), message("latest")], {
      olderCursor: "old-cursor",
    });
    if (!("stale" in result)) {
      result.conversation.title = "Obsolete";
      result.conversation.replyStatus = "failed";
    }
    return result;
  });
  await client.loadOlder();
  expect(client.getSnapshot().conversation?.title).toBe("Latest title");
  expect(client.getSnapshot().conversation?.replyStatus).toBeUndefined();
  client.dispose();
});
it("live-only messages acquire a host body before newer outline adoption", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  h.frame({ type: "message.start", messageId: "live", role: "assistant" });
  h.frame({ type: "text.delta", messageId: "live", text: "Live body" });
  const indexed: OutlineMessage[] = [
    ...outline(),
    { id: "live", role: "assistant", text: "Live body", revision: "1" },
    { id: "tail", role: "notice", text: "Notice", revision: "1" },
  ];
  const tail = { ...message("tail"), role: "notice" as const };
  h.readPage.mockImplementationOnce(async () =>
    page([tail], { snapshotId: "snapshot-b", outline: indexed }),
  );
  h.readPage.mockImplementationOnce(async (_id, input) => {
    expect(input.aroundMessageId).toBe("live");
    return page([message("live", "Live body"), tail], {
      snapshotId: "snapshot-b",
      outline: indexed,
    });
  });
  await client.refresh();
  expect(
    client
      .getSnapshot()
      .conversation?.messages.some(
        (entry) => entry.id === "live" && entry.content === "Live body",
      ),
  ).toBe(true);
  client.dispose();
});
it("page requests carry the negotiated binding and abort without waiting for an adapter", async () => {
  const h = setup();
  h.cfg.transport.negotiate = async () => ({
    protocol: "1.0",
    capabilities: [],
    agreementId: "binding",
  });
  const client = createWaypointClient(h.cfg);
  await client.ready;
  expect(h.readPage.mock.calls[0]![1].context).toEqual({
    agreementId: "binding",
  });
  const held = deferred<ConversationPage>();
  let input: ConversationPageInput | undefined;
  h.readPage.mockImplementationOnce(async (_id, next) => {
    input = next;
    return held.promise;
  });
  const loading = client.loadOlder();
  await vi.waitFor(() => expect(input).toBeDefined());
  client.dispose();
  expect(input!.signal.aborted).toBe(true);
  expect(await loading).toBe(false);
});

it("a newer outline navigation cancels the previous target page", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  const held = deferred<ConversationPage>();
  let input: ConversationPageInput | undefined;
  h.readPage.mockImplementationOnce(async (_id, next) => {
    input = next;
    return held.promise;
  });
  const previous = client.loadMessage("old");
  await vi.waitFor(() => expect(input).toBeDefined());
  expect(await client.loadMessage("latest")).toBe(true);
  expect(input!.signal.aborted).toBe(true);
  expect(await previous).toBe(false);
  expect(client.getSnapshot().history?.loading).toBe(false);
  client.dispose();
});

it("a successful older-page retry clears its read failure", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  h.readPage.mockImplementationOnce(async () => ({ stale: true }));
  expect(await client.loadOlder()).toBe(false);
  expect(client.getSnapshot().problem?.id).toBe("conversation-read");
  expect(await client.loadOlder()).toBe(true);
  expect(client.getSnapshot().problem).toBeNull();
  client.dispose();
});

it("a changed history revision replaces its predecessor cursor boundary", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  await client.loadOlder();
  const changed = outline({ middle: "2" });
  h.readPage.mockImplementationOnce(async () =>
    page(undefined, {
      snapshotId: "snapshot-b",
      outline: changed,
      olderCursor: "old-b",
    }),
  );
  h.readPage.mockImplementationOnce(async () =>
    page([message("middle", "Edited"), message("latest")], {
      snapshotId: "snapshot-b",
      outline: changed,
    }),
  );
  await client.refresh();
  h.readPage.mockImplementationOnce(async (_id, input) => {
    if (input.snapshotId !== "snapshot-b" || input.cursor !== "old-b")
      return { stale: true };
    return page([message("old"), message("middle", "Edited")], {
      snapshotId: "snapshot-b",
      outline: changed,
      olderCursor: null,
    });
  });
  expect(await client.loadOlder()).toBe(true);
  expect(
    client.getSnapshot().conversation?.messages.map((entry) => entry.content),
  ).toEqual(["old", "Edited", "latest"]);
  client.dispose();
});

it("rejects a page whose message carries an attachment the protocol does not allow", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  const before = client.getSnapshot().conversation;
  // The host's page is untrusted: one entry is malformed.
  const untrusted = [
    { id: "file-1", name: "notes.txt", mediaType: "text/plain", size: 5 },
    { name: "broken.txt", mediaType: "text/plain", size: 5 },
  ] as Message["attachments"];
  h.readPage.mockImplementationOnce(async () =>
    page([{ ...message("old"), attachments: untrusted }]),
  );
  expect(await client.loadMessage("old")).toBe(false);
  expect(client.getSnapshot().history?.failed).toBe(true);
  expect(client.getSnapshot().conversation).toBe(before);
  client.dispose();
});

it("rejects a page whose message carries more attachments than the protocol allows", async () => {
  const h = setup();
  const client = createWaypointClient(h.cfg);
  await client.ready;
  const before = client.getSnapshot().conversation;
  const many = Array.from({ length: 21 }, (_, at) => ({
    id: `file-${at}`,
    name: `notes-${at}.txt`,
    mediaType: "text/plain",
    size: 5,
  }));
  h.readPage.mockImplementationOnce(async () =>
    page([{ ...message("old"), attachments: many }]),
  );
  expect(await client.loadMessage("old")).toBe(false);
  expect(client.getSnapshot().history?.failed).toBe(true);
  expect(client.getSnapshot().conversation).toBe(before);
  client.dispose();
});
