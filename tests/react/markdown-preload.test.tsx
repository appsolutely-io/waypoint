// @vitest-environment jsdom
// The Markdown chunk is asked for once the chat mounts, while the
// conversation is still being read, so the first reply's text does not
// wait for it after the read.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";

const loaded = vi.hoisted(() => ({ markdown: false }));
vi.mock("../../src/react/markdown", async (original) => {
  loaded.markdown = true;
  return original();
});
afterEach(cleanup);

it("asks for the Markdown chunk before any message is shown", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    // The read never answers: no message body ever mounts.
    transport: { ...base.transport, read: () => new Promise(() => {}) },
  });
  render(<WaypointChat client={client} />);
  await waitFor(() => expect(loaded.markdown).toBe(true));
  expect(document.querySelector("article")).toBeNull();
  client.dispose();
});
