import { it, expect } from "vitest";
import { createWaypointClient } from "../../src/core/client";
import {
  createScriptedTransport,
  createTestPlatform,
} from "../../src/testing/transport";
it("a scripted send without an answer starts inside the reply grace period", async () => {
  const fixture = createScriptedTransport();
  const client = createWaypointClient({
    accountId: "fixture",
    conversationId: "conversation-a",
    platform: createTestPlatform(),
    transport: fixture.transport,
  });
  await client.ready;
  try {
    await client.setDraft("Hello");
    await client.send();
    expect(client.getSnapshot().replyState).toBe("writing");
  } finally {
    client.dispose();
  }
});
