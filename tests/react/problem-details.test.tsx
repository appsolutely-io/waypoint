// @vitest-environment jsdom
// A problem is said in plain words; its code and reference sit behind a
// disclosure, outside the alert, for whoever needs them.
import { it, expect, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
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
