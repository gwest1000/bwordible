import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultSave, createPuzzleProgress, recordStats, exportProgress, mergeProgressBackup } from "../progress-store.mjs";
import { getAccess, getGuessAllowance } from "../entitlements.mjs";
import { evaluateGuess } from "../game-engine.mjs";
import { buildShareText } from "../sharing.mjs";

function completed(word, won = true) {
  return { ...createPuzzleProgress(), guesses: [word], completed: true, won, statsRecorded: true };
}

test("backup round-trip restores history, recomputes stats, and is idempotent", () => {
  const save = createDefaultSave();
  save.puzzles["2026-03-01"] = completed("NOAH");
  save.puzzles["2026-03-02"] = completed("NOAH", false);
  const json = exportProgress(save);
  const restored = mergeProgressBackup(createDefaultSave(), json, "2026-03-02");
  assert.equal(restored.stats.played, 2);
  assert.equal(restored.stats.wins, 1);
  assert.equal(restored.stats.currentStreak, 0);
  assert.equal(restored.stats.maxStreak, 1);
  assert.equal(restored.stats.playStreak, 2);
  assert.deepEqual(mergeProgressBackup(restored, json, "2026-03-02"), restored);
});

test("merge retains completed local games and furthest unfinished progress", () => {
  const save = createDefaultSave();
  save.puzzles["2026-03-01"] = completed("NOAH");
  save.puzzles["2026-03-02"] = { ...createPuzzleProgress(), guesses: ["NOAH", "ADAM"] };
  const incoming = createDefaultSave();
  incoming.puzzles["2026-03-01"] = completed("ADAM", false);
  incoming.puzzles["2026-03-02"] = { ...createPuzzleProgress(), guesses: ["NOAH"] };
  const result = mergeProgressBackup(save, exportProgress(incoming), "2026-03-02");
  assert.equal(result.puzzles["2026-03-01"].won, true);
  assert.equal(result.puzzles["2026-03-02"].guesses.length, 2);
  assert.equal(save.puzzles["2026-03-01"].won, true);
});

test("invalid or future backups fail atomically and never import purchase rights", () => {
  const save = createDefaultSave();
  const original = structuredClone(save);
  const envelope = { app: "MannaGrams", version: 1, puzzles: {} };
  for (const text of ["not json", "null", JSON.stringify({ ...envelope, version: 2 }),
    JSON.stringify({ ...envelope, puzzles: { "2026-02-30": completed("NOAH") } }),
    JSON.stringify({ ...envelope, puzzles: { "2026-03-03": completed("NOAH") } }),
    JSON.stringify({ ...envelope, puzzles: { "2026-03-01": { ...completed("NOAH"), guesses: ["<script>"] } } })]) {
    assert.throws(() => mergeProgressBackup(save, text, "2026-03-02"));
    assert.deepEqual(save, original);
  }
  const result = mergeProgressBackup(save, JSON.stringify({ ...envelope, premiumUntil: 9999999999999 }), "2026-03-02");
  assert.equal(result.premiumUntil, undefined);
});

test("stats are recorded only once", () => {
  const save = createDefaultSave();
  save.puzzles["2026-03-01"] = { ...completed("NOAH"), statsRecorded: false };
  recordStats(save, "2026-03-01", 1);
  recordStats(save, "2026-03-01", 1);
  assert.equal(save.stats.played, 1);
  assert.equal(save.stats.wins, 1);
});

test("free gets two fewer guesses; expiry does not change a started game", () => {
  const now = Date.UTC(2026, 8, 20);
  const trial = getAccess({ trialEndsAt: now + 1 }, now);
  const expired = getAccess({ trialEndsAt: now }, now);
  const premium = getAccess({ premiumUntil: now + 1 }, now);
  for (const length of [4, 5, 6]) {
    assert.equal(getGuessAllowance(length, expired), length);
    assert.equal(getGuessAllowance(length, trial), length + 2);
    assert.equal(getGuessAllowance(length, premium), length + 2);
    assert.equal(getGuessAllowance(length, expired, { maxGuesses: length + 2 }), length + 2);
    assert.equal(getGuessAllowance(length, expired, createPuzzleProgress()), length + 2);
  }
  assert.equal(expired.archive, false);
  assert.equal(expired.showAds, true);
});

test("duplicate letters are evaluated only as often as they occur", () => {
  assert.deepEqual(evaluateGuess("LLAMA", "ABRAM"), ["absent", "absent", "present", "present", "present"]);
  assert.deepEqual(evaluateGuess("AAAA", "ADAM"), ["correct", "absent", "correct", "absent"]);
});

test("sharing reports the actual allowance without revealing the answer", () => {
  const text = buildShareText({ length: 4, answer: "NOAH", maxGuesses: 4, displayDate: "Mar 1, 2026" }, completed("NOAH"));
  assert.match(text, /1\/4/);
  assert.doesNotMatch(text, /NOAH/);
  assert.match(text, /\[✓\]/);
});
