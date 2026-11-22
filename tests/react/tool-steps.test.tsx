// @vitest-environment jsdom
// The host's reads show as one line in plain words, which the user can
// expand to every step.
import { it, expect, afterEach, beforeAll, vi } from "vitest";
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
import type {
  ManifestEntry,
  ToolCall,
  Message,
} from "../../src/protocol/generated";
import samples from "../protocol/samples.json";
import { config } from "../support/client";
afterEach(cleanup);
beforeAll(async () => {
  await import("../../src/react/reply-controls");
});

async function chat(locale?: string, initial?: Message["steps"]) {
  const base = config();
  const protocol = initial ? "1.2" : "1.0";
  let saved = initial;
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
      negotiate: async () => ({ protocol, capabilities: [] }),
      read: async () => ({
        protocol,
        id: "conversation-a",
        title: "Chat",
        messages: [
          { id: "u", role: "user", content: "Hi", blocks: [], createdAt: 0 },
          ...(initial
            ? [
                {
                  id: "a",
                  role: "assistant" as const,
                  content: "Reply",
                  blocks: [],
                  createdAt: 1,
                  status: "writing" as const,
                  steps: saved,
                },
              ]
            : []),
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
        protocol,
        sequence: ++sequence,
        call: { ...(samples.ToolCall as ToolCall), ...value },
      },
    });
  return {
    client,
    call,
    finish: () => pending.shift()?.(),
    host: (step: NonNullable<Message["steps"]>[number]) => {
      const at = saved?.findIndex((entry) => entry.id === step.id) ?? -1;
      saved =
        at < 0
          ? [...(saved ?? []), step]
          : saved!.map((entry, index) => (index === at ? step : entry));
      listener({
        type: "frame",
        frame: {
          type: "step",
          protocol,
          sequence: ++sequence,
          messageId: "a",
          step,
        },
      });
    },
  };
}
const steps = () => document.querySelector<HTMLElement>("[data-tool-steps]");

it.each([1, 2, 5, 12])(
  "shows %s read-restored host steps using the existing disclosure",
  async (count) => {
    const initial = Array.from({ length: count }, (_, at) => ({
      id: `host-${at}`,
      label: `Work ${at}`,
      status: "done" as const,
    }));
    const { client, host } = await chat(undefined, initial);
    await waitFor(() =>
      expect(steps()?.textContent).toContain(`Work ${count - 1}`),
    );
    host({ id: "host-0", label: "<b>Updated</b>", status: "failed" });
    if (count > 1) {
      const toggle = within(steps()!).getByRole("button", {
        name: `Show all ${count} steps`,
      });
      await userEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      await waitFor(() =>
        expect(within(steps()!).getAllByRole("listitem")).toHaveLength(count),
      );
      expect(within(steps()!).getAllByRole("listitem")[0]!.textContent).toBe(
        "<b>Updated</b>Failed",
      );
    } else
      await waitFor(() => expect(steps()?.textContent).toBe("<b>Updated</b>"));
    expect(steps()?.querySelector("b")).toBeNull();
    client.dispose();
  },
);

it.each([
  [undefined, "Looking this up…"],
  ["zh-CN", "正在查询…"],
] as const)(
  "uses the localized fallback for an unlabeled host step (%s)",
  async (locale, label) => {
    const { client } = await chat(locale, [{ id: "s", status: "running" }]);
    await waitFor(() => expect(steps()?.textContent).toContain(label));
    client.dispose();
  },
);

it("shows mixed host and client steps without duplicate ids", async () => {
  const { client, call, host, finish } = await chat(undefined, []);
  call({ id: "same", label: "Client work" });
  await waitFor(() => expect(steps()?.textContent).toContain("Client work"));
  host({ id: "same", label: "Host work", status: "done" });
  await vi.waitFor(() => finish());
  host({ id: "other", label: "More work", status: "running" });
  const button = await screen.findByRole("button", {
    name: "Show all 2 steps",
  });
  await userEvent.click(button);
  await waitFor(() =>
    expect(
      within(steps()!)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Host workDone", "More workRunning"]),
  );
  client.dispose();
});

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
