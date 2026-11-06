import { test, expect } from "@playwright/test";
for (const skin of ["neutral", "antd"])
  test(`computed tokens, container layout and state preservation: ${skin}`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/index.html?skin=${skin}`, {
      waitUntil: "domcontentloaded",
    });
    const root = page.locator(".waypoint");
    const field = page.getByRole("textbox", { name: "Message" });
    await field.fill("Keep my draft");
    await field.focus();
    const before = await page.evaluate(() => {
      const root = document.querySelector(".waypoint")!;
      const transcript = root.querySelector(".wp-transcript")!;
      // A user's scroll away from the latest message (a wheel, then the
      // move), so the position is the user's and Back to latest shows.
      transcript.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
      transcript.scrollTop = 80;
      return {
        top: transcript.scrollTop,
        parts: [...root.querySelectorAll("[data-part]")].map((part) => ({
          name: part.getAttribute("data-part"),
          color: getComputedStyle(part).color,
        })),
        columns: getComputedStyle(root.querySelector(".wp-shell")!)
          .gridTemplateColumns,
      };
    });
    expect(before.columns.split(" ")).toHaveLength(1);
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          "--wp-foreground",
        ),
      ),
    ).toBe("");
    await page
      .locator("#switch")
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(root).toHaveAttribute("data-color-scheme", "dark");
    await expect
      .poll(() => root.evaluate((element) => getComputedStyle(element).color))
      .toBe("rgb(238, 242, 247)");
    await expect
      .poll(() =>
        root.evaluate((element) =>
          [...element.querySelectorAll("[data-part]")].every(
            (part) => getComputedStyle(part).color === "rgb(238, 242, 247)",
          ),
        ),
      )
      .toBe(true);
    await expect(field).toHaveValue("Keep my draft");
    await expect(field).toBeFocused();
    await expect(page.getByLabel("Plan", { exact: true })).toBeVisible();
    const after = await page.evaluate(() => {
      const root = document.querySelector(".waypoint")!;
      return {
        top: root.querySelector(".wp-transcript")!.scrollTop,
        parts: [...root.querySelectorAll("[data-part]")].map((part) => ({
          name: part.getAttribute("data-part"),
          color: getComputedStyle(part).color,
        })),
      };
    });
    expect(after.top).toBe(before.top);
    expect(after.parts.map((part) => part.name)).toEqual(
      before.parts.map((part) => part.name),
    );
    for (let i = 0; i < before.parts.length; i++)
      expect(after.parts[i]?.color).not.toBe(before.parts[i]?.color);
    const button = page.getByRole("button", { name: "Back to latest" });
    const ltr = await button.evaluate((element) => ({
      left: getComputedStyle(element).marginLeft,
      right: getComputedStyle(element).marginRight,
    }));
    await page.locator("#direction").click();
    await expect(root).toHaveAttribute("dir", "rtl");
    await expect
      .poll(() =>
        button.evaluate((element) => getComputedStyle(element).marginLeft),
      )
      .toBe(ltr.right);
    const rtl = await button.evaluate((element) => ({
      left: getComputedStyle(element).marginLeft,
      right: getComputedStyle(element).marginRight,
    }));
    expect(rtl.left).toBe(ltr.right);
    expect(rtl.right).toBe(ltr.left);
  });

test("layout modes have distinct computed geometry", async ({ page }) => {
  await page.goto("/tests/browser/index.html");
  const styles = [];
  for (const mode of ["panel", "page", "floating", "sheet"]) {
    await page.locator("#layout").selectOption(mode);
    await expect(page.locator(".waypoint")).toHaveAttribute(
      "data-layout",
      mode,
    );
    styles.push(
      await page.locator(".waypoint").evaluate((element) => {
        const css = getComputedStyle(element);
        return JSON.stringify([
          css.position,
          css.width,
          css.minHeight,
          css.borderRadius,
        ]);
      }),
    );
  }
  expect(new Set(styles).size).toBe(4);
});

test("default Markdown images never request a remote resource", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://evil/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/tests/browser/index.html");
  await expect(page.locator("#image-preview a")).toHaveAttribute(
    "href",
    "https://evil/?q=x",
  );
  expect(await page.locator("#image-preview img").count()).toBe(0);
  expect(requests).toEqual([]);
});

for (const query of ["grey=1", "scheme=light", "scheme=dark"])
  test(`default danger keeps a contrast margin on both surfaces: ${query}`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/contrast.html?${query}`);
    const ratios = await page
      .locator("[data-danger]")
      .evaluateAll((elements) => {
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return (
            channels[0]! * 0.2126 +
            channels[1]! * 0.7152 +
            channels[2]! * 0.0722
          );
        };
        return elements.map((element) => {
          const foreground = luminance(getComputedStyle(element).color);
          const background = luminance(
            getComputedStyle(element.parentElement!).backgroundColor,
          );
          return (
            (Math.max(foreground, background) + 0.05) /
            (Math.min(foreground, background) + 0.05)
          );
        });
      });
    expect(ratios).toHaveLength(2);
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.6);
  });
