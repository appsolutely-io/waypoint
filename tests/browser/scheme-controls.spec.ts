import { test, expect } from "@playwright/test";

// Colours of controls in each skin and scheme, read from the computed
// style. These are rendering checks, not screen-reader checks.
const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
    const c = Number(value) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"] as const) {
    test(`text fields follow the chat's scheme: ${skin}-${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(
        `/tests/browser/form-fill.html?skin=${skin}&scheme=${scheme}&fields=all`,
      );
      for (const field of [
        page.getByRole("textbox", { name: "Title" }).first(),
        page.getByRole("spinbutton", { name: "Count", exact: true }),
      ]) {
        const style = await field.evaluate((element) => {
          const own = getComputedStyle(element);
          const root = getComputedStyle(element.closest(".waypoint")!);
          // Token values resolved to colours the way the field's are.
          const probe = document.createElement("span");
          element.closest(".waypoint")!.append(probe);
          probe.style.color = "var(--wp-background)";
          const background = getComputedStyle(probe).color;
          probe.style.color = "var(--wp-foreground)";
          const foreground = getComputedStyle(probe).color;
          probe.remove();
          return {
            background: own.backgroundColor,
            color: own.color,
            tokens: { background, foreground },
            scheme: root.colorScheme,
          };
        });
        expect(contrast(style.color, style.background)).toBeGreaterThan(4.5);
        const dark = luminance(style.background) < 0.2;
        expect(dark).toBe(scheme === "dark");
        if (skin === "neutral") {
          expect(style.background).toBe(style.tokens.background);
          expect(style.color).toBe(style.tokens.foreground);
        }
      }
    });

    test(`date fields take the chat's colours, file, range and colour inputs the platform's: ${skin}-${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(
        `/tests/browser/form-fill.html?skin=${skin}&scheme=${scheme}&fields=all`,
      );
      await page.getByRole("textbox", { name: "Title" }).first().waitFor();
      const fills = await page.evaluate(() => {
        // A background no platform default has, so only the rule gives it.
        const root = document.createElement("div");
        root.className = "waypoint";
        root.style.setProperty("--wp-background", "rgb(1, 2, 3)");
        document.body.append(root);
        return ["file", "range", "color", "text", "datetime-local"].map(
          (type) => {
            const input = document.createElement("input");
            input.type = type;
            root.append(input);
            const fill = getComputedStyle(input).backgroundColor;
            input.remove();
            return fill;
          },
        );
      });
      expect(fills.splice(3)).toEqual(["rgb(1, 2, 3)", "rgb(1, 2, 3)"]);
      for (const fill of fills) expect(fill).not.toBe("rgb(1, 2, 3)");
    });

    test(`the selected flow tab is marked by more than colour: ${skin}-${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(
        `/tests/browser/flows.html?skin=${skin}&scheme=${scheme}`,
      );
      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveCount(2);
      const measure = () =>
        tabs.evaluateAll((elements) =>
          elements.map((element) => ({
            selected: element.getAttribute("aria-selected") === "true",
            mark: getComputedStyle(element).boxShadow,
            box: element.getBoundingClientRect().toJSON() as DOMRect,
          })),
        );
      const before = await measure();
      expect(before.filter((tab) => tab.selected)).toHaveLength(1);
      for (const tab of before)
        if (tab.selected) expect(tab.mark).toMatch(/inset.*-3px|-3px.*inset/);
        else expect(tab.mark).not.toMatch(/inset/);
      // Selecting the other tab moves the mark, and nothing else.
      await page.getByRole("tab", { selected: false }).click();
      await expect(page.getByRole("tab", { selected: true })).toHaveCSS(
        "box-shadow",
        /inset/,
      );
      const after = await measure();
      expect(after.map((tab) => tab.box)).toEqual(before.map((tab) => tab.box));
      expect(after.map((tab) => tab.selected)).toEqual(
        before.map((tab) => !tab.selected),
      );
    });

    test(`under forced colours selecting a flow tab moves nothing: ${skin}-${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme, forcedColors: "active" });
      await page.goto(
        `/tests/browser/flows.html?skin=${skin}&scheme=${scheme}`,
      );
      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveCount(2);
      const boxes = () =>
        tabs.evaluateAll((elements) =>
          elements.map((element) => ({
            selected: element.getAttribute("aria-selected") === "true",
            box: element.getBoundingClientRect().toJSON() as DOMRect,
            outline: getComputedStyle(element).outlineStyle,
          })),
        );
      const before = await boxes();
      for (const tab of before)
        expect(tab.outline !== "none").toBe(tab.selected);
      await page.getByRole("tab", { selected: false }).click();
      // Away from the pressed tab, so the focus ring is not what is read.
      await page.mouse.click(1, 1);
      const after = await boxes();
      expect(after.map((tab) => tab.box)).toEqual(before.map((tab) => tab.box));
      for (const tab of after)
        expect(tab.outline !== "none").toBe(tab.selected);
    });
  }
