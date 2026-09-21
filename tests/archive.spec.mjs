import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { selectPuzzleForDateKey } from "../puzzle-utils.mjs";

const answers = JSON.parse(fs.readFileSync("jwordl_tier1_expanded_core_vocab_4to6.json", "utf8"));
const yesterday = "2026-03-09";
const today = "2026-03-10";
const puzzle = selectPuzzleForDateKey(answers, yesterday);
const storageKey = "bwordible-state-v2";

async function openArchive(page) {
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("#archiveDialog")).toBeVisible();
}

test("plays and shares an archive puzzle without changing daily progress or streaks", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/?today=${today}`);
  await expect(page.locator(".board-row").first()).toBeVisible();
  await page.keyboard.type("A");
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  await openArchive(page);
  await expect(page.locator('#archiveGrid [data-date="2026-03-10"]')).toBeDisabled();
  await expect(page.locator('#archiveGrid [data-date="2026-03-11"]')).toBeDisabled();
  await expect(page.locator("#archivePrevious")).toBeDisabled();
  await expect(page.locator("#archiveNext")).toBeDisabled();
  await page.locator(`#archiveGrid [data-date="${yesterday}"]`).click();
  await expect(page.locator("#todaySummary")).toContainText("Archive: 9 Mar, 2026");
  await expect(page.locator(".board-row")).toHaveCount(puzzle.maxGuesses);
  await page.keyboard.type(puzzle.answer);
  await page.keyboard.press("Enter");
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(after.stats).toEqual(before.stats);
  expect(after.puzzles).toEqual(before.puzzles);
  expect(after.archive[yesterday].won).toBe(true);
  await page.locator("#resultShareButton").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("MannaGrams Archive");
  await page.reload();
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  await openArchive(page);
  await expect(page.locator("#archiveStats")).toHaveText("Archive: 1 played · 1 solved");
  await page.getByRole("button", { name: "Close", exact: true }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Back to today" }).click();
  await expect(page.locator("#todaySummary")).toContainText("Today: 10 Mar, 2026");
  await expect(page.locator(".tile.filled .tile-letter")).toHaveText(["A"]);
});

test("reviews completed daily games without overwriting them and resumes archive games", async ({ page }) => {
  await page.goto(`/?today=${yesterday}`);
  await expect(page.locator(".board-row").first()).toBeVisible();
  await page.keyboard.type(puzzle.answer);
  await page.keyboard.press("Enter");
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  await page.goto(`/?today=${today}&archive=${yesterday}`);
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  await page.keyboard.type("NOAH");
  const save = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(save.archive[yesterday]).toBeUndefined();
  expect(save.puzzles[yesterday].guesses).toEqual([puzzle.answer]);
  expect(save.stats.wins).toBe(1);
  await page.goto(`/?today=${today}&archive=2026-03-08`);
  await expect(page.locator(".board-row").first()).toBeVisible();
  await page.keyboard.type("A");
  await page.reload();
  await expect(page.locator(".tile.filled .tile-letter")).toHaveText(["A"]);
});

test("continues an unfinished past daily game in a separate archive record", async ({ page }) => {
  await page.goto(`/?today=${yesterday}`);
  await expect(page.locator(".board-row").first()).toBeVisible();
  await page.keyboard.type(puzzle.answer.slice(0, 2));
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  await page.goto(`/?today=${today}&archive=${yesterday}`);
  await expect(page.locator(".tile.filled .tile-letter")).toHaveText(puzzle.answer.slice(0, 2).split(""));
  await page.keyboard.type(puzzle.answer.slice(2));
  await page.keyboard.press("Enter");
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(after.puzzles[yesterday]).toEqual(before.puzzles[yesterday]);
  expect(after.stats.played).toBe(0);
  expect(after.archive[yesterday].won).toBe(true);
});

test("calendar crosses month boundaries, fits a narrow phone and blocks future/deep-linked dates", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?today=2026-05-01");
  await expect(page.locator(".board-row").first()).toBeVisible();
  await openArchive(page);
  await expect(page.locator("#archiveMonth")).toHaveText("April 2026");
  await page.locator("#archivePrevious").click();
  await expect(page.locator("#archiveMonth")).toHaveText("March 2026");
  await expect(page.locator("#archivePrevious")).toBeDisabled();
  const fit = await page.locator("#archiveDialog").evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.width);
  await page.locator("#archiveNext").click();
  await page.locator('#archiveGrid [data-date="2026-04-30"]').click();
  await expect(page.locator("#todaySummary")).toContainText("Archive: 30 Apr, 2026");
  for (const date of ["2026-05-02", "2026-02-28", "2026-04-31"]) {
    await page.goto(`/?today=2026-05-01&archive=${date}`);
    await expect(page.locator("#todaySummary")).toContainText("Today: 1 May, 2026");
    await expect(page.locator("#todayButton")).toBeHidden();
  }
});

test("archive is available offline", async ({ page, context }) => {
  await page.goto(`/?today=${today}`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.locator(".board-row").first()).toBeVisible();
  await context.setOffline(true);
  await openArchive(page);
  await page.locator(`#archiveGrid [data-date="${yesterday}"]`).click();
  await page.reload();
  await expect(page.locator("#todaySummary")).toContainText("Archive: 9 Mar, 2026");
});

test("free access cannot open the archive through its button or URL", async ({ page }) => {
  await page.route("**/entitlements.mjs", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("testing || premiumUntil", "false || premiumUntil") });
  });
  await page.goto(`/?today=${today}&archive=${yesterday}`);
  await expect(page.locator("#todaySummary")).toContainText("Today:");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("#archiveDialog")).not.toBeVisible();
  await expect(page.locator("#toast")).toContainText("included with Premium");
});
