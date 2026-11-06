// What `runFlow()` resolves with: the conversation its run opened, only
// once that conversation's authoritative read has loaded and it is still
// shown; nothing for a failed, retired or superseded run.
import { describe, expect, it } from "vitest";
import {
  ConversationReadError,
  createWaypointClient,
} from "../../src/core/client";
import type { Conversation } from "../../src/protocol/generated";
import { config } from "../support/client";

const conversation = (id: string): Conversation =>
  ({ protocol: "1.0", id, title: id, messages: [] }) as Conversation;
function client(
  read: (id: string) => Promise<Conversation>,
  hold?: Promise<void>,
) {
  const base = config();
  return createWaypointClient({
    ...base,
    transport: { ...base.transport, read },
    flowSource: {
      list: () => [{ id: "flow-a", title: "Run" }],
      setFavourite: () => {},
      run: async () => {
        await hold;
        return { conversationId: "conversation-b" };
      },
    },
  });
}

describe("CK-F2-outcome runFlow's result", () => {
  it("the loaded destination", async () => {
    const c = client(async (id) => conversation(id));
    await c.ready;
    expect(await c.runFlow("flow-a", {})).toBe("conversation-b");
    c.dispose();
  });
  it.each([
    ["a 404", () => new ConversationReadError("conversation-b", 404)],
    ["a 410", () => new ConversationReadError("conversation-b", 410)],
    ["a transient failure", () => new Error("offline")],
    [
      "an unavailable host",
      () => new ConversationReadError("conversation-b", 503),
    ],
  ])("nothing when the destination read ends in %s", async (_, failure) => {
    const c = client(async (id) => {
      if (id === "conversation-b") throw failure();
      return conversation(id);
    });
    await c.ready;
    expect(await c.runFlow("flow-a", {})).toBeUndefined();
    expect(c.getSnapshot().conversation?.id).not.toBe("conversation-b");
    c.dispose();
  });
  it("nothing when the host navigated before the run's result", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const c = client(async (id) => conversation(id), hold);
    await c.ready;
    const run = c.runFlow("flow-a", {});
    await c.switchConversation("conversation-c");
    release();
    expect(await run).toBeUndefined();
    c.dispose();
  });
  it("nothing for a run superseded by a newer one", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const c = client(async (id) => conversation(id), hold);
    await c.ready;
    const first = c.runFlow("flow-a", {});
    const second = c.runFlow("flow-a", {});
    release();
    expect(await first).toBeUndefined();
    expect(await second).toBe("conversation-b");
    c.dispose();
  });
});
