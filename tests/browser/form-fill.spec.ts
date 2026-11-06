import { test, expect } from "@playwright/test";
import { tabAround } from "./tab-around";
for (const skin of ["neutral", "antd"])
  test(`form draft and private reference behavior: ${skin}`, async ({
    page,
  }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("https://example.test/"))
        external.push(request.url());
    });
    const response = await page.goto(
      `/tests/browser/form-fill.html?skin=${skin}`,
      { waitUntil: "domcontentloaded" },
    );
    expect(response?.ok()).toBe(true);
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await title.focus();
    await expect(
      page.getByRole("button", { name: "Regenerate Title", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Regenerate Title", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Use my material");
    await page
      .getByRole("textbox", { name: "Reference links" })
      .fill("https://example.test/reference");
    await page.getByRole("button", { name: "Generate draft" }).click();
    await expect(page.getByRole("status", { name: "Result" })).toHaveText(
      "Draft ready",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(title).toHaveValue("Generated complete title");
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Prefer a shorter title")).toBeVisible();
    expect(external).toEqual([]);
  });

for (const skin of ["neutral", "antd"])
  test(`CK-FU9 a shown adornment never covers its field: ${skin}`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/form-fill.html?skin=${skin}`, {
      waitUntil: "domcontentloaded",
    });
    // A host-style form: the field fills its row.
    await page.addStyleTag({
      content: ".wp-field-parent input { inline-size: 100%; }",
    });
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await title.focus();
    const adornment = page.getByRole("button", {
      name: "Regenerate Title",
      exact: true,
    });
    await expect(adornment).toBeVisible();
    const field = (await title.boundingBox())!;
    const button = (await adornment.boundingBox())!;
    const overlaps =
      button.x < field.x + field.width &&
      field.x < button.x + button.width &&
      button.y < field.y + field.height &&
      field.y < button.y + button.height;
    expect(overlaps).toBe(false);
  });

for (const skin of ["neutral", "antd"])
  test(`A11Y focus never leaves the open popup, and the page is reachable after it closes: ${skin}`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/form-fill.html?skin=${skin}`, {
      waitUntil: "domcontentloaded",
    });
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await title.focus();
    const adornment = page.getByRole("button", {
      name: "Regenerate Title",
      exact: true,
    });
    await adornment.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const reached = await tabAround(page, dialog, 8);
    expect(reached).toContain("Close");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate(() => document.querySelectorAll("[inert]").length),
    ).toBe(0);
  });

for (const skin of ["neutral", "antd"])
  test(`CK-FF11 at 390 px the popup fits and labels sit above their fields: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/tests/browser/form-fill.html?skin=${skin}&fields=all&attach=1`,
      { waitUntil: "domcontentloaded" },
    );
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    const label = page.locator("label", { has: title });
    const labelText = await label.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild!);
      return range.getBoundingClientRect().bottom;
    });
    expect(labelText).toBeLessThanOrEqual((await title.boundingBox())!.y + 1);
    await title.focus();
    await page
      .getByRole("button", { name: "Regenerate Title", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Attach images" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"])
    test(`CK-FF5 CK-FF7 validation in the danger tone, and a picked image is listed by name: ${skin} ${scheme}`, async ({
      page,
    }) => {
      await page.goto(
        `/tests/browser/form-fill.html?skin=${skin}&scheme=${scheme}&attach=1`,
        { waitUntil: "domcontentloaded" },
      );
      const title = page.getByRole("textbox", { name: "Title", exact: true });
      await title.focus();
      await page
        .getByRole("button", { name: "Regenerate Title", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "photo.png",
        mimeType: "image/png",
        buffer: Buffer.from("png"),
      });
      await expect(
        dialog.getByRole("button", { name: "Remove photo.png" }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Generate draft" }).click();
      await expect(dialog.getByRole("status").last()).toContainText(
        "Draft ready",
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      const messages = page.locator(".wp-invalid").first();
      await expect(messages).toContainText("Invalid");
      const contrast = await messages.evaluate((element) => {
        const rgb = (value: string) =>
          value
            .match(/\d+(\.\d+)?/g)!
            .slice(0, 3)
            .map(Number);
        const lum = (c: number[]) => {
          const [r, g, b] = c.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        let back: Element | null = element;
        let bg = "rgba(0, 0, 0, 0)";
        while (back && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
          bg = getComputedStyle(back).backgroundColor;
          back = back.parentElement;
        }
        if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = "rgb(255,255,255)";
        const a = lum(rgb(getComputedStyle(element).color));
        const b = lum(rgb(bg));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      const danger = await page
        .locator(".waypoint")
        .first()
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--wp-danger").trim(),
        );
      expect(danger).not.toBe("");
    });

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"])
    test(`CK-FF6 the boolean field's target is at least 24 by 24 px and follows the scheme: ${skin} ${scheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(
        `/tests/browser/form-fill.html?skin=${skin}&scheme=${scheme}&fields=all`,
        { waitUntil: "domcontentloaded" },
      );
      const box = page.getByRole("checkbox", { name: "Public" });
      await expect(box).toBeVisible();
      // The target is the label around the box: a press on either toggles.
      const measured = await box.evaluate((input) => {
        const target = input.closest("label")!.getBoundingClientRect();
        const count = document
          .querySelector('input[type="number"]')!
          .getBoundingClientRect();
        return {
          width: target.width,
          height: target.height,
          gapToCount: target.top - count.bottom,
          colorScheme: getComputedStyle(input).colorScheme,
        };
      });
      test.info().annotations.push({
        type: "target",
        description: JSON.stringify(measured),
      });
      expect(measured.width).toBeGreaterThanOrEqual(24);
      expect(measured.height).toBeGreaterThanOrEqual(24);
      // It never overlaps the field above it.
      expect(measured.gapToCount).toBeGreaterThanOrEqual(0);
      expect(measured.colorScheme).toBe(scheme);
    });
