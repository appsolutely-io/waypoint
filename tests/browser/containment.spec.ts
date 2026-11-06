// A modal drawer outside a chat keeps focus off the page behind it, by the
// browser's own Tab order: buttons in shadow roots, contenteditable fields
// and stacked drawers included. Closing makes the page reachable again.
// Returning focus to an opener is the chat's (its drawers' tests check it).
import { test, expect, type Page } from "@playwright/test";
import { tabAround } from "./tab-around";

const open = async (page: Page, kind: string) => {
  await page.goto(`/tests/browser/containment.html?case=${kind}`, {
    waitUntil: "domcontentloaded",
  });
  const opener = page.getByRole("button", { name: "Open" });
  await opener.focus();
  await page.keyboard.press("Enter");
  return opener;
};
const nothingInert = (page: Page) =>
  page.evaluate(() => document.querySelectorAll("[inert]").length);

for (const [kind, expected] of [
  ["sheet", ["Confirm", "Cancel", "Close"]],
  ["slotted", ["Confirm", "Cancel", "Close"]],
  ["shadow", ["Confirm", "Cancel"]],
  ["editable", ["Notes", "Close"]],
] as const)
  test(`A11Y focus never leaves the open drawer, and the page is reachable again after: ${kind}`, async ({
    page,
  }) => {
    const opener = await open(page, kind);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    const reached = await tabAround(page, dialog, 6);
    for (const name of expected) expect(reached).toContain(name);
    expect(reached).not.toContain("Before");
    expect(reached).not.toContain("After");
    expect(reached).not.toContain("Outside slot");
    await page.keyboard.press("Escape");
    if (await dialog.count())
      await dialog
        .getByRole("button", { name: kind === "editable" ? "Close" : "Cancel" })
        .click();
    await expect(dialog).toHaveCount(0);
    expect(await nothingInert(page)).toBe(0);
    await expect(opener).toBeFocused();
  });
test("A11Y stacked drawers: only the topmost is reachable, then the one below, then the page", async ({
  page,
}) => {
  await open(page, "stacked");
  const first = page.getByRole("dialog", { name: "First" });
  const second = page.getByRole("dialog", { name: "Second" });
  await expect(second).toBeVisible();
  await second.focus();
  let reached = await tabAround(page, second, 5);
  expect(reached).toContain("Cancel");
  await second.getByRole("button", { name: "Cancel" }).click();
  await expect(second).toHaveCount(0);
  await first.focus();
  reached = await tabAround(page, first, 5);
  expect(reached).toContain("Confirm");
  await first.getByRole("button", { name: "Cancel" }).click();
  await expect(first).toHaveCount(0);
  expect(await nothingInert(page)).toBe(0);
});

test("closing preserves inert claimed by the host while the sheet was open", async ({
  page,
}) => {
  await open(page, "sheet");
  const before = page.getByRole("button", {
    name: "Before",
    includeHidden: true,
  });
  await before.evaluate((element: HTMLElement) => {
    element.inert = true;
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(before).toHaveAttribute("inert", "");
});

for (const scheme of ["light", "dark"])
  test(`drawer popups stay interactive inside their modal: ${scheme}`, async ({
    page,
  }) => {
    await open(page, `popups&scheme=${scheme}`);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Choice", exact: true }).click();
    await expect(dialog.locator(".ant-select-dropdown")).toBeVisible();
    await page.getByText("Second option", { exact: true }).click();
    await expect(dialog.locator(".ant-select-selection-item")).toHaveText(
      "Second option",
    );
    await dialog.getByRole("textbox", { name: "Date", exact: true }).click();
    const calendar = dialog.locator(".ant-picker-dropdown");
    await expect(calendar).toBeVisible();
    expect(
      await calendar.evaluate((element) => element.closest("[inert]")),
    ).toBeNull();
    await calendar.locator(".ant-picker-cell-in-view").first().click();
    await expect(
      dialog.getByRole("textbox", { name: "Date", exact: true }),
    ).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open", exact: true }),
    ).toBeFocused();
    await page.getByRole("combobox", { name: "Outside choice" }).click();
    await expect(
      page.getByText("Outside option", { exact: true }),
    ).toBeVisible();
  });

for (const skin of ["neutral", "antd"])
  for (const chat of [false, true])
    test(`a second programmatic modal enters from an inert region: ${skin} chat=${chat}`, async ({
      page,
    }) => {
      await open(page, `stacked-inert&skin=${skin}${chat ? "&chat" : ""}`);
      const second = page.getByRole("dialog", { name: "Second", exact: true });
      await expect(second).toBeVisible();
      await expect(second).toBeFocused();
      await second.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "First", exact: true }),
      ).toBeFocused();
    });

for (const skin of ["neutral", "antd"])
  for (const kind of [
    "fallback-removed",
    "fallback-disabled",
    "fallback-provided-removed",
  ])
    test(`a no-press drawer returns to its available destination: ${skin} ${kind}`, async ({
      page,
    }) => {
      await open(page, `${kind}&skin=${skin}`);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeFocused();
      if (kind.includes("removed"))
        await expect(page.getByRole("button", { name: "Open" })).toHaveCount(0);
      else
        await expect(
          page.getByRole("button", { name: "Open", includeHidden: true }),
        ).toBeDisabled();
      await dialog
        .getByRole("button", {
          name: kind.includes("provided") ? "Close" : "Cancel",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("region", {
          name: kind.includes("provided") ? "Return destination" : "Transcript",
          exact: true,
        }),
      ).toBeFocused();
    });

for (const skin of ["neutral", "antd"])
  test(`a stock drawer unmounts its dialog when closed: ${skin}`, async ({
    page,
  }) => {
    const opener = await open(page, `sheet&skin=${skin}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeFocused();
    const element = await dialog.elementHandle();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await element!.evaluate((node) => node.isConnected)).toBe(false);
    await expect(opener).toBeFocused();
  });
