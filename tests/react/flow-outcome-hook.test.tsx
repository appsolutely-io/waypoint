// @vitest-environment jsdom
// The hook gives the same outcome as the client: nothing for a run whose
// destination failed to load, the conversation for one that loaded.
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { WaypointProvider, useFlows } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import type { Conversation } from "../../src/protocol/generated";
import { config } from "../support/client";

async function run(fail: boolean) {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async (id) => {
        if (id === "conversation-b" && fail) throw new Error("offline");
        return { protocol: "1.0", id, title: id, messages: [] } as Conversation;
      },
    },
    flowSource: {
      list: () => [],
      setFavourite: () => {},
      run: () => ({ conversationId: "conversation-b" }),
    },
  });
  await client.ready;
  const { result } = renderHook(() => useFlows(), {
    wrapper: ({ children }: { children?: ReactNode }) => (
      <WaypointProvider client={client}>{children}</WaypointProvider>
    ),
  });
  const outcome = await result.current.run("flow-a", {});
  client.dispose();
  return outcome;
}
describe("CK-F2-outcome useFlows().run", () => {
  it("resolves with nothing when the destination read failed", async () => {
    expect(await run(true)).toBeUndefined();
  });
  it("resolves with the conversation when it loaded", async () => {
    expect(await run(false)).toBe("conversation-b");
  });
});
