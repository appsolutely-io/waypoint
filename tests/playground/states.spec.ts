import { test, expect, type Page } from "@playwright/test";
import { pageErrors } from "./page-errors";
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
  await expect(replyRow(page)).toHaveText("Reply failed");
});

for (const state of ["reply-failed", "reply-unavailable"] as const)
  test(`a reply the host ends as ${state} says so`, async ({ page }) => {
    await page.goto(`/?state=${state}`);
    await expect(replyRow(page)).toHaveAttribute(
      "data-reply-state",
      state.slice("reply-".length),
    );
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
