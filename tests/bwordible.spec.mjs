import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

const STORAGE_KEY = "bwordible-state-v2";
const ROOT = path.resolve(process.cwd());
const answers = JSON.parse(
  await fs.readFile(path.join(ROOT, "jwordl_tier1_expanded_core_vocab_4to6.json"), "utf8"),
);
const { START_DATE, selectPuzzleForDateKey, shiftDateKey } = await import(
  pathToFileURL(path.join(ROOT, "puzzle-utils.mjs")).href
);

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getPuzzle(dateKey) {
  return selectPuzzleForDateKey(answers, dateKey);
}

function findDateByLength(targetLength, startDateKey = START_DATE, searchWindow = 60) {
  for (let offset = 0; offset < searchWindow; offset += 1) {
    const dateKey = shiftDateKey(startDateKey, offset);
    if (getPuzzle(dateKey).length === targetLength) {
      return dateKey;
    }
  }

  throw new Error(`Unable to find a ${targetLength}-letter puzzle within ${searchWindow} days.`);
}

function formatSummaryDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${day} ${MONTH_LABELS[month - 1]}, ${year}`;
}

function getWrongGuess(length, answer) {
  const match = answers.find((entry) => entry.length === length && entry.word !== answer);
  if (!match) {
    throw new Error(`No alternate guess found for length ${length}.`);
  }
  return match.word;
}

test("renders the correct blocked tiles and summary for a 4-letter daily puzzle", async ({ page }) => {
  const todayKey = findDateByLength(4);
  const puzzle = getPuzzle(todayKey);

  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`/?today=${todayKey}`);

  await expect(page.getByTestId("today-summary")).toContainText(`Today: ${formatSummaryDate(todayKey)}`);
  await expect(page.getByTestId("today-summary")).toContainText(
    `${puzzle.length}-letter word | ${puzzle.maxGuesses} guesses`,
  );
  await expect(page.locator('[data-testid="board"] .tile.blocked')).toHaveCount(
    (6 - puzzle.length) * puzzle.maxGuesses,
  );
  await expect(page.locator('.board-row').first().locator('.tile').first()).not.toHaveClass(/blocked/);
  await expect(page.locator('.board-row').first().locator('.tile').last()).toHaveClass(/blocked/);

  const brandBox = await page.locator(".brand-card").boundingBox();
  const gamePanelBox = await page.locator(".game-panel").boundingBox();
  const boardCardBox = await page.locator(".board-card").boundingBox();

  expect(brandBox).not.toBeNull();
  expect(gamePanelBox).not.toBeNull();
  expect(boardCardBox).not.toBeNull();
  expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(gamePanelBox.x - 8);
  expect(boardCardBox.x).toBeGreaterThan(gamePanelBox.x);
});

test("adapts cleanly to tablet and phone widths", async ({ page }) => {
  const todayKey = "2026-03-01";

  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto(`/?today=${todayKey}`);

  let brandBox = await page.locator(".brand-card").boundingBox();
  let statsBox = await page.locator(".stats-card").boundingBox();
  let calendarBox = await page.locator(".calendar-card").boundingBox();
  let gamePanelBox = await page.locator(".game-panel").boundingBox();
  let boardBox = await page.locator('[data-testid="board"]').boundingBox();
  let keyboardBox = await page.locator("#keyboard").boundingBox();

  expect(brandBox).not.toBeNull();
  expect(statsBox).not.toBeNull();
  expect(calendarBox).not.toBeNull();
  expect(gamePanelBox).not.toBeNull();
  expect(boardBox).not.toBeNull();
  expect(keyboardBox).not.toBeNull();
  expect(gamePanelBox.y).toBeGreaterThan(brandBox.y + brandBox.height - 2);
  expect(statsBox.y).toBeGreaterThan(gamePanelBox.y + gamePanelBox.height - 2);
  expect(calendarBox.y).toBeGreaterThan(statsBox.y + statsBox.height - 2);
  expect(boardBox.width).toBeLessThanOrEqual(1024 - 24);
  expect(keyboardBox.width).toBeLessThanOrEqual(1024 - 24);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  brandBox = await page.locator(".brand-card").boundingBox();
  statsBox = await page.locator(".stats-card").boundingBox();
  calendarBox = await page.locator(".calendar-card").boundingBox();
  gamePanelBox = await page.locator(".game-panel").boundingBox();
  boardBox = await page.locator('[data-testid="board"]').boundingBox();
  keyboardBox = await page.locator("#keyboard").boundingBox();
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);

  expect(gamePanelBox.y).toBeGreaterThan(brandBox.y + brandBox.height - 2);
  expect(statsBox.y).toBeGreaterThan(gamePanelBox.y + gamePanelBox.height - 2);
  expect(calendarBox.y).toBeGreaterThan(statsBox.y + statsBox.height - 2);
  expect(pageWidth).toBeLessThanOrEqual(391);
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(390);
  expect(keyboardBox.x + keyboardBox.width).toBeLessThanOrEqual(390);
});

test("solves the ranked daily puzzle and persists stats", async ({ page }) => {
  const todayKey = "2026-03-01";
  const puzzle = getPuzzle(todayKey);

  await page.goto(`/?today=${todayKey}`);
  await expect(page.getByTestId("today-summary")).toContainText(`${puzzle.length}-letter word`);

  await page.keyboard.type(puzzle.answer);
  await page.keyboard.press("Enter");

  await expect(page.locator('[data-testid="board"] .tile.celebrate')).toHaveCount(puzzle.length);
  await expect(page.locator("#toast")).toContainText("Solved");
  await expect(page.getByTestId("current-streak")).toHaveText("1");
  await expect(page.locator("#statsDialog")).not.toHaveJSProperty("open", true);

  const saved = await page.evaluate((storageKey) => {
    return JSON.parse(localStorage.getItem(storageKey));
  }, STORAGE_KEY);

  expect(saved.stats.played).toBe(1);
  expect(saved.stats.wins).toBe(1);
  expect(saved.puzzles[todayKey].won).toBe(true);
});

test("renders the streak calendar from saved multi-day results", async ({ page }) => {
  const dateA = "2026-03-07";
  const dateB = "2026-03-08";
  const dateC = "2026-03-09";
  const dateD = "2026-03-10";
  const puzzleA = getPuzzle(dateA);
  const puzzleB = getPuzzle(dateB);
  const puzzleC = getPuzzle(dateC);
  const wrongB = getWrongGuess(puzzleB.length, puzzleB.answer);
  const wrongC = getWrongGuess(puzzleC.length, puzzleC.answer);

  await page.goto(`/?today=${dateA}`);
  await expect(page.getByTestId("today-summary")).toContainText(`${puzzleA.length}-letter word`);
  await page.keyboard.type(puzzleA.answer);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="board"] .tile.celebrate')).toHaveCount(puzzleA.length);

  await page.goto(`/?today=${dateB}`);
  await expect(page.getByTestId("today-summary")).toContainText(`${puzzleB.length}-letter word`);
  await page.keyboard.type(wrongB);
  await page.keyboard.press("Enter");
  await page.keyboard.type(wrongB);
  await page.keyboard.press("Enter");
  await page.keyboard.type(wrongB);
  await page.keyboard.press("Enter");
  await page.keyboard.type(puzzleB.answer);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="board"] .tile.celebrate')).toHaveCount(puzzleB.length);

  await page.goto(`/?today=${dateC}`);
  await expect(page.getByTestId("today-summary")).toContainText(`${puzzleC.length}-letter word`);
  for (let guess = 0; guess < puzzleC.maxGuesses; guess += 1) {
    await page.keyboard.type(wrongC);
    await page.keyboard.press("Enter");
  }
  await expect
    .poll(async () => {
      return page.evaluate(({ storageKey, dateKey }) => {
        const data = JSON.parse(localStorage.getItem(storageKey));
        return data.puzzles[dateKey]?.completed && data.puzzles[dateKey]?.won === false;
      }, { storageKey: STORAGE_KEY, dateKey: dateC });
    })
    .toBe(true);

  await page.goto(`/?today=${dateD}`);
  await expect(page.getByTestId("today-summary")).toContainText(`${getPuzzle(dateD).length}-letter word`);
  await expect(page.locator('[data-testid="streak-calendar"] .day-cell.won[data-date="2026-03-07"]')).toBeVisible();
  await expect(page.locator('[data-testid="streak-calendar"] .day-cell.won[data-date="2026-03-08"]')).toBeVisible();
  const strongerWin = await page
    .locator('[data-testid="streak-calendar"] .day-cell.won[data-date="2026-03-07"]')
    .evaluate((el) => el.style.getPropertyValue("--win-strength"));
  const weakerWin = await page
    .locator('[data-testid="streak-calendar"] .day-cell.won[data-date="2026-03-08"]')
    .evaluate((el) => el.style.getPropertyValue("--win-strength"));
  expect(Number(strongerWin)).toBeGreaterThan(Number(weakerWin));
  await expect(page.locator('[data-testid="streak-calendar"] .day-cell.lost[data-date="2026-03-09"]')).toBeVisible();
  await expect(page.locator('[data-testid="streak-calendar"] .day-cell.today[data-date="2026-03-10"]')).toBeVisible();
  await expect(page.getByTestId("current-streak")).toHaveText("0");
});
