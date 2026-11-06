// Who wrote each message, seen as well as read: the sender first in each
// bubble, and the user's messages apart from the assistant's.
import { test, expect, type Page } from "@playwright/test";

const open = async (page: Page, query: string) => {
  await page.goto(`/tests/browser/layout.html?${query}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("article[data-message-id]").first()).toBeVisible();
  await expect(page.locator(".wp-markdown").first()).toBeVisible();
};
// Any CSS colour (color-mix included) as sRGB bytes, read back from a canvas.
const bytes = (page: Page, colours: string[]) =>
  page.evaluate((values) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    return values.map((value) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    });
  }, colours);
const contrast = (a: number[], b: number[]) => {
  const lum = (rgb: number[]) =>
    rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// The bubble, sender label and text of a message, as drawn.
const look = (page: Page, id: string) =>
  page.locator(`article[data-message-id="${id}"]`).evaluate((article) => {
    const bubble = article.querySelector('[data-part="bubble"]')!;
    const sender = bubble.querySelector("[data-sender]")!;
    const text = bubble.querySelector(".wp-markdown")!;
    const box = bubble.getBoundingClientRect();
    const transcript = article.parentElement!.getBoundingClientRect();
    return {
      left: box.left - transcript.left,
      right: transcript.right - box.right,
      background: getComputedStyle(bubble).backgroundColor,
      sender: getComputedStyle(sender).color,
      text: getComputedStyle(text).color,
      link: text.querySelector("a")
        ? getComputedStyle(text.querySelector("a")!).color
        : undefined,
      accent: getComputedStyle(article).getPropertyValue("--wp-accent"),
      surface: getComputedStyle(article).getPropertyValue("--wp-surface"),
      first: bubble.firstElementChild === sender,
    };
  });

for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"])
    test(`user and assistant messages look apart, each labelled legibly: ${skin}, ${scheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, `skin=${skin}&scheme=${scheme}`);
      const user = await look(page, "u1");
      const assistant = await look(page, "a1");
      expect(user.first && assistant.first).toBe(true);
      // The user's bubble at the inline end, the assistant's at the start.
      expect(user.right).toBeLessThanOrEqual(1);
      expect(user.left).toBeGreaterThan(assistant.left + 20);
      expect(assistant.left).toBeLessThanOrEqual(1);
      const [userBg, assistantBg, userSender, assistantSender, userText] =
        await bytes(page, [
          user.background,
          assistant.background,
          user.sender,
          assistant.sender,
          user.text,
        ]);
      expect(userBg).not.toEqual(assistantBg);
      expect(contrast(userSender!, userBg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(assistantSender!, assistantBg!)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(userText!, userBg!)).toBeGreaterThanOrEqual(4.5);
      const [link] = await bytes(page, [user.link!]);
      expect(contrast(link!, userBg!)).toBeGreaterThanOrEqual(4.5);
      // The tint: 12% of the accent in light, 16% in dark, where the
      // surfaces are closer.
      const share = scheme === "dark" ? 0.16 : 0.12;
      const [accent, surface] = await bytes(page, [
        user.accent.trim(),
        user.surface.trim(),
      ]);
      const expected = accent!.map(
        (v, i) => v * share + surface![i]! * (1 - share),
      );
      for (const [i, v] of userBg!.entries())
        expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(2);
    });
test("in a right-to-left chat the user's messages sit at the left", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "skin=neutral&scheme=light");
  await page.evaluate(() =>
    document.querySelector(".waypoint")!.setAttribute("dir", "rtl"),
  );
  const user = await look(page, "u1");
  expect(user.left).toBeLessThanOrEqual(1);
  expect(user.right).toBeGreaterThan(20);
});
test("under forced colours the user's messages still sit apart", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, "skin=neutral&scheme=light");
  const user = await look(page, "u1");
  const assistant = await look(page, "a1");
  expect(user.right).toBeLessThanOrEqual(1);
  expect(user.left).toBeGreaterThan(assistant.left + 20);
});

// A host theme's colours are not checked by the library, so its user bubble
// keeps the plain surface, set apart by an accent edge instead of a fill.
for (const scheme of ["light", "dark"])
  test(`under a host theme the user's bubble keeps the surface, with an accent start edge: ${scheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, `skin=neutral&scheme=${scheme}&theme=1`);
    const user = await look(page, "u1");
    const assistant = await look(page, "a1");
    const edge = await page
      .locator('article[data-message-id="u1"] [data-part="bubble"]')
      .evaluate((bubble) => {
        const style = getComputedStyle(bubble);
        return {
          start: parseFloat(style.borderInlineStartWidth),
          left: parseFloat(style.borderLeftWidth),
          colour: style.borderInlineStartColor,
        };
      });
    const [userBg, assistantBg, sender, link, colour] = await bytes(page, [
      user.background,
      assistant.background,
      user.sender,
      user.link!,
      edge.colour,
    ]);
    expect(userBg).toEqual(assistantBg);
    expect(contrast(sender!, userBg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(link!, userBg!)).toBeGreaterThanOrEqual(4.5);
    expect(edge.start).toBeGreaterThanOrEqual(3);
    expect(edge.left).toBe(edge.start);
    expect(contrast(colour!, userBg!)).toBeGreaterThanOrEqual(3);
    expect(user.right).toBeLessThanOrEqual(1);
  });
test("under a host theme, right to left, the accent edge is on the right", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "skin=neutral&scheme=light&theme=1");
  await page.evaluate(() =>
    document.querySelector(".waypoint")!.setAttribute("dir", "rtl"),
  );
  const edge = await page
    .locator('article[data-message-id="u1"] [data-part="bubble"]')
    .evaluate((bubble) => {
      const style = getComputedStyle(bubble);
      return {
        left: parseFloat(style.borderLeftWidth),
        right: parseFloat(style.borderRightWidth),
      };
    });
  expect(edge.right).toBeGreaterThanOrEqual(3);
  expect(edge.left).toBe(0);
});
// A chat inside another chat, or a host that sets the same properties, keeps
// its own bubble: nothing of the outer setting leaks in.
test("a chat inside a plain-bubble chat keeps its own tinted bubble", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "skin=neutral&scheme=light");
  await page.evaluate(() => {
    const chat = document.querySelector(".waypoint")!;
    const outer = document.createElement("section");
    outer.className = "waypoint";
    outer.setAttribute("data-custom-theme", "");
    outer.style.setProperty("--wp-user-edge", "3px");
    outer.style.setProperty("--wp-user-tint", "0%");
    chat.parentElement!.insertBefore(outer, chat);
    outer.append(chat);
  });
  const edge = await page
    .locator('article[data-message-id="u1"] [data-part="bubble"]')
    .evaluate((bubble) =>
      parseFloat(getComputedStyle(bubble).borderInlineStartWidth),
    );
  const user = await look(page, "u1");
  const assistant = await look(page, "a1");
  const [userBg, assistantBg] = await bytes(page, [
    user.background,
    assistant.background,
  ]);
  expect(edge).toBe(0);
  expect(userBg).not.toEqual(assistantBg);
});
