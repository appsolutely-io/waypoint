// The chat follows the system colour scheme unless the host sets one.
import { test, expect, type Page } from "@playwright/test";

const open = async (page: Page, query: string) => {
  await page.goto(`/tests/browser/layout.html?${query}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("article[data-message-id]").first()).toBeVisible();
  await expect(page.locator(".wp-markdown").first()).toBeVisible();
};
// Any CSS colour (color-mix included) as sRGB bytes, read back from a canvas.
const scheme = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".waypoint")!;
    return {
      name: root.dataset.colorScheme,
      background: getComputedStyle(root).backgroundColor,
    };
  });
test("without a scheme the chat follows the system's, live", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "skin=neutral");
  const dark = await scheme(page);
  expect(dark.name).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => (await scheme(page)).name).toBe("light");
  const light = await scheme(page);
  expect(light.background).not.toBe(dark.background);
});
test("an explicit light scheme keeps the chat light on a dark system", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "skin=neutral&scheme=light");
  expect((await scheme(page)).name).toBe("light");
});
