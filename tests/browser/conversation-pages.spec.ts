import { expect, test } from "@playwright/test";

for (const skin of ["neutral", "antd"])
  for (const dir of ["ltr", "rtl"])
    for (const width of [360, 1280])
      test(`paged outline loads and focuses history: ${skin}/${dir}/${width}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `/tests/browser/transcript.html?paged=1&prose=1&skin=${skin}&dir=${dir}`,
          { waitUntil: "domcontentloaded" },
        );
        await expect(page.locator("article[data-message-id]")).toHaveCount(5);
        await expect(page.locator(".waypoint")).toHaveAttribute("dir", dir);
        await expect(page.locator(".waypoint")).toHaveCSS("direction", dir);
        const tail = page.locator('article[data-message-id="m10"]');
        await expect(tail).toHaveAttribute("aria-posinset", "10");
        await expect(tail).toHaveAttribute("aria-setsize", "10");
        await expect(
          page.getByRole("button", { name: "Load older messages" }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Message outline" }).click();
        await expect(page.locator("[data-outline-link]")).toHaveCount(10);
        await page.locator('[data-outline-link="m1"]').click();
        const first = page.locator('article[data-message-id="m1"]');
        await expect(first).toBeFocused();
        await expect(page.locator("article[data-message-id]")).toHaveCount(10);
        await expect(
          page.getByRole("button", { name: "Load older messages" }),
        ).toHaveCount(0);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          )
          .toBe(true);
        await page.screenshot({
          path: info.outputPath("history.png"),
          fullPage: true,
        });
      });

test("scrolling to the older boundary loads one predecessor in a real browser", async ({
  page,
}) => {
  await page.goto("/tests/browser/transcript.html?paged=1&holdPages=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("article[data-message-id]")).toHaveCount(5);
  const transcript = page.locator(".wp-transcript");
  await transcript.hover();
  await page.mouse.wheel(0, -10000);
  await expect(
    page.getByRole("button", { name: "Loading older messages…" }),
  ).toBeVisible();
  const anchor = page.locator('article[data-message-id="m6"]');
  const before = await anchor.evaluate(
    (row) => row.getBoundingClientRect().top,
  );
  await page.evaluate(() =>
    (
      window as unknown as { fixture: { releasePages(): void } }
    ).fixture.releasePages(),
  );
  await expect(page.locator("article[data-message-id]")).toHaveCount(10);
  await expect
    .poll(async () =>
      Math.abs(
        (await anchor.evaluate((row) => row.getBoundingClientRect().top)) -
          before,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(anchor).toBeInViewport();
});
