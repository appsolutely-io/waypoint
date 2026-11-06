// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { config } from "../support/client";
import { completed, recordOf } from "../support/host-plans";
afterEach(() => {
  cleanup();
  vi.doUnmock("../../src/react/recovery-panel");
  vi.resetModules();
});
const chunk = { fail: false, hold: undefined as Promise<void> | undefined };
async function open(locale?: string) {
  vi.resetModules();
  vi.doMock("../../src/react/recovery-panel", async (original) => {
    if (chunk.fail) throw new Error("chunk unavailable");
    await chunk.hold;
    return await original();
  });
  const { WaypointChat } = await import("../../src/react/ui");
  const { createWaypointClient } = await import("../../src/core/client");
  // No intent port: plan recovery is neither offered nor agreed.
  const client = createWaypointClient(config());
  await client.ready;
  const record = recordOf(completed());
  client.setPlan({
    ...record,
    recovery: { ...record.recovery!, conversationId: "conversation-a" },
  });
  render(<WaypointChat client={client} locale={locale} />);
  const plan = screen.getByRole("complementary");
  return { client, plan };
}

describe("a plan this client cannot control", () => {
  it("CK-W5-view shows its recorded status and why it cannot act, with no controls", async () => {
    chunk.fail = false;
    const { client, plan } = await open();
    await within(plan).findByText(
      "Update the app to control this plan. Its recorded status is shown here.",
    );
    expect(within(plan).getByText("Completed")).toBeDefined();
    expect(within(plan).queryAllByRole("button")).toEqual([]);
    client.dispose();
  });

  it("CK-W5-view says it in Simplified Chinese", async () => {
    chunk.fail = false;
    const { client, plan } = await open("zh-CN");
    await within(plan).findByText(
      "请更新应用后再操作此计划。此处仍显示已记录的状态。",
    );
    client.dispose();
  });

  it("CK-W5-view a failed panel load says so, and a keyboard Retry loads it and lands on the plan heading", async () => {
    chunk.fail = true;
    const { client, plan } = await open();
    const alert = await within(plan).findByRole("alert");
    chunk.fail = false;
    let release!: () => void;
    chunk.hold = new Promise<void>((resolve) => (release = resolve));
    const retry = within(alert).getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.keyDown(retry, { key: "Enter" });
    fireEvent.click(retry);
    // While the panel loads again the Retry stays, busy, and keeps focus.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    // Loading is said by a status beside the alert; no live region is
    // inside another.
    expect(alert.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(within(alert.parentElement!).getByRole("status").textContent).toBe(
      "Loading",
    );
    release();
    chunk.hold = undefined;
    // The Retry is gone once the panel is there: focus is on its heading.
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H3"));
    expect(plan.contains(document.activeElement)).toBe(true);
    await waitFor(() =>
      expect(
        within(plan).getByText(
          "Update the app to control this plan. Its recorded status is shown here.",
        ),
      ).toBeDefined(),
    );
    client.dispose();
  });
});

describe("a Stop pressed on a plan this client cannot control", () => {
  it("is refused once, with the plan's id", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { usePlanView } = await import("../../src/react/recovery");
    const { createWaypointClient } = await import("../../src/core/client");
    const client = createWaypointClient(config());
    await client.ready;
    const record = recordOf(completed());
    client.setPlan({
      ...record,
      recovery: { ...record.recovery!, conversationId: "conversation-a" },
    });
    expect(client.getSnapshot().planReadOnly).toBe(true);
    const problems: string[] = [];
    client.on((event) => {
      if (event.type === "problem") problems.push(event.problemId);
    });
    // The press a view made before the plan turned read-only.
    const { result } = renderHook(() => usePlanView(client));
    act(() => result.current.press("stop"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(problems).toEqual([record.id]);
    expect(client.getSnapshot().problem).toEqual({
      code: "refused",
      id: record.id,
    });
    client.dispose();
  });
});
