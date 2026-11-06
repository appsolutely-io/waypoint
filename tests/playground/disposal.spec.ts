import { expect, test } from "@playwright/test";
import { pageErrors } from "./page-errors";

type StreamWindow = Window & {
  previewStreams: { path: string; aborted: boolean; settled: boolean }[];
};

for (const late of [false, true])
  test(`retired scenario stops requests after ${late ? "late" : "mounted"} initialization`, async ({
    page,
  }) => {
    const errors = pageErrors(page);
    await page.clock.install();
    await page.addInitScript(() => {
      const entries: StreamWindow["previewStreams"] = [];
      (window as unknown as StreamWindow).previewStreams = entries;
      const original = window.fetch.bind(window);
      window.fetch = (...args) => {
        const path = String(args[0]).split("?")[0]!;
        if (!path.endsWith("/stream")) return original(...args);
        const entry = { path, aborted: false, settled: false };
        entries.push(entry);
        args[1]?.signal?.addEventListener("abort", () => {
          entry.aborted = true;
        });
        return original(...args).finally(() => {
          entry.settled = true;
        });
      };
    });
    let retiredPath = "";
    let releaseRead = () => {};
    const heldRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let readStarted = () => {};
    const firstRead = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    let releaseStream = () => {};
    const heldStream = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    await page.route("**/api/conversations/*", async (route) => {
      if (!retiredPath && route.request().method() === "GET") {
        retiredPath = new URL(route.request().url()).pathname;
        readStarted();
      }
      if (late && new URL(route.request().url()).pathname === retiredPath)
        await heldRead;
      await route.continue();
    });
    await page.route("**/api/conversations/*/stream*", async (route) => {
      if (new URL(route.request().url()).pathname === retiredPath + "/stream") {
        await heldStream;
        await route.fulfill({ status: 200, body: "not-json" });
      } else await route.continue();
    });
    await page.goto("/");
    await firstRead;
    if (!late)
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Scenario", exact: true })
      .selectOption("form-fill");
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toBeVisible();
    releaseRead();
    await page.waitForFunction(
      (path) =>
        (window as unknown as StreamWindow).previewStreams.some(
          (entry) => entry.path === path,
        ),
      retiredPath + "/stream",
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === retiredPath || path.startsWith(retiredPath + "/"))
        requests.push(path);
    });
    releaseStream();
    await page.waitForFunction(
      (path) =>
        (window as unknown as StreamWindow).previewStreams.some(
          (entry) => entry.path === path && entry.settled && entry.aborted,
        ),
      retiredPath + "/stream",
    );
    await page.clock.runFor(5000);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(
        (path) =>
          (window as unknown as StreamWindow).previewStreams.find(
            (entry) => entry.path === path,
          )?.aborted,
        retiredPath + "/stream",
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
