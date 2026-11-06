import { test as base, expect } from "@playwright/test";
import { pageErrors } from "./page-errors";

const test = base.extend<{ localPage: void; expectedConsoleError: string }>({
  expectedConsoleError: ["", { option: true }],
  localPage: [
    async ({ page, expectedConsoleError }, use) => {
      const errors = pageErrors(page, expectedConsoleError);
      const external: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).hostname !== "127.0.0.1")
          external.push(request.url());
      });
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1"
          ? route.continue()
          : route.abort(),
      );
      await use();
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    },
    { auto: true },
  ],
});

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark", "system"])
    test(`chat renders with ${skin} controls and ${scheme} scheme`, async ({
      page,
    }) => {
      const errors = pageErrors(page);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`/?skin=${skin}&scheme=${scheme}`);
      await expect(
        page.getByRole("region", { name: "Messages", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Welcome to your local preview.", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".playground")).toHaveAttribute(
        "data-scheme",
        scheme === "system" ? "dark" : scheme,
      );
      if (scheme === "system") {
        await page.emulateMedia({ colorScheme: "light" });
        await expect(page.locator(".playground")).toHaveAttribute(
          "data-scheme",
          "light",
        );
        await expect(page.locator(".waypoint")).toHaveCSS(
          "color-scheme",
          "light",
        );
      }
      expect(errors).toEqual([]);
    });

test("query restores the toolbar, preview and browser history", async ({
  page,
}) => {
  await page.goto(
    "/?skin=antd&scheme=dark&layout=sheet&dir=rtl&lang=zh-CN&scenario=transcript&keep=yes",
  );
  for (const [key, value] of Object.entries({
    skin: "antd",
    scheme: "dark",
    layout: "sheet",
    dir: "rtl",
    lang: "zh-CN",
    scenario: "transcript",
  }))
    await expect(page.locator(`#preview-${key}`)).toHaveValue(value);
  await expect(page.locator(".waypoint")).toHaveAttribute(
    "data-layout",
    "sheet",
  );
  await expect(page.locator(".waypoint")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".waypoint")).toHaveAttribute("lang", "zh-CN");
  await page.locator("#preview-layout").selectOption("floating");
  await expect(page).toHaveURL(/layout=floating/);
  await page.reload();
  await expect(page.locator("#preview-layout")).toHaveValue("floating");
  expect(new URL(page.url()).searchParams.get("keep")).toBe("yes");
  await page.locator("#preview-layout").selectOption("panel");
  await page.goBack();
  await expect(page.locator("#preview-layout")).toHaveValue("floating");
  await page.goto(
    "/?skin=unknown&scheme=unknown&layout=unknown&lang=unknown&dir=unknown&scenario=unknown",
  );
  await expect(page.locator("#preview-skin")).toHaveValue("neutral");
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveValue("chat");
});

test("form fill uses the mock draft service", async ({ page }) => {
  await page.goto("/?scenario=form-fill");
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.focus();
  await page
    .getByRole("button", { name: "Regenerate Title", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Write a title for a weekly report");
  await dialog.getByRole("button", { name: "Generate draft" }).click();
  await expect(title).toHaveValue("Draft Title");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("saved requests run a preset and update favourites", async ({ page }) => {
  await page.goto("/?scenario=flows");
  await page.getByRole("tab", { name: "Presets", exact: true }).click();
  await page.getByRole("button", { name: "Rename item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rename item" });
  await dialog
    .getByRole("textbox", { name: "Title (required)" })
    .fill("Weekly notes");
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("article").filter({ hasText: "Rename item: Weekly notes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Favourite: Rename item" }).click();
  await page.getByRole("tab", { name: "Favourites", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Rename item", exact: true }),
  ).toBeVisible();
});

test("long transcript has a usable message outline", async ({ page }) => {
  await page.goto("/?scenario=transcript");
  const outline = page.locator("[data-outline]");
  await outline.getByRole("button").click();
  await expect(outline.getByRole("link")).toHaveCount(48);
  await outline.getByRole("link").first().click();
  await expect(
    page.getByRole("button", { name: "Back to latest" }),
  ).toBeVisible();
});

for (const width of [1440, 390])
  test(`toolbar remains reachable in every layout at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    for (const layout of ["panel", "page", "floating", "sheet"]) {
      await page.locator("#preview-layout").selectOption(layout);
      await expect(page.locator(".waypoint")).toHaveAttribute(
        "data-layout",
        layout,
      );
      await expect(page.locator("#preview-skin")).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });

test("presentation changes preserve the conversation draft", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep my draft");
  await page.locator("#preview-skin").selectOption("antd");
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep my draft");
  await page
    .getByRole("combobox", { name: "Colour scheme", exact: true })
    .selectOption("dark");
  await page
    .getByRole("combobox", { name: "Direction", exact: true })
    .selectOption("rtl");
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("zh-CN");
  await expect(page.locator(".waypoint textarea")).toHaveValue("Keep my draft");
  await page.locator("#preview-skin").selectOption("neutral");
  await expect(page.locator(".waypoint textarea")).toHaveValue("Keep my draft");
});

test.describe("HTTP initialization failure", () => {
  test.use({
    expectedConsoleError:
      "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
  });
  test("failed preview initialization offers a working retry", async ({
    page,
  }) => {
    let failed = false;
    await page.route("**/api/conversations", (route) => {
      if (!failed && route.request().method() === "GET") {
        failed = true;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        });
      }
      return route.continue();
    });
    await page.goto("/");
    await expect(page.getByRole("alert")).toHaveText(
      "The preview could not be loaded.Retry",
    );
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible();
  });
});

test("form previews reuse the server conversation across remounts", async ({
  page,
}) => {
  const ids: string[] = [];
  page.on("response", async (response) => {
    if (
      new URL(response.url()).pathname === "/api/conversations" &&
      response.request().method() === "POST"
    ) {
      const body = (await response.json()) as { id: string };
      ids.push(body.id);
    }
  });
  await page.goto("/?scenario=form-fill");
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("chat");
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("form-fill");
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeVisible();
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(1);
});

for (const skin of ["neutral", "antd"])
  for (const width of [1440, 390])
    test(`form fields fill their column with focus guidance for ${skin} at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/?scenario=form-fill&skin=${skin}`);
      await expect(
        page.getByText(
          "Start with your own words, then focus a field to see Regenerate and try an AI draft.",
          { exact: true },
        ),
      ).toBeVisible();
      const input = page.getByRole("textbox", { name: "Title", exact: true });
      const measure = () =>
        input.evaluate((element) => {
          const label = element.closest("label")!;
          const field = element.getBoundingClientRect();
          return {
            difference: Math.abs(
              field.width - label.getBoundingClientRect().width,
            ),
            gap: getComputedStyle(label).rowGap,
          };
        });
      await expect.poll(measure).toEqual({ difference: 0, gap: "8px" });
      await input.focus();
      const action = page.getByRole("button", {
        name: "Regenerate Title",
        exact: true,
      });
      await expect(action).toBeVisible();
      const field = (await input.boundingBox())!;
      const button = (await action.boundingBox())!;
      expect(
        field.x + field.width <= button.x || button.x + button.width <= field.x,
      ).toBe(true);
      expect((await measure()).difference).toBe(0);
    });

for (const skin of ["neutral", "antd"])
  test(`Chinese preview localizes toolbar, seeded text and form for ${skin}`, async ({
    page,
  }) => {
    await page.goto(`/?lang=zh-CN&skin=${skin}`);
    await expect(
      page.getByRole("heading", { name: "Waypoint 组件预览", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "语言", exact: true }),
    ).toHaveValue("zh-CN");
    await expect(
      page.getByRole("region", { name: "消息", exact: true }),
    ).toContainText("欢迎使用本地预览");
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.fill("Keep this user text");
    await page.locator("#preview-lang").selectOption("en");
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("Keep this user text");
    await page.locator("#preview-lang").selectOption("zh-CN");
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveValue("Keep this user text");
    await page.locator("#preview-scenario").selectOption("form-fill");
    const title = page.getByRole("textbox", { name: "标题", exact: true });
    await title.fill("保留我的标题");
    await expect(
      page.getByText(
        "先输入自己的内容，再聚焦字段以显示“重新生成”，试用 AI 草稿。",
        { exact: true },
      ),
    ).toBeVisible();
    await page.locator("#preview-lang").selectOption("en");
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue("保留我的标题");
    await page.locator("#preview-lang").selectOption("zh-CN");
    await title.focus();
    await expect(
      page.getByRole("button", { name: /重新生成.*标题/ }),
    ).toBeVisible();
    await page.locator("#preview-scenario").selectOption("flows");
    await expect(
      page.getByRole("button", { name: "重命名条目", exact: true }),
    ).toBeVisible();
  });

test("generated form labels return to English without changing values", async ({
  page,
}) => {
  await page.goto("/?scenario=form-fill&lang=zh-CN");
  const title = page.getByRole("textbox", { name: "标题", exact: true });
  await title.focus();
  await page.getByRole("button", { name: "重新生成标题", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("生成每周报告标题");
  await dialog.getByRole("button", { name: "生成草稿", exact: true }).click();
  await expect(title).toHaveValue("标题草稿");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator("#preview-lang").selectOption("en");
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("标题草稿");
  await expect(
    page.getByRole("textbox", { name: "Summary", exact: true }),
  ).toBeVisible();
  await page.locator("#preview-lang").selectOption("zh-CN");
  await expect(title).toHaveValue("标题草稿");
});
