// Back-fill fixes that need a real browser: forced colours, the look of an
// unavailable action and of neutral buttons, the shell's columns and the
// page layout's height, and the rail's list.
import { test, expect, type Page } from "@playwright/test";

const open = async (page: Page, query: string) => {
  await page.goto(`/tests/browser/layout.html?${query}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("article[data-message-id]").first()).toBeVisible();
  await expect(page.locator(".wp-markdown pre").first()).toBeVisible();
};
const rgb = (page: Page, css: string) =>
  page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, css);
// WCAG relative-luminance contrast of two computed rgb() colours.
const contrast = (a: string, b: string) => {
  const lum = (color: string) => {
    const [r, g, bl] = color
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => {
        const v = Number(part) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test.describe("forced colours", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const skin of ["neutral", "antd"])
    test(`bubbles keep a boundary, the open toggle a cue, and focus a ring: ${skin}`, async ({
      page,
    }) => {
      await page.emulateMedia({ forcedColors: "active" });
      await open(page, `skin=${skin}`);
      const bubble = page.locator('article [data-part="bubble"]').first();
      expect(
        await bubble.evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            style.borderTopStyle !== "none" &&
            parseFloat(style.borderTopWidth) > 0
          );
        }),
      ).toBe(true);
      const toggle = page.getByRole("button", { name: "Conversations" });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        await toggle.evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            (style.outlineStyle !== "none" &&
              parseFloat(style.outlineWidth) > 0) ||
            (style.borderBottomStyle !== "none" &&
              parseFloat(style.borderBottomWidth) >= 2)
          );
        }),
      ).toBe(true);
      const ring = await page.getByRole("dialog").evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
        );
      });
      expect(ring).toBe(true);
    });
});

test.describe("an unavailable action looks unavailable", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  for (const skin of ["neutral", "antd"])
    test(`a blocked Submit is muted, keeps 3:1, and does not change on hover: ${skin}`, async ({
      page,
    }) => {
      await open(page, `skin=${skin}&form=1`);
      const submit = page.getByRole("button", { name: "Submit" });
      await expect(submit).toHaveAttribute("aria-disabled", "true");
      const send = page.locator('[data-part="composer"] button').first();
      const look = (locator: typeof submit) =>
        locator.evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, cursor: style.cursor };
        });
      const blocked = await look(submit);
      const background = await page
        .locator(".waypoint")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const available = await page
        .getByRole("button", { name: "Conversations" })
        .or(page.getByRole("button", { name: "Message outline" }))
        .first()
        .evaluate((element) => getComputedStyle(element).color);
      expect(blocked.color).not.toBe(available);
      expect(blocked.cursor).toBe("not-allowed");
      expect(contrast(blocked.color, background)).toBeGreaterThanOrEqual(3);
      await submit.hover();
      expect((await look(submit)).color).toBe(blocked.color);
      expect(await send.count()).toBeGreaterThan(0);
    });
  test("neutral buttons are drawn from the tokens", async ({ page }) => {
    await open(page, "skin=neutral");
    const button = page.getByRole("button", { name: "Message outline" });
    const style = await button.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        border: computed.borderTopColor,
        width: computed.borderTopWidth,
        radius: computed.borderTopLeftRadius,
        background: computed.backgroundColor,
      };
    });
    const tokens = await page.locator(".waypoint").evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        border: computed.getPropertyValue("--wp-control-border").trim(),
        surface: computed.getPropertyValue("--wp-surface").trim(),
        radius: computed.getPropertyValue("--wp-radius").trim(),
      };
    });
    expect(style.border).toBe(await rgb(page, tokens.border));
    expect(style.width).toBe("1px");
    expect(style.background).toBe(await rgb(page, tokens.surface));
    expect(parseFloat(style.radius)).toBeGreaterThan(0);
  });
});

test.describe("the shell and the page layout", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  for (const skin of ["neutral", "antd"]) {
    test(`without a plan, main takes the room of the plan column: ${skin}`, async ({
      page,
    }) => {
      await open(page, `skin=${skin}`);
      const widths = await page.locator(".wp-shell").evaluate((shell) => ({
        shell: shell.getBoundingClientRect().width,
        main: shell.querySelector("main")!.getBoundingClientRect().width,
      }));
      expect(widths.main / widths.shell).toBeGreaterThanOrEqual(0.7);
    });
    test(`with a plan, the shell has three columns: ${skin}`, async ({
      page,
    }) => {
      await open(page, `skin=${skin}&plan=1`);
      await expect(page.locator(".wp-shell > aside")).toBeVisible();
      const columns = await page
        .locator(".wp-shell")
        .evaluate(
          (shell) =>
            getComputedStyle(shell).gridTemplateColumns.split(" ").length,
        );
      expect(columns).toBe(3);
    });
    test(`in the page layout the transcript fills the height and the composer sits at the bottom: ${skin}`, async ({
      page,
    }) => {
      await open(page, `skin=${skin}&layout=page`);
      const box = await page.evaluate(() => {
        const root = document
          .querySelector(".waypoint")!
          .getBoundingClientRect();
        const main = document.querySelector(".waypoint main")!;
        // The composer and the bar under it are the last of the main column.
        const last = main.lastElementChild!.getBoundingClientRect();
        const composer = document
          .querySelector('[data-part="composer"]')!
          .getBoundingClientRect();
        const transcript = document
          .querySelector(".wp-transcript")!
          .getBoundingClientRect();
        return { root, last, composer, transcript };
      });
      expect(box.transcript.height).toBeGreaterThan(512);
      expect(box.composer.top).toBeGreaterThan(box.transcript.bottom);
      expect(box.root.bottom - box.last.bottom).toBeLessThanOrEqual(32);
    });
  }
  test("in the panel layout the transcript keeps its 32rem cap", async ({
    page,
  }) => {
    await open(page, "skin=neutral&layout=panel");
    const height = await page
      .locator(".wp-transcript")
      .evaluate((element) => getComputedStyle(element).maxBlockSize);
    expect(height).toBe("512px");
  });
});

test("the rail list has no bullets", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "skin=neutral");
  const styles = await page
    .locator('[data-part="rail"] li')
    .evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).listStyleType),
    );
  expect(styles.length).toBeGreaterThan(0);
  for (const style of styles) expect(style).toBe("none");
});

const prose = (page: Page) => page.locator('article[data-message-id="a3"]');
test("an image never exceeds its bubble, at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, "skin=neutral&prose=1");
  const image = prose(page).locator("img");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).complete),
    )
    .toBe(true);
  const fit = await image.evaluate((element) => {
    const bubble = element.closest('[data-part="bubble"]')!;
    return {
      image: element.getBoundingClientRect().width,
      bubble: bubble.getBoundingClientRect().width,
      wide:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
  expect(fit.image).toBeLessThanOrEqual(fit.bubble);
  expect(fit.wide).toBe(false);
});
for (const skin of ["neutral", "antd"])
  test(`blocks are spaced by the token, soft breaks and code whitespace kept: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, `skin=${skin}&prose=1`);
    const message = prose(page);
    await expect(message.getByText("Second paragraph.")).toBeVisible();
    const box = await message.evaluate((element) => {
      const paragraphs = [...element.querySelectorAll(".wp-markdown p")];
      const first = paragraphs.find(
        (p) => p.textContent === "First paragraph.",
      )!;
      const second = paragraphs.find(
        (p) => p.textContent === "Second paragraph.",
      )!;
      const soft = paragraphs.find((p) => p.textContent!.includes("line one"))!;
      const space = parseFloat(
        getComputedStyle(element.closest(".waypoint")!).getPropertyValue(
          "--wp-space",
        ),
      );
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const lineHeight =
        parseFloat(getComputedStyle(soft).lineHeight) ||
        parseFloat(getComputedStyle(soft).fontSize) * 1.2;
      return {
        gap:
          second.getBoundingClientRect().top -
          first.getBoundingClientRect().bottom,
        space: getComputedStyle(element.closest(".waypoint")!)
          .getPropertyValue("--wp-space")
          .trim()
          .endsWith("rem")
          ? space * rem
          : space,
        softLines: soft.getBoundingClientRect().height / lineHeight,
        code: element.querySelector("pre")!.textContent,
      };
    });
    expect(Math.abs(box.gap - box.space)).toBeLessThanOrEqual(1);
    expect(box.softLines).toBeGreaterThan(1.5);
    expect(box.code).toContain("    indented code");
  });

for (const skin of ["neutral", "antd"])
  test(`forced colours: a blocked Submit draws as unavailable: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ forcedColors: "active" });
    await open(page, `skin=${skin}&form=1`);
    const submit = page.getByRole("button", { name: "Submit" });
    await expect(submit).toHaveAttribute("aria-disabled", "true");
    const colours = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "GrayText";
      document.body.append(probe);
      const gray = getComputedStyle(probe).color;
      probe.remove();
      const blocked = document.querySelector('button[aria-disabled="true"]')!;
      return { gray, blocked: getComputedStyle(blocked).color };
    });
    expect(colours.blocked).toBe(colours.gray);
  });
for (const width of [320, 390])
  test(`a Markdown table keeps its words whole and scrolls in its region at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, "skin=neutral&prose=1");
    const region = prose(page).locator("[data-scroll-region]:has(table)");
    await expect(region).toBeVisible();
    const result = await region.evaluate((element) => {
      const cells = [...element.querySelectorAll("td, th")];
      const lines = cells.map((cell) => {
        const style = getComputedStyle(cell);
        const line =
          parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
        const inner =
          cell.getBoundingClientRect().height -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom);
        return inner / line;
      });
      return {
        broken: lines.filter((count) => count > 1.5).length,
        scrolls: element.scrollWidth > element.clientWidth,
        page:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    expect(result.broken).toBe(0);
    expect(result.scrolls).toBe(true);
    expect(result.page).toBe(false);
  });
test("a task list has no bullets, and its done box stands out from the bubble", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "skin=neutral&prose=1");
  const item = prose(page).locator("li:has(input[type=checkbox])").first();
  await expect(item).toBeVisible();
  expect(
    await item.evaluate((element) => getComputedStyle(element).listStyleType),
  ).toBe("none");
  // The centre of each box against the bubble: done stands out, open not.
  const centre = async (index: number) => {
    const box = prose(page).locator("li input[type=checkbox]").nth(index);
    const shot = (await box.screenshot()).toString("base64");
    return page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const [r, g, b] = context.getImageData(
        Math.floor(image.width / 2),
        Math.floor(image.height / 2),
        1,
        1,
      ).data;
      const lum = (red: number, green: number, blue: number) =>
        [red, green, blue]
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const bubble = getComputedStyle(
        document.querySelector(
          'article[data-message-id="a3"] [data-part="bubble"]',
        )!,
      )
        .backgroundColor.match(/\d+/g)!
        .map(Number);
      const [x, y] = [lum(r!, g!, b!), lum(bubble[0]!, bubble[1]!, bubble[2]!)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }, shot);
  };
  expect(await centre(0)).toBeGreaterThanOrEqual(3);
  expect(await centre(1)).toBeLessThan(1.5);
});
for (const skin of ["neutral", "antd"])
  test(`in page layout without a conversation list the chat is a readable width, centred: ${skin}`, async ({
    page,
  }) => {
    const measure = () =>
      page.evaluate(() => {
        const root = document.querySelector(".waypoint")!;
        const style = getComputedStyle(root);
        const outer = root.getBoundingClientRect();
        const left = outer.left + parseFloat(style.paddingLeft);
        const right = outer.right - parseFloat(style.paddingRight);
        const shell = document
          .querySelector(".wp-shell")!
          .getBoundingClientRect();
        const main = document
          .querySelector(".waypoint main")!
          .getBoundingClientRect();
        return {
          room: right - left,
          width: shell.width,
          before: shell.left - left,
          after: right - shell.right,
          main: main.width / shell.width,
          rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        };
      });
    await page.setViewportSize({ width: 1600, height: 900 });
    await open(page, `skin=${skin}&layout=page&norail=1`);
    const wide = await measure();
    expect(wide.width).toBeLessThanOrEqual(60 * wide.rem + 1);
    expect(wide.width).toBeLessThan(wide.room - 100);
    expect(Math.abs(wide.before - wide.after)).toBeLessThanOrEqual(1);
    expect(wide.main).toBeGreaterThanOrEqual(0.95);
    // Narrower than the cap, it still uses the whole width.
    await page.setViewportSize({ width: 700, height: 900 });
    const narrow = await measure();
    expect(narrow.width / narrow.room).toBeGreaterThanOrEqual(0.99);
  });
for (const skin of ["neutral", "antd"])
  test(`a bubble's text and its blocks are spaced by the token: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, `skin=${skin}`);
    const gap = await page.evaluate(() => {
      const bubble = document.querySelector(
        'article[data-message-id="a1"] [data-part="bubble"]',
      )!;
      const text = bubble
        .querySelector(".wp-markdown")!
        .getBoundingClientRect();
      const block = bubble
        .querySelector('[data-part="widgetFrame"]')!
        .getBoundingClientRect();
      const root = document.querySelector(".waypoint")!;
      const value = getComputedStyle(root)
        .getPropertyValue("--wp-space")
        .trim();
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      return {
        gap: block.top - text.bottom,
        space: value.endsWith("rem")
          ? parseFloat(value) * rem
          : parseFloat(value),
      };
    });
    expect(Math.abs(gap.gap - gap.space)).toBeLessThanOrEqual(1);
  });

// The colour at the centre of an element's screenshot, as rgb().
const centreOf = async (page: Page, target: ReturnType<Page["locator"]>) => {
  const shot = (await target.screenshot()).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const [r, g, b] = context.getImageData(
      Math.floor(image.width / 2),
      Math.floor(image.height / 2),
      1,
      1,
    ).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, shot);
};
const bubbleOf = (page: Page, id: string) =>
  page
    .locator(`article[data-message-id="${id}"] [data-part="bubble"]`)
    .evaluate((element) => getComputedStyle(element).backgroundColor);
for (const skin of ["neutral", "antd"])
  for (const scheme of ["light", "dark"])
    test(`an open task box's border keeps 3:1 against the bubble: ${skin}, ${scheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, `skin=${skin}&scheme=${scheme}&prose=1`);
      const open_ = prose(page).locator("li input[type=checkbox]").nth(1);
      const edge = await open_.evaluate(
        (element) => getComputedStyle(element).borderInlineStartColor,
      );
      expect(contrast(edge, await bubbleOf(page, "a3"))).toBeGreaterThanOrEqual(
        3,
      );
    });
for (const skin of ["neutral", "antd"])
  test(`forced colours: a done task box still reads apart from an open one: ${skin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ forcedColors: "active" });
    await open(page, `skin=${skin}&prose=1`);
    const boxes = prose(page).locator("li input[type=checkbox]");
    const done = await centreOf(page, boxes.nth(0));
    const open_ = await centreOf(page, boxes.nth(1));
    const edge = await boxes
      .nth(1)
      .evaluate((element) => getComputedStyle(element).borderInlineStartColor);
    expect(contrast(done, open_)).toBeGreaterThanOrEqual(3);
    expect(contrast(edge, open_)).toBeGreaterThanOrEqual(3);
  });
test("a block quote is indented by the token with a start border, and a quoted table fits at 320 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await open(page, "skin=neutral&quote=1");
  const quote = page.locator('article[data-message-id="a4"] blockquote');
  await expect(quote).toBeVisible();
  const box = await quote.evaluate((element) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(element.closest(".waypoint")!);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const token = root.getPropertyValue("--wp-space").trim();
    const bubble = element.closest('[data-part="bubble"]')!;
    const inner = bubble.getBoundingClientRect();
    const region = element
      .querySelector("[data-scroll-region]")!
      .getBoundingClientRect();
    return {
      gap:
        region.top - element.querySelector("p")!.getBoundingClientRect().bottom,
      start: parseFloat(style.paddingInlineStart),
      margin:
        parseFloat(style.marginInlineStart) + parseFloat(style.marginInlineEnd),
      space: token.endsWith("rem")
        ? parseFloat(token) * rem
        : parseFloat(token),
      border: parseFloat(style.borderInlineStartWidth),
      colour: style.borderInlineStartColor,
      fits:
        region.right <=
        inner.right - parseFloat(getComputedStyle(bubble).paddingRight) + 0.5,
      page:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
  expect(Math.abs(box.start - box.space)).toBeLessThanOrEqual(0.5);
  expect(box.margin).toBe(0);
  // What it quotes is spaced like any other blocks.
  expect(Math.abs(box.gap - box.space)).toBeLessThanOrEqual(1);
  expect(box.border).toBeGreaterThanOrEqual(2);
  expect(
    contrast(box.colour, await bubbleOf(page, "a4")),
  ).toBeGreaterThanOrEqual(3);
  expect(box.fits).toBe(true);
  expect(box.page).toBe(false);
});
