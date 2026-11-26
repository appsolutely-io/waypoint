import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  type AttachmentPort,
  type AttachmentUpload,
  type StoragePort,
  type TransportPort,
} from "../../src/core/client";
import type { Reply, ReplyMessage } from "../../src/protocol/generated";
import { acceptsMediaType } from "../../src/core/attachment-shape";
import { config, flush } from "../support/client";

const file = (name: string, text: string): AttachmentUpload => ({
  name,
  mediaType: "text/plain",
  data: new TextEncoder().encode(text),
});

function harness(
  options: {
    /** The host's upload port; null is a client without one. */
    port?: AttachmentPort | null;
    storage?: StoragePort;
    send?: TransportPort["send"];
    read?: TransportPort["read"];
  } = {},
) {
  const base = config();
  const sent: Reply[] = [];
  const stored: {
    data: Uint8Array;
    context: Parameters<AttachmentPort["upload"]>[1];
  }[] = [];
  const port: AttachmentPort = options.port ?? {
    upload: async (data, context) => {
      stored.push({ data, context });
      return { id: `file-${stored.length}` };
    },
  };
  const client = createWaypointClient({
    ...base,
    ...(options.port === null ? {} : { attachments: port }),
    ...(options.storage ? { storage: options.storage } : {}),
    transport: {
      ...base.transport,
      ...(options.read ? { read: options.read } : {}),
      send:
        options.send ??
        (async (reply) => {
          sent.push(reply as Reply);
          return { id: "stored" };
        }),
    },
  });
  return { client, sent, stored };
}

const references = [
  { id: "file-1", name: "report.txt", mediaType: "text/plain", size: 5 },
];

it("stores every file with the message's id and sends the references", async () => {
  const { client, sent, stored } = harness();
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(stored).toHaveLength(1);
  expect(stored[0]?.context.clientMessageId).toBe(
    (sent[0] as ReplyMessage).clientMessageId,
  );
  expect(stored[0]?.context.conversationId).toBe("conversation-a");
  expect(stored[0]?.context.fileName).toBe("report.txt");
  expect(stored[0]?.context.contentType).toBe("text/plain");
  expect((sent[0] as ReplyMessage).attachments).toEqual(references);
  client.dispose();
});

it("keeps the references in the outbox", async () => {
  const values = new Map<string, string>();
  const storage: StoragePort = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  // The message stays queued: its references stay with it.
  const { client } = harness({
    storage,
    send: async () => {
      throw { code: "in-doubt", id: "p" };
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  const record = JSON.parse([...values.values()][0]!);
  expect(record.pending[0].attachments).toEqual(references);
  client.dispose();
});

it("retries under the same id with the same references", async () => {
  let calls = 0;
  const sent: Reply[] = [];
  const { client, stored } = harness({
    send: async (reply) => {
      sent.push(reply as Reply);
      if (calls++ === 0) throw { code: "in-doubt", id: "p" };
      return { id: "stored" };
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(client.getSnapshot().pending[0]?.failure?.code).toBe("in-doubt");
  await client.retry(sent[0]!.clientReplyId);
  // The retried row is queued; the request settles after.
  await flush();
  expect(stored).toHaveLength(1);
  expect((sent[1] as ReplyMessage).attachments).toEqual(references);
  expect((sent[1] as ReplyMessage).clientMessageId).toBe(
    (sent[0] as ReplyMessage).clientMessageId,
  );
  client.dispose();
});

it("fails the message itself when the host refuses the file", async () => {
  const { client, sent } = harness({
    port: {
      upload: async () => {
        throw new Error("no storage");
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(sent).toHaveLength(0);
  const pending = client.getSnapshot().pending[0];
  expect(pending?.failure?.code).toBe("refused");
  expect(pending?.failure?.id).toBe(pending?.id);
  expect(client.getSnapshot().problem?.id).toBe(pending?.id);
  client.dispose();
});

it("refuses a message whose files it cannot store", async () => {
  const { client, sent } = harness({ port: null });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(sent).toHaveLength(0);
  expect(client.getSnapshot().pending[0]?.failure?.code).toBe("refused");
  client.dispose();
});

it("refuses a file the host does not take", async () => {
  const { client, stored } = harness({
    port: {
      upload: async (data, context) => {
        stored.push({ data, context });
        return { id: "file-1" };
      },
      accept: ["image/png"],
      maxBytes: 4,
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(stored).toHaveLength(0);
  expect(client.getSnapshot().pending[0]?.failure?.code).toBe("refused");
  client.dispose();
});

it("keeps the references of a restored row and does not store them again", async () => {
  const values = new Map<string, string>();
  const storage: StoragePort = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  const sent: Reply[] = [];
  let calls = 0;
  const first = harness({
    storage,
    send: async (reply) => {
      sent.push(reply as Reply);
      if (calls++ === 0) throw { code: "in-doubt", id: "p" };
      return { id: "stored" };
    },
  });
  await first.client.ready;
  await first.client.setDraft("Here is the report");
  await first.client.send([file("report.txt", "hello")]);
  await flush();
  const id = (sent[0] as ReplyMessage).clientReplyId;
  first.client.dispose();
  const second = harness({
    storage,
    send:
      first.client &&
      (async (reply) => {
        sent.push(reply as Reply);
        return { id: "stored" };
      }),
  });
  await second.client.ready;
  await flush();
  expect(second.client.getSnapshot().pending[0]?.attachments).toEqual(
    references,
  );
  await second.client.retry(id);
  // The retried row is queued; the request settles after.
  await flush();
  expect(second.stored).toHaveLength(0);
  expect((sent.at(-1) as ReplyMessage).attachments).toEqual(references);
  second.client.dispose();
});

it("keeps each stored file on the row, so a retry sends only what is missing", async () => {
  const sent: Reply[] = [];
  const uploaded: string[] = [];
  let failed = false;
  const { client } = harness({
    send: async (reply) => {
      sent.push(reply as Reply);
      return { id: "stored" };
    },
    port: {
      upload: async (data, context) => {
        if (context.fileName === "second.txt" && !failed) {
          failed = true;
          throw new Error("no storage");
        }
        uploaded.push(context.fileName);
        return { id: `file-${context.fileName}` };
      },
    },
  });
  await client.ready;
  await client.setDraft("Two files");
  await client.send([file("first.txt", "one"), file("second.txt", "two")]);
  await flush();
  expect(uploaded).toEqual(["first.txt"]);
  const pending = client.getSnapshot().pending[0];
  expect(pending?.attachments?.map((each) => each.id ?? null)).toEqual([
    "file-first.txt",
    null,
  ]);
  expect(pending?.failure?.code).toBe("refused");
  await client.retry(pending!.id);
  // The retried row is queued; the upload and the request settle after.
  await flush();
  expect(uploaded).toEqual(["first.txt", "second.txt"]);
  expect((sent.at(-1) as ReplyMessage).attachments).toEqual([
    {
      id: "file-first.txt",
      name: "first.txt",
      mediaType: "text/plain",
      size: 3,
    },
    {
      id: "file-second.txt",
      name: "second.txt",
      mediaType: "text/plain",
      size: 3,
    },
  ]);
  client.dispose();
});

it("tells the host which file of the message it stores", async () => {
  const { client, stored } = harness();
  await client.ready;
  await client.setDraft("Two files");
  await client.send([file("first.txt", "one"), file("second.txt", "two")]);
  await flush();
  expect(stored.map((each) => each.context.index)).toEqual([0, 1]);
  client.dispose();
});

it("does not queue a message whose conversation changed while its files were being read", async () => {
  const sent: Reply[] = [];
  const { client } = harness({
    send: async (reply) => {
      sent.push(reply as Reply);
      return { id: "stored" };
    },
    read: async (id) => ({
      protocol: "1.0",
      id,
      title: "Chat",
      messages: [],
    }),
  });
  await client.ready;
  await client.setDraft("Here is the report");
  const sending = client.send([file("report.txt", "hello")]);
  await client.switchConversation("conversation-b");
  await sending;
  expect(sent).toHaveLength(0);
  client.dispose();
});

it("sends one message with both files after a switch away and back", async () => {
  const values = new Map<string, string>();
  const storage: StoragePort = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  const sent: Reply[] = [];
  const uploads: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started: () => void = () => {};
  const uploading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { client } = harness({
    storage,
    send: async (reply) => {
      sent.push(reply as Reply);
      return { id: "stored" };
    },
    read: async (id) => ({
      protocol: "1.0",
      id,
      title: "Chat",
      messages: [],
    }),
    port: {
      upload: async (data, context) => {
        uploads.push(context.fileName);
        if (context.fileName === "a.txt") {
          started();
          await gate;
        }
        return { id: `file-${context.fileName}` };
      },
    },
  });
  await client.ready;
  await client.setDraft("Two files");
  const sending = client.send([file("a.txt", "a"), file("b.txt", "b")]);
  await uploading;
  const switched = client.switchConversation("conversation-b");
  release();
  await sending;
  await switched;
  await flush();
  // The message belongs to the conversation before: nothing was sent
  // into the new one, and the first file was not uploaded again.
  expect(sent).toHaveLength(0);
  await client.switchConversation("conversation-a");
  await flush();
  const row = client.getSnapshot().pending[0]!;
  // The attempt the switch abandoned settled on the row's own conversation;
  // it does not hang open as an answer that never came.
  expect(row.failure?.code).toBe("unavailable");
  // The settle wrote the id the host gave onto the row's own record, so a
  // reload never reads a host-stored file as one still waiting; the retry
  // asks the host only for the file it never got.
  expect(row.attachments?.map((each) => each.id ?? null)).toEqual([
    "file-a.txt",
    null,
  ]);
  await client.retry(row.id);
  // The retried row is queued; the upload and the request settle after.
  await flush();
  expect(uploads).toEqual(["a.txt", "b.txt"]);
  expect(sent).toHaveLength(1);
  expect((sent[0] as ReplyMessage).attachments).toEqual([
    { id: "file-a.txt", name: "a.txt", mediaType: "text/plain", size: 1 },
    { id: "file-b.txt", name: "b.txt", mediaType: "text/plain", size: 1 },
  ]);
  client.dispose();
});

it("refuses a file the host stored without an id", async () => {
  const { client, sent } = harness({
    port: {
      upload: async () => ({ id: "" }),
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(sent).toHaveLength(0);
  expect(client.getSnapshot().pending[0]?.failure?.code).toBe("refused");
  client.dispose();
});

it("keeps the host's own problem when the store refuses a file", async () => {
  const { client, sent } = harness({
    port: {
      upload: async () => {
        throw { code: "rate-limited", retryAfter: 30 };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(sent).toHaveLength(0);
  const failure = client.getSnapshot().pending[0]?.failure;
  expect(failure?.code).toBe("rate-limited");
  expect(failure?.retryAfter).toBe(30);
  client.dispose();
});

it("a file store that fails with an outcome the client cannot place leaves the message's outcome definite", async () => {
  const { client, sent } = harness({
    port: {
      upload: async () => {
        throw { code: "in-doubt", id: "store" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(sent).toHaveLength(0);
  // The message was never handed to the transport, so it was not sent:
  // its outcome is a refusal, not an unknown one.
  expect(client.getSnapshot().pending[0]?.failure?.code).toBe("refused");
  client.dispose();
});

it("takes a file whose media type the host takes as a wildcard", async () => {
  const { client, stored } = harness({
    port: {
      upload: async (data, context) => {
        stored.push({ data, context });
        return { id: "file-1" };
      },
      accept: ["image/*"],
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([
    { name: "shot.png", mediaType: "image/png", data: new Uint8Array([1]) },
  ]);
  await flush();
  expect(stored).toHaveLength(1);
  expect(client.getSnapshot().pending).toHaveLength(0);
  client.dispose();
});

it("drops a restored row's malformed attachment", async () => {
  const record = JSON.stringify({
    revision: 1,
    draft: "",
    pending: [
      {
        id: "m1",
        content: "Here is the report",
        failure: null,
        open: [],
        attachments: [
          {
            id: "file-1",
            name: "report.txt",
            mediaType: "text/plain",
            size: 5,
          },
          { name: "broken.txt", mediaType: "text/plain", size: -1 },
          { name: "unstaged.txt", mediaType: "text/plain", size: 5 },
        ],
      },
    ],
  });
  const storage: StoragePort = {
    get: () => record,
    set: () => {},
    remove: () => {},
  };
  const { client } = harness({ storage });
  await client.ready;
  await flush();
  expect(client.getSnapshot().pending[0]?.attachments).toEqual([
    { id: "file-1", name: "report.txt", mediaType: "text/plain", size: 5 },
    { name: "unstaged.txt", mediaType: "text/plain", size: 5 },
  ]);
  client.dispose();
});

it("reports whether it queued the message", async () => {
  const held = harness({
    send: async () => ({ id: "stored" }),
  });
  await held.client.ready;
  await held.client.setDraft("Held");
  // A contribution that holds the draft keeps the message unqueued.
  const holding = createWaypointClient({
    ...config(),
    attachments: {
      upload: async () => ({ id: "file-1" }),
    },
    contributions: [{ id: "hold", evaluate: async () => ({ hold: "hold" }) }],
    transport: {
      ...config().transport,
      send: async () => ({ id: "stored" }),
    },
  });
  await holding.ready;
  await holding.setDraft("Held");
  expect(await holding.send([file("report.txt", "hello")])).toBe(false);
  expect(holding.getSnapshot().pending).toHaveLength(0);
  holding.dispose();
  const refused = createWaypointClient({
    ...config(),
    attachments: { upload: async () => ({ id: "file-1" }) },
    beforeSend: () => false,
    transport: {
      ...config().transport,
      send: async () => ({ id: "stored" }),
    },
  });
  await refused.ready;
  await refused.setDraft("Refused");
  expect(await refused.send([file("report.txt", "hello")])).toBe(false);
  expect(refused.getSnapshot().pending).toHaveLength(0);
  refused.dispose();
  const queued = harness();
  await queued.client.ready;
  await queued.client.setDraft("Here is the report");
  expect(await queued.client.send([file("report.txt", "hello")])).toBe(true);
  queued.client.dispose();
  held.client.dispose();
});

it("fails a retried row whose files are no longer held", async () => {
  const values = new Map<string, string>();
  const storage: StoragePort = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  const sent: Reply[] = [];
  const first = harness({
    storage,
    send: async (reply) => {
      sent.push(reply as Reply);
      return { id: "stored" };
    },
    port: {
      upload: async () => {
        throw new Error("no storage");
      },
    },
  });
  await first.client.ready;
  await first.client.setDraft("Here is the report");
  await first.client.send([file("report.txt", "hello")]);
  await flush();
  expect(sent).toHaveLength(0);
  const id = first.client.getSnapshot().pending[0]!.id;
  first.client.dispose();
  const second = harness({ storage });
  await second.client.ready;
  await flush();
  await second.client.retry(id);
  expect(sent).toHaveLength(0);
  // The retried row is queued; the upload settles the row after.
  await vi.waitFor(() =>
    expect(second.client.getSnapshot().pending[0]?.failure?.code).toBe(
      "attachments-lost",
    ),
  );
  second.client.dispose();
});

it("refuses a message with more files than the protocol allows", async () => {
  const { client, sent, stored } = harness();
  await client.ready;
  await client.setDraft("Too many");
  const many = Array.from({ length: 21 }, (_, at) =>
    file(`report-${at}.txt`, "x"),
  );
  expect(await client.send(many)).toBe(false);
  expect(sent).toHaveLength(0);
  expect(stored).toHaveLength(0);
  client.dispose();
});

it("keeps a host's binding problem out of the row's failure", async () => {
  const { client, sent } = harness({
    port: {
      upload: async () => {
        throw { code: "agreement-expired", id: "binding" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(sent).toHaveLength(0);
  expect(client.getSnapshot().pending[0]?.failure?.code).toBe("refused");
  client.dispose();
});

it("resolves the send once the row is queued, not once it is delivered", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: Reply[] = [];
  const { client } = harness({
    send: async (reply) => {
      sent.push(reply as Reply);
      await gate;
      return { id: "stored" };
    },
  });
  await client.ready;
  await client.setDraft("Two steps");
  expect(await client.send([file("report.txt", "hello")])).toBe(true);
  // The row is queued and the composer's sending state holds while the
  // delivery is still on its way.
  expect(client.getSnapshot().pending).toHaveLength(1);
  expect(client.getSnapshot().sending).toBe(true);
  expect(sent).toHaveLength(0);
  release();
  await flush();
  expect(sent).toHaveLength(1);
  client.dispose();
});

it("releases the staged bytes when a read confirms an in-doubt row", async () => {
  const spy = vi.spyOn(Map.prototype, "delete");
  let rowId = "";
  const { client } = harness({
    send: async () => {
      throw new Error("connection lost");
    },
    read: async (id) => ({
      protocol: "1.0",
      id,
      title: "Chat",
      messages: [
        {
          id: "host-1",
          role: "user" as const,
          content: "Here is the report",
          blocks: [],
          createdAt: 0,
          ...(rowId ? { clientMessageId: rowId } : {}),
        },
      ],
    }),
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  rowId = client.getSnapshot().pending[0]!.id;
  expect(client.getSnapshot().pending[0]?.failure?.code).toBe("in-doubt");
  await client.refresh();
  await flush();
  expect(client.getSnapshot().pending).toHaveLength(0);
  // The bytes the row's files held leave with the row itself.
  expect(spy).toHaveBeenCalledWith(rowId);
  spy.mockRestore();
  client.dispose();
});

it("refuses too many files under the message's id, before the middleware", async () => {
  const base = config();
  const beforeSend = vi.fn();
  const client = createWaypointClient({
    ...base,
    beforeSend,
    attachments: { upload: async () => ({ id: "file-1" }) },
    transport: {
      ...base.transport,
      send: async () => ({ id: "stored" }),
    },
  });
  await client.ready;
  await client.setDraft("Too many");
  const many = Array.from({ length: 21 }, (_, at) =>
    file("report-" + at + ".txt", "x"),
  );
  expect(await client.send(many)).toBe(false);
  expect(beforeSend).not.toHaveBeenCalled();
  const problem = client.getSnapshot().problem;
  expect(problem?.code).toBe("refused");
  expect(problem?.id).not.toBe("before-send");
  client.dispose();
});

it("takes a file whatever case its media type is written in", async () => {
  const { client, stored } = harness({
    port: {
      accept: ["Text/Plain"],
      upload: async (data, context) => {
        stored.push({ data, context });
        return { id: "file-1" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(stored).toHaveLength(1);
  client.dispose();
});

it("names the withdrawn message's files on the restored item", async () => {
  const { client } = harness({
    port: {
      upload: async () => {
        throw { code: "refused", id: "store" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello"), file("notes.txt", "n")]);
  await flush();
  const id = client.getSnapshot().pending[0]!.id;
  await client.withdraw(id);
  await flush();
  const restored = client.getSnapshot().restored[0];
  expect(restored?.files).toEqual(["report.txt", "notes.txt"]);
  client.dispose();
});

it("drops a restored row's attachments when there are too many", async () => {
  const record = JSON.stringify({
    revision: 1,
    draft: "",
    pending: [
      {
        id: "m1",
        content: "Too many",
        failure: null,
        open: [],
        attachments: Array.from({ length: 21 }, (_, at) => ({
          id: `file-${at}`,
          name: `report-${at}.txt`,
          mediaType: "text/plain",
          size: 1,
        })),
      },
    ],
  });
  const storage: StoragePort = {
    get: () => record,
    set: () => {},
    remove: () => {},
  };
  const { client } = harness({ storage });
  await client.ready;
  await flush();
  expect(client.getSnapshot().pending[0]?.attachments).toBeUndefined();
  client.dispose();
});

it("takes every file when the host names the bare wildcard", async () => {
  const { client, stored } = harness({
    port: {
      accept: ["*/*"],
      upload: async (data, context) => {
        stored.push({ data, context });
        return { id: "file-1" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  expect(stored).toHaveLength(1);
  client.dispose();
});

it("keeps a commit that lands during the abroad settle", async () => {
  const at = JSON.stringify(["waypoint", "account-a", "conversation-a"]);
  const values = new Map<string, string>([[at, "{}"]]);
  let armed = false;
  let raced = false;
  let injectedRevision = 0;
  const storage = {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
    remove: (key: string) => {
      values.delete(key);
    },
    compareAndSet: async (key: string, expected: string, value: string) => {
      if (armed && !raced) {
        // Another runtime commits between the settle's read and its write:
        // it read the same record and added its own row.
        raced = true;
        const theirs = JSON.parse(values.get(key) ?? "{}") as Record<
          string,
          unknown
        > & { pending?: unknown[]; revision?: number };
        injectedRevision = (theirs.revision ?? 0) + 1;
        values.set(
          key,
          JSON.stringify({
            ...theirs,
            revision: injectedRevision,
            pending: [
              ...(Array.isArray(theirs.pending) ? theirs.pending : []),
              { id: "theirs", content: "Theirs", failure: null, open: [] },
            ],
          }),
        );
        return false;
      }
      if (values.get(key) !== expected) return false;
      values.set(key, value);
      return true;
    },
  } as StoragePort;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client } = harness({
    storage,
    send: async () => ({ id: "stored" }),
    read: async (id) => ({
      protocol: "1.0",
      id,
      title: "Chat",
      messages: [],
    }),
    port: {
      upload: async () => {
        await gate;
        return { id: "file-a.txt" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Two files");
  const sending = client.send([file("a.txt", "a")]);
  await flush();
  const rowId = client.getSnapshot().pending[0]!.id;
  const switched = client.switchConversation("conversation-b");
  await flush();
  armed = true;
  release();
  await sending;
  await switched;
  await flush();
  await client.switchConversation("conversation-a");
  await flush();
  const record = JSON.parse(values.get(at) ?? "{}") as {
    revision: number;
    pending: {
      id: string;
      failure?: { code: string } | null;
      attachments?: { id?: string | null }[];
    }[];
  };
  const rows = record.pending.map((row) => row.id).sort();
  expect(rows).toEqual([rowId, "theirs"]);
  // The settle carries the writer's revision forward by exactly one.
  expect(record.revision).toBe(injectedRevision + 1);
  const ours = record.pending.find((row) => row.id === rowId);
  expect(ours?.failure?.code).toBe("unavailable");
  client.dispose();
});

it("reports an abroad settle whose write fails", async () => {
  const values = new Map<string, string>();
  // Writes work until the settle is armed, so the row is stored; then the
  // disk goes away under exactly the settle's own write.
  let armed = false;
  const storage: StoragePort = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      if (armed) throw new Error("disk gone");
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The switch's own read would clear the reported problem on success, so
  // it waits until the settle has been observed.
  let releaseRead: () => void = () => {};
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const { client } = harness({
    storage,
    send: async () => ({ id: "stored" }),
    read: async (id) => {
      if (id === "conversation-b") await readGate;
      return {
        protocol: "1.0",
        id,
        title: "Chat",
        messages: [],
      };
    },
    port: {
      upload: async () => {
        await gate;
        return { id: "file-a.txt" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Two files");
  const sending = client.send([file("a.txt", "a")]);
  await flush();
  const switched = client.switchConversation("conversation-b");
  await flush();
  armed = true;
  release();
  await sending;
  await flush();
  const problem = client.getSnapshot().problem;
  expect(problem?.code).toBe("unavailable");
  expect(problem?.id).toBe("storage-write");
  releaseRead();
  await switched;
  client.dispose();
});

it("settles a host refusal the switch met, keeping the file it stored", async () => {
  const at = JSON.stringify(["waypoint", "account-a", "conversation-a"]);
  const values = new Map<string, string>();
  const storage: StoragePort = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  let started: () => void = () => {};
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client } = harness({
    storage,
    send: async () => ({ id: "stored" }),
    read: async (id) => ({
      protocol: "1.0",
      id,
      title: "Chat",
      messages: [],
    }),
    port: {
      // The first file is stored; the refusal lands on the second while
      // the conversation already moved on.
      upload: async (_data, meta) => {
        if (meta.index === 0) return { id: "file-a.txt" };
        started();
        await gate;
        throw { code: "refused", id: "m1" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  const sending = client.send([
    file("a.txt", "a"),
    file("report.txt", "hello"),
  ]);
  await new Promise<void>((resolve) => {
    started = resolve;
  });
  const switched = client.switchConversation("conversation-b");
  await flush();
  release();
  await sending;
  await switched;
  await flush();
  // The settle writes the refusal the upload met while aborted, not a
  // blanket unavailable, and keeps the id the host gave the first file.
  const record = JSON.parse(values.get(at) ?? "{}") as {
    pending: {
      id: string;
      failure?: { code: string } | null;
      attachments?: { id?: string | null }[];
    }[];
  };
  const row = record.pending[0]!;
  expect(row.attachments?.map((each) => each.id ?? null)).toEqual([
    "file-a.txt",
    null,
  ]);
  expect(row.failure?.code).toBe("refused");
  client.dispose();
});

it("settles a host rate limit the switch met, keeping the file it stored", async () => {
  const at = JSON.stringify(["waypoint", "account-a", "conversation-a"]);
  const values = new Map<string, string>();
  const storage: StoragePort = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  let started: () => void = () => {};
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client } = harness({
    storage,
    send: async () => ({ id: "stored" }),
    read: async (id) => ({
      protocol: "1.0",
      id,
      title: "Chat",
      messages: [],
    }),
    port: {
      upload: async (_data, meta) => {
        if (meta.index === 0) return { id: "file-a.txt" };
        started();
        await gate;
        throw { code: "rate-limited", id: "m1" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  const sending = client.send([
    file("a.txt", "a"),
    file("report.txt", "hello"),
  ]);
  await new Promise<void>((resolve) => {
    started = resolve;
  });
  const switched = client.switchConversation("conversation-b");
  await flush();
  release();
  await sending;
  await switched;
  await flush();
  const record = JSON.parse(values.get(at) ?? "{}") as {
    pending: {
      id: string;
      failure?: { code: string } | null;
      attachments?: { id?: string | null }[];
    }[];
  };
  const row = record.pending[0]!;
  expect(row.attachments?.map((each) => each.id ?? null)).toEqual([
    "file-a.txt",
    null,
  ]);
  expect(row.failure?.code).toBe("rate-limited");
  client.dispose();
});

it("treats a host's attachments-lost as a refusal on the row", async () => {
  const { client } = harness({
    port: {
      upload: async () => {
        throw { code: "attachments-lost", id: "host-side" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  const row = client.getSnapshot().pending[0]!;
  expect(row.failure?.code).toBe("refused");
  client.dispose();
});

it("takes a host's attachments-lost answer to a send as a refusal", async () => {
  const { client } = harness({
    send: async () => {
      throw { code: "attachments-lost", id: "host-side" };
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  const row = client.getSnapshot().pending[0]!;
  expect(row.failure?.code).toBe("refused");
  client.dispose();
});

it("takes a wildcard prefix only for the types under it", async () => {
  const plain = acceptsMediaType(["x/*"], "application/pdf");
  expect(plain).toBe(false);
  expect(acceptsMediaType(["x/*"], "x/anything")).toBe(true);
  expect(acceptsMediaType(["*/*"], "application/pdf")).toBe(true);
});

it("a host's own detail survives the refusal of a file", async () => {
  const { client } = harness({
    port: {
      upload: async () => {
        throw { code: "attachments-lost", host: { code: "availability" } };
      },
    },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  await client.send([file("report.txt", "hello")]);
  await flush();
  const failure = client.getSnapshot().pending[0]?.failure;
  expect(failure?.code).toBe("refused");
  expect(failure?.host).toEqual({ code: "availability" });
  client.dispose();
});
