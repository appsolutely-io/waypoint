import { it, expect, vi, describe } from "vitest";
import type { StoragePort } from "../../src/core/client";
import { config as baseConfig, flush } from "../support/client";

// Clients here share one advancing wall clock, as tabs on one machine do;
// drafts are ordered by edit time.
let now = 1_000_000;
const config = () => {
  const base = baseConfig();
  return {
    ...base,
    platform: {
      ...base.platform,
      clock: { ...base.platform.clock, now: () => ++now },
    },
  };
};

type ClientModule = typeof import("../../src/core/client");
// Each runtime gets its own module instances, as two browser tabs would.
async function runtime(): Promise<ClientModule> {
  vi.resetModules();
  return import("../../src/core/client");
}
function backend() {
  const values = new Map<string, string>();
  const held: (() => void)[] = [];
  return {
    values,
    held,
    port(options: { atomic: boolean }): {
      port: StoragePort;
      hold: () => void;
    } {
      let holdNext = false;
      const land = (apply: () => void) => {
        if (!holdNext) {
          apply();
          return Promise.resolve();
        }
        holdNext = false;
        return new Promise<void>((resolve) =>
          held.push(() => {
            apply();
            resolve();
          }),
        );
      };
      const port: StoragePort = {
        get: async (key) => values.get(key) ?? null,
        set: (key, value) => land(() => values.set(key, value)),
        remove: async (key) => {
          values.delete(key);
        },
        ...(options.atomic
          ? {
              compareAndSet: (
                key: string,
                expected: string | null,
                value: string,
              ) => {
                let wrote = false;
                return land(() => {
                  // The comparison happens when the commit lands.
                  if ((values.get(key) ?? null) === expected) {
                    values.set(key, value);
                    wrote = true;
                  }
                }).then(() => wrote);
              },
            }
          : {}),
      };
      return { port, hold: () => (holdNext = true) };
    },
  };
}
const failingSend = (base: ReturnType<typeof config>) => ({
  ...base.transport,
  send: async () => {
    throw { code: "retryable", id: "send" };
  },
});

describe("two runtimes on one store", () => {
  for (const mode of ["atomic port", "Web Locks"] as const)
    it(`an obsolete runtime cannot overwrite newer state or delete an unsent message (${mode})`, async () => {
      {
        const store = backend();
        const a = await runtime();
        const b = await runtime();
        expect(a).not.toBe(b);
        const portA = store.port({ atomic: mode === "atomic port" });
        const portB = store.port({ atomic: mode === "atomic port" });
        const oldClient = a.createWaypointClient({
          ...config(),
          storage: portA.port,
        });
        await oldClient.ready;
        await flush();
        portA.hold();
        void oldClient.setDraft("Old first");
        await flush();
        void oldClient.setDraft("Old queued");
        await flush();
        oldClient.dispose();
        const base = config();
        const current = b.createWaypointClient({
          ...base,
          storage: portB.port,
          transport: failingSend(base),
        });
        // The newer runtime saves its draft and an unsent message while the
        // obsolete runtime's commit is still in flight.
        const saving = (async () => {
          await current.ready;
          await current.setDraft("Do not lose this message");
          await current.send();
          await current.setDraft("New current");
        })();
        for (let round = 0; round < 40; round++) await flush();
        // Then the obsolete runtime's in-flight commit lands.
        for (let round = 0; round < 20 && store.held.length; round++) {
          store.held.shift()!();
          await flush();
        }
        await saving;
        await flush();
        expect(current.getSnapshot().pending.map((row) => row.content)).toEqual(
          ["Do not lose this message"],
        );
        current.dispose();
        const reload = b.createWaypointClient({
          ...config(),
          storage: portB.port,
        });
        await reload.ready;
        expect(reload.getSnapshot().draft).toBe("New current");
        expect(reload.getSnapshot().pending.map((row) => row.content)).toEqual([
          "Do not lose this message",
        ]);
        reload.dispose();
      }
    });
  it("a disposed runtime's final save still lands when no other runtime wrote", async () => {
    const store = backend();
    const a = await runtime();
    const { port, hold } = store.port({ atomic: true });
    const client = a.createWaypointClient({ ...config(), storage: port });
    await client.ready;
    await flush();
    hold();
    void client.setDraft("Earlier");
    await flush();
    void client.setDraft("Last words");
    await flush();
    client.dispose();
    for (let round = 0; round < 20 && store.held.length; round++) {
      store.held.shift()!();
      await flush();
    }
    expect(
      [...store.values.values()].some((v) => v.includes("Last words")),
    ).toBe(true);
  });
});

describe("revisioned commits", () => {
  it("a stale live runtime keeps another runtime's unsent message", async () => {
    const store = backend();
    const a = await runtime();
    const b = await runtime();
    const base = config();
    const later = b.createWaypointClient({
      ...config(),
      storage: store.port({ atomic: true }).port,
    });
    await later.ready;
    await flush();
    const sender = a.createWaypointClient({
      ...base,
      storage: store.port({ atomic: true }).port,
      transport: failingSend(base),
    });
    await sender.ready;
    await sender.setDraft("Unsent from another tab");
    await sender.send();
    await flush();
    await later.setDraft("Typing here");
    await flush();
    const reload = b.createWaypointClient({
      ...config(),
      storage: store.port({ atomic: true }).port,
    });
    await reload.ready;
    expect(reload.getSnapshot().draft).toBe("Typing here");
    expect(reload.getSnapshot().pending.map((row) => row.content)).toEqual([
      "Unsent from another tab",
    ]);
    for (const client of [later, sender, reload]) client.dispose();
  });
  it("without an atomic port or locks, a commit overwritten before read-back is rebuilt", async () => {
    const { commitRecord } = await import("../../src/core/storage-commit");
    const locks = (navigator as { locks?: unknown }).locks;
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    });
    try {
      const values = new Map<string, string>();
      let rivalled = false;
      const port: StoragePort = {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
          values.set(key, value);
          if (!rivalled) {
            rivalled = true;
            // Another runtime writes between this write and its read-back.
            values.set(key, JSON.stringify({ rows: ["theirs"], revision: 7 }));
          }
        },
        remove: async () => {},
      };
      const revision = await commitRecord(port, "k", (stored) => ({
        rows: [...((stored?.rows as string[] | undefined) ?? []), "ours"],
      }));
      expect(revision).toBe(8);
      expect(JSON.parse(values.get("k")!)).toEqual({
        rows: ["theirs", "ours"],
        revision: 8,
      });
    } finally {
      Object.defineProperty(navigator, "locks", {
        value: locks,
        configurable: true,
      });
    }
  });
});

describe("snapshot and baseline are one pair", () => {
  const gateOf = () => {
    let open!: () => void;
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  };
  it("a late hydration does not authorize a disposed runtime's queued final save", async () => {
    const { createManualClock } = await import("../support/client");
    const a = await runtime();
    const b = await runtime();
    const shared = a.createMemoryStorage(true);
    const hydrationGate = gateOf();
    let firstGet = true;
    let holdCas: ReturnType<typeof gateOf> | undefined;
    const portA: StoragePort = {
      get: async (key) => {
        if (firstGet) {
          firstGet = false;
          await hydrationGate.wait;
        }
        return shared.get(key);
      },
      set: (key, value) => shared.set(key, value),
      remove: (key) => shared.remove(key),
      compareAndSet: async (key, expected, value) => {
        const held = holdCas;
        holdCas = undefined;
        if (held) await held.wait;
        return shared.compareAndSet!(key, expected, value);
      },
    };
    const manual = createManualClock(1000);
    const base = config();
    const old = a.createWaypointClient({
      ...base,
      platform: { ...base.platform, clock: manual.clock },
      storage: portA,
    });
    await manual.advance(1000);
    await old.ready;
    await flush();
    const held = gateOf();
    holdCas = held;
    void old.setDraft("Old first");
    await flush();
    void old.setDraft("Old queued");
    await flush();
    const replacement = b.createWaypointClient({
      ...config(),
      storage: shared,
    });
    await replacement.ready;
    await replacement.setDraft("Newest draft from replacement");
    hydrationGate.open();
    await flush();
    old.dispose();
    held.open();
    for (let round = 0; round < 10; round++) await flush();
    const reload = b.createWaypointClient({ ...config(), storage: shared });
    await reload.ready;
    expect(reload.getSnapshot().draft).toBe("Newest draft from replacement");
    replacement.dispose();
    reload.dispose();
  });
  for (const mode of ["atomic port", "Web Locks"] as const) {
    it(`an automatic save after a held first read does not restore an older draft (${mode})`, async () => {
      const store = backend();
      const a = await runtime();
      const b = await runtime();
      const writer = a.createWaypointClient({
        ...config(),
        storage: store.port({ atomic: mode === "atomic port" }).port,
      });
      await writer.ready;
      await writer.setDraft("Earlier draft");
      await flush();
      const firstRead = gateOf();
      const base = config();
      const reader = b.createWaypointClient({
        ...base,
        storage: store.port({ atomic: mode === "atomic port" }).port,
        transport: {
          ...base.transport,
          read: async (id) => {
            await firstRead.wait;
            return { protocol: "1.0", id, title: "Chat", messages: [] };
          },
        },
      });
      await flush();
      await writer.setDraft("Newest draft that must survive");
      await flush();
      firstRead.open();
      await reader.ready;
      await flush();
      const reload = b.createWaypointClient({
        ...config(),
        storage: store.port({ atomic: mode === "atomic port" }).port,
      });
      await reload.ready;
      expect(reload.getSnapshot().draft).toBe("Newest draft that must survive");
      for (const client of [writer, reader, reload]) client.dispose();
    });
    it(`a stale refresh does not bring back a withdrawn unsent message (${mode})`, async () => {
      const store = backend();
      const a = await runtime();
      const b = await runtime();
      const base = config();
      const editor = a.createWaypointClient({
        ...base,
        storage: store.port({ atomic: mode === "atomic port" }).port,
        transport: failingSend(base),
      });
      await editor.ready;
      await editor.setDraft("Original unsent content");
      await editor.send();
      await flush();
      const viewer = b.createWaypointClient({
        ...config(),
        storage: store.port({ atomic: mode === "atomic port" }).port,
      });
      await viewer.ready;
      await flush();
      expect(viewer.getSnapshot().pending.map((row) => row.content)).toEqual([
        "Original unsent content",
      ]);
      const row = editor.getSnapshot().pending[0]!;
      await editor.withdraw(row.id);
      await editor.setDraft("Corrected unsent content");
      await editor.send();
      await flush();
      await viewer.refresh();
      await flush();
      const reload = b.createWaypointClient({
        ...config(),
        storage: store.port({ atomic: mode === "atomic port" }).port,
      });
      await reload.ready;
      expect(reload.getSnapshot().pending.map((r) => r.content)).toEqual([
        "Corrected unsent content",
      ]);
      for (const client of [editor, viewer, reload]) client.dispose();
    });
  }
});

describe("a load replaces value and baseline together", () => {
  const gateOf = () => {
    let open!: () => void;
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  };
  for (const mode of ["atomic port", "Web Locks"] as const)
    for (const subject of ["draft", "unsent message"] as const)
      it(`returning to a conversation does not let an automatic save undo a newer ${subject} (${mode})`, async () => {
        const store = backend();
        const a = await runtime();
        const b = await runtime();
        let holdRead: ReturnType<typeof gateOf> | undefined;
        const baseA = config();
        const returning = a.createWaypointClient({
          ...baseA,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: {
            ...failingSend(baseA),
            read: async (id) => {
              const held = holdRead;
              if (held && id === "conversation-a") {
                holdRead = undefined;
                await held.wait;
              }
              return { protocol: "1.0", id, title: "Chat", messages: [] };
            },
          },
        });
        await returning.ready;
        if (subject === "draft") await returning.setDraft("Original baseline");
        else {
          await returning.setDraft("Original unsent content");
          await returning.send();
        }
        await flush();
        await returning.switchConversation("conversation-b");
        const baseB = config();
        const other = b.createWaypointClient({
          ...baseB,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: failingSend(baseB),
        });
        await other.ready;
        const edit = async (text: string) => {
          if (subject === "draft") await other.setDraft(text);
          else {
            const row = other.getSnapshot().pending[0]!;
            await other.withdraw(row.id);
            await other.setDraft(text);
            await other.send();
          }
          await flush();
        };
        await edit("Intermediate content");
        const held = gateOf();
        holdRead = held;
        const back = returning.switchConversation("conversation-a");
        for (let round = 0; round < 10; round++) await flush();
        await edit("Newest content that must survive");
        held.open();
        await back;
        await flush();
        const reload = b.createWaypointClient({
          ...config(),
          storage: store.port({ atomic: mode === "atomic port" }).port,
        });
        await reload.ready;
        if (subject === "draft")
          expect(reload.getSnapshot().draft).toBe(
            "Newest content that must survive",
          );
        else
          expect(reload.getSnapshot().pending.map((r) => r.content)).toEqual([
            "Newest content that must survive",
          ]);
        for (const client of [returning, other, reload]) client.dispose();
      });
});

describe("random interleavings never lose a newer edit", () => {
  // Deterministic generator over a fixed seed list, so failures replay.
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const gateOf = () => {
    let open!: () => void;
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  };
  const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);
  const STEPS = 12;
  for (const mode of ["atomic port", "Web Locks"] as const)
    it(`loads, edits, saves, late hydration and external commits across two runtimes (${mode})`, async () => {
      const { createManualClock } = await import("../support/client");
      for (const seed of SEEDS) {
        const next = random(seed);
        const store = backend();
        const editorModule = await runtime();
        const readerModule = await runtime();
        const readerClock = createManualClock(1000);
        const holds: { read?: ReturnType<typeof gateOf> } = {};
        // The editor drafts, sends and corrects one unsent message; its view
        // is always current because each of its commits reads the store.
        const editorBase = baseConfig();
        const editor = editorModule.createWaypointClient({
          ...editorBase,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: failingSend(editorBase),
        });
        await editor.ready;
        // The reader only loads: starts (with a late, captured hydration),
        // refreshes, revisits and saves automatically.
        const openReader = (late?: Promise<void>) => {
          const base = baseConfig();
          const { port } = store.port({ atomic: mode === "atomic port" });
          let first = true;
          return readerModule.createWaypointClient({
            ...base,
            platform: { ...base.platform, clock: readerClock.clock },
            storage: {
              ...port,
              get: async (key) => {
                const captured = await port.get(key);
                const hydration = first;
                first = false;
                if (hydration && late) await late;
                return captured;
              },
            },
            transport: {
              ...base.transport,
              read: async (id) => {
                const held = holds.read;
                if (held && id === "conversation-a") {
                  holds.read = undefined;
                  await held.wait;
                }
                return { protocol: "1.0", id, title: "Chat", messages: [] };
              },
            },
          });
        };
        let reader = openReader();
        await readerClock.advance(1000);
        await reader.ready;
        let draft = "";
        let message: string | undefined;
        let counter = 0;
        const trace: string[] = [];
        const editDraft = async () => {
          draft = `draft ${++counter}`;
          trace.push(draft);
          await editor.setDraft(draft);
          await flush();
        };
        const sendOrCorrect = async () => {
          const text = `message ${++counter}`;
          trace.push(text);
          const row = editor.getSnapshot().pending[0];
          if (row) await editor.withdraw(row.id);
          await editor.setDraft(text);
          await editor.send();
          await flush();
          message = text;
          draft = editor.getSnapshot().draft;
        };
        const editorEdit = () => (next() < 0.5 ? editDraft() : sendOrCorrect());
        for (let step = 0; step < STEPS; step++) {
          const roll = next();
          if (roll < 0.35) await editorEdit();
          else if (roll < 0.5) {
            trace.push("reader refresh");
            await reader.refresh();
          } else if (roll < 0.62) {
            trace.push("reader revisit");
            await reader.switchConversation("conversation-b");
            await reader.switchConversation("conversation-a");
          } else if (roll < 0.8) {
            // A restart whose hydration captured the record, answers after
            // the startup budget and after newer edits.
            trace.push("reader restart, late hydration");
            reader.dispose();
            const late = gateOf();
            reader = openReader(late.wait);
            await flush();
            await editorEdit();
            await readerClock.advance(1000);
            await reader.ready;
            await flush();
            late.open();
            await flush();
            await editorEdit();
            await reader.refresh();
          } else {
            trace.push("reader refresh held across an edit");
            const held = gateOf();
            holds.read = held;
            const pending = reader.refresh();
            await flush();
            await editorEdit();
            held.open();
            await pending;
          }
          await flush();
          const reload = editorModule.createWaypointClient({
            ...baseConfig(),
            storage: store.port({ atomic: mode === "atomic port" }).port,
          });
          await reload.ready;
          const where = `seed ${seed}: ${trace.join(", ")}`;
          expect(reload.getSnapshot().draft, where).toBe(draft);
          expect(
            reload.getSnapshot().pending.map((row) => row.content),
            where,
          ).toEqual(message ? [message] : []);
          reload.dispose();
        }
        editor.dispose();
        reader.dispose();
      }
    }, 120000);
});

describe("random withdrawals and resends keep one id per message and lose no content", () => {
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);
  const STEPS = 12;
  // refuse: definitely not admitted. accept: admitted and answered.
  // unknown: never admitted, no answer. lost: admitted, answer lost.
  // late: no answer, admitted just after the client gave up.
  type Outcome = "accept" | "refuse" | "unknown" | "lost" | "late";
  for (const mode of ["atomic port", "Web Locks"] as const)
    it(`withdrawals during a send, unknown outcomes, refused retries, reloads, failed claims (${mode})`, async () => {
      for (const seed of SEEDS) {
        const next = random(seed);
        const store = backend();
        const trace: string[] = [];
        const where = () => `seed ${seed}: ${trace.join(", ")}`;
        // Every stored revision of every message: its content never changes.
        const revisions = new Map<string, string>();
        const seen = new Set<string>();
        // What the server holds, deduplicated by message id.
        const delivered = new Map<string, string>();
        const violations: string[] = [];
        const withdrawn = new Set<string>();
        type Row = {
          id: string;
          content: string;
          open?: string[];
          failure?: { code: string } | null;
        };
        // Unsettled: an attempt is open, or the stored outcome is unknown.
        const unsettled = (row: Row) =>
          (row.open?.length ?? 0) > 0 || row.failure?.code === "in-doubt";
        const write = store.values.set.bind(store.values);
        type Item = { id: string; content: string };
        type Saved = { draft?: string; pending?: Row[]; restored?: Item[] };
        // Restored items the test itself discarded.
        const discarded = new Set<string>();
        store.values.set = (key, value) => {
          const next = JSON.parse(value) as Saved;
          const before = JSON.parse(store.values.get(key) ?? "{}") as Saved;
          for (const row of next.pending ?? []) {
            const known = revisions.get(row.id);
            if (known !== undefined && known !== row.content)
              violations.push(`${row.id} changed content`);
            revisions.set(row.id, row.content);
            seen.add(row.id);
          }
          // A row leaves undelivered only by being withdrawn: it was settled
          // and its content is a restored item of the record written with
          // its removal.
          for (const row of before.pending ?? [])
            if (
              !delivered.has(row.id) &&
              !(next.pending ?? []).some((other) => other.id === row.id)
            ) {
              if (
                unsettled(row) ||
                !(next.restored ?? []).some(
                  (item) =>
                    item.content === row.content &&
                    !(before.restored ?? []).some((old) => old.id === item.id),
                )
              )
                violations.push(`${row.id} left undelivered`);
              withdrawn.add(row.id);
            }
          // A restored item leaves only when the user discards it.
          for (const item of before.restored ?? [])
            if (
              !(next.restored ?? []).some((other) => other.id === item.id) &&
              !discarded.has(item.id)
            )
              violations.push(`restored ${item.id} lost`);
          return write(key, value);
        };
        const stored = () =>
          [...store.values.values()].flatMap(
            (value) => (JSON.parse(value) as { pending?: Row[] }).pending ?? [],
          );
        let outcome: Outcome = "refuse";
        let storageDown = false;
        let hold: Promise<void> | undefined;
        const deliver = (id: string, content: string) => {
          const before = delivered.get(id);
          if (before !== undefined && before !== content)
            violations.push(`${id} delivered twice with different content`);
          // Every composed message is distinct, so the same content under a
          // second id is a duplicate delivery.
          if (before === undefined && [...delivered.values()].includes(content))
            violations.push(`${id} duplicates a delivered message`);
          delivered.set(id, before ?? content);
        };
        const port = () => {
          const { port: inner } = store.port({
            atomic: mode === "atomic port",
          });
          const down = () => {
            if (storageDown) throw new Error("storage unavailable");
          };
          return {
            ...inner,
            get: async (key: string) => (down(), inner.get(key)),
            set: async (key: string, value: string) => (
              down(),
              inner.set(key, value)
            ),
            ...(inner.compareAndSet
              ? {
                  compareAndSet: async (
                    key: string,
                    expected: string | null,
                    value: string,
                  ) => (down(), inner.compareAndSet!(key, expected, value)),
                }
              : {}),
          } as StoragePort;
        };
        const open = async (name: string) => {
          const module = await runtime();
          const base = baseConfig();
          let count = 0;
          const client = module.createWaypointClient({
            ...base,
            platform: { ...base.platform, ids: () => `${name}-${++count}` },
            storage: port(),
            transport: {
              ...base.transport,
              read: async (id) => ({
                protocol: "1.0",
                id,
                title: "Chat",
                messages: [...delivered].map(([messageId, content], index) => ({
                  id: `server-${messageId}`,
                  role: "user" as const,
                  content,
                  blocks: [],
                  createdAt: index,
                  clientMessageId: messageId,
                })),
              }),
              send: async (reply) => {
                if (reply.kind !== "message") return { id: "other" };
                if (storageDown) violations.push(`${name} sent uncommitted`);
                // Only the current revision, with its stored content, is sent.
                const row = stored().find(
                  (r) => r.id === reply.clientMessageId,
                );
                if (!row || row.content !== reply.content)
                  violations.push(
                    `${name} sent stale ${reply.clientMessageId}`,
                  );
                const held = hold;
                hold = undefined;
                if (held) await held;
                // The server deduplicates: a message it already holds is
                // acknowledged again, whatever this attempt would have done.
                if (delivered.has(reply.clientMessageId)) {
                  deliver(reply.clientMessageId, reply.content);
                  return { id: reply.clientMessageId };
                }
                if (outcome === "refuse")
                  throw { code: "retryable", id: "send" };
                if (outcome === "accept" || outcome === "lost")
                  deliver(reply.clientMessageId, reply.content);
                if (outcome === "late")
                  void Promise.resolve().then(() =>
                    deliver(reply.clientMessageId, reply.content),
                  );
                if (outcome !== "accept") throw new Error("connection lost");
                return { id: reply.clientMessageId };
              },
            },
          });
          await client.ready;
          return client;
        };
        const editors = [await open("a"), await open("b")];
        type Editor = (typeof editors)[number];
        let counter = 0;
        let reopened = 0;
        const correct = async (client: Editor) => {
          const row = client.getSnapshot().pending[0];
          const text = `message ${++counter}`;
          if (row) await client.withdraw(row.id);
          // Sometimes the user takes a withdrawn message back into the draft
          // before discarding it; the draft is then composed around it.
          const item = client.getSnapshot().restored[0];
          if (item && next() < 0.5) {
            await client.editRestored(item.id);
            discarded.add(item.id);
            await client.discardRestored(item.id);
          }
          const kept = client.getSnapshot().draft;
          await client.setDraft(kept ? `${kept}\n\n${text}` : text);
          await client.send();
          await flush();
        };
        const retry = async (client: Editor) => {
          const row = client.getSnapshot().pending[0];
          if (row) await client.retry(row.id);
          await flush();
        };
        const pick = (): Outcome => {
          const roll = next();
          return roll < 0.35
            ? "refuse"
            : roll < 0.6
              ? "accept"
              : roll < 0.75
                ? "unknown"
                : roll < 0.9
                  ? "lost"
                  : "late";
        };
        const uncertain = (): Outcome => {
          const roll = next();
          return roll < 0.34 ? "unknown" : roll < 0.67 ? "lost" : "late";
        };
        for (let step = 0; step < STEPS; step++) {
          const order = next() < 0.5 ? [0, 1] : [1, 0];
          const x = editors[order[0]!]!;
          const y = editors[order[1]!]!;
          outcome = pick();
          const roll = next();
          if (roll < 0.15) {
            trace.push(`withdraw and resend (${outcome})`);
            await correct(x);
          } else if (roll < 0.25) {
            trace.push(`retry (${outcome})`);
            await retry(x);
          } else if (roll < 0.37) {
            // One runtime's send is held in the transport while the other,
            // which may still show the earlier refusal, withdraws the same
            // message and sends its draft before the withdrawal commits.
            trace.push(`withdraw during remote send (${outcome})`);
            let release!: () => void;
            hold = new Promise<void>((resolve) => (release = resolve));
            const target = x.getSnapshot().pending[0];
            const sending = target ? x.retry(target.id) : correct(x);
            await flush();
            hold = undefined;
            const row = target
              ? y.getSnapshot().pending.find((p) => p.id === target.id)
              : y.getSnapshot().pending[0];
            const withdrawing = row ? y.withdraw(row.id) : Promise.resolve();
            if (y.getSnapshot().draft) await y.send();
            else await correct(y);
            await withdrawing;
            release();
            await sending;
          } else if (roll < 0.47) {
            trace.push(`retry after withdraw (${outcome})`);
            const stale = y.getSnapshot().pending[0];
            await correct(x);
            if (stale) await y.retry(stale.id);
            await flush();
          } else if (roll < 0.6) {
            // An unknown outcome, then a retry refused before admission,
            // then an edit: the uncertainty must survive the refusal.
            const first = uncertain();
            trace.push(`${first} then refused retry then withdraw`);
            outcome = first;
            await correct(x);
            outcome = "refuse";
            await retry(x);
            outcome = pick();
            await correct(x);
          } else if (roll < 0.72) {
            // A reload while an outcome is unknown.
            const first = uncertain();
            trace.push(`${first} then reload (${outcome})`);
            const final = outcome;
            outcome = first;
            await correct(x);
            x.dispose();
            const fresh = await open(`r${++reopened}`);
            editors[order[0]!] = fresh;
            await flush();
            outcome = final;
            await (next() < 0.5 ? retry(fresh) : correct(fresh));
          } else if (roll < 0.84) {
            // The claim cannot be committed: nothing may be sent.
            trace.push(`claim while storage is down (${outcome})`);
            storageDown = true;
            await (next() < 0.5 ? retry(x) : correct(x));
            storageDown = false;
            await x.refresh();
            await flush();
          } else {
            // A withdrawal from the runtime that may still show an older
            // state, with draft edits on both runtimes while it commits.
            trace.push(`withdraw with draft edits (${outcome})`);
            const row = y.getSnapshot().pending[0];
            const withdrawing = row ? y.withdraw(row.id) : Promise.resolve();
            const typing = y.setDraft(`draft ${++counter}`);
            await x.setDraft(`draft ${++counter}`);
            await Promise.all([withdrawing, typing]);
            await y.refresh();
            await flush();
          }
          await flush();
          expect(violations, where()).toEqual([]);
          // A delivered message stays only while an attempt is unsettled, and
          // then with exactly the delivered content, so a retry is idempotent.
          const rows = stored();
          expect(
            rows
              .filter(
                (row) =>
                  delivered.has(row.id) &&
                  (!unsettled(row) || row.content !== delivered.get(row.id)),
              )
              .map((row) => row.id),
            where(),
          ).toEqual([]);
          expect(rows.map((row) => row.id).sort(), where()).toEqual(
            [...seen]
              .filter(
                (id) =>
                  (!delivered.has(id) && !withdrawn.has(id)) ||
                  rows.some((row) => row.id === id),
              )
              .sort(),
          );
        }
        for (const client of editors) client.dispose();
      }
    }, 240000);
});

describe("operations, not snapshots", () => {
  for (const mode of ["atomic port", "Web Locks"] as const)
    it(`a late partial hydration cannot relabel a retained outbox row (${mode})`, async () => {
      const { createManualClock } = await import("../support/client");
      const store = backend();
      const a = await runtime();
      const b = await runtime();
      const baseB = config();
      const editor = b.createWaypointClient({
        ...baseB,
        storage: store.port({ atomic: mode === "atomic port" }).port,
        transport: failingSend(baseB),
      });
      await editor.ready;
      await editor.setDraft("Original");
      await editor.send();
      await flush();
      // The reader's first storage read captures the record, then waits.
      let releaseHydration!: () => void;
      const hydrationHeld = new Promise<void>((resolve) => {
        releaseHydration = resolve;
      });
      const { port } = store.port({ atomic: mode === "atomic port" });
      let first = true;
      const readerPort: StoragePort = {
        ...port,
        get: async (key) => {
          const captured = await port.get(key);
          if (first) {
            first = false;
            await hydrationHeld;
          }
          return captured;
        },
      };
      const manual = createManualClock(2_000_000);
      const baseA = baseConfig();
      const reader = a.createWaypointClient({
        ...baseA,
        platform: { ...baseA.platform, clock: manual.clock },
        storage: readerPort,
      });
      const resend = async (text: string) => {
        const row = editor.getSnapshot().pending[0]!;
        await editor.withdraw(row.id);
        await editor.setDraft(text);
        await editor.send();
        await flush();
      };
      await resend("Intermediate");
      await manual.advance(1000);
      await reader.ready;
      await flush();
      expect(reader.getSnapshot().pending.map((r) => r.content)).toEqual([
        "Intermediate",
      ]);
      releaseHydration();
      await flush();
      // An older record loaded late does not replace the newer view.
      expect(reader.getSnapshot().pending.map((r) => r.content)).toEqual([
        "Intermediate",
      ]);
      await resend("Newest must survive");
      await reader.refresh();
      await flush();
      const reload = b.createWaypointClient({
        ...config(),
        storage: store.port({ atomic: mode === "atomic port" }).port,
      });
      await reload.ready;
      expect(reload.getSnapshot().pending.map((r) => r.content)).toEqual([
        "Newest must survive",
      ]);
      for (const client of [editor, reader, reload]) client.dispose();
    });
});

describe("operation preconditions", () => {
  for (const mode of ["atomic port", "Web Locks"] as const) {
    // A host that holds messages from admission, deduplicates by message id
    // and reports what it holds on every read.
    const host = () => {
      const held = new Map<string, string>();
      const read = async (conversationId: string) => ({
        protocol: "1.0",
        id: conversationId,
        title: "Chat",
        messages: [...held].map(([messageId, content], index) => ({
          id: `server-${messageId}`,
          role: "user" as const,
          content,
          blocks: [],
          createdAt: index,
          clientMessageId: messageId,
        })),
      });
      const admit = (id: string, content: string) => {
        if (!held.has(id)) held.set(id, content);
      };
      return { held, read, admit };
    };
    const sendingRefusal = { code: "refused", id: "sending" };
    it(`withdrawing moves a refused message into one restored item in one commit (${mode})`, async () => {
      const store = backend();
      const open = async () => {
        const base = config();
        const client = (await runtime()).createWaypointClient({
          ...base,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: failingSend(base),
        });
        await client.ready;
        return client;
      };
      const first = await open();
      await first.setDraft("Queued message");
      await first.send();
      await first.setDraft("Typed meanwhile");
      await flush();
      const second = await open();
      await flush();
      const id = first.getSnapshot().pending[0]!.id;
      // Both runtimes withdraw the same row: its content lands once.
      await Promise.all([first.withdraw(id), second.withdraw(id)]);
      await flush();
      const reload = await open();
      expect(reload.getSnapshot().pending).toEqual([]);
      expect(reload.getSnapshot().draft).toBe("Typed meanwhile");
      expect(reload.getSnapshot().restored.map((r) => r.content)).toEqual([
        "Queued message",
      ]);
      for (const client of [first, second, reload]) client.dispose();
    });
    it(`a row withdrawn elsewhere is not resent by a stale retry (${mode})`, async () => {
      const store = backend();
      const sent: string[] = [];
      let accept = false;
      const open = async () => {
        const base = config();
        const client = (await runtime()).createWaypointClient({
          ...base,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: {
            ...base.transport,
            send: async (reply) => {
              if (!accept) throw { code: "retryable", id: "send" };
              if (reply.kind === "message") sent.push(reply.content);
              return { id: reply.clientReplyId };
            },
          },
        });
        await client.ready;
        return client;
      };
      const stale = await open();
      await stale.setDraft("Original");
      await stale.send();
      await flush();
      const current = await open();
      await flush();
      const id = current.getSnapshot().pending[0]!.id;
      await current.withdraw(id);
      await current.setDraft("Corrected unsent content");
      await current.send();
      await flush();
      accept = true;
      expect(stale.getSnapshot().pending[0]!.content).toBe("Original");
      await stale.retry(id);
      await flush();
      expect(sent).toEqual([]);
      const reload = await open();
      expect(reload.getSnapshot().pending.map((r) => r.content)).toEqual([
        "Corrected unsent content",
      ]);
      for (const client of [stale, current, reload]) client.dispose();
    });
    it(`a message cannot be withdrawn while another runtime is sending it (${mode})`, async () => {
      const store = backend();
      const server = host();
      let accept = false;
      let release: (() => void) | undefined;
      const open = async () => {
        const base = config();
        const client = (await runtime()).createWaypointClient({
          ...base,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: {
            ...base.transport,
            read: server.read,
            send: async (reply) => {
              if (accept)
                await new Promise<void>((resolve) => (release = resolve));
              if (!accept) throw { code: "retryable", id: "send" };
              if (reply.kind === "message")
                server.admit(reply.clientMessageId, reply.content);
              return { id: reply.clientReplyId };
            },
          },
        });
        await client.ready;
        return client;
      };
      const a = await open();
      await a.setDraft("Original");
      await a.send();
      await flush();
      const b = await open();
      await flush();
      const id = a.getSnapshot().pending[0]!.id;
      accept = true;
      const retrying = a.retry(id);
      await flush();
      expect(release).toBeDefined();
      // The second runtime still shows the earlier refusal.
      expect(b.getSnapshot().pending[0]!.failure?.code).toBe("retryable");
      await b.withdraw(id);
      expect(b.getSnapshot().problem).toEqual(sendingRefusal);
      expect(b.getSnapshot().draft).toBe("");
      release!();
      await retrying;
      await flush();
      expect([...server.held]).toEqual([[id, "Original"]]);
      for (const client of [a, b]) client.dispose();
    });
    it(`an unknown outcome stays locked through a refused retry, a late refusal and a takeover (${mode})`, async () => {
      const store = backend();
      const server = host();
      const releases: ((outcome: "refuse" | "accept") => void)[] = [];
      let hold = false;
      let first = true;
      const open = async () => {
        const base = config();
        const client = (await runtime()).createWaypointClient({
          ...base,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: {
            ...base.transport,
            read: server.read,
            send: async (reply) => {
              if (first) {
                first = false;
                throw new Error("connection lost");
              }
              const outcome = hold
                ? await new Promise<"refuse" | "accept">((resolve) =>
                    releases.push(resolve),
                  )
                : "refuse";
              if (outcome === "refuse") throw { code: "retryable", id: "send" };
              if (reply.kind === "message")
                server.admit(reply.clientMessageId, reply.content);
              return { id: reply.clientReplyId };
            },
          },
        });
        await client.ready;
        return client;
      };
      const a = await open();
      await a.setDraft("Original");
      await a.send();
      await flush();
      const id = a.getSnapshot().pending[0]!.id;
      expect(a.getSnapshot().pending[0]!.failure?.code).toBe("in-doubt");
      // A retry refused before admission says nothing about the first try.
      await a.retry(id);
      await flush();
      await a.withdraw(id);
      expect(a.getSnapshot().problem).toEqual(sendingRefusal);
      // A new runtime, a reload and a read of an empty conversation change
      // nothing either.
      const b = await open();
      await b.refresh();
      await flush();
      await b.withdraw(id);
      expect(b.getSnapshot().problem).toEqual(sendingRefusal);
      // Two attempts in flight; the one that took over is refused first.
      hold = true;
      const one = a.retry(id);
      await flush();
      const two = b.retry(id);
      await flush();
      expect(releases).toHaveLength(2);
      hold = false;
      releases[1]!("refuse");
      await two;
      await flush();
      await b.withdraw(id);
      expect(b.getSnapshot().problem).toEqual(sendingRefusal);
      releases[0]!("accept");
      await one;
      await flush();
      expect([...server.held]).toEqual([[id, "Original"]]);
      const reload = await open();
      expect(reload.getSnapshot().pending).toEqual([]);
      for (const client of [a, b, reload]) client.dispose();
    });
    it(`a request in transit when its owner went away cannot cost a correction (${mode})`, async () => {
      // An empty read while the old request is still in transit settles
      // nothing; the correction is a separate message with its own id.
      const store = backend();
      const server = host();
      let admitLate!: () => void;
      let step: "lose" | "accept" = "lose";
      const open = async () => {
        const base = config();
        const client = (await runtime()).createWaypointClient({
          ...base,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: {
            ...base.transport,
            read: server.read,
            send: async (reply) => {
              if (reply.kind !== "message") return { id: "other" };
              const { clientMessageId: id, content } = reply;
              if (step === "lose") {
                void new Promise<void>((resolve) => (admitLate = resolve)).then(
                  () => server.admit(id, content),
                );
                throw new Error("connection lost");
              }
              server.admit(id, content);
              return { id };
            },
          },
        });
        await client.ready;
        return client;
      };
      const owner = await open();
      await owner.setDraft("Original");
      await owner.send();
      await flush();
      const id = owner.getSnapshot().pending[0]!.id;
      owner.dispose();
      const next = await open();
      await next.refresh();
      await flush();
      expect(server.held.size).toBe(0);
      await next.withdraw(id);
      expect(next.getSnapshot().problem).toEqual(sendingRefusal);
      await next.setDraft("Correction must survive");
      admitLate();
      await flush();
      step = "accept";
      await next.send();
      await flush();
      expect([...server.held.values()]).toEqual([
        "Original",
        "Correction must survive",
      ]);
      const reload = await open();
      expect(reload.getSnapshot().pending).toEqual([]);
      for (const client of [next, reload]) client.dispose();
    });
    it(`without Web Locks a live sender elsewhere cannot cost a correction (${mode})`, async () => {
      // Nothing infers that another runtime's attempt is dead: the row stays
      // locked and is only ever resent under its own id.
      const store = backend();
      const server = host();
      let releaseA!: () => void;
      let stage: "refuse" | "hold" | "accept" = "refuse";
      const navigator = globalThis.navigator;
      const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "navigator",
      );
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { ...navigator, locks: undefined },
      });
      try {
        const open = async () => {
          const base = config();
          const client = (await runtime()).createWaypointClient({
            ...base,
            storage: store.port({ atomic: true }).port,
            transport: {
              ...base.transport,
              read: server.read,
              send: async (reply) => {
                if (reply.kind !== "message") return { id: "other" };
                if (stage === "refuse") throw { code: "retryable", id: "send" };
                if (stage === "hold") {
                  await new Promise<void>((resolve) => (releaseA = resolve));
                  server.admit(reply.clientMessageId, reply.content);
                  throw new Error("connection lost");
                }
                server.admit(reply.clientMessageId, reply.content);
                return { id: reply.clientReplyId };
              },
            },
          });
          await client.ready;
          return client;
        };
        const a = await open();
        await a.setDraft("Original");
        await a.send();
        await flush();
        const id = a.getSnapshot().pending[0]!.id;
        stage = "hold";
        const sending = a.retry(id);
        await flush();
        expect(a.getSnapshot().sending).toBe(true);
        const b = await open();
        await b.refresh();
        await flush();
        await b.withdraw(id);
        expect(b.getSnapshot().problem).toEqual(sendingRefusal);
        await b.setDraft("Correction must survive");
        stage = "accept";
        releaseA();
        await sending;
        await b.retry(id);
        await b.send();
        await flush();
        expect([...server.held]).toEqual([
          [id, "Original"],
          [expect.any(String), "Correction must survive"],
        ]);
        for (const client of [a, b]) client.dispose();
      } finally {
        if (descriptor)
          Object.defineProperty(globalThis, "navigator", descriptor);
      }
    });
    for (const variant of ["held commit", "failed commit"] as const)
      it(`a withdrawal shows nothing until it commits, while another runtime sends (${variant}, ${mode})`, async () => {
        const store = backend();
        const server = host();
        let accept = false;
        let release: (() => void) | undefined;
        let holdSend = false;
        let down = false;
        let holdRead: Promise<void> | undefined;
        const open = async (gated: boolean) => {
          const base = config();
          const { port } = store.port({ atomic: mode === "atomic port" });
          const client = (await runtime()).createWaypointClient({
            ...base,
            storage: gated
              ? {
                  ...port,
                  get: async (key) => {
                    if (down) throw new Error("storage unavailable");
                    const held = holdRead;
                    holdRead = undefined;
                    if (held) await held;
                    return port.get(key);
                  },
                }
              : port,
            transport: {
              ...base.transport,
              read: server.read,
              send: async (reply) => {
                if (reply.kind !== "message") return { id: "other" };
                if (!accept) throw { code: "retryable", id: "send" };
                if (holdSend) {
                  holdSend = false;
                  await new Promise<void>((resolve) => (release = resolve));
                }
                server.admit(reply.clientMessageId, reply.content);
                return { id: reply.clientMessageId };
              },
            },
          });
          await client.ready;
          return client;
        };
        const a = await open(false);
        await a.setDraft("Original queued message");
        await a.send();
        await flush();
        const b = await open(true);
        await flush();
        const id = a.getSnapshot().pending[0]!.id;
        // The sender's retry is claimed and held before admission; the
        // other runtime still shows the earlier settled refusal.
        accept = true;
        holdSend = true;
        const retrying = a.retry(id);
        await flush();
        expect(release).toBeDefined();
        let resume!: () => void;
        if (variant === "held commit")
          holdRead = new Promise<void>((resolve) => (resume = resolve));
        else down = true;
        const withdrawing = b.withdraw(id);
        await flush();
        // Nothing visible changes before the commit.
        expect(b.getSnapshot().draft).toBe("");
        expect(b.getSnapshot().pending.map((row) => row.id)).toEqual([id]);
        if (variant === "held commit") {
          expect(b.getSnapshot().withdrawing).toEqual([id]);
          await b.send();
          resume();
        }
        await withdrawing;
        down = false;
        await flush();
        expect(b.getSnapshot().withdrawing).toEqual([]);
        expect(b.getSnapshot().draft).toBe("");
        expect(b.getSnapshot().pending.map((row) => row.id)).toEqual([id]);
        if (variant === "held commit")
          expect(b.getSnapshot().problem).toEqual(sendingRefusal);
        await b.send();
        await flush();
        release!();
        await retrying;
        await flush();
        expect([...server.held]).toEqual([[id, "Original queued message"]]);
        for (const client of [a, b]) client.dispose();
      });
    for (const action of ["typing", "sending"] as const)
      it(`${action} while a withdrawal commits keeps the withdrawn content (${mode})`, async () => {
        const store = backend();
        const sent: string[] = [];
        let accept = false;
        let holdRead: Promise<void> | undefined;
        const open = async () => {
          const base = config();
          const { port } = store.port({ atomic: mode === "atomic port" });
          const client = (await runtime()).createWaypointClient({
            ...base,
            storage: {
              ...port,
              get: async (key) => {
                const held = holdRead;
                holdRead = undefined;
                if (held) await held;
                return port.get(key);
              },
            },
            transport: {
              ...base.transport,
              send: async (reply) => {
                if (!accept) throw { code: "retryable", id: "send" };
                if (reply.kind === "message") sent.push(reply.content);
                return { id: reply.clientReplyId };
              },
            },
          });
          await client.ready;
          return client;
        };
        const client = await open();
        await client.setDraft("Queued message");
        await client.send();
        await flush();
        const id = client.getSnapshot().pending[0]!.id;
        let resume!: () => void;
        holdRead = new Promise<void>((resolve) => (resume = resolve));
        const withdrawing = client.withdraw(id);
        await flush();
        const typing = client.setDraft("Typed meanwhile");
        await flush();
        if (action === "sending") {
          accept = true;
          const sending = client.send();
          await flush();
          resume();
          await sending;
        } else resume();
        await typing;
        await withdrawing;
        await flush();
        const reload = await open();
        for (const view of [client, reload]) {
          // The withdrawn content survives somewhere the user can reach.
          const snapshot = view.getSnapshot();
          expect([
            snapshot.draft,
            ...(snapshot.restored ?? []).map((r) => r.content),
          ]).toContain("Queued message");
          expect(snapshot.restored.map((r) => r.content)).toEqual([
            "Queued message",
          ]);
          expect(view.getSnapshot().pending).toEqual([]);
          expect(view.getSnapshot().draft).toBe(
            action === "sending" ? "" : "Typed meanwhile",
          );
        }
        expect(sent).toEqual(action === "sending" ? ["Typed meanwhile"] : []);
        for (const c of [client, reload]) c.dispose();
      });
    it(`restored items are shared, edited into the draft only on request and removed only by discard (${mode})`, async () => {
      const store = backend();
      const open = async () => {
        const base = config();
        const client = (await runtime()).createWaypointClient({
          ...base,
          storage: store.port({ atomic: mode === "atomic port" }).port,
          transport: failingSend(base),
        });
        await client.ready;
        return client;
      };
      const a = await open();
      await a.setDraft("Queued message");
      await a.send();
      await flush();
      const b = await open();
      await flush();
      const id = a.getSnapshot().pending[0]!.id;
      // Both runtimes withdraw the row; only one restored item results.
      await Promise.all([a.withdraw(id), b.withdraw(id)]);
      await b.refresh();
      await flush();
      const items = b.getSnapshot().restored;
      expect(items.map((r) => r.content)).toEqual(["Queued message"]);
      await b.setDraft("Other text");
      await b.editRestored(items[0]!.id);
      expect(b.getSnapshot().draft).toBe("Other text\n\nQueued message");
      // Draft changes from either runtime leave the item alone.
      await a.setDraft("");
      await flush();
      const reload = await open();
      expect(reload.getSnapshot().restored.map((r) => r.content)).toEqual([
        "Queued message",
      ]);
      await reload.discardRestored(items[0]!.id);
      const after = await open();
      expect(after.getSnapshot().restored).toEqual([]);
      for (const client of [a, b, reload, after]) client.dispose();
    });
    it(`a claim that cannot be committed sends nothing (${mode})`, async () => {
      const store = backend();
      const sent: string[] = [];
      let accept = false;
      let down = false;
      const open = async () => {
        const base = config();
        const { port } = store.port({ atomic: mode === "atomic port" });
        const fail = () => {
          if (down) throw new Error("storage unavailable");
        };
        const client = (await runtime()).createWaypointClient({
          ...base,
          storage: {
            get: async (key) => (fail(), port.get(key)),
            set: async (key, value) => (fail(), port.set(key, value)),
            remove: port.remove,
            ...(port.compareAndSet
              ? {
                  compareAndSet: async (key, expected, value) => (
                    fail(),
                    port.compareAndSet!(key, expected, value)
                  ),
                }
              : {}),
          },
          transport: {
            ...base.transport,
            send: async (reply) => {
              if (!accept) throw { code: "retryable", id: "send" };
              if (reply.kind === "message") sent.push(reply.content);
              return { id: reply.clientReplyId };
            },
          },
        });
        await client.ready;
        return client;
      };
      const stale = await open();
      await stale.setDraft("Original");
      await stale.send();
      await flush();
      const current = await open();
      await flush();
      const id = current.getSnapshot().pending[0]!.id;
      await current.withdraw(id);
      await current.setDraft("Newest unsent correction");
      await current.send();
      await flush();
      expect(stale.getSnapshot().pending[0]!.content).toBe("Original");
      down = true;
      accept = true;
      await stale.retry(id);
      await flush();
      expect(sent).toEqual([]);
      down = false;
      await stale.refresh();
      await flush();
      const reload = await open();
      expect(reload.getSnapshot().pending.map((r) => r.content)).toEqual([
        "Newest unsent correction",
      ]);
      expect(sent).toEqual([]);
      for (const client of [stale, current, reload]) client.dispose();
    });
    for (const clocks of ["frozen", "skewed ahead", "skewed behind"] as const)
      it(`the draft follows commit order whatever the clocks say (${clocks}, ${mode})`, async () => {
        const store = backend();
        const a = await runtime();
        const b = await runtime();
        // The first runtime's clock reads the same, far ahead or far behind.
        const offset =
          clocks === "frozen" ? 0 : clocks === "skewed ahead" ? 3.6e6 : -3.6e6;
        const frozen = clocks === "frozen";
        const clockFor = (shift: number) => {
          const base = baseConfig();
          return {
            ...base,
            platform: {
              ...base.platform,
              clock: {
                ...base.platform.clock,
                now: frozen ? () => 100 : () => Date.now() + shift,
              },
            },
          };
        };
        const open = (module: ClientModule, shift: number) =>
          module.createWaypointClient({
            ...clockFor(shift),
            storage: store.port({ atomic: mode === "atomic port" }).port,
          });
        const first = open(a, offset);
        const second = open(b, 0);
        await first.ready;
        await second.ready;
        await first.setDraft("First edit");
        await flush();
        await second.setDraft("Later edit");
        await flush();
        await first.setDraft("Latest edit");
        await flush();
        const reload = open(b, 0);
        await reload.ready;
        expect(reload.getSnapshot().draft).toBe("Latest edit");
        await second.setDraft("Final edit");
        await flush();
        const again = open(b, 0);
        await again.ready;
        expect(again.getSnapshot().draft).toBe("Final edit");
        for (const client of [first, second, reload, again]) client.dispose();
      });
  }
});
