import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

const STORAGE_KEY = "bwordible-state-v2";
const ROOT = path.resolve(process.cwd());
const answers = JSON.parse(
  await fs.readFile(path.join(ROOT, "jwordl_tier1_expanded_core_vocab_4to6.json"), "utf8"),
);
const { BASE_SEED, START_DATE, buildPermutation, getCycleYearForDateKey, selectPuzzleForDateKey, shiftDateKey } = await import(
  pathToFileURL(path.join(ROOT, "puzzle-utils.mjs")).href
);

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getPuzzle(dateKey) {
  return selectPuzzleForDateKey(answers, dateKey);
}

function findDateByLength(targetLength, startDateKey = START_DATE, searchWindow = 366) {
  for (let offset = 0; offset < searchWindow; offset += 1) {
    const dateKey = shiftDateKey(startDateKey, offset);
    if (getPuzzle(dateKey).length === targetLength) {
      return dateKey;
    }
  }

  throw new Error(`Unable to find a ${targetLength}-letter puzzle within ${searchWindow} days.`);
}

test("reshuffles the master answer order on each March 1 cycle", () => {
  const order2026 = buildPermutation(answers.length, `${BASE_SEED}:2026`);
  const order2027 = buildPermutation(answers.length, `${BASE_SEED}:2027`);
  const feb2027 = getPuzzle("2027-02-28");
  const mar2027 = getPuzzle("2027-03-01");

  expect(order2026).toHaveLength(answers.length);
  expect(order2027).toHaveLength(answers.length);
  expect(new Set(order2026).size).toBe(answers.length);
  expect(new Set(order2027).size).toBe(answers.length);
  expect(order2026).not.toEqual(order2027);

  expect(getCycleYearForDateKey("2027-02-28")).toBe(2026);
  expect(getCycleYearForDateKey("2027-03-01")).toBe(2027);
  expect(feb2027.cycleYear).toBe(2026);
  expect(feb2027.positionInCycle).toBe(364);
  expect(mar2027.cycleYear).toBe(2027);
  expect(mar2027.positionInCycle).toBe(0);
  expect(feb2027.answerIndex).toBe(order2026[364]);
  expect(mar2027.answerIndex).toBe(order2027[0]);
});

function formatSummaryDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${day} ${MONTH_LABELS[month - 1]}, ${year}`;
}

async function waitForPuzzleReady(page, dateKey) {
  await expect(page.getByTestId("today-summary")).toContainText(`Today: ${formatSummaryDate(dateKey)}`);
  await expect(page.getByTestId("today-summary")).not.toContainText("Loading");
}

function getWrongGuess(length, answer) {
  const match = answers.find((entry) => entry.length === length && entry.word !== answer);
  if (!match) {
    throw new Error(`No alternate guess found for length ${length}.`);
  }
  return match.word;
}

test("renders a centered board with only the active word columns", async ({ page }) => {
  const todayKey = findDateByLength(4);
  const puzzle = getPuzzle(todayKey);

  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`/?today=${todayKey}`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("MannaGrams");
  await expect(page.locator(".brand-subtitle")).toHaveText("Your Daily Bible Word Game");
  await expect(page.getByTestId("today-summary")).toContainText(`Today: ${formatSummaryDate(todayKey)}`);
  await expect(page.getByTestId("today-summary")).toContainText(
    `${puzzle.length}-letter word | ${puzzle.maxGuesses} guesses`,
  );
  await expect(page.locator('[data-testid="board"] .tile.blocked')).toHaveCount(0);
  await expect(page.locator(".board-row")).toHaveCount(puzzle.maxGuesses);
  await expect(page.locator(".board-row").first().locator(".tile")).toHaveCount(puzzle.length);
  await expect(page.locator("#shareButton")).toBeDisabled();

  const brandBox = await page.locator(".brand-card").boundingBox();
  const brandLockupBox = await page.locator(".brand-lockup").boundingBox();
  const gamePanelBox = await page.locator(".game-panel").boundingBox();
  const boardCardBox = await page.locator(".board-card").boundingBox();

  expect(brandBox).not.toBeNull();
  expect(brandLockupBox).not.toBeNull();
  expect(gamePanelBox).not.toBeNull();
  expect(boardCardBox).not.toBeNull();
  expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(gamePanelBox.x - 8);
  expect(brandLockupBox.x).toBeGreaterThanOrEqual(brandBox.x);
  expect(brandLockupBox.x + brandLockupBox.width).toBeLessThanOrEqual(brandBox.x + brandBox.width);
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
  const helpButtonBox = await page.locator("#helpButton").boundingBox();
  const statsButtonBox = await page.locator("#statsButton").boundingBox();
  const shareButtonBox = await page.locator("#shareButton").boundingBox();
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const narrowBrandTextAlign = await page.locator(".brand-card").evaluate((element) => {
    return getComputedStyle(element).textAlign;
  });
  const narrowLockupJustification = await page.locator(".brand-lockup").evaluate((element) => {
    return getComputedStyle(element).justifyContent;
  });
  const narrowActionsJustification = await page.locator(".hero-actions").evaluate((element) => {
    return getComputedStyle(element).justifyContent;
  });
  const narrowBoardFit = await page.locator(".board-card").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  const narrowKeyboardFit = await page.locator(".keyboard-card").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  const narrowKeyHeight = await page.locator(".key").first().evaluate((element) => {
    return element.getBoundingClientRect().height;
  });

  expect(gamePanelBox.y).toBeGreaterThan(brandBox.y + brandBox.height - 2);
  expect(statsBox.y).toBeGreaterThan(gamePanelBox.y + gamePanelBox.height - 2);
  expect(calendarBox.y).toBeGreaterThan(statsBox.y + statsBox.height - 2);
  expect(Math.abs(helpButtonBox.y - statsButtonBox.y)).toBeLessThanOrEqual(5);
  expect(Math.abs(statsButtonBox.y - shareButtonBox.y)).toBeLessThanOrEqual(5);
  expect(pageWidth).toBeLessThanOrEqual(391);
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(390);
  expect(keyboardBox.x + keyboardBox.width).toBeLessThanOrEqual(390);
  expect(narrowBrandTextAlign).toBe("center");
  expect(narrowLockupJustification).toBe("center");
  expect(narrowActionsJustification).toBe("center");
  expect(narrowBoardFit.scrollWidth).toBeLessThanOrEqual(narrowBoardFit.clientWidth);
  expect(narrowKeyboardFit.scrollWidth).toBeLessThanOrEqual(narrowKeyboardFit.clientWidth);
  expect(narrowKeyHeight).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload();

  const compactPageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const compactBoardFit = await page.locator(".board-card").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  const compactKeyboardFit = await page.locator(".keyboard-card").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(compactPageWidth).toBeLessThanOrEqual(321);
  expect(compactBoardFit.scrollWidth).toBeLessThanOrEqual(compactBoardFit.clientWidth);
  expect(compactKeyboardFit.scrollWidth).toBeLessThanOrEqual(compactKeyboardFit.clientWidth);
});

test("records one letter when a touch is followed by its synthetic click", async ({ page }) => {
  const todayKey = findDateByLength(4);

  await page.goto(`/?today=${todayKey}`);
  await waitForPuzzleReady(page, todayKey);

  const aKey = page.locator('.key[data-key="A"]');
  await aKey.dispatchEvent("touchend");
  await aKey.click();

  await expect(page.locator('[data-testid="board"] .tile.filled')).toHaveCount(1);
  await expect(page.locator('[data-testid="board"] .tile.filled .tile-letter')).toHaveText("A");

  await page.keyboard.type("B");
  await expect(page.locator('[data-testid="board"] .tile.filled')).toHaveCount(2);
  await expect(page.locator('[data-testid="board"] .tile.filled .tile-letter')).toHaveText(["A", "B"]);
});

test("installs and reloads as an offline-capable app", async ({ context, page }) => {
  const todayKey = "2026-03-01";

  await page.goto(`/?today=${todayKey}`);
  await waitForPuzzleReady(page, todayKey);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await waitForPuzzleReady(page, todayKey);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("MannaGrams");
  await waitForPuzzleReady(page, todayKey);
});

test("solves, shares, and persists the ranked daily puzzle", async ({ context, page }) => {
  const todayKey = "2026-03-01";
  const puzzle = getPuzzle(todayKey);

  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
  await page.goto(`/?today=${todayKey}`);
  await expect(page.getByTestId("today-summary")).toContainText(`${puzzle.length}-letter word`);

  await page.keyboard.type(puzzle.answer);
  await page.keyboard.press("Enter");

  await expect(page.locator('[data-testid="board"] .tile.celebrate')).toHaveCount(puzzle.length);
  await expect(page.locator('[data-testid="board"] .tile.correct .tile-symbol')).toHaveCount(puzzle.length);
  await expect(page.locator('[data-testid="board"] .tile.correct .tile-symbol').first()).toHaveText("✓");
  await expect(page.locator('[data-testid="board"] .tile.correct').first()).toHaveAttribute(
    "aria-label",
    /right letter, right place/,
  );
  await expect(page.locator("#toast")).toContainText("Solved");
  await expect(page.getByTestId("win-streak")).toHaveText("1");
  await expect(page.getByTestId("play-streak")).toHaveText("1");
  await expect(page.locator("#statsDialog")).not.toHaveJSProperty("open", true);
  await expect(page.locator("#shareButton")).toBeEnabled();
  await expect(page.locator("#shareButton")).toHaveClass(/primary-button/);
  await expect(page.getByTestId("result-banner")).toContainText(puzzle.answer);
  await expect(page.getByTestId("result-banner")).toContainText(`1/${puzzle.maxGuesses} guesses`);
  await expect(page.locator("#nextPuzzleCountdown")).toHaveText("Preview puzzle");

  await page.locator("#shareButton").click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("MannaGrams");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("[✓]");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("[↔] wrong place");

  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: ({ files }) => files?.[0]?.type === "image/png",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        window.__sharedResult = {
          fileCount: data.files?.length ?? 0,
          fileSize: data.files?.[0]?.size ?? 0,
          fileType: data.files?.[0]?.type ?? "",
          text: data.text ?? "",
        };
      },
    });
  });
  await page.locator("#shareButton").click();
  await expect.poll(() => page.evaluate(() => window.__sharedResult?.fileCount)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__sharedResult?.fileType)).toBe("image/png");
  await expect.poll(() => page.evaluate(() => window.__sharedResult?.fileSize)).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(() => window.__sharedResult?.text)).toContain("[✓]");
  await expect.poll(() => page.evaluate(() => window.__sharedResult?.text)).toContain("[↔] wrong place");
  await expect.poll(() => page.evaluate(() => window.__sharedResult?.text)).not.toContain("✅");
  await expect.poll(() => page.evaluate(() => window.__sharedResult?.text)).not.toContain("🔶");
  await expect.poll(() => page.evaluate(() => window.__sharedResult?.text)).not.toContain("❌");

  const saved = await page.evaluate((storageKey) => {
    return JSON.parse(localStorage.getItem(storageKey));
  }, STORAGE_KEY);

  expect(saved.stats.played).toBe(1);
  expect(saved.stats.wins).toBe(1);
  expect(saved.puzzles[todayKey].won).toBe(true);
});

test("shows the answer after a losing puzzle", async ({ page }) => {
  const todayKey = "2026-03-05";
  const puzzle = getPuzzle(todayKey);
  const wrongGuess = getWrongGuess(puzzle.length, puzzle.answer);

  await page.goto(`/?today=${todayKey}`);
  await waitForPuzzleReady(page, todayKey);

  for (let guess = 0; guess < puzzle.maxGuesses; guess += 1) {
    await page.keyboard.type(wrongGuess);
    await page.keyboard.press("Enter");
  }

  await expect(page.getByTestId("result-banner")).toContainText(puzzle.answer);
  await expect(page.getByTestId("result-banner")).toContainText("Not solved");
  await expect(page.locator("#toast")).toContainText(`The word was ${puzzle.answer}.`);
});

test("keeps the win streak across skipped days while the play streak resets", async ({ page }) => {
  const firstDate = "2026-03-01";
  const secondDate = "2026-03-03";
  const firstPuzzle = getPuzzle(firstDate);
  const secondPuzzle = getPuzzle(secondDate);

  await page.goto(`/?today=${firstDate}`);
  await waitForPuzzleReady(page, firstDate);
  await page.keyboard.type(firstPuzzle.answer);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("win-streak")).toHaveText("1");
  await expect(page.getByTestId("play-streak")).toHaveText("1");

  await page.goto(`/?today=${secondDate}`);
  await waitForPuzzleReady(page, secondDate);
  await page.keyboard.type(secondPuzzle.answer);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("win-streak")).toHaveText("2");
  await expect(page.getByTestId("play-streak")).toHaveText("1");

  const saved = await page.evaluate((storageKey) => {
    return JSON.parse(localStorage.getItem(storageKey));
  }, STORAGE_KEY);

  expect(saved.stats.currentStreak).toBe(2);
  expect(saved.stats.maxStreak).toBe(2);
  expect(saved.stats.playStreak).toBe(1);
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
  await expect(page.getByTestId("win-streak")).toHaveText("0");
  await expect(page.getByTestId("play-streak")).toHaveText("3");
});
