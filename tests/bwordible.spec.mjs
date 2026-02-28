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

test("renders the correct blocked tiles and summary for a 4-letter daily puzzle", async ({ page }) => {
  const todayKey = findDateByLength(4);
  const puzzle = getPuzzle(todayKey);

  await page.goto(`/?today=${todayKey}`);

  await expect(page.getByTestId("today-summary")).toHaveText(
    `Today: ${formatSummaryDate(todayKey)} | ${puzzle.length}-letter word | ${puzzle.maxGuesses} guesses`,
  );
  await expect(page.locator('[data-testid="board"] .tile.blocked')).toHaveCount(
    (6 - puzzle.length) * puzzle.maxGuesses,
  );
});

test("solves the ranked daily puzzle and persists stats", async ({ page }) => {
  const todayKey = "2026-03-01";
  const puzzle = getPuzzle(todayKey);

  await page.goto(`/?today=${todayKey}`);
  await expect(page.getByTestId("today-summary")).toContainText(`${puzzle.length}-letter word`);

  await page.keyboard.type(puzzle.answer);
  await page.keyboard.press("Enter");

  await expect(page.locator("#toast")).toContainText("Solved");
  await expect(page.getByTestId("current-streak")).toHaveText("1");

  const saved = await page.evaluate((storageKey) => {
    return JSON.parse(localStorage.getItem(storageKey));
  }, STORAGE_KEY);

  expect(saved.stats.played).toBe(1);
  expect(saved.stats.wins).toBe(1);
  expect(saved.puzzles[todayKey].won).toBe(true);
});

test("renders the streak calendar from seeded history", async ({ page }) => {
  await page.addInitScript(([storageKey]) => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        puzzles: {
          "2026-03-08": {
            completed: true,
            currentGuess: "",
            guesses: ["ALIVE", "ABNER", "ANGER", "AARON"],
            statsRecorded: true,
            won: true,
          },
          "2026-03-09": {
            completed: true,
            currentGuess: "",
            guesses: ["ADAM", "AMOS", "ABLE", "AHAB", "ASIA"],
            statsRecorded: true,
            won: false,
          },
        },
        stats: {
          currentStreak: 0,
          distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, 6: 0, 7: 0 },
          lastCompletedDate: "2026-03-09",
          maxStreak: 1,
          played: 2,
          totalWinningGuesses: 4,
          wins: 1,
        },
      }),
    );
  }, [STORAGE_KEY]);

  await page.goto("/?today=2026-03-10");

  await expect(page.locator('[data-testid="streak-calendar"] .day-cell.won[data-date="2026-03-08"]')).toBeVisible();
  await expect(page.locator('[data-testid="streak-calendar"] .day-cell.lost[data-date="2026-03-09"]')).toBeVisible();
  await expect(page.locator('[data-testid="streak-calendar"] .day-cell.today[data-date="2026-03-10"]')).toBeVisible();
  await expect(page.getByTestId("current-streak")).toHaveText("0");
});
