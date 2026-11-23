import { it, expect } from "vitest";
import {
  createWaypointClient,
  type AttachmentPort,
  type AttachmentUpload,
  type StoragePort,
  type TransportPort,
} from "../../src/core/client";
import type { Reply, ReplyMessage } from "../../src/protocol/generated";
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
  expect(client.getSnapshot().pending[0]?.failure?.code).toBe("in-doubt");
  await client.retry(sent[0]!.clientReplyId);
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
  expect(second.stored).toHaveLength(0);
  expect((sent.at(-1) as ReplyMessage).attachments).toEqual(references);
  second.client.dispose();
});
