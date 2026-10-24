import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { selectPuzzleForDateKey, shiftDateKey } from "../puzzle-utils.mjs";

const answers = JSON.parse(fs.readFileSync("jwordl_tier1_expanded_core_vocab_4to6.json", "utf8"));
const dates = {};
for (let offset = 0; offset < 60; offset += 1) {
  const date = shiftDateKey("2026-03-01", offset);
  dates[selectPuzzleForDateKey(answers, date).length] ??= date;
}
test.use({ reducedMotion: "reduce" });

async function fitsViewport(page, height) {
  return page.evaluate((height) => {
    const board = document.querySelector("#board").getBoundingClientRect();
    const keyboard = document.querySelector(".keyboard-card").getBoundingClientRect();
    return board.bottom <= height + 1 && keyboard.bottom <= height + 1 &&
      document.documentElement.scrollWidth <= window.innerWidth;
  }, height);
}

test("all word lengths fit phones and tablets in portrait and landscape", async ({ page }) => {
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [412, 915], [844, 390], [800, 1280], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    for (const length of [4, 5, 6]) {
      await page.goto(`/?today=${dates[length]}`);
      await expect(page.locator("#board .board-row")).toHaveCount(length + 2);
      await expect.poll(() => fitsViewport(page, height), { message: `${length} letters at ${width} × ${height}` }).toBe(true);
      const box = await page.locator("#board .tile").first().boundingBox();
      expect(Math.abs(box.width - box.height)).toBeLessThan(1);
      expect(box.width).toBeGreaterThanOrEqual(32);
      await expect(page.locator("#todaySummary")).not.toContainText("Today:");
      const title = await page.locator("h1").boundingBox();
      const date = await page.locator(".today-line").boundingBox();
      expect(title.x + title.width).toBeLessThanOrEqual(date.x + 1);
    }
  }
});

test("rotation and resizing preserve guesses while rescaling the board", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?today=${dates[6]}`);
  await expect(page.locator("#board .board-row")).toHaveCount(8);
  await page.keyboard.type("A");
  for (const [width, height] of [[844, 390], [320, 568], [800, 1280], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => fitsViewport(page, height)).toBe(true);
    await expect(page.locator("#board .tile-letter")).toHaveText(["A"]);
  }
});

test("completion panel triggers a new fit and evaluated letters stay inside their squares", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?today=${dates[6]}`);
  await expect(page.locator("#board .board-row")).toHaveCount(8);
  await page.keyboard.type(selectPuzzleForDateKey(answers, dates[6]).answer);
  await page.keyboard.press("Enter");
  await expect(page.locator("#resultPanel")).toBeVisible();
  await expect.poll(() => fitsViewport(page, 844)).toBe(true);
  const contained = await page.locator("#board .tile.correct").first().evaluate((tile) => {
    const outer = tile.getBoundingClientRect();
    return [...tile.children].every((child) => {
      const rect = child.getBoundingClientRect();
      return rect.top >= outer.top && rect.bottom <= outer.bottom;
    });
  });
  expect(contained).toBe(true);
});
