import type { Locator, Page } from "@playwright/test";

/** Where an element is and how big it is. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The boxes of the given elements, read in one step.
 *
 * A page's layout can change between two round-trips: a message's lazy part
 * lands and the message above the tabs grows or shrinks. Boxes read across
 * such a change belong to no layout at all, and the gap between them then
 * says nothing about the spacing a reader sees. One evaluate reads them all
 * from the layout the page is in at that moment.
 */
export async function boxesOf<const T extends readonly Locator[]>(
  page: Page,
  locators: T,
): Promise<{ -readonly [K in keyof T]: Box }> {
  const handles = await Promise.all(
    locators.map((locator) => locator.elementHandle()),
  );
  const boxes = await page.evaluate(
    (elements) =>
      elements.map((element) => {
        if (!element) throw new Error("A measured element is gone.");
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    handles,
  );
  return boxes as { -readonly [K in keyof T]: Box };
}

/** The space between the first box's lower edge and the second box's top. */
export function gapBelow(above: Box, below: Box): number {
  return below.y - (above.y + above.height);
}
