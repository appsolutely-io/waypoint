// @vitest-environment jsdom
// The host's reads show as one line in plain words, which the user can
// expand to every step.
import { it, expect, afterEach, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaypointChat } from "../../src/react/index";
import {
  createWaypointClient,
  type ClientConfig,
  type TransportEvent,
} from "../../src/core/client";
import type { ManifestEntry, ToolCall } from "../../src/protocol/generated";
import samples from "../protocol/samples.json";
import { config } from "../support/client";
afterEach(cleanup);

async function chat(locale?: string) {
  const base = config();
  let listener!: (event: TransportEvent) => void;
  const pending: (() => void)[] = [];
  const client = createWaypointClient({
    ...base,
    reads: {
      manifest: [samples.ManifestEntry as ManifestEntry],
      request: () =>
        new Promise((resolve) => pending.push(() => resolve({ title: "A" }))),
    },
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
        ],
      }),
      subscribe: (_id, fn) => {
        listener = fn;
        return () => {};
      },
    },
  } as ClientConfig);
  await client.ready;
  render(<WaypointChat client={client} locale={locale} />);
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
  return { client, call, finish: () => pending.shift()?.() };
}
const steps = () => document.querySelector<HTMLElement>("[data-tool-steps]");

it("shows the latest step on one line and expands to all of them", async () => {
  const { client, call, finish } = await chat();
  call({ id: "one", label: "Reading 3 orders…" });
  await waitFor(() =>
    expect(steps()?.textContent).toContain("Reading 3 orders…"),
  );
  await vi.waitFor(() => finish());
  call({ id: "two", label: "Checking stock…" });
  await waitFor(() =>
    expect(within(steps()!).getByText("Checking stock…")).toBeTruthy(),
  );
  expect(within(steps()!).queryByText("Reading 3 orders…")).toBeNull();
  const toggle = within(steps()!).getByRole("button", {
    name: "Show all 2 steps",
  });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const items = within(steps()!).getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "Reading 3 orders…Done",
    "Checking stock…Running",
  ]);
  client.dispose();
});

it("names a step without a label in general words, in Chinese too", async () => {
  const { client, call } = await chat("zh-CN");
  call({ id: "one" });
  await waitFor(() => expect(steps()?.textContent).toContain("正在查询…"));
  client.dispose();
});

it("is not shown before any step", async () => {
  const { client } = await chat();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(steps()).toBeNull();
  expect(screen.queryByText("Looking this up…")).toBeNull();
  client.dispose();
});
