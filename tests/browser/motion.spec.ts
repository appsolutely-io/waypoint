// Reduced motion (Table M) in a real browser: nothing inside the chat
// animates, antd's click wave included, whether the preference was set
// before mount or turned on while mounted; scrolls the chat starts land at
// once even on a host page that asks for smooth scrolling.
import { test, expect, type Page } from "@playwright/test";

// After a real press, the longest transition or animation of any element
// in the chat, including nodes added during the press.
const longestMotion = (page: Page) =>
  page.evaluate(async () => {
    const seconds = (value: string) =>
      Math.max(
        0,
        ...value.split(",").map((part) => {
          const text = part.trim();
          return text.endsWith("ms")
            ? parseFloat(text) / 1000
            : parseFloat(text) || 0;
        }),
      );
    const chat = document.querySelector(".waypoint")!;
    let longest = 0;
    const measure = (element: Element) => {
      const style = getComputedStyle(element);
      longest = Math.max(
        longest,
        seconds(style.transitionDuration),
        seconds(style.animationDuration),
      );
    };
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof Element) {
            measure(node);
            node.querySelectorAll("*").forEach(measure);
          }
    });
    observer.observe(chat, { childList: true, subtree: true });
    const button = [...chat.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === "Message outline",
    )!;
    const rect = button.getBoundingClientRect();
    const at = { clientX: rect.x + 5, clientY: rect.y + 5, bubbles: true };
    button.dispatchEvent(new PointerEvent("pointerdown", at));
    button.dispatchEvent(new MouseEvent("mousedown", at));
    button.dispatchEvent(new PointerEvent("pointerup", at));
    button.dispatchEvent(new MouseEvent("mouseup", at));
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    observer.disconnect();
    chat.querySelectorAll("*").forEach(measure);
    return longest;
  });
for (const skin of ["neutral", "antd"])
  for (const when of ["before mount", "while mounted"])
    test(`CK-M1 CK-M2 reduced motion ${when}: nothing in the chat animates after a press: ${skin}`, async ({
      page,
    }) => {
      if (when === "before mount")
        await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/transcript.html?skin=${skin}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("button", { name: "Message outline" }),
      ).toBeVisible();
      if (when === "while mounted")
        await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await longestMotion(page)).toBe(0);
    });
test("CK-M checker: without the preference, antd's wave does animate", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/tests/browser/transcript.html?skin=antd", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Message outline" }),
  ).toBeVisible();
  expect(await longestMotion(page)).toBeGreaterThan(0);
});
test("CK-M3 a host asking for smooth scrolling: the chat's scrolls land at once", async ({
  page,
}) => {
  await page.goto("/tests/browser/transcript.html?skin=neutral", {
    waitUntil: "domcontentloaded",
  });
  await page.addStyleTag({
    content: "html, .wp-transcript { scroll-behavior: smooth !important; }",
  });
  await page.getByRole("button", { name: "Message outline" }).click();
  const offset = await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-outline-link="m3"]')!.click();
    const row = document.querySelector('article[data-message-id="m3"]')!;
    const box = row.closest(".wp-transcript")!;
    return Math.round(
      row.getBoundingClientRect().top - box.getBoundingClientRect().top,
    );
  });
  expect(offset).toBe(0);
});
