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
