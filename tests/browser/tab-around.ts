// Focus containment as a modal dialog has it: with a drawer open, Tab and
// Shift+Tab never put focus on anything outside it (focus may leave the
// page for the browser's own controls, as with a native modal dialog).
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Presses Tab, then Shift+Tab, `count` times each, checking after every
 * press; returns the names of the controls focus reached.
 */
export async function tabAround(
  page: Page,
  dialog: Locator,
  count: number,
): Promise<string[]> {
  const reached = new Set<string>();
  for (const key of ["Tab", "Shift+Tab"])
    for (let press = 0; press < count; press++) {
      await page.keyboard.press(key);
      const where = await dialog.evaluate((own) => {
        let active: Element | null = document.activeElement;
        while (active?.shadowRoot?.activeElement)
          active = active.shadowRoot.activeElement;
        if (!active || active === document.body)
          return { outside: false, name: "", what: "the page itself" };
        let inside = false;
        for (let node: Node | null = active; node;) {
          if (node === own) {
            inside = true;
            break;
          }
          node =
            node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
        }
        return {
          outside: !inside,
          name:
            active.getAttribute("aria-label") ??
            active.textContent?.trim() ??
            "",
          what: active.outerHTML.slice(0, 120),
        };
      });
      expect(where.outside, `${key} reached ${where.what}`).toBe(false);
      if (where.name) reached.add(where.name);
    }
  return [...reached];
}
