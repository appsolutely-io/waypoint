import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  ConversationReadError,
} from "../../src/core/client";
import { createHttpTransport } from "../../src/core/transports";
import { createFormSession } from "../../src/core/form-session";
import { config } from "../support/client";
for (const status of [404, 410, 503])
  it(`preserves a conversation-bound HTTP read failure for status ${status}`, async () => {
    const transport = createHttpTransport(async () => ({ status, body: {} }), {
      subscribe: () => () => {},
    });
    await expect(transport.read("child/a")).rejects.toMatchObject({
      conversationId: "child/a",
      status,
    });
  });
for (const status of [404, 410])
  it(`returns a definitive missing outcome only for the selected conversation on ${status}`, async () => {
    const cfg = config();
    cfg.transport.read = async (id) => {
      if (id === "missing") throw new ConversationReadError(id, status);
      return { protocol: "1.0", id, title: "Chat", messages: [] };
    };
    const client = createWaypointClient(cfg);
    await client.ready;
    expect(await client.switchConversation("missing")).toEqual({
      kind: "missing",
      conversationId: "missing",
      status,
    });
    client.dispose();
  });
it("does not treat another conversation's missing response as this one's disappearance", async () => {
  const cfg = config();
  cfg.transport.read = async () => {
    throw new ConversationReadError("another", 404);
  };
  const client = createWaypointClient(cfg);
  await client.ready;
  expect(await client.refresh()).toEqual({
    kind: "unavailable",
    conversationId: "conversation-a",
  });
  client.dispose();
});
for (const method of ["refresh", "switchConversation"] as const)
  for (const newer of ["missing", "loaded"] as const)
    for (const newestFirst of [false, true])
      it(`${method} follows the newest ${newer} read when it settles ${newestFirst ? "first" : "last"}`, async () => {
        const cfg = config();
        const client = createWaypointClient(cfg);
        await client.ready;
        let fail!: () => void, settle!: () => void;
        const olderGate = new Promise<void>((resolve) => {
          fail = resolve;
        });
        const newerGate = new Promise<void>((resolve) => {
          settle = resolve;
        });
        let reads = 0;
        cfg.transport.read = async (id) => {
          if (++reads === 1) {
            await olderGate;
            throw newer === "missing"
              ? new ConversationReadError(id, 404)
              : new Error("Read failed");
          }
          await newerGate;
          if (newer === "missing") throw new ConversationReadError(id, 404);
          return { protocol: "1.0", id, title: "Newest", messages: [] };
        };
        const older =
          method === "refresh"
            ? client.refresh()
            : client.switchConversation("conversation-a");
        await vi.waitFor(() => expect(reads).toBe(1));
        const latest = client.refresh();
        if (newestFirst) {
          settle();
          await latest;
          fail();
        } else {
          fail();
          await Promise.resolve();
          settle();
        }
        const result = await older;
        expect(result).toEqual(await latest);
        expect(result.kind).toBe(newer);
        if (newer === "loaded")
          expect(client.getSnapshot().conversation?.title).toBe("Newest");
        client.dispose();
      });
it("follows a third read started while a successful read persists", async () => {
  const cfg = config();
  const client = createWaypointClient(cfg);
  await client.ready;
  let release!: () => void;
  const persisted = new Promise<void>((resolve) => {
    release = resolve;
  });
  cfg.storage = {
    get: async () => null,
    set: async () => {
      await persisted;
    },
    remove: async () => {},
  };
  let reads = 0;
  cfg.transport.read = async (id) => ({
    protocol: "1.0",
    id,
    title: `Read ${++reads}`,
    messages: [],
  });
  const older = client.refresh();
  await vi.waitFor(() => expect(reads).toBe(1));
  const middle = client.refresh();
  const latest = client.refresh();
  release();
  expect(await older).toEqual(await latest);
  expect(await middle).toEqual(await latest);
  expect((await latest).kind).toBe("loaded");
  client.dispose();
});
for (const action of ["switch", "dispose"] as const)
  it(`does not follow reads across ${action}`, async () => {
    const cfg = config();
    const client = createWaypointClient(cfg);
    await client.ready;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    cfg.transport.read = async (id) => {
      if (id === "conversation-a") await gate;
      return { protocol: "1.0", id, title: id, messages: [] };
    };
    const older = client.refresh();
    if (action === "switch") await client.switchConversation("other");
    else client.dispose();
    release();
    expect(await older).toEqual({
      kind: "superseded",
      conversationId: "conversation-a",
    });
    client.dispose();
  });

for (const method of ["refresh", "switchConversation"] as const)
  for (const status of [404, 410, 503, "network"] as const)
    for (const failureFirst of [false, true])
      it(`${method} resolves the authoritative outcome when the newer ${status} settles ${failureFirst ? "first" : "last"}`, async () => {
        const cfg = config();
        cfg.transport.read = async () => {
          throw new Error("Initial read unavailable");
        };
        const client = createWaypointClient(cfg);
        await client.ready;
        let load!: () => void, fail!: () => void;
        const loaded = new Promise<void>((resolve) => {
          load = resolve;
        });
        const failed = new Promise<void>((resolve) => {
          fail = resolve;
        });
        let reads = 0;
        cfg.transport.read = async (id) => {
          if (++reads === 1) {
            await loaded;
            return { protocol: "1.0", id, title: "Applied", messages: [] };
          }
          await failed;
          throw typeof status === "number"
            ? new ConversationReadError(id, status)
            : new Error("Network unavailable");
        };
        const selection =
          method === "refresh"
            ? client.refresh()
            : client.switchConversation("child");
        await vi.waitFor(() => expect(reads).toBe(1));
        const refetch = client.refresh();
        if (failureFirst) {
          fail();
          await refetch;
          load();
        } else {
          load();
          await vi.waitFor(() =>
            expect(client.getSnapshot().conversation?.title).toBe("Applied"),
          );
          fail();
        }
        const result = await selection;
        const id = method === "refresh" ? "conversation-a" : "child";
        if (status === 404 || status === 410) {
          expect(result).toEqual({
            kind: "missing",
            conversationId: id,
            status,
          });
          expect(client.getSnapshot().conversation).toBeNull();
        } else {
          expect(result).toEqual({
            kind: "loaded",
            conversationId: id,
            conversation: client.getSnapshot().conversation,
          });
          expect(client.getSnapshot().conversation?.title).toBe("Applied");
        }
        if (!failureFirst) expect(await refetch).toEqual(result);
        client.dispose();
      });

for (const status of [404, 410, 503, "network"] as const)
  it(`invalidates a loaded snapshot only for a definitive ${status} read failure`, async () => {
    const cfg = config();
    const client = createWaypointClient(cfg);
    await client.ready;
    const loaded = client.getSnapshot().conversation;
    cfg.transport.read = async (id) => {
      throw typeof status === "number"
        ? new ConversationReadError(id, status)
        : new Error("Network unavailable");
    };
    const result = await client.refresh();
    if (status === 404 || status === 410) {
      expect(result).toEqual({
        kind: "missing",
        conversationId: "conversation-a",
        status,
      });
      expect(client.getSnapshot().conversation).toBeNull();
    } else {
      expect(result.kind).toBe("unavailable");
      expect(client.getSnapshot().conversation).toBe(loaded);
    }
    expect(client.getSnapshot().problem?.id).toBe("conversation-read");
    cfg.transport.read = async (id) => ({
      protocol: "1.0",
      id,
      title: "Recovered",
      messages: [],
    });
    expect((await client.refresh()).kind).toBe("loaded");
    expect(client.getSnapshot().conversation?.title).toBe("Recovered");
    expect(client.getSnapshot().problem).toBeNull();
    client.dispose();
  });
it("does not revive an applied success after a definitive missing read and another transient refetch", async () => {
  const cfg = config();
  const client = createWaypointClient(cfg);
  await client.ready;
  let release!: () => void;
  const persisted = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Each save reads the stored record first; holding that read holds it.
  cfg.storage = {
    get: async () => {
      await persisted;
      return null;
    },
    set: () => {},
    remove: () => {},
  };
  cfg.transport.read = async (id) => ({
    protocol: "1.0",
    id,
    title: "Applied",
    messages: [],
  });
  const selection = client.refresh();
  await vi.waitFor(() =>
    expect(client.getSnapshot().conversation?.title).toBe("Applied"),
  );
  await Promise.resolve();
  cfg.transport.read = async (id) => {
    throw new ConversationReadError(id, 404);
  };
  expect((await client.refresh()).kind).toBe("missing");
  cfg.transport.read = async () => {
    throw new Error("Network unavailable");
  };
  await client.refresh();
  release();
  expect(await selection).toEqual({
    kind: "missing",
    conversationId: "conversation-a",
    status: 404,
  });
  expect(client.getSnapshot().conversation).toBeNull();
  client.dispose();
});

for (const mode of ["ordinary", "form-fill"] as const)
  for (const status of [404, 410])
    it(`blocks ${mode} send and retry after a current ${status} until recovery`, async () => {
      const cfg = config();
      cfg.transport.negotiate = async () => ({
        protocol: "1.1",
        capabilities: ["form-fill"],
      });
      cfg.formSession = createFormSession({
        fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
        ids: () => "request-a",
      });
      const read = async (id: string) => ({
        protocol: "1.1",
        id,
        title: "Form",
        messages: [],
        ...(mode === "form-fill" ? { mode, field: "title" } : {}),
      });
      cfg.transport.read = read;
      const send = vi
        .spyOn(cfg.transport, "send")
        .mockRejectedValueOnce(new Error("Send unavailable"));
      const client = createWaypointClient(cfg);
      await client.ready;
      await client.setDraft("Keep draft");
      await client.send();
      const pending = client.getSnapshot().pending[0];
      await client.setDraft("Keep draft");
      cfg.transport.read = async (id) => {
        throw new ConversationReadError(id, status);
      };
      expect((await client.refresh()).kind).toBe("missing");
      await client.send();
      await client.retry(pending?.id ?? "request-a");
      expect(send).toHaveBeenCalledOnce();
      expect(client.getSnapshot().draft).toBe("Keep draft");
      expect(client.getSnapshot().conversationUnavailable).toBe(true);
      cfg.transport.read = read;
      expect((await client.refresh()).kind).toBe("loaded");
      expect(client.getSnapshot().conversationUnavailable).toBe(false);
      if (pending) await client.retry(pending.id);
      else await client.send();
      expect(send).toHaveBeenCalledTimes(2);
      if (mode === "form-fill")
        expect(send.mock.calls[1]?.[0]).toMatchObject({
          kind: "form-fill",
          request: { field: "title", requestId: "request-a" },
        });
      client.dispose();
    });

for (const status of [404, 410])
  it(`ignores a stale ${status} after a newer successful load`, async () => {
    const cfg = config();
    const client = createWaypointClient(cfg);
    await client.ready;
    let reject!: () => void;
    const gate = new Promise<void>((resolve) => {
      reject = resolve;
    });
    let reads = 0;
    cfg.transport.read = async (id) => {
      if (++reads === 1) {
        await gate;
        throw new ConversationReadError(id, status);
      }
      return { protocol: "1.0", id, title: "Newest", messages: [] };
    };
    const older = client.refresh();
    const newer = await client.refresh();
    reject();
    expect(await older).toEqual(newer);
    expect(client.getSnapshot().conversation?.title).toBe("Newest");
    expect(client.getSnapshot().conversationUnavailable).toBe(false);
    expect(client.getSnapshot().problem).toBeNull();
    client.dispose();
  });

for (const stage of [
  "contribution",
  "beforeSend",
  "storage-send",
  "storage-retry",
] as const)
  it(`blocks a missing conversation while ${stage} is preparing a send`, async () => {
    const cfg = config();
    const client = createWaypointClient(cfg);
    await client.ready;
    const send = vi
      .spyOn(cfg.transport, "send")
      .mockRejectedValueOnce(new Error("Send unavailable"));
    let pendingId: string | undefined;
    if (stage === "storage-retry") {
      await client.setDraft("Retry input");
      await client.send();
      pendingId = client.getSnapshot().pending[0]!.id;
    } else await client.setDraft("Keep input");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepare = vi.fn(async () => {
      await gate;
    });
    if (stage === "contribution")
      cfg.contributions = [
        {
          id: "context",
          evaluate: async () => {
            await prepare();
            return {};
          },
        },
      ];
    else if (stage === "beforeSend") cfg.beforeSend = prepare;
    else cfg.storage = { get: () => null, set: prepare, remove: () => {} };
    const operation = pendingId ? client.retry(pendingId) : client.send();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    const read = cfg.transport.read;
    cfg.transport.read = async (id) => {
      throw new ConversationReadError(id, 404);
    };
    expect((await client.refresh()).kind).toBe("missing");
    release();
    await operation;
    expect(send).toHaveBeenCalledTimes(pendingId ? 1 : 0);
    expect(client.getSnapshot().sending).toBe(false);
    if (stage.startsWith("storage")) {
      expect(client.getSnapshot().pending[0]?.content).toBe(
        pendingId ? "Retry input" : "Keep input",
      );
      // The first send's outcome is unknown; the retry stopped by the
      // missing conversation does not settle it.
      expect(client.getSnapshot().pending[0]?.failure?.code).toBe(
        pendingId ? "in-doubt" : "unavailable",
      );
    } else expect(client.getSnapshot().draft).toBe("Keep input");
    cfg.transport.read = read;
    await client.refresh();
    const row = client.getSnapshot().pending[0];
    if (row) await client.retry(row.id);
    else await client.send();
    expect(send).toHaveBeenCalledTimes(pendingId ? 2 : 1);
    client.dispose();
  });
