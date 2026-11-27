import { test, expect, type Page } from "@playwright/test";
import { pageErrors } from "./page-errors";
import { boxesOf, gapBelow } from "../boxes";
import { problemStates } from "../../playground/state";

// Every state a reply can be in is one URL away, so it can be looked at and
// shot without typing anything.
const replyRow = (page: Page) =>
  page.locator('[data-part="replyRow"] [role="status"]');
const reply = (page: Page) =>
  page.locator('article[data-role="assistant"]').last();

test("a streaming reply is written a piece at a time", async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto("/?state=streaming");
  await expect(reply(page)).toHaveAttribute("aria-busy", "true");
  await expect(replyRow(page)).toHaveAttribute("data-reply-state", "writing");
  const first = (await reply(page).textContent()) ?? "";
  await expect
    .poll(async () => ((await reply(page).textContent()) ?? "").length)
    .toBeGreaterThan(first.length);
  expect(errors).toEqual([]);
});

test("a finished reply is complete and no longer busy", async ({ page }) => {
  await page.goto("/?state=done");
  await expect(reply(page)).toContainText("Here is a short summary");
  await expect(reply(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(replyRow(page)).toHaveAttribute("data-reply-state", "none");
});

test("Stop is within reach while a reply streams", async ({ page }) => {
  await page.goto("/?state=streaming");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
});

test("a stopped reply keeps its text and is marked stopped", async ({
  page,
}) => {
  await page.goto("/?state=stopped");
  await expect(reply(page).locator("[data-stopped]")).toHaveText("Stopped");
  await expect(reply(page)).toContainText("Your last three orders");
  await expect(replyRow(page)).toHaveAttribute("data-reply-state", "none");
  const text = await reply(page).textContent();
  await page.waitForTimeout(500);
  expect(await reply(page).textContent()).toBe(text);
});

test("a reply's versions are walked in place", async ({ page }) => {
  await page.goto("/?state=versions");
  await expect(reply(page)).toContainText("2/3");
  await reply(page).getByRole("button", { name: "Next version" }).click();
  await expect(reply(page)).toContainText("3/3");
});

test("a finished reply can be copied and rated", async ({ page }) => {
  await page.goto("/?state=done");
  await expect(reply(page).getByRole("button", { name: "Copy" })).toBeVisible();
  await reply(page).getByRole("button", { name: "Good response" }).click();
  await expect(
    reply(page).getByRole("button", { name: "Good response" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("tool steps are named in plain words and expand to the list", async ({
  page,
}) => {
  await page.goto("/?state=tools");
  const steps = page.locator("[data-tool-steps]");
  await expect(steps).toContainText("Reading 3 orders…");
  await expect(steps).toContainText("Checking stock for order 1043…");
  await steps.getByRole("button", { name: "Show all 2 steps" }).click();
  await expect(steps.getByRole("listitem")).toHaveCount(2);
});

test("sources are cited inline and listed under the answer", async ({
  page,
}) => {
  await page.goto("/?state=sources");
  await expect(
    reply(page).getByRole("link", { name: "Source 1: Order 1042" }),
  ).toHaveAttribute("href", "https://example.test/orders/1042");
  await expect(reply(page).locator("[data-sources] summary")).toHaveText(
    "Sources (2)",
  );
});

test("supporting detail sits closed under the answer", async ({ page }) => {
  await page.goto("/?state=details");
  const summary = reply(page).getByText("How this was worked out");
  await expect(summary).toBeVisible();
  await expect(reply(page).locator("details")).not.toHaveAttribute("open");
  await summary.click();
  await expect(reply(page).getByText("Read the last 3 orders")).toBeVisible();
});

test("a reply that never starts is overdue", async ({ page }) => {
  await page.goto("/?state=overdue");
  await expect(replyRow(page)).toHaveAttribute("data-reply-state", "overdue");
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep waiting", exact: true }).click();
  await expect(replyRow(page)).toHaveAttribute("data-reply-state", "writing");
});

test("a reply the host ends with a failed message says it failed", async ({
  page,
}) => {
  await page.goto("/?state=reply-ended-failed");
  await expect(replyRow(page)).toHaveAttribute("data-reply-state", "failed");
  // Said in the reply; the row's live region leaves it to the announcer.
  await expect(reply(page).locator("[data-reply-ended]")).toHaveText(
    "Reply failed",
  );
  await expect(replyRow(page)).toHaveText("");
  // The playground has no versions port: a read would show the same ended
  // reply, so there is no Retry, and the composer is where the user goes on.
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeEditable();
});

for (const state of ["reply-failed", "reply-unavailable"] as const)
  test(`a reply the host ends as ${state} says so`, async ({ page }) => {
    await page.goto(`/?state=${state}`);
    await expect(replyRow(page)).toHaveAttribute(
      "data-reply-state",
      state.slice("reply-".length),
    );
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible();
  });

for (const state of problemStates)
  test(`a send refused with ${state} shows the failed message`, async ({
    page,
  }) => {
    await page.goto(`/?state=${state}`);
    await expect(page.locator('[data-pending-status="failed"]')).toBeVisible();
  });

test("a plan shows its steps", async ({ page }) => {
  await page.goto("/?state=plan");
  await expect(page.locator("[data-plan]")).toBeVisible();
  await expect(page.locator('[data-part="stepRow"]').first()).toBeVisible();
  // Named in the host's words, as a host passes them in `planLabels`.
  const first = page.locator('[data-part="stepRow"]').first();
  await expect(first).toContainText("Order 1");
  await expect(first).toContainText("Status");
  await expect(page.locator("[data-plan]")).not.toContainText("Change 1");
  await expect(page.locator("[data-plan]")).not.toContainText("Value 1");
});

test("a plan whose step failed says which, why, and whether it can be retried", async ({
  page,
}) => {
  await page.goto("/?state=plan-step-failed");
  const failed = page.locator('[data-part="stepRow"]').filter({
    hasText: "The order changed since the plan was made.",
  });
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("It can be tried again");
  await expect(failed).toContainText("Failed");
  await expect(page.locator('[data-part="stepRow"]').first()).toContainText(
    "Done",
  );
  // The failed one stands out: danger tone, and bold so colour is not the
  // only cue.
  const status = failed.locator('[data-tone="danger"] strong');
  await expect(status).toHaveCSS("font-weight", "700");
  const tone = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((node) => getComputedStyle(node).color);
  expect(await tone('[data-part="stepRow"] [data-tone="danger"]')).not.toBe(
    await tone('[data-part="stepRow"] .wp-step-facts li'),
  );
});

test("a form asks for what is missing inline", async ({ page }) => {
  await page.goto("/?state=form");
  await expect(
    reply(page).getByRole("textbox", { name: "Order number (required)" }),
  ).toHaveValue("1043");
});

test("the state is a toolbar choice kept in the URL", async ({ page }) => {
  await page.goto("/?state=done");
  await expect(page.locator("#preview-state")).toHaveValue("done");
  await page.locator("#preview-state").selectOption("overdue");
  await expect(page).toHaveURL(/state=overdue/);
  await expect(replyRow(page)).toHaveAttribute("data-reply-state", "overdue");
});

test("the mock host answers a message typed in any conversation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Welcome to your local preview.", { exact: false }),
  ).toBeVisible();
  const before = await page.locator('article[data-role="assistant"]').count();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Is anyone there?");
  await page.keyboard.press("Enter");
  await expect(page.locator('article[data-role="assistant"]')).toHaveCount(
    before + 1,
  );
  await expect(reply(page)).toContainText("local preview");
  await expect(replyRow(page)).toHaveAttribute("data-reply-state", "none");
});

test.describe("on a phone", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  test("a message's problem keeps its action at the message's side", async ({
    page,
  }) => {
    await page.goto("/?state=error-replaced");
    const message = page.locator('article[data-role="pending"]');
    const refresh = message.getByRole("alert").locator("button");
    await expect(refresh).toBeVisible();
    const [bubble, box] = await boxesOf(page, [
      message.locator('[data-part="bubble"]'),
      refresh,
    ]);
    expect(
      Math.abs(box.x + box.width - (bubble.x + bubble.width)),
    ).toBeLessThan(1);
  });
  test("a message not sent ends its controls at the message's edge", async ({
    page,
  }) => {
    await page.goto("/?state=error-retryable");
    const message = page.locator('article[data-role="pending"]');
    const last = message
      .locator('[data-part="failedSendControls"] button')
      .last();
    await expect(last).toBeVisible();
    const [bubble, box] = await boxesOf(page, [
      message.locator('[data-part="bubble"]'),
      last,
    ]);
    expect(
      Math.abs(box.x + box.width - (bubble.x + bubble.width)),
    ).toBeLessThan(1);
  });
  for (const skin of ["neutral", "antd"])
    test(`a sent message ends its actions at the message's edge: ${skin}`, async ({
      page,
    }) => {
      // The group also holds the empty status that says Copied.
      await page.goto(`/?state=streaming&skin=${skin}`);
      const message = page.locator('article[data-role="user"]').last();
      const last = message
        .locator('[data-part="messageActions"] button')
        .last();
      await expect(last).toBeVisible();
      const [bubble, box] = await boxesOf(page, [
        message.locator('[data-part="bubble"]'),
        last,
      ]);
      expect(
        Math.abs(box.x + box.width - (bubble.x + bubble.width)),
      ).toBeLessThan(1);
    });
  test("a message not sent has its error and Details with it", async ({
    page,
  }) => {
    await page.goto("/?state=error-retryable");
    const message = page.locator('article[data-role="pending"]');
    const error = message.getByRole("alert");
    await expect(error).toHaveText(
      "Something went wrong for a moment. Try again.",
    );
    await expect(message.locator("[data-problem-details]")).toBeVisible();
    // Above the composer, where the message is, and said once.
    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    const [errorBox, composerBox] = await boxesOf(page, [error, composer]);
    expect(errorBox.y).toBeLessThan(composerBox.y);
    await expect(page.locator("[data-problem-details]")).toHaveCount(1);
    await expect(page.locator("[data-announcement]")).toHaveText("");
    // Opening the details moves nothing: the words "Details" stay at the
    // message's side.
    const summary = message.locator("[data-problem-details] summary");
    const words = () =>
      summary.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return Math.round(range.getBoundingClientRect().right);
      });
    const closed = await words();
    await summary.click();
    await expect(message.locator("[data-problem-details]")).toHaveAttribute(
      "open",
      "",
    );
    expect(await words()).toBe(closed);
  });
  test("an inline citation is a 44 by 44 target without moving the text", async ({
    page,
  }) => {
    await page.goto("/?state=sources");
    const cite = reply(page).locator("a[data-wp-cite]").first();
    await expect(cite).toBeVisible();
    // The link's height and the hits on it are read together: the page's
    // layout can change between two round-trips, and the target then sits
    // where it was read, not where it is.
    const measured = await cite.evaluate((link) => {
      const rect = link.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return {
        height: rect.height,
        hits: [
          [x - 21, y],
          [x + 21, y],
          [x, y - 21],
          [x, y + 21],
        ].map(([px, py]) => {
          const hit = document.elementFromPoint(px!, py!);
          return !!hit && (hit === link || link.contains(hit));
        }),
      };
    });
    // The link itself stays inline text, as tall as the line.
    expect(measured.height).toBeLessThan(30);
    expect(measured.hits).toEqual([true, true, true, true]);
  });
  for (const skin of ["neutral", "antd"])
    test(`every control of a reply's form is 44 by 44: ${skin}`, async ({
      page,
    }) => {
      await page.goto(`/?state=form&skin=${skin}`);
      await expect(
        reply(page).getByRole("textbox", { name: "Order number (required)" }),
      ).toBeVisible();
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.waypoint button, .waypoint input:not([type="hidden"]), .waypoint select, .waypoint textarea, .waypoint summary',
          ),
        ]
          .map((element) => ({
            element,
            rect: element.getBoundingClientRect(),
          }))
          .filter(
            ({ rect }) =>
              rect.width > 0 && (rect.width < 43.5 || rect.height < 43.5),
          )
          .map(
            ({ element, rect }) =>
              `${element.tagName.toLowerCase()} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          ),
      );
      expect(small).toEqual([]);
    });
});

test("the reply row's buttons keep a gap from what follows", async ({
  page,
}) => {
  await page.goto("/?state=reply-failed");
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  const below = page.locator('[data-part="flowTabs"] [role="tab"]').first();
  const [retryBox, belowBox] = await boxesOf(page, [retry, below]);
  expect(gapBelow(retryBox, belowBox)).toBeGreaterThanOrEqual(4);
});

// The chat's spacing token (`space`, 0.75rem) between what ends a message
// (its actions; a failed message's problem details) and whatever follows.
for (const skin of ["neutral", "antd"])
  for (const [state, last] of [
    [
      "details",
      'article[data-role="assistant"] [data-part="messageActions"] [role="group"]',
    ],
    ["error-retryable", 'article[data-role="pending"] [data-problem-details]'],
  ] as const)
    test(`the end of a message keeps the chat's spacing from the tabs: ${state}, ${skin}`, async ({
      page,
    }) => {
      await page.goto(`/?state=${state}&skin=${skin}`);
      const end = page.locator(last).last();
      await expect(end).toBeVisible();
      const tab = page.locator('[data-part="flowTabs"] [role="tab"]').first();
      const [endBox, tabBox] = await boxesOf(page, [end, tab]);
      const gap = gapBelow(endBox, tabBox);
      expect(gap).toBeGreaterThanOrEqual(11.5);
    });

// The gap between two boxes is read from one layout. A page's layout can
// change between two round-trips — a message's lazy part lands and the
// message above the tabs grows or shrinks — and a gap read across that
// change belongs to no layout: it can read as an overlap where the reader
// sees the chat's spacing.
test("a gap is read from one layout, not across a change", async ({
  page,
}) => {
  await page.goto("/?state=details&skin=antd");
  const end = page
    .locator(
      'article[data-role="assistant"] [data-part="messageActions"] [role="group"]',
    )
    .last();
  await expect(end).toBeVisible();
  const tab = page.locator('[data-part="flowTabs"] [role="tab"]').first();
  const [endBox, tabBox] = await boxesOf(page, [end, tab]);
  const gap = gapBelow(endBox, tabBox);
  expect(gap).toBeGreaterThanOrEqual(11.5);
  // The message changes its height: what ends it moves, and the tabs move
  // with it.
  const before = (await end.boundingBox())!;
  await page.evaluate(() => {
    const bubble = document.querySelector(
      'article[data-role="assistant"] [data-part="bubble"]',
    );
    if (bubble instanceof HTMLElement) bubble.style.display = "none";
  });
  const after = (await tab.boundingBox())!;
  // Two reads with the change in between: the numbers come from different
  // layouts, and the gap they make says nothing about the spacing.
  expect(gapBelow(before, after)).toBeLessThan(gap);
  // Read in one step, the same two elements keep the spacing they have.
  const [movedEnd, movedTab] = await boxesOf(page, [end, tab]);
  expect(gapBelow(movedEnd, movedTab)).toBeGreaterThanOrEqual(11.5);
});

test("a user's message keeps the chat's spacing from the reply after it", async ({
  page,
}) => {
  await page.goto("/?state=done");
  const copy = page
    .locator('article[data-role="user"] [data-part="messageActions"]')
    .last();
  const button = copy.getByRole("button", { name: "Copy" });
  await expect(button).toBeVisible();
  await expect(reply(page)).not.toHaveAttribute("aria-busy", "true");
  const [box, next] = await boxesOf(page, [
    button,
    reply(page).locator('[data-part="bubble"]'),
  ]);
  expect(gapBelow(box, next)).toBeGreaterThanOrEqual(11.5);
});
