import { test, expect } from "@playwright/test";
import { createDefaultSave, createPuzzleProgress, exportProgress } from "../progress-store.mjs";

test("free allowance is displayed and an existing full-allowance game stays intact", async ({ page }) => {
  await page.route("**/entitlements.mjs", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("testing || premiumUntil", "false || premiumUntil");
    await route.fulfill({ response, body });
  });
  await page.goto("/?today=2026-03-02");
  await expect(page.locator(".board-row").first()).toBeVisible();
  const length = await page.locator(".board-row").first().locator(".tile").count();
  await expect(page.locator(".board-row")).toHaveCount(length);
  await page.evaluate(({ length }) => {
    const save = JSON.parse(localStorage.getItem("bwordible-state-v2"));
    save.puzzles["2026-03-02"].maxGuesses = length + 2;
    localStorage.setItem("bwordible-state-v2", JSON.stringify(save));
  }, { length });
  await page.reload();
  await expect(page.locator(".board-row")).toHaveCount(length + 2);
});

test("exports saved games and imports them on a fresh browser", async ({ page, browser }) => {
  const save = createDefaultSave();
  save.puzzles["2026-03-01"] = { ...createPuzzleProgress(), guesses: ["NOAH"], completed: true, won: true, statsRecorded: true };
  await page.goto("/?today=2026-03-02");
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await page.locator("#importFile").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(exportProgress(save)) });
  await expect(page.locator("#statsWins")).toHaveText("1");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export progress" }).click();
  const backup = await (await downloadPromise).path();
  const other = await browser.newContext();
  const destination = await other.newPage();
  await destination.goto("http://127.0.0.1:4173/?today=2026-03-02");
  await destination.getByRole("button", { name: "Stats", exact: true }).click();
  await destination.locator("#importFile").setInputFiles(backup);
  await expect(destination.locator("#statsWins")).toHaveText("1");
  await destination.reload();
  await expect(destination.locator("#winStreak")).toHaveText("1");
  await other.close();
});

test("rejects an invalid file without changing saved progress", async ({ page }) => {
  await page.goto("/?today=2026-03-02");
  await expect(page.locator(".board-row").first()).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem("bwordible-state-v2"));
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await page.locator("#importFile").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"app":"Something else"}') });
  await expect(page.locator("#toast")).toContainText("not a valid MannaGrams");
  expect(await page.evaluate(() => localStorage.getItem("bwordible-state-v2"))).toBe(before);
});
