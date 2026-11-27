// @vitest-environment jsdom
// A problem is said in plain words; its code and reference sit behind a
// disclosure, outside the alert, for whoever needs them.
import { it, expect, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import {
  createMemoryStorage,
  createWaypointClient,
} from "../../src/core/client";
import { config, flush } from "../support/client";
afterEach(cleanup);

for (const [locale, summary, code, reference] of [
  [undefined, "Details", "Error code: refused", "Reference: send-42"],
  ["zh-CN", "详情", "错误代码：refused", "参考编号：send-42"],
] as const)
  it(`a problem's code and reference are behind a disclosure (${locale ?? "en"})`, async () => {
    const client = createWaypointClient(config());
    await client.ready;
    render(<WaypointChat client={client} locale={locale} />);
    client.report({ code: "refused", id: "send-42" });
    const toggle = await screen.findByText(summary);
    expect(toggle.tagName).toBe("SUMMARY");
    const disclosure = toggle.closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(disclosure.textContent).toContain(code);
    expect(disclosure.textContent).toContain(reference);
    // Said once: the alert keeps the plain words only.
    const alert = document.querySelector('main [role="alert"]')!;
    expect(alert.contains(disclosure)).toBe(false);
    expect(alert.textContent).not.toContain("send-42");
    client.dispose();
  });

it("no disclosure without a problem", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  render(<WaypointChat client={client} />);
  await waitFor(() => expect(document.querySelector("main")).not.toBeNull());
  expect(document.querySelector("[data-problem-details]")).toBeNull();
  client.dispose();
});

// A message that could not be sent has its problem with it, not below the
// composer: the problem is about that message.
for (const [locale, text, summary] of [
  [undefined, "Something went wrong for a moment. Try again.", "Details"],
  ["zh-CN", "刚才出了点问题，请重试。", "详情"],
] as const)
  it(`a message not sent has its problem and Details under it (${locale ?? "en"})`, async () => {
    const base = config();
    const client = createWaypointClient({
      ...base,
      transport: {
        ...base.transport,
        send: async () => {
          throw { code: "retryable" };
        },
      },
    });
    await client.ready;
    render(<WaypointChat client={client} locale={locale} />);
    await client.setDraft("Hello");
    await client.send();
    const pending = await waitFor(() => {
      const element = document.querySelector('article[data-role="pending"]');
      expect(element).not.toBeNull();
      return element!;
    });
    const id = client.getSnapshot().pending[0]!.id;
    await waitFor(() =>
      expect(pending.querySelector('[role="alert"]')?.textContent).toBe(text),
    );
    const details = pending.querySelector("[data-problem-details]")!;
    expect(details.querySelector("summary")?.textContent).toBe(summary);
    expect(details.textContent).toContain(id);
    // Said once, there: the conversation's alert and its Details have none
    // of it, and the message's own Retry is the only one.
    expect(document.querySelectorAll("[data-problem-details]")).toHaveLength(1);
    const conversation = document.querySelector("[data-announcement]")!;
    expect(conversation.textContent).toBe("");
    expect(
      screen.getAllByRole("button", { name: locale ? "重试" : "Retry" }),
    ).toHaveLength(1);
    client.dispose();
  });

it("a problem not about a message stays with the conversation", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  render(<WaypointChat client={client} />);
  client.report({ code: "retryable", id: "conversation-read" });
  const conversation = await waitFor(() => {
    const element = document.querySelector("[data-announcement]")!;
    expect(element.textContent).not.toBe("");
    return element;
  });
  expect(conversation.closest("article")).toBeNull();
  expect(
    document.querySelector("[data-problem-details]")?.closest("article"),
  ).toBeNull();
  client.dispose();
});

it("a message not sent because the chat was replaced keeps the problem's Refresh", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async () => {
        throw { code: "replaced" };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await client.setDraft("Hello");
  await client.send();
  // The replacement settles after the send resolves; the alert reads it.
  await flush();
  const alert = await waitFor(() => {
    const element = document.querySelector(
      'article[data-role="pending"] [role="alert"]',
    );
    expect(element?.querySelector("button")).not.toBeNull();
    return element!;
  });
  expect(alert.querySelectorAll("button")).toHaveLength(1);
  expect(alert.querySelector("button")!.dataset.action).toBe("status");
  // The message's own Retry is the only Retry.
  expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  client.dispose();
});

// The Refresh a problem asks for is named with the problem's own words,
// which load with the chat, not with a plan's confirmation.
for (const [locale, name] of [
  [undefined, "Refresh"],
  ["zh-CN", "刷新"],
] as const)
  it(`a problem's Refresh is named without a plan (${locale ?? "en"})`, async () => {
    const client = createWaypointClient(config());
    await client.ready;
    render(<WaypointChat client={client} locale={locale} />);
    client.report({ code: "replaced", id: "conversation-read" });
    await waitFor(() =>
      expect(
        document.querySelector('[data-announcement] [data-action="status"]')
          ?.textContent,
      ).toBe(name),
    );
    client.dispose();
  });

const hostText = (problem: {
  code: string;
  host?: { code: string; qualifier?: string } | null;
}) => ({
  text: problem.host
    ? `${problem.host.code}:${problem.host.qualifier ?? "unknown"}`
    : problem.code,
});

for (const reverse of [false, true])
  it(`two refusals resolving out of order keep their own request details (reverse=${reverse})`, async () => {
    const base = config({ storage: createMemoryStorage(true) });
    const refusals: ((problem: unknown) => void)[] = [];
    const clientTransport = {
      ...base.transport,
      send: async () =>
        new Promise<never>((_resolve, reject) => {
          refusals.push(reject);
        }),
    };
    const client = createWaypointClient({
      ...base,
      transport: clientTransport,
    });
    await client.ready;
    render(<WaypointChat client={client} problemText={hostText} />);
    await client.setDraft("First");
    const first = client.send();
    await waitFor(() => expect(refusals).toHaveLength(1));
    const other = createWaypointClient({ ...base, transport: clientTransport });
    await other.ready;
    await other.setDraft("Second");
    const second = other.send();
    await waitFor(() => expect(refusals).toHaveLength(2));
    const order = reverse ? [0, 1] : [1, 0];
    const names = ["first", "second"];
    await act(async () => {
      refusals[order[0]!]!({
        code: "refused",
        id: "same-host-id",
        host: { code: names[order[0]!]!, qualifier: "temporary" },
      });
      await [first, second][order[0]!];
      await client.setDraft("");
    });
    const earlier = document.querySelector(
      'article[data-role="pending"] [role="alert"]',
    );
    expect(earlier?.textContent).toBe(`${names[order[0]!]}:temporary`);
    await act(async () => {
      refusals[order[1]!]!({
        code: "refused",
        id: "same-host-id",
        host: { code: names[order[1]!]!, qualifier: "temporary" },
      });
      await [first, second][order[1]!];
      await client.setDraft("");
    });
    expect(screen.getByText("first:temporary")).toBeTruthy();
    expect(screen.getByText("second:temporary")).toBeTruthy();
    expect(earlier?.isConnected).toBe(true);
    expect(document.querySelector("[data-announcement]")?.textContent).toBe("");
    other.dispose();
    client.dispose();
  });

it("a live send refused before any intermediate render announces once", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async () => {
        throw { code: "refused", host: { code: "availability" } };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} problemText={hostText} />);
  await act(async () => {
    await client.setDraft("Live");
    await client.send();
  });
  const row = document.querySelector('article[data-role="pending"]')!;
  expect(row.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(row.querySelector('[role="alert"]')?.textContent).toBe(
    "availability:unknown",
  );
  client.dispose();
});

it("restoring an outbox with several failed rows announces nothing", async () => {
  const { createMemoryStorage } = await import("../../src/core/client");
  const storage = createMemoryStorage(true);
  const base = config({ storage });
  let requests = 0;
  const transport = {
    ...base.transport,
    send: async () => {
      if (++requests === 3) throw new Error("Lost acknowledgement");
      throw { code: "refused", host: { code: "availability" } };
    },
  };
  const original = createWaypointClient({ ...base, transport });
  await original.ready;
  for (const content of ["First", "Second", "Third"]) {
    await original.setDraft(content);
    await original.send();
    // A send resolves once its row is queued and the delivery keeps the
    // sending state; the next send waits for the delivery to settle.
    await vi.waitFor(() => expect(original.getSnapshot().sending).toBe(false));
  }
  // The refusals settled with the sending state; the storage holds them.
  await flush();
  original.dispose();
  const client = createWaypointClient({ ...base, transport });
  const observed: Element[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof Element) {
          const alerts = [node, ...node.querySelectorAll('[role="alert"]')];
          for (const alert of alerts)
            if (
              alert.matches('[role="alert"]') &&
              alert.closest('article[data-role="pending"]')
            )
              observed.push(alert);
        }
  });
  observer.observe(document.body, { subtree: true, childList: true });
  render(<WaypointChat client={client} problemText={hostText} />);
  await act(async () => {
    await client.ready;
  });
  await waitFor(() =>
    expect(
      document.querySelectorAll('article[data-role="pending"]'),
    ).toHaveLength(3),
  );
  expect(screen.getAllByText("availability:unknown")).toHaveLength(2);
  expect(screen.getByText("in-doubt")).toBeTruthy();
  expect(
    document.querySelectorAll('article[data-role="pending"] [role="alert"]'),
  ).toHaveLength(0);
  expect(observed).toHaveLength(0);
  observer.disconnect();
  const row = client.getSnapshot().pending[0]!;
  await act(async () => client.report({ code: "retryable", id: row.id }));
  expect(
    document.querySelectorAll('article[data-role="pending"] [role="alert"]'),
  ).toHaveLength(1);
  client.dispose();
});

it("a refusal after a later send succeeded stays on its own request", async () => {
  const base = config({ storage: createMemoryStorage(true) });
  let reject!: (error: unknown) => void;
  const firstTransport = {
    ...base.transport,
    send: () =>
      new Promise<never>((_yes, no) => {
        reject = no;
      }),
  };
  const client = createWaypointClient({ ...base, transport: firstTransport });
  await client.ready;
  render(<WaypointChat client={client} problemText={hostText} />);
  await client.setDraft("First");
  const sending = client.send();
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  const other = createWaypointClient(base);
  await other.ready;
  await other.setDraft("Second");
  await other.send();
  // The acknowledged row leaves with its delivery; the outbox settles
  // after the send resolves.
  await flush();
  const acknowledged = other.getSnapshot().pending;
  expect(acknowledged.map((row) => row.content)).not.toContain("Second");
  await act(async () => {
    reject({
      code: "refused",
      id: "reused-host-id",
      host: { code: "availability", qualifier: "temporary" },
    });
    await sending;
  });
  expect(
    screen.getByText("availability:temporary").closest("article")?.textContent,
  ).toContain("First");
  expect(client.getSnapshot().pending.map((row) => row.content)).toEqual([
    "First",
  ]);
  expect(document.querySelector("[data-announcement]")?.textContent).toBe("");
  const alert = document.querySelector(
    'article[data-role="pending"] [role="alert"]',
  )!;
  const id = client.getSnapshot().pending[0]!.id;
  await act(async () =>
    client.report({ code: "unavailable", id: "unrelated-host-problem" }),
  );
  expect(alert.isConnected).toBe(true);
  expect(alert.textContent).toBe("availability:temporary");
  await act(async () =>
    client.report({ code: "retryable", id, host: { code: "settings" } }),
  );
  expect(
    screen.getByText("settings:unknown").closest("article")?.textContent,
  ).toContain("First");
  await act(async () =>
    client.report({ code: "retryable", id: "other-host-problem" }),
  );
  expect(
    screen.getByText("availability:temporary").closest("article"),
  ).toBeTruthy();
  expect(client.getSnapshot().pending[0]!.failure).toHaveProperty(
    "host.code",
    "availability",
  );
  other.dispose();
  client.dispose();
});

it("failedSendControls receives an independent host detail copy", async () => {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      send: async () => {
        throw {
          code: "refused",
          host: { code: "availability", qualifier: "temporary" },
        };
      },
    },
  });
  await client.ready;
  render(
    <WaypointChat
      client={client}
      parts={{
        failedSendControls: ({ data }) => {
          const failure = data?.pending.failure;
          if (failure?.host) failure.host.qualifier = "changed-by-part";
          return <span>Host controls</span>;
        },
      }}
    />,
  );
  await act(async () => {
    await client.setDraft("Refused");
    await client.send();
  });
  expect(screen.getByText("Host controls")).toBeTruthy();
  expect(client.getSnapshot().pending[0]!.failure).toHaveProperty(
    "host.qualifier",
    "temporary",
  );
  client.dispose();
});
