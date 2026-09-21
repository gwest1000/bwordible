import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { selectPuzzleForDateKey } from "../puzzle-utils.mjs";
import { createDefaultSave, createPuzzleProgress } from "../progress-store.mjs";

const answers = JSON.parse(fs.readFileSync("jwordl_tier1_expanded_core_vocab_4to6.json", "utf8"));
const yesterday = "2026-03-09";
const today = "2026-03-10";
const puzzle = selectPuzzleForDateKey(answers, yesterday);
const storageKey = "bwordible-state-v2";

async function seed(page, save) {
  await page.addInitScript(({ key, save }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
  }, { key: storageKey, save });
}

test("missed and unfinished games are disabled and cannot open through archive URLs", async ({ page }) => {
  const save = createDefaultSave();
  save.puzzles[yesterday] = { ...createPuzzleProgress(), currentGuess: "A" };
  save.archive["2026-03-08"] = { ...createPuzzleProgress(), currentGuess: "B" };
  await seed(page, save);
  await page.goto(`/?today=${today}`);
  await expect(page.locator(".board-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  for (const date of ["2026-03-07", "2026-03-08", yesterday, today]) {
    await expect(page.locator(`#archiveGrid [data-date="${date}"]`)).toBeDisabled();
  }
  for (const date of ["2026-03-07", "2026-03-08", yesterday]) {
    await page.goto(`/?today=${today}&archive=${date}`);
    await expect(page.locator("#todaySummary")).toContainText("Today: 10 Mar, 2026");
    await expect(page.locator("#todayButton")).toBeHidden();
  }
  const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(after.puzzles[yesterday]).toEqual(save.puzzles[yesterday]);
  expect(after.archive).toEqual(save.archive);
});

test("completed daily games can be reviewed and shared offline without changing history", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/?today=${yesterday}`);
  await expect(page.locator(".board-row").first()).toBeVisible();
  await page.keyboard.type(puzzle.answer);
  await page.keyboard.press("Enter");
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  await page.goto(`/?today=${today}`);
  await expect(page.locator(".board-row").first()).toBeVisible();
  await page.keyboard.type("A");
  const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.locator(`#archiveGrid [data-date="${yesterday}"]`).click();
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  await page.keyboard.type("NOAH");
  await page.keyboard.press("Enter");
  await page.locator("#resultShareButton").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("MannaGrams Archive");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(after.puzzles).toEqual(before.puzzles);
  expect(after.archive).toEqual(before.archive);
  expect(after.stats.played).toBe(before.stats.played);
  expect(after.stats.wins).toBe(before.stats.wins);
  await expect(page.locator("#winStreak")).toHaveText("1");
  await expect(page.locator("#playStreak")).toHaveText("1");
  await page.getByRole("button", { name: "Back to today" }).click();
  await expect(page.locator(".tile.filled .tile-letter")).toHaveText(["A"]);
});

test("previously completed archive games remain available for review", async ({ page }) => {
  const save = createDefaultSave();
  save.archive[yesterday] = { ...createPuzzleProgress(), completed: true, won: true, guesses: [puzzle.answer], maxGuesses: puzzle.maxGuesses };
  await seed(page, save);
  await page.goto(`/?today=${today}&archive=${yesterday}`);
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  await expect(page.locator("#winStreak")).toHaveText("0");
});

test("calendar fits narrow screens and navigates months while blocking invalid dates", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?today=2026-05-01");
  await expect(page.locator(".board-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("#archiveMonth")).toHaveText("April 2026");
  await page.locator("#archivePrevious").click();
  await expect(page.locator("#archiveMonth")).toHaveText("March 2026");
  await expect(page.locator("#archivePrevious")).toBeDisabled();
  const fit = await page.locator("#archiveDialog").evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.width);
  for (const date of ["2026-05-02", "2026-02-28", "2026-04-31"]) {
    await page.goto(`/?today=2026-05-01&archive=${date}`);
    await expect(page.locator("#todaySummary")).toContainText("Today: 1 May, 2026");
  }
});

test("native app cannot use the local preview date override to play missed puzzles", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-20T19:00:00Z") });
  await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
  await page.goto(`/?today=${yesterday}`);
  await expect(page.locator("#todaySummary")).toContainText("Today: 20 Sep, 2026");
});

test("free access cannot open completed history", async ({ page }) => {
  const save = createDefaultSave();
  save.puzzles[yesterday] = { ...createPuzzleProgress(), completed: true, won: true, guesses: [puzzle.answer], statsRecorded: true };
  await seed(page, save);
  await page.route("**/entitlements.mjs", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("testing || premiumUntil", "false || premiumUntil") });
  });
  await page.goto(`/?today=${today}&archive=${yesterday}`);
  await expect(page.locator("#todaySummary")).toContainText("Today:");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("#archiveDialog")).not.toBeVisible();
  await expect(page.locator("#toast")).toContainText("included with Premium");
});
