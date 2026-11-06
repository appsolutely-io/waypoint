// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import {
  createScriptedTransport,
  createTestPlatform,
  renderWithWaypoint,
} from "../../src/testing/index";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
afterEach(cleanup);
it("scripted blocks reach real registry replacements through renderWithWaypoint", async () => {
  const fixture = createScriptedTransport();
  fixture.enqueue({
    blocks: [
      {
        type: "notice",
        id: "notice-a",
        fallback: "Fallback",
        body: { text: "Fixture notice" },
      },
    ],
  });
  const client = createWaypointClient({
    accountId: "test",
    conversationId: "conversation-a",
    platform: createTestPlatform(),
    transport: fixture.transport,
  });
  await client.ready;
  await client.setDraft("Send");
  await client.send();
  renderWithWaypoint(<WaypointChat />, {
    client,
    skin: {
      widgets: [
        {
          type: "notice",
          render: ({ block }) => <p>Replacement {block.id}</p>,
        },
      ],
    },
  });
  expect(screen.getByText("Replacement notice-a")).toBeTruthy();
  client.dispose();
});
