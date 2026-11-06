import { describe, expect, it, vi } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import type { Flow } from "../../src/protocol/generated";
import { config } from "../support/client";

const document: Flow = {
  format: "1.0",
  id: "flow-a",
  title: "Rename",
  kind: "prompt",
  parameters: [
    { name: "title", type: "string", required: true, label: "Title" },
  ],
  tags: [],
  body: "Rename to {{title}}",
};
function setup(options: { load?: boolean } = {}) {
  const load = vi.fn(async () => structuredClone(document));
  const run = vi.fn(
    async (_id: string, _values: Record<string, unknown>, _doc?: Flow) => ({
      conversationId: "conversation-a",
    }),
  );
  const client = createWaypointClient({
    ...config(),
    flowSource: {
      list: () => [{ id: "flow-a", title: "Rename" }],
      setFavourite: () => {},
      run,
      ...(options.load === false ? {} : { load }),
    },
  });
  return { client, load, run };
}

describe("preparing a flow", () => {
  it("CK-FL1 loads and validates the document once; the run uses it", async () => {
    const h = setup();
    await h.client.ready;
    expect(h.client.canPrepareFlow()).toBe(true);
    const prepared = await h.client.prepareFlow("flow-a");
    expect(prepared?.parameters.map((p) => p.name)).toEqual(["title"]);
    await h.client.runFlow("flow-a", { title: "New" });
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0]![1]).toEqual({ title: "New" });
    expect(h.run.mock.calls[0]![2]?.id).toBe("flow-a");
    h.client.dispose();
  });

  it("CK-FL2 a source without load prepares nothing", async () => {
    const h = setup({ load: false });
    await h.client.ready;
    expect(h.client.canPrepareFlow()).toBe(false);
    expect(await h.client.prepareFlow("flow-a")).toBeUndefined();
    h.client.dispose();
  });

  it("CK-FL2b a prepared document is forgotten on request, and a later run loads again", async () => {
    const h = setup();
    await h.client.ready;
    await h.client.prepareFlow("flow-a");
    await h.client.prepareFlow();
    await h.client.runFlow("flow-a", { title: "New" });
    expect(h.load).toHaveBeenCalledTimes(2);
    h.client.dispose();
  });

  it("CK-FL2b a failed run keeps the document for its Retry", async () => {
    const h = setup();
    await h.client.ready;
    await h.client.prepareFlow("flow-a");
    h.run.mockRejectedValueOnce(new Error("busy"));
    await expect(
      h.client.runFlow("flow-a", { title: "New" }),
    ).rejects.toThrow();
    await h.client.runFlow("flow-a", { title: "New" });
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[1]![2]).toEqual(h.run.mock.calls[0]![2]);
    h.client.dispose();
  });

  it("CK-FL2b a load still on its way when the document is forgotten keeps nothing", async () => {
    const h = setup();
    await h.client.ready;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    h.load.mockImplementationOnce(async () => {
      await held;
      return structuredClone(document);
    });
    const preparing = h.client.prepareFlow("flow-a");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await h.client.prepareFlow();
    release();
    await preparing.catch(() => {});
    await h.client.runFlow("flow-a", { title: "New" });
    expect(h.load).toHaveBeenCalledTimes(2);
    h.client.dispose();
  });

  it("CK-FL2b a run of one flow never forgets another flow's document", async () => {
    const h = setup();
    await h.client.ready;
    await h.client.prepareFlow("flow-a");
    let finish!: () => void;
    const finishing = new Promise<void>((resolve) => (finish = resolve));
    // A run that opens nothing: no navigation forgets the documents.
    h.run.mockImplementationOnce(async () => {
      await finishing;
      return undefined as never;
    });
    const runA = h.client.runFlow("flow-a", { title: "A" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await h.client.prepareFlow("flow-b");
    finish();
    await runA;
    await h.client.runFlow("flow-b", { title: "B" });
    expect(h.load.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "flow-a",
      "flow-b",
    ]);
    h.client.dispose();
  });

  it("CK-FL1c a document prepared across a conversation switch is refused, never nothing", async () => {
    const h = setup();
    await h.client.ready;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    h.load.mockImplementationOnce(async () => {
      await held;
      return structuredClone(document);
    });
    const preparing = h.client.prepareFlow("flow-a");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await h.client.switchConversation("conversation-b");
    release();
    await expect(preparing).rejects.toMatchObject({
      code: "refused",
      id: "flow-prepare",
    });
    h.client.dispose();
  });
});
