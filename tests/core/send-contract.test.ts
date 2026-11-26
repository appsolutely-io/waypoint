import { it, expect } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import { config, flush } from "../support/client";

it("a send resolves while its row is queued, and the row settles after", async () => {
  const base = config();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async () => {
        await held;
        throw { code: "refused" };
      },
    },
  });
  await client.ready;
  await client.setDraft("Queued");
  expect(await client.send()).toBe(true);
  // The row is queued and its delivery is still open.
  expect(client.getSnapshot().sending).toBe(true);
  expect(client.getSnapshot().pending.map((row) => row.content)).toEqual([
    "Queued",
  ]);
  expect(client.getSnapshot().pending.map((row) => row.failure)).toEqual([
    null,
  ]);
  release();
  await flush();
  // The row settles after the send resolved.
  expect(client.getSnapshot().sending).toBe(false);
  expect(client.getSnapshot().pending.map((row) => row.failure?.code)).toEqual([
    "refused",
  ]);
  client.dispose();
});
