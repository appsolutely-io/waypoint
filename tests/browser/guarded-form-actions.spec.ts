import { test, expect } from "@playwright/test";

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"])
    for (const width of [390, 768, 1280]) {
      const tag = `${skin}-${scheme}-${width}`;
      test(`guarded form and Retry states: ${tag}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme as "light" | "dark" });
        const shot = async (name: string) => {
          const folder = process.env.WAYPOINT_SHOTS;
          if (folder)
            await page.screenshot({
              path: `${folder}/${name}-${tag}.png`,
              fullPage: true,
            });
        };
        await page.goto(
          `/tests/browser/form-fill.html?skin=${skin}&scheme=${scheme}&fields=all&attach=1&draft=retry`,
        );
        const count = page.getByRole("spinbutton", {
          name: "Count",
          exact: true,
        });
        await count.fill("");
        const regenerate = page.getByRole("button", {
          name: "Regenerate Count",
          exact: true,
        });
        await regenerate.focus();
        await expect(regenerate).toBeFocused();
        await expect(regenerate).toHaveAttribute("aria-disabled", "true");
        await expect(regenerate).toHaveAccessibleDescription(
          "Fix the highlighted fields first.",
        );
        await regenerate.press("Enter");
        await regenerate.press("Space");
        await regenerate.click({ force: true });
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await shot("guarded-regenerate");
        await count.fill("3");
        await regenerate.click();
        const dialog = page.getByRole("dialog");
        await dialog.locator('input[type="file"]').setInputFiles({
          name: "photo.png",
          mimeType: "image/png",
          buffer: Buffer.from("png"),
        });
        const remove = dialog.getByRole("button", { name: "Remove photo.png" });
        await expect(remove).toBeVisible();
        await dialog.getByRole("button", { name: "Generate draft" }).click();
        await expect(remove).toHaveAttribute("aria-disabled", "true");
        await remove.focus();
        await expect(remove).toBeFocused();
        await expect(remove).toHaveAccessibleDescription(
          "Wait for the draft to finish.",
        );
        await remove.press("Enter");
        await remove.press("Space");
        await remove.click({ force: true });
        await expect(remove).toBeVisible();
        await shot("guarded-remove");
        await page.waitForFunction(
          () =>
            typeof (window as unknown as { finishDraft?: unknown })
              .finishDraft === "function",
        );
        await page.evaluate(() =>
          (window as unknown as { finishDraft(): void }).finishDraft(),
        );
        const draftRetry = dialog.getByRole("button", {
          name: "Retry",
          exact: true,
        });
        await expect(draftRetry).toBeVisible();
        await expect(remove).toHaveAttribute("aria-disabled", "true");
        await remove.press("Enter");
        await remove.press("Space");
        await remove.click({ force: true });
        await expect(remove).toBeVisible();
        await shot("failed-draft-remove");
        await draftRetry.click();
        await expect(remove).not.toHaveAttribute("aria-disabled", "true");
        const attempts = await page.evaluate(
          () =>
            (window as unknown as { draftAttempts: unknown[] }).draftAttempts,
        );
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toEqual(attempts[0]);
        await page.goto(
          `/tests/browser/flows.html?skin=${skin}&scheme=${scheme}&load=retry`,
        );
        await page
          .getByRole("button", { name: "Rename item", exact: true })
          .click();
        const flow = page.getByRole("dialog", { name: "Rename item" });
        const retry = flow.getByRole("button", { name: "Retry", exact: true });
        await retry.click();
        await expect(retry).toHaveAttribute("aria-busy", "true");
        await expect(flow.getByRole("status")).toHaveText("Loading");
        await shot("busy-retry");
        await page.waitForFunction(
          () =>
            typeof (window as unknown as { finishFlow?: unknown })
              .finishFlow === "function",
        );
        await page.evaluate(() =>
          (window as unknown as { finishFlow(): void }).finishFlow(),
        );
        await expect(
          flow.getByRole("textbox", { name: "Title (required)" }),
        ).toBeVisible();
      });
    }

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"])
    test(`Generate during an upload stays focusable and says why: ${skin}-${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme as "light" | "dark" });
      await page.goto(
        `/tests/browser/form-fill.html?skin=${skin}&scheme=${scheme}&attach=held&draft=retry`,
      );
      // The field's Regenerate shows once focus is in the field.
      await page.getByRole("textbox", { name: "Title" }).focus();
      await page
        .getByRole("button", { name: "Regenerate Title", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "photo.png",
        mimeType: "image/png",
        buffer: Buffer.from("png"),
      });
      await expect(dialog.getByRole("status")).toHaveText("Uploading 1 image…");
      const generate = dialog.getByRole("button", { name: "Generate draft" });
      await generate.scrollIntoViewIfNeeded();
      await generate.focus();
      await expect(generate).toBeFocused();
      await expect(generate).toHaveAttribute("aria-disabled", "true");
      await expect(generate).toHaveAccessibleDescription(
        "Wait for the current upload to finish.",
      );
      await generate.press("Enter");
      await generate.press("Space");
      await generate.click({ force: true });
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { draftAttempts: unknown[] }).draftAttempts
              .length,
        ),
      ).toBe(0);
      await page.evaluate(() =>
        (window as unknown as { finishUpload(): void }).finishUpload(),
      );
      await expect(dialog.getByRole("status")).toHaveText("1 image attached");
      await expect(generate).not.toHaveAttribute("aria-disabled", "true");
    });
