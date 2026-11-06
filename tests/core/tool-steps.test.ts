// The reads the host asks for while it writes a reply are shown as steps,
// named in the host's words, until the user's next message.
import { it, expect, vi } from "vitest";
import {
  createWaypointClient,
  type ClientConfig,
  type TransportEvent,
} from "../../src/core/client";
import type { ManifestEntry, ToolCall } from "../../src/protocol/generated";
import { config } from "../support/client";
import samples from "../protocol/samples.json";

async function setup(request: (call: ToolCall) => Promise<unknown>) {
  const base = config();
  let listener!: (event: TransportEvent) => void;
  const client = createWaypointClient({
    ...base,
    reads: { manifest: [samples.ManifestEntry as ManifestEntry], request },
    transport: {
      ...base.transport,
      subscribe: (_id, fn) => {
        listener = fn;
        return () => {};
      },
    },
  } as ClientConfig);
  await client.ready;
  let sequence = 0;
  const call = (value: Partial<ToolCall>) =>
    listener({
      type: "frame",
      frame: {
        type: "tool.call",
        protocol: "1.0",
        sequence: ++sequence,
        call: { ...(samples.ToolCall as ToolCall), ...value },
      },
    });
  return { client, call };
}

it("names each read as a step that runs, then is done", async () => {
  let release = () => {};
  const { client, call } = await setup(
    () => new Promise((resolve) => (release = () => resolve({ title: "A" }))),
  );
  expect(client.getSnapshot().toolSteps).toEqual([]);
  call({ id: "one", label: "Reading 3 orders…" });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps).toEqual([
      { id: "one", label: "Reading 3 orders…", status: "running" },
    ]),
  );
  release();
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps[0]?.status).toBe("done"),
  );
  client.dispose();
});

it("marks a read that failed, and keeps a step without a label", async () => {
  const { client, call } = await setup(async () => {
    throw new Error("down");
  });
  call({ id: "two" });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps).toEqual([
      { id: "two", status: "failed" },
    ]),
  );
  client.dispose();
});

it("forgets the steps when the user sends the next message", async () => {
  const { client, call } = await setup(async () => ({ title: "A" }));
  call({ id: "three", label: "Reading" });
  await vi.waitFor(() =>
    expect(client.getSnapshot().toolSteps[0]?.status).toBe("done"),
  );
  await client.setDraft("Next");
  await client.send();
  expect(client.getSnapshot().toolSteps).toEqual([]);
  client.dispose();
});
