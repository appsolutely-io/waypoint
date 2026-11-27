// A failed load of the lazy upload chunk must not eat the message's files.
import { it, expect, vi } from "vitest";
vi.mock("../../src/core/attachment-upload", () => {
  throw new Error("The upload chunk could not be loaded.");
});
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";

it("reports nothing queued when the upload chunk cannot load", async () => {
  const client = createWaypointClient({
    ...config(),
    attachments: { upload: async () => ({ id: "file-1" }) },
  });
  await client.ready;
  await client.setDraft("Here is the report");
  expect(
    await client.send([
      {
        name: "report.txt",
        mediaType: "text/plain",
        data: new TextEncoder().encode("hello"),
      },
    ]),
  ).toBe(false);
  expect(client.getSnapshot().pending).toHaveLength(0);
  expect(client.getSnapshot().problem?.id).toBe("before-send");
  client.dispose();
});
