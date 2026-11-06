// The transcript's position in a real browser (Table T: T2, T4, T5 and the
// browser's clamp), where layout, scroll events and ResizeObserver timing
// are the browser's own.
import { test, expect, type Page } from "@playwright/test";

// Headless Chromium hides scrollbars by default; the drag needs one.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const box = (page: Page) => page.locator(".wp-transcript");
const latest = (page: Page) =>
  page.getByRole("button", { name: "Back to latest", exact: true });
const end = (page: Page) =>
  box(page).evaluate(
    (element) =>
      element.scrollHeight - element.clientHeight - element.scrollTop,
  );
const show = (page: Page, contents: string[], ids?: string[]) =>
  page.evaluate(
    ([next, nextIds]) =>
      (
        window as unknown as {
          fixture: { show(c: string[], i?: string[]): Promise<void> };
        }
      ).fixture.show(next, nextIds),
    [contents, ids] as const,
  );
const rows = (count: number, height = "100") =>
  Array.from({ length: count }, () => height);
/** Arms a wait for the box's next scroll event; `scrolled` awaits it. */
const armScroll = (page: Page, timeout = 2000) =>
  box(page).evaluate((element, ms) => {
    (window as unknown as { scrolled: Promise<boolean> }).scrolled =
      new Promise<boolean>((resolve) => {
        const done = (value: boolean) => {
          element.removeEventListener("scroll", onScroll);
          resolve(value);
        };
        const onScroll = () => done(true);
        element.addEventListener("scroll", onScroll);
        setTimeout(() => done(false), ms);
      });
  }, timeout);
const scrolled = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { scrolled: Promise<boolean> }).scrolled,
  );
/** A scripted user scroll: a wheel input on the box, then the box moves. */
const userScrollTo = (page: Page, top: (max: number) => number) =>
  box(page).evaluate((element, source) => {
    const target = new Function("max", `return (${source})(max)`) as (
      max: number,
    ) => number;
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
    element.scrollTop = target(element.scrollHeight - element.clientHeight);
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }, top.toString());
const setHeight = (page: Page, index: number, height: number) =>
  page.evaluate(
    ([at, value]) => {
      const sized = document.querySelectorAll<HTMLElement>(
        ".wp-transcript [data-sized], .wp-transcript [data-nested]",
      )[at]!;
      sized.style.height = `${value}px`;
    },
    [index, height] as const,
  );
async function open(page: Page, skin: string) {
  await page.goto(`/tests/browser/transcript.html?skin=${skin}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("article[data-message-id]")).toHaveCount(10);
  await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
  await expect(latest(page)).toHaveCount(0);
}
async function unpinAtTop(page: Page) {
  await box(page).hover();
  await page.mouse.wheel(0, -10000);
  await expect(latest(page)).toBeVisible();
  await expect.poll(() => box(page).evaluate((e) => e.scrollTop)).toBe(0);
  // Let the wheel gesture end.
  await page.waitForTimeout(250);
}

for (const skin of ["neutral", "antd"])
  for (const width of [390, 1440])
    for (const dir of ["ltr", "rtl"])
      for (const scheme of ["light", "dark"])
        for (const layout of ["panel", "page"])
          test(`latest row leaves the final line exposed: ${skin} ${width} ${dir} ${scheme} ${layout}`, async ({
            page,
          }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(
              `/tests/browser/transcript.html?skin=${skin}&scheme=${scheme}&dir=${dir}&layout=${layout}&prose=1`,
            );
            await show(
              page,
              Array.from(
                { length: 20 },
                (_, index) =>
                  `Review detail ${index + 1}. Keep the summary clear and check the wording.\n\nReview the current wording.`,
              ),
            );
            const line = page.locator(".wp-markdown p").last();
            await expect(line).toHaveText("Review the current wording.");
            await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
            await unpinAtTop(page);
            // A geometry move after the gesture ends must not repin.
            await box(page).evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
            await expect(latest(page)).toBeVisible();
            const geometry = await line.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const lines = [...range.getClientRects()];
              const last = lines[lines.length - 1]!;
              const scroller = element.closest(".wp-transcript")!;
              const clip = scroller.getBoundingClientRect();
              const row = scroller.parentElement!.querySelector(
                "[data-back-to-latest]",
              )!;
              const rowRect = row.getBoundingClientRect();
              const button = row.querySelector("button")!;
              const buttonRect = button.getBoundingClientRect();
              const hit = document.elementFromPoint(
                (last.left + last.right) / 2,
                (last.top + last.bottom) / 2,
              );
              return {
                inside:
                  last.top >= clip.top && last.bottom <= clip.bottom + 0.5,
                unobscured: !!hit && element.contains(hit),
                gap: rowRect.top - clip.bottom,
                space: parseFloat(getComputedStyle(row).marginBlockStart),
                reserved: getComputedStyle(row).flexShrink,
                buttonInside:
                  buttonRect.top >= rowRect.top &&
                  buttonRect.bottom <= rowRect.bottom + 0.5,
                sideways: scroller.scrollWidth > scroller.clientWidth + 1,
                live: !!button.closest(
                  '[aria-live], [role="status"], [role="alert"]',
                ),
              };
            });
            expect(geometry.inside).toBe(true);
            expect(geometry.unobscured).toBe(true);
            expect(geometry.gap).toBeGreaterThan(0);
            expect(geometry.gap).toBeCloseTo(geometry.space, 0);
            if (layout === "page") expect(geometry.reserved).toBe("0");
            expect(geometry.buttonInside).toBe(true);
            expect(geometry.sideways).toBe(false);
            expect(geometry.live).toBe(false);
            for (const key of ["Enter", "Space"]) {
              await box(page).focus();
              await page.keyboard.press("Tab");
              await expect(latest(page)).toBeFocused();
              await page.keyboard.press(key);
              await expect(latest(page)).toHaveCount(0);
              await expect(box(page)).toBeFocused();
              await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
              if (key === "Enter") await unpinAtTop(page);
            }
          });

// WCAG relative luminance contrast of two computed rgb() colours.
const contrast = (a: string, b: string) => {
  const lum = (color: string) => {
    const [r, g, bl] = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((value) => {
        const c = Number(value) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
// Whether a focused element's painted outline lies fully inside the scroller
// that holds it, and is a real outline (not none, at least 2 px).
const ringInside = (page: Page, link: string) =>
  page.locator(link).evaluate((element) => {
    const style = getComputedStyle(element);
    const width = parseFloat(style.outlineWidth) || 0;
    const offset = parseFloat(style.outlineOffset) || 0;
    const rect = element.getBoundingClientRect();
    const grow = width + offset;
    const scroller = element.closest("ol")!;
    const clip = scroller.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(scroller).borderTopWidth) || 0;
    const painted = style.outlineStyle !== "none" && width >= 2;
    const inside =
      rect.left - grow >= clip.left + border - 0.5 &&
      rect.right + grow <= clip.right - border + 0.5 &&
      rect.top - grow >= clip.top + border - 0.5 &&
      rect.bottom + grow <= clip.bottom - border + 0.5;
    return { painted, inside };
  });
for (const skin of ["neutral", "antd"])
  for (const colors of ["light", "dark", "forced"])
    test(`CK-FU5 CK-FU6 CK-FU7 the outline: a ring never clipped, a gap under the toggle, a visible scroller edge: ${skin} ${colors}`, async ({
      page,
    }) => {
      if (colors === "forced")
        await page.emulateMedia({ forcedColors: "active" });
      await page.goto(
        `/tests/browser/transcript.html?skin=${skin}&scheme=${colors === "dark" ? "dark" : "light"}`,
        { waitUntil: "domcontentloaded" },
      );
      await show(page, rows(30, "60"));
      const toggle = page.getByRole("button", { name: "Message outline" });
      await toggle.click();
      const list = page.locator("nav[data-outline] ol");
      await expect(list.locator("a")).toHaveCount(30);
      // A gap between the toggle and the list.
      const t = (await toggle.boundingBox())!;
      const l = (await list.boundingBox())!;
      expect(l.y - (t.y + t.height)).toBeGreaterThanOrEqual(4);
      // A visible edge on the scroller.
      expect(
        await list.evaluate((e) =>
          parseFloat(getComputedStyle(e).borderTopWidth),
        ),
      ).toBeGreaterThanOrEqual(1);
      // The first, a middle and the last link, focused by keyboard.
      for (const index of [1, 15, 30]) {
        const selector = `nav[data-outline] li:nth-child(${index}) a`;
        await page.locator(selector).focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(page.locator(selector)).toBeFocused();
        expect(await ringInside(page, selector)).toEqual({
          painted: true,
          inside: true,
        });
      }
    });
test("CK-FU5 the ring checker rejects a box-shadow-only indicator under forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/tests/browser/transcript.html?skin=neutral", {
    waitUntil: "domcontentloaded",
  });
  await page.addStyleTag({
    content:
      ".waypoint nav[data-outline] a:focus-visible { outline: none !important; box-shadow: inset 0 0 0 2px #245ad1; }",
  });
  await page.getByRole("button", { name: "Message outline" }).click();
  const selector = "nav[data-outline] li:nth-child(1) a";
  await page.locator(selector).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  expect((await ringInside(page, selector)).painted).toBe(false);
});

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"])
    test(`CK-FU12 CK-K3 the composer's boundary is 3:1 and native controls follow the scheme: ${skin} ${scheme}`, async ({
      page,
    }) => {
      await page.goto(
        `/tests/browser/transcript.html?skin=${skin}&scheme=${scheme}`,
        { waitUntil: "domcontentloaded" },
      );
      const field = page.getByRole("textbox", { name: "Message" });
      await expect(field).toBeVisible();
      const colors = await field.evaluate((element) => ({
        border: getComputedStyle(element).borderTopColor,
        background: getComputedStyle(element.closest(".waypoint")!)
          .backgroundColor,
        scheme: getComputedStyle(element.closest(".waypoint")!).colorScheme,
      }));
      expect(contrast(colors.border, colors.background)).toBeGreaterThanOrEqual(
        3,
      );
      expect(colors.scheme).toBe(scheme);
    });

for (const scheme of ["light", "dark"])
  test(`CK-FU8 antd button text keeps 4.5:1 when hovered and pressed: ${scheme}`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/browser/transcript.html?skin=antd&scheme=${scheme}`,
      { waitUntil: "domcontentloaded" },
    );
    const toggle = page.getByRole("button", { name: "Message outline" });
    await expect(toggle).toBeVisible();
    const measure = () =>
      toggle.evaluate((element) => ({
        text: getComputedStyle(element).color,
        background: getComputedStyle(element.closest(".waypoint")!)
          .backgroundColor,
      }));
    await toggle.hover();
    // Past antd's colour transition.
    await page.waitForTimeout(400);
    const hovered = await measure();
    expect(contrast(hovered.text, hovered.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    await page.mouse.down();
    await page.waitForTimeout(400);
    const pressed = await measure();
    await page.mouse.up();
    expect(contrast(pressed.text, pressed.background)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

for (const scheme of ["light", "dark"])
  test(`the antd focus ring has at least 3:1 contrast (WCAG 1.4.11): ${scheme}`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/browser/transcript.html?skin=antd&scheme=${scheme}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    const toggle = page.getByRole("button", { name: "Message outline" });
    await expect(toggle).toBeVisible();
    // Keyboard focus, so the ring shows.
    await toggle.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    const colors = await toggle.evaluate((element) => ({
      ring: getComputedStyle(element).outlineColor,
      width: getComputedStyle(element).outlineWidth,
      background: getComputedStyle(element.closest(".waypoint")!)
        .backgroundColor,
    }));
    expect(parseFloat(colors.width)).toBeGreaterThan(0);
    expect(contrast(colors.ring, colors.background)).toBeGreaterThanOrEqual(3);
  });

for (const skin of ["neutral", "antd"]) {
  test(`CK-T2 pinned through every size change and a browser clamp: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    await show(page, rows(11));
    await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
    await show(page, [...rows(10), "400"]);
    await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
    // An earlier message grows without a snapshot (a late image).
    await setHeight(page, 0, 300);
    await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
    // The box itself is resized.
    await box(page).evaluate((element) => {
      element.style.maxBlockSize = "260px";
    });
    await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
    // A downward wheel at the end scrolls nothing; a shrink the browser
    // clamps; then a grow.
    await box(page).hover();
    await page.mouse.wheel(0, 200);
    await armScroll(page);
    await setHeight(page, 10, 10);
    expect(await scrolled(page)).toBe(true);
    await setHeight(page, 10, 600);
    await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
    await expect(latest(page)).toHaveCount(0);
  });

  test(`CK-T2 unpinned: a wheel a nested scroller consumed, then a geometry change, stays unpinned: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    await show(page, ["200:nested", ...rows(9)]);
    await unpinAtTop(page);
    await page.locator("[data-nested]").hover();
    await page.mouse.wheel(0, 100);
    await expect
      .poll(() => page.locator("[data-nested]").evaluate((e) => e.scrollTop))
      .toBeGreaterThan(0);
    expect(await box(page).evaluate((e) => e.scrollTop)).toBe(0);
    await setHeight(page, 1, 300);
    await page.waitForTimeout(100);
    await expect(latest(page)).toBeVisible();
  });

  for (const [distance, pins] of [
    [23, true],
    [24, true],
    [25, false],
  ] as const)
    test(`CK-T4 a downward user scroll ending ${distance} px from the end pins: ${pins}: ${skin}`, async ({
      page,
    }) => {
      await open(page, skin);
      await unpinAtTop(page);
      await userScrollTo(
        page,
        new Function(`return (max) => max - ${distance}`)(),
      );
      expect(Math.round(await end(page))).toBe(distance);
      if (pins) await expect(latest(page)).toHaveCount(0);
      else await expect(latest(page)).toBeVisible();
    });

  test(`CK-T4 touch momentum reaching the end more than 150 ms after the last touchmove pins, through a reconciled delta: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    await unpinAtTop(page);
    await box(page).evaluate(async (element) => {
      const frame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));
      const wait = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));
      element.dispatchEvent(new Event("touchstart"));
      element.dispatchEvent(new Event("touchmove"));
      element.scrollTop = 100;
      await frame();
      document.dispatchEvent(new Event("touchend"));
      const max = () => element.scrollHeight - element.clientHeight;
      for (let step = 0; step < 6; step++) {
        await wait(40);
        // A delta lands between touchend and the last momentum scroll.
        if (step === 3)
          element.querySelector<HTMLElement>("[data-sized]")!.style.height =
            "180px";
        element.scrollTop = step === 5 ? max() : 100 + (step + 1) * 80;
        await frame();
      }
    });
    await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
    await expect(latest(page)).toHaveCount(0);
  });

  test(`CK-T4 a scrollbar drag down to the end pins, a drag up unpins: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    const gutter = await box(page).evaluate(
      (element) => (element as HTMLElement).offsetWidth - element.clientWidth,
    );
    expect(gutter).toBeGreaterThan(0);
    const rect = (await box(page).boundingBox())!;
    const x = rect.x + rect.width - gutter / 2;
    await page.mouse.move(x, rect.y + rect.height - 20);
    await page.mouse.down();
    await page.mouse.move(x, rect.y + rect.height - 120, { steps: 8 });
    await page.mouse.up();
    await expect(latest(page)).toBeVisible();
    await page.waitForTimeout(250);
    await page.mouse.move(x, rect.y + rect.height - 140);
    await page.mouse.down();
    await page.mouse.move(x, rect.y + rect.height + 200, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
    await expect(latest(page)).toHaveCount(0);
  });

  test(`CK-T8 Back to latest by a real click and by Enter: at the end, pinned, focus on the box: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    for (const how of ["click", "Enter"]) {
      await unpinAtTop(page);
      if (how === "click") await latest(page).click();
      else {
        await latest(page).focus();
        await page.keyboard.press("Enter");
      }
      await expect(latest(page)).toHaveCount(0);
      await expect(box(page)).toBeFocused();
      await expect.poll(() => end(page)).toBeLessThanOrEqual(1);
    }
  });

  test(`CK-T9 an outline link moves the box itself, not the page by its URL: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    await page.getByRole("button", { name: "Message outline" }).click();
    const pageTop = await page.evaluate(() => scrollY);
    await page.locator('[data-outline-link="m3"]').click();
    expect(await page.evaluate(() => location.hash)).toBe("");
    expect(await page.evaluate(() => scrollY)).toBe(pageTop);
    await expect
      .poll(() =>
        page
          .locator('article[data-message-id="m3"]')
          .evaluate(
            (row) =>
              row.getBoundingClientRect().top -
              row.closest(".wp-transcript")!.getBoundingClientRect().top,
          ),
      )
      .toBe(0);
    await expect(page.locator('article[data-message-id="m3"]')).toBeFocused();
    await expect(latest(page)).toBeVisible();
  });

  test(`CK-T3 a scrollbar drag that pauses before it moves is still the user's scroll: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    const gutter = await box(page).evaluate(
      (element) => (element as HTMLElement).offsetWidth - element.clientWidth,
    );
    expect(gutter).toBeGreaterThan(0);
    const rect = (await box(page).boundingBox())!;
    const x = rect.x + rect.width - gutter / 2;
    await page.mouse.move(x, rect.y + rect.height - 20);
    await page.mouse.down();
    // The pointer rests on the thumb while the content changes.
    await page.waitForTimeout(300);
    await setHeight(page, 9, 160);
    await page.waitForTimeout(300);
    await page.mouse.move(x, rect.y + rect.height - 140, { steps: 8 });
    await page.mouse.up();
    await expect(latest(page)).toBeVisible();
  });

  test(`the outline: the skin's button, apart from the messages, bounded, no list markers: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    await show(page, rows(30, "60"));
    const toggle = page.getByRole("button", { name: "Message outline" });
    if (skin === "antd") await expect(toggle).toHaveClass(/ant-btn/);
    const gap = async () => {
      const t = (await toggle.boundingBox())!;
      const b = (await box(page).boundingBox())!;
      return b.y - (t.y + t.height);
    };
    expect(await gap()).toBeGreaterThanOrEqual(8);
    await toggle.click();
    const list = page.locator("nav[data-outline] ol");
    await expect(list.locator("a")).toHaveCount(30);
    const listStyle = await list.evaluate((element) => ({
      role: element.getAttribute("role"),
      marker: getComputedStyle(element).listStyleType,
      overflow: getComputedStyle(element).overflowY,
      height: element.clientHeight,
      content: element.scrollHeight,
    }));
    expect(listStyle.role).toBe("list");
    expect(listStyle.marker).toBe("none");
    expect(listStyle.overflow).toBe("auto");
    expect(listStyle.height).toBeLessThanOrEqual(200);
    expect(listStyle.content).toBeGreaterThan(listStyle.height);
    expect(await gap()).toBeGreaterThanOrEqual(8);
  });

  test(`outline links are targets of at least 24 by 24 px that do not overlap (WCAG 2.5.8): ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    await page.getByRole("button", { name: "Message outline" }).click();
    const boxes = await page
      .locator("nav[data-outline] a")
      .evaluateAll((links) =>
        links.slice(0, 5).map((link) => {
          const rect = link.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
            w: rect.width,
            h: rect.height,
          };
        }),
      );
    for (const rect of boxes) {
      expect(rect.h).toBeGreaterThanOrEqual(24);
      expect(rect.w).toBeGreaterThanOrEqual(24);
    }
    for (let i = 1; i < boxes.length; i++)
      expect(boxes[i]!.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom);
  });

  test(`CK-T5 unpinned: the anchor keeps its offset under growth above it and its own removal: ${skin}`, async ({
    page,
  }) => {
    await open(page, skin);
    await unpinAtTop(page);
    await userScrollTo(page, () => 350);
    await page.waitForTimeout(250);
    const anchor = () =>
      box(page).evaluate((element) => {
        const top = element.getBoundingClientRect().top;
        const first = [
          ...element.querySelectorAll<HTMLElement>("article[data-message-id]"),
        ].find((row) => row.getBoundingClientRect().bottom > top + 0.5)!;
        return {
          id: first.getAttribute("data-message-id"),
          offset: Math.round(first.getBoundingClientRect().top - top),
        };
      });
    const before = await anchor();
    await setHeight(page, 0, 400);
    await expect.poll(anchor).toEqual(before);
    await expect(latest(page)).toBeVisible();
    // The anchor itself goes: the next message takes its offset.
    const index = Number(before.id!.slice(1)) - 1;
    const next = rows(10).map((height, at) => (at === 0 ? "400" : height));
    const nextIds = next.map((_, at) => `m${at + 1}`);
    next.splice(index, 1);
    nextIds.splice(index, 1);
    await show(page, next, nextIds);
    await expect
      .poll(anchor)
      .toEqual({ id: `m${index + 2}`, offset: before.offset });
    await expect(latest(page)).toBeVisible();
  });
}
