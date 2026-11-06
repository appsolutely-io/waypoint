import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const format = process.argv[2];
const entry = process.argv[3];
assert.ok(
  entry,
  "usage: consumer-probe.mjs <esm|cjs> <package name or entry path>",
);
const require = createRequire(import.meta.url);
const core =
  format === "cjs"
    ? require(entry)
    : await import(entry.startsWith("/") ? pathToFileURL(entry).href : entry);
assert.deepEqual(core.SUPPORTED_PROTOCOLS, ["1.1", "1.0"]);
const flow = await core.parseFlow(
  '---\nformat: "1.0"\nid: example/prompt\ntitle: Example\nkind: prompt\nparameters: []\ntags: []\n---\nHello',
  [],
);
assert.equal(flow.body, "Hello");
let serial = 0;
const session = await core.loadFormSession({
  fields: [{ name: "title", label: "Title", tier: "low", value: "Before" }],
  ids: () => `id-${++serial}`,
});
session.edit("title", "After");
assert.equal(session.getSnapshot().fields.title.value, "After");
session.dispose();
await core.loadReadHandlers();
assert.deepEqual(
  await core.handleToolRead(
    { id: "read", method: "POST", operation: "missing", path: "/items" },
    [],
    async () => {
      throw new Error("Refused read dispatched");
    },
  ),
  { kind: "refused", reason: "invalid-read" },
);
const frame = {
  protocol: "1.0",
  sequence: 1,
  type: "message.delta",
  messageId: "m",
  delta: "Hello",
};
const frames = [];
for await (const value of core.decodeFrames(
  (async function* () {
    yield JSON.stringify(frame) + "\n";
  })(),
  "ndjson",
))
  frames.push(value);
assert.deepEqual(frames, [frame]);
const client = core.createWaypointClient({
  accountId: "example-account",
  conversationId: "before",
  platform: {
    clock: { now: Date.now, setTimeout, clearTimeout },
    online: () => true,
    visibility: () => true,
    ids: () => `id-${++serial}`,
  },
  storage: core.createMemoryStorage(),
  transport: {
    negotiate: async () => ({ protocol: "1.0", capabilities: [] }),
    read: async (id) => ({
      protocol: "1.0",
      id,
      title: "Example",
      messages: [],
    }),
    send: async () => ({ id: "sent" }),
    subscribe: () => () => {},
  },
  flowSource: {
    list: async () => [],
    run: async () => ({ conversationId: "after" }),
  },
});
try {
  await client.ready;
  await client.setDraft("Saved");
  assert.equal(client.getSnapshot().draft, "Saved");
  assert.equal(await client.runFlow("example/prompt", {}), "after");
  assert.equal(client.getSnapshot().conversationId, "after");
} finally {
  client.dispose();
}
process.stdout.write(`${format}: lazy package operations passed\n`);
