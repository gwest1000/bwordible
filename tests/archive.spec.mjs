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
async function menu(page) {
  await page.getByRole("button", { name: "Open menu" }).click();
}
test("calendar shows missed and unfinished day details without enabling play", async ({ page }) => {
  const save = createDefaultSave();
  save.puzzles[yesterday] = { ...createPuzzleProgress(), currentGuess: "A" };
  await seed(page, save);
  await page.goto(`/?today=${today}`);
  await expect(page.locator("#board .board-row").first()).toBeVisible();
  await menu(page);
  await page.locator('#archiveGrid [data-date="2026-03-07"]').click();
  await expect(page.locator("#dayStatus")).toContainText("Not played");
  await expect(page.locator("#dayGuesses .tile")).toHaveCount(0);
  await expect(page.locator("#dayWord")).toHaveText("");
  await page.locator("#dayDialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(`#archiveGrid [data-date="${yesterday}"]`).click();
  await expect(page.locator("#dayStatus")).toContainText("Unfinished");
  await page.keyboard.type("NOAH");
  const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(after.puzzles[yesterday]).toEqual(save.puzzles[yesterday]);
  expect(after.archive).toEqual({});
});
test("completed history shows saved guesses offline and leaves today's game intact", async ({ page, context }) => {
  await page.goto(`/?today=${yesterday}`);
  await expect(page.locator("#board .board-row").first()).toBeVisible();
  await page.keyboard.type(puzzle.answer);
  await page.keyboard.press("Enter");
  await expect(page.locator("#resultWord")).toHaveText(puzzle.answer);
  await page.goto(`/?today=${today}`);
  await expect(page.locator("#board .board-row").first()).toBeVisible();
  await page.keyboard.type("A");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await context.setOffline(true);
  await menu(page);
  await page.locator(`#archiveGrid [data-date="${yesterday}"]`).click();
  await expect(page.locator("#dayWord")).toHaveText(puzzle.answer);
  await expect(page.locator("#dayGuesses .tile-letter")).toHaveText(puzzle.answer.split(""));
  await expect(page.locator("#dayStatus")).toContainText("Solved in 1/");
  await page.keyboard.press("Escape");
  await expect(page.locator("#menuDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#board .tile-letter")).toHaveText(["A"]);
});
test("previous archive records remain reviewable but loss details do not reveal the answer", async ({ page }) => {
  const save = createDefaultSave();
  save.archive[yesterday] = { ...createPuzzleProgress(), completed: true, won: false, guesses: ["NOAH"], maxGuesses: 6 };
  await seed(page, save);
  await page.goto(`/?today=${today}&archive=${yesterday}`);
  await expect(page.locator("#dayStatus")).toHaveText("Not solved.");
  await expect(page.locator("#dayWord")).toHaveText("");
  await expect(page.locator("#dayGuesses .tile-letter")).toHaveText(["N", "O", "A", "H"]);
});
test("calendar navigates months, includes today and disables future dates", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?today=2026-05-01");
  await expect(page.locator("#board .board-row").first()).toBeVisible();
  await menu(page);
  await expect(page.locator("#archiveMonth")).toHaveText("May 2026");
  await expect(page.locator('#archiveGrid [data-date="2026-05-02"]')).toBeDisabled();
  await page.locator("#archivePrevious").click();
  await expect(page.locator("#archiveMonth")).toHaveText("April 2026");
  await page.locator("#archivePrevious").click();
  await expect(page.locator("#archivePrevious")).toBeDisabled();
  const fit = await page.locator("#menuDialog").evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.width);
});
test("native app cannot use date override to play missed puzzles", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-20T19:00:00Z") });
  await page.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
  await page.goto(`/?today=${yesterday}`);
  await expect(page.locator("#todaySummary")).toContainText("20 Sep, 2026");
});
test("free access cannot open saved history", async ({ page }) => {
  await page.route("**/entitlements.mjs", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("testing || premiumUntil", "false || premiumUntil") });
  });
  await page.goto(`/?today=${today}`);
  await expect(page.locator("#board .board-row").first()).toBeVisible();
  await menu(page);
  await page.locator(`#archiveGrid [data-date="${yesterday}"]`).click();
  await expect(page.locator("#dayDialog")).not.toBeVisible();
  await expect(page.locator("#toast")).toContainText("included with Premium");
});
