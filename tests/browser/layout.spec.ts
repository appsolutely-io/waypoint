// Reflow (Table B) and target sizes (Table S) in a real browser. Each
// checker is also run against a page made wrong on purpose, which it must
// reject.
import { test, expect, type Page } from "@playwright/test";
import { tabAround } from "./tab-around";

const open = async (page: Page, query: string) => {
  await page.goto(`/tests/browser/layout.html?${query}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("article[data-message-id]")).toHaveCount(3);
  // The stock renderer is its own chunk: wait for the rendered content.
  await expect(page.locator(".wp-markdown pre")).toBeVisible();
};

/** Everything that scrolls sideways when it should not. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const wide = (element: Element) =>
      element.scrollWidth > element.clientWidth + 1;
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) found.push("document");
    const container = document.getElementById("container")!;
    if (wide(container)) found.push("container");
    const transcript = document.querySelector(".wp-transcript")!;
    if (wide(transcript)) found.push("transcript");
    for (const element of document.querySelectorAll(".wp-transcript article *"))
      if (wide(element) && !element.closest("[data-scroll-region]"))
        found.push(
          `${element.tagName.toLowerCase()}.${(element as HTMLElement).className}`,
        );
    return found;
  });

/** Every named scroller can be focused and scrolled to its end by keyboard. */
async function scrollersReachTheEnd(page: Page) {
  const scrollers = page.locator("[data-scroll-region]");
  const count = await scrollers.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    const scroller = scrollers.nth(index);
    expect(await scroller.getAttribute("tabindex")).toBe("0");
    expect(await scroller.getAttribute("aria-label")).toBeTruthy();
    const overflow = await scroller.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    if (overflow <= 1) continue;
    await scroller.focus();
    // Keyboard scrolling animates; wait for each step to settle.
    for (let press = 0; press < 400; press++) {
      const left = await scroller.evaluate((element) => element.scrollLeft);
      if (left >= overflow - 1) break;
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(20);
    }
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) =>
            element.scrollLeft >= element.scrollWidth - element.clientWidth - 1,
        ),
      )
      .toBe(true);
  }
}

const widths: [string, number, number][] = [
  ["320×256", 320, 256],
  ["375", 375, 740],
  ["390", 390, 844],
  ["768", 768, 1024],
  ["1280", 1280, 900],
];
for (const skin of ["neutral", "antd"])
  for (const layout of ["panel", "page", "floating", "sheet"])
    for (const [name, width, height] of widths)
      test(`CK-B1 CK-B2 CK-B4 nothing scrolls sideways, scrollers reach their end: ${skin} ${layout} ${name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await open(page, `skin=${skin}&layout=${layout}`);
        expect(await sideways(page)).toEqual([]);
        await scrollersReachTheEnd(page);
      });
// The chat renders again on its own when the reply it waits for turns
// overdue (15 s after the user's message). A code block being scrolled by
// keyboard keeps its focus and position through that render.
test("CK-B2 a code block keeps keyboard focus and scroll when the chat renders again", async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "skin=neutral");
  const code = page.locator(".wp-markdown pre[data-scroll-region]").first();
  await code.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => code.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  const before = await code.evaluate((element) => element.scrollLeft);
  // Past the reply's 15 s: the reply row turns overdue and the chat renders.
  await page.clock.fastForward(16000);
  await expect(page.locator('[data-reply-state="overdue"]')).toHaveCount(1);
  expect(
    await code.evaluate((element) => document.activeElement === element),
  ).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => code.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(before);
});
for (const skin of ["neutral", "antd"])
  test(`CK-B4 at 200% text in 375 nothing scrolls sideways: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await open(page, `skin=${skin}&text=200`);
    expect(await sideways(page)).toEqual([]);
  });

test("CK-B checker: a clipped message is rejected", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 256 });
  await open(page, "skin=neutral");
  await page.addStyleTag({
    content:
      ".wp-transcript article p { overflow: hidden !important; white-space: pre !important; }",
  });
  expect(await sideways(page)).not.toEqual([]);
});
test("CK-B checker: a transcript-wide sideways scroller is rejected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 256 });
  await open(page, "skin=neutral");
  await page.addStyleTag({
    content:
      ".wp-transcript { overflow-x: auto !important; } .wp-transcript article { min-inline-size: 900px; }",
  });
  expect(await sideways(page)).toContain("transcript");
});

/** Targets too small, under the fine (24, or spacing) or coarse (44) rule. */
const smallTargets = (page: Page, minimum: 24 | 44) =>
  page.evaluate((least) => {
    const chat = document.querySelector(".waypoint")!;
    const targets = [
      ...chat.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      // Inline links in message text are exempt.
      if (element.matches(".wp-markdown a")) return false;
      // Named scrollers are regions, not controls.
      if (element.matches("[data-scroll-region]")) return false;
      return true;
    });
    const rects = targets.map((element) => element.getBoundingClientRect());
    const small: string[] = [];
    targets.forEach((element, index) => {
      const rect = rects[index]!;
      if (rect.width >= least - 0.5 && rect.height >= least - 0.5) return;
      if (least === 24) {
        // WCAG 2.5.8 spacing: a 24 px circle on its centre overlaps no
        // other target and no other small target's circle.
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const clear = rects.every((other, at) => {
          if (at === index) return true;
          const dx = Math.max(other.left - cx, 0, cx - other.right);
          const dy = Math.max(other.top - cy, 0, cy - other.bottom);
          return Math.hypot(dx, dy) >= 12;
        });
        if (clear) return;
      }
      small.push(
        `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      );
    });
    return small;
  }, minimum);

for (const skin of ["neutral", "antd"])
  test(`CK-S1 CK-S5 every target is 24 by 24 or spaced: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await open(page, `skin=${skin}`);
    expect(await smallTargets(page, 24)).toEqual([]);
  });
for (const size of ["small", "middle", "large"])
  for (const compact of ["", "1"])
    test(`CK-S2 antd targets are 24 by 24 under a host ${size}${compact ? " compact" : ""} theme`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, `skin=antd&antdSize=${size}&compact=${compact}`);
      const sizes = await page
        .locator(".waypoint .ant-btn, .waypoint .ant-input, .waypoint textarea")
        .evaluateAll((elements) =>
          elements
            .filter((element) => element.getBoundingClientRect().height > 0)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return [Math.round(rect.width), Math.round(rect.height)];
            }),
        );
      expect(sizes.length).toBeGreaterThan(0);
      for (const [width, height] of sizes) {
        expect(width).toBeGreaterThanOrEqual(24);
        expect(height).toBeGreaterThanOrEqual(24);
      }
    });

for (const size of ["small", "middle", "large"])
  for (const compact of ["", "1"])
    test(`CK-S3 antd buttons keep the host's ${size}${compact ? " compact" : ""} control height`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(
        page,
        `skin=antd&antdSize=${size}&compact=${compact}&reference=1`,
      );
      const reference = await page
        .locator("[data-reference]")
        .evaluate((element) => element.getBoundingClientRect().height);
      const heights = await page
        .locator(".waypoint .ant-btn")
        .evaluateAll((elements) =>
          elements
            .map((element) => element.getBoundingClientRect().height)
            .filter((height) => height > 0),
        );
      expect(heights.length).toBeGreaterThan(0);
      // Never under the 24 px target, whatever the host's size.
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(
        Math.max(24, reference) - 0.5,
      );
    });

test.describe("a coarse pointer", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  for (const skin of ["neutral", "antd"])
    test(`CK-S4 every chat control is 44 by 44: ${skin}`, async ({ page }) => {
      await open(page, `skin=${skin}`);
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      expect(await smallTargets(page, 44)).toEqual([]);
    });
  test("CK-S checker: a 24 by 44 icon button is rejected", async ({ page }) => {
    await open(page, "skin=neutral");
    // One real button shrunk to an icon's width.
    await page.addStyleTag({
      content:
        '.waypoint [data-part="composer"] button { min-inline-size: 0 !important; inline-size: 24px !important; padding: 0 !important; }',
    });
    expect(await smallTargets(page, 44)).not.toEqual([]);
  });
  test("CK-S checker: without the coarse rule, targets are rejected", async ({
    page,
  }) => {
    await open(page, "skin=neutral");
    await page.addStyleTag({
      content:
        ".waypoint button, .waypoint a, .waypoint summary, .waypoint select, .waypoint [role=tab] { min-block-size: 24px !important; min-inline-size: 24px !important; }",
    });
    expect(await smallTargets(page, 44)).not.toEqual([]);
  });
});
test("CK-S checker: a fine pointer passes at 24", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "skin=neutral");
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(false);
});

for (const skin of ["neutral", "antd"])
  test(`CK-N1 CK-N2 a container-only resize moves the rail behind its toggle and back: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, `skin=${skin}`);
    const toggle = page.getByRole("button", { name: "Conversations" });
    const pageRail = page.locator('[data-part="rail"] nav');
    await expect(pageRail).toBeVisible();
    await expect(toggle).toHaveCount(0);
    await page.locator("#container").evaluate((element) => {
      (element as HTMLElement).style.inlineSize = "320px";
    });
    await expect(toggle).toBeVisible();
    await expect(pageRail).toHaveCount(0);
    await toggle.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Another conversation" })
      .focus();
    await page.locator("#container").evaluate((element) => {
      (element as HTMLElement).style.inlineSize = "1000px";
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      pageRail.getByRole("button", { name: "Another conversation" }),
    ).toBeFocused();
  });
// The scroller of the drawer's list, in either skin.
const drawerScroller = (page: Page) =>
  page.locator(
    '[role="dialog"] .wp-drawer-body, [role="dialog"] .ant-drawer-body',
  );
for (const skin of ["neutral", "antd"])
  test(`CK-N5 CK-B4 a long list scrolls inside the drawer, which fits the viewport, at 320 by 256: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await open(page, `skin=${skin}&many=1`);
    await page.getByRole("button", { name: "Conversations" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Past the drawer's opening slide, which starts off the edge.
    await page.waitForTimeout(500);
    expect(await sideways(page)).toEqual([]);
    const before = await page.evaluate(() => scrollY);
    const box = await dialog.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(256 + 0.5);
    const scroller = drawerScroller(page);
    expect(
      await scroller.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      dialog.getByRole("button", { name: "Conversation 59" }),
    ).toBeInViewport();
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(
      dialog.getByRole("button", { name: "Close" }),
    ).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(before);
  });
for (const skin of ["neutral", "antd"])
  test(`A11Y focus never leaves the open drawer, and the composer shortcut waits: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await open(page, `skin=${skin}`);
    const toggle = page.getByRole("button", { name: "Conversations" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const reached = await tabAround(page, dialog, 6);
    expect(reached).toContain("Close");
    expect(reached).toContain("Another conversation");
    await dialog.getByRole("button", { name: "Layout" }).focus();
    await page.keyboard.press("/");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Layout" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });
for (const skin of ["neutral", "antd"])
  test(`R4 the drawer is a sheet over the chat, headed, with Close before the list: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `skin=${skin}`);
    const transcript = page.locator(".wp-transcript");
    const top = (await transcript.boundingBox())!.y;
    const toggle = page.getByRole("button", { name: "Conversations" });
    await toggle.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // antd draws its own title; the neutral drawer's is a heading.
    await expect(
      skin === "neutral"
        ? dialog.getByRole("heading", { name: "Conversations" })
        : dialog.getByText("Conversations", { exact: true }),
    ).toBeVisible();
    // Over the chat: nothing of the chat moves.
    expect((await transcript.boundingBox())!.y).toBe(top);
    const order = await dialog.evaluate((element) => {
      const close = [...element.querySelectorAll("button")].find(
        (button) => button.getAttribute("aria-label") === "Close",
      )!;
      const first = element.querySelector("[data-conversation-id] button")!;
      return !!(
        close.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
    expect(order).toBe(true);
    const surface = await page
      .locator(".wp-drawer, .ant-drawer-content")
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(surface).not.toBe("rgba(0, 0, 0, 0)");
  });
test("R4 the neutral toggle looks pressed while the drawer is open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "skin=neutral");
  const toggle = page.getByRole("button", { name: "Conversations" });
  const look = () =>
    toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.backgroundColor} ${style.boxShadow} ${style.borderColor}`;
    });
  const closed = await look();
  await toggle.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await look()).not.toBe(closed);
});
for (const skin of ["neutral", "antd"])
  test(`R4 the toggle and the title share the top row: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `skin=${skin}`);
    const toggle = (await page
      .getByRole("button", { name: "Conversations" })
      .boundingBox())!;
    const title = (await page
      .locator('[data-part="topBar"] h2')
      .boundingBox())!;
    expect(title.y).toBeLessThan(toggle.y + toggle.height);
    expect(toggle.y).toBeLessThan(title.y + title.height);
    expect(title.x).toBeGreaterThanOrEqual(toggle.x + toggle.width);
  });
for (const skin of ["neutral", "antd"])
  test(`R4 table columns stay apart: ${skin}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, `skin=${skin}`);
    const paddings = await page
      .locator(".wp-transcript table th, .wp-transcript table td")
      .evaluateAll((cells) =>
        cells.map((cell) => {
          const style = getComputedStyle(cell);
          return [
            parseFloat(style.paddingInlineStart),
            parseFloat(style.paddingInlineEnd),
          ];
        }),
      );
    expect(paddings.length).toBeGreaterThan(0);
    for (const [start, end] of paddings) {
      expect(start).toBeGreaterThanOrEqual(4);
      expect(end).toBeGreaterThanOrEqual(4);
    }
  });
for (const skin of ["neutral", "antd"])
  test(`R4 an alert's Retry stands apart from its sentence: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/tests/browser/layout.html?skin=${skin}&railFails=1`, {
      waitUntil: "domcontentloaded",
    });
    const alert = page.locator('[data-part="rail"] [role="alert"]');
    await expect(alert).toBeVisible();
    const gap = await alert.evaluate((element) => {
      const button = element.querySelector("button")!;
      const text = [...element.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim(),
      )!;
      const range = document.createRange();
      range.selectNodeContents(text);
      // The sentence may wrap: its last line is what the action follows.
      const lines = range.getClientRects();
      const words = lines[lines.length - 1]!;
      const control = button.getBoundingClientRect();
      // Beside it on the same line, or on a line of its own.
      return control.top >= words.bottom - 1
        ? Infinity
        : control.left - words.right;
    });
    expect(gap).toBeGreaterThanOrEqual(4);
  });

for (const skin of ["neutral", "antd"])
  test(`A11Y a threaded list: focus reaches the collapsed threads' summary, then the opened thread, never outside: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await open(page, `skin=${skin}&threads=1`);
    await page.getByRole("button", { name: "Conversations" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    await dialog.focus();
    let reached = await tabAround(page, dialog, 6);
    expect(reached).toContain("Sub-threads");
    expect(reached).not.toContain("A thread");
    await dialog.locator("summary").focus();
    await expect(dialog.locator("summary")).toHaveCSS("outline-offset", "-2px");
    await dialog.locator("summary").click();
    await expect(
      dialog.getByRole("button", { name: "A thread" }),
    ).toBeVisible();
    reached = await tabAround(page, dialog, 7);
    expect(reached).toContain("A thread");
  });

for (const skin of ["neutral", "antd"])
  for (const [width, height] of [
    [390, 844],
    [1280, 900],
  ] as const)
    test(`R4 the top row keeps space above the outline toggle: ${skin} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await open(page, `skin=${skin}`);
      const bar = (await page.locator('[data-part="topBar"]').boundingBox())!;
      const toggle = (await page
        .getByRole("button", { name: "Message outline" })
        .boundingBox())!;
      expect(toggle.y - (bar.y + bar.height)).toBeGreaterThanOrEqual(4);
    });
for (const skin of ["neutral", "antd"])
  test(`R4 a Retry that wraps lines up with its sentence: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/tests/browser/layout.html?skin=${skin}&railFails=1`, {
      waitUntil: "domcontentloaded",
    });
    const alert = page.locator('[data-part="rail"] [role="alert"]');
    await expect(alert).toBeVisible();
    // Too narrow for both on one line.
    await alert.evaluate((element) => {
      (element as HTMLElement).style.inlineSize = "7rem";
    });
    const edges = await alert.evaluate((element) => {
      const button = element.querySelector("button")!;
      const text = [...element.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim(),
      )!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const words = range.getClientRects()[0]!;
      const control = button.getBoundingClientRect();
      return {
        wrapped: control.top >= words.bottom - 1,
        text: words.left,
        control: control.left,
      };
    });
    expect(edges.wrapped).toBe(true);
    expect(Math.abs(edges.control - edges.text)).toBeLessThanOrEqual(1);
  });
for (const skin of ["neutral", "antd"])
  test(`R4 the focused drawer's ring stays on screen at phone width: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `skin=${skin}`);
    await page.getByRole("button", { name: "Conversations" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeFocused();
    // Past antd's opening slide, which starts off the edge.
    await expect
      .poll(
        async () =>
          (await dialog.boundingBox())!.x + (await dialog.boundingBox())!.width,
      )
      .toBeLessThanOrEqual(390);
    const ring = await dialog.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const reach =
        parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
      return {
        shown:
          style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
        left: rect.left - reach,
        right: rect.right + reach,
        top: rect.top - reach,
        bottom: rect.bottom + reach,
      };
    });
    expect(ring.shown).toBe(true);
    expect(ring.left).toBeGreaterThanOrEqual(0);
    expect(ring.top).toBeGreaterThanOrEqual(0);
    expect(ring.right).toBeLessThanOrEqual(390);
    expect(ring.bottom).toBeLessThanOrEqual(844);
  });

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"])
    for (const edge of ["top", "bottom"])
      test(`drawer summary has room at the scroll edge: ${skin} ${scheme} ${edge}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width: 375, height: 600 });
        await open(page, `skin=${skin}&scheme=${scheme}&threads=1`);
        await page
          .getByRole("button", { name: "Conversations", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        const summary = dialog.locator("summary");
        await summary.evaluate((element) => {
          const row = element.closest("li")!;
          const list = row.parentElement!;
          for (const position of ["before", "after"])
            for (let index = 0; index < 40; index++) {
              const item = document.createElement("li");
              const button = document.createElement("button");
              button.textContent = `${position} conversation ${index}`;
              item.append(button);
              if (position === "before") list.insertBefore(item, row);
              else list.append(item);
            }
        });
        await page.keyboard.press("Tab");
        await summary.focus();
        const metrics = await summary.evaluate((element, edge) => {
          const scroller = element.closest(
            ".wp-drawer-body, .ant-drawer-body",
          )!;
          const clip = scroller.getBoundingClientRect();
          const own = element.getBoundingClientRect();
          const top = clip.top + scroller.clientTop;
          const bottom = top + scroller.clientHeight;
          scroller.scrollTop +=
            edge === "top" ? own.top - top : own.bottom - bottom;
          const bounds = element.getBoundingClientRect();
          const previous =
            element.parentElement!.previousElementSibling!.getBoundingClientRect();
          const css = getComputedStyle(element);
          return {
            gap: bounds.top - previous.bottom,
            padding: parseFloat(css.paddingInlineStart),
            offset: parseFloat(css.outlineOffset),
            outline: css.outlineStyle,
            left: bounds.left - clip.left - scroller.clientLeft,
            right:
              clip.left +
              scroller.clientLeft +
              scroller.clientWidth -
              bounds.right,
            top: bounds.top - top,
            bottom: bottom - bounds.bottom,
          };
        }, edge);
        await drawerScroller(page).screenshot({
          path: info.outputPath(`drawer-summary-${skin}-${scheme}-${edge}.png`),
          animations: "disabled",
        });
        expect(metrics.gap).toBeGreaterThan(0);
        expect(metrics.padding).toBeGreaterThan(0);
        expect(metrics.offset).toBeLessThan(0);
        expect(metrics.outline).toBe("solid");
        expect(metrics.left).toBeGreaterThanOrEqual(-1);
        expect(metrics.right).toBeGreaterThanOrEqual(-1);
        expect(metrics.top).toBeGreaterThanOrEqual(-1);
        expect(metrics.bottom).toBeGreaterThanOrEqual(-1);
      });
