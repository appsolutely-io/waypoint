import { test, expect } from "@playwright/test";
for (const skin of ["neutral", "antd"]) {
  test(`CK-DR1 the parameter drawer is named, and Run sends typed values: ${skin}`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/flows.html?skin=${skin}`);
    await page
      .getByRole("button", { name: "Rename item", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Rename item" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Title (required)" }).fill("New");
    await dialog.getByRole("button", { name: "Run" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { runs: unknown[] }).runs),
      )
      .toEqual([
        { id: "flow-a", values: { title: "New", count: 2, notify: false } },
      ]);
  });
}
test("CK-FL1d CK-FUD2 an antd double-click opens the drawer once; a later mask click closes it", async ({
  page,
}) => {
  await page.goto(`/tests/browser/flows.html?skin=antd`);
  await page
    .getByRole("button", { name: "Rename item", exact: true })
    .dblclick();
  const dialog = page.getByRole("dialog", { name: "Rename item" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(700);
  await expect(dialog).toBeVisible();
  // One drawer, one load.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(
    await page.evaluate(() => (window as unknown as { loads: number }).loads),
  ).toBe(1);
  await page.locator(".ant-drawer-mask").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
});
test("CK-FL5 arrow keys follow a direction set only by the host's stylesheet", async ({
  page,
}) => {
  await page.goto(`/tests/browser/flows.html?rtl=css`);
  const presets = page.getByRole("tab", { name: "Presets" });
  await presets.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Favourites" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(presets).toBeFocused();
});
