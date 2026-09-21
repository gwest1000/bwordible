import { START_DATE, TIME_ZONE, compareDateKeys, getDateKeyInTimeZone, isValidDateKey, shiftDateKey } from "./puzzle-utils.mjs";

// Keep the legacy key so existing players retain their progress after the rename.
export const STORAGE_KEY = "bwordible-state-v2";

export function recordStats(save, dateKey, winningGuesses) {
  const progress = save.puzzles[dateKey];
  const stats = save.stats;

  if (progress.statsRecorded) {
    return;
  }

  stats.played += 1;

  if (winningGuesses) {
    stats.wins += 1;
    stats.totalWinningGuesses += winningGuesses;
    stats.distribution[String(winningGuesses)] = (stats.distribution[String(winningGuesses)] ?? 0) + 1;
  }

  progress.statsRecorded = true;
  syncDerivedStats(save, dateKey);
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultSave();
    }

    const parsed = JSON.parse(raw);
    const save = {
      puzzles: parsed.puzzles ?? {},
      stats: {
        ...createDefaultSave().stats,
        ...(parsed.stats ?? {}),
      },
    };
    return syncDerivedStats(save);
  } catch (error) {
    console.warn("Failed to load saved game state.", error);
    return createDefaultSave();
  }
}

export function createDefaultSave() {
  return {
    puzzles: {},
    stats: {
      currentStreak: 0,
      distribution: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
      },
      lastCompletedDate: null,
      maxStreak: 0,
      playStreak: 0,
      played: 0,
      totalWinningGuesses: 0,
      wins: 0,
    },
  };
}

export function syncDerivedStats(save, throughDateKey = getDateKeyInTimeZone(new Date(), TIME_ZONE)) {
  const streakSummary = computeWinStreakSummary(save.puzzles, throughDateKey);
  save.stats.currentStreak = streakSummary.currentStreak;
  save.stats.maxStreak = streakSummary.maxStreak;
  save.stats.lastCompletedDate = streakSummary.lastCompletedDate;
  save.stats.playStreak = computePlayStreak(save.puzzles, throughDateKey);
  return save;
}

function computeWinStreakSummary(puzzles, throughDateKey) {
  const rankedResults = Object.entries(puzzles)
    .filter(([dateKey, progress]) => isRankedCompletedProgress(dateKey, progress, throughDateKey))
    .sort(([leftDate], [rightDate]) => compareDateKeys(leftDate, rightDate));

  let currentStreak = 0;
  let maxStreak = 0;
  let lastCompletedDate = null;

  rankedResults.forEach(([dateKey, progress]) => {
    lastCompletedDate = dateKey;

    if (progress.won) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
      return;
    }

    currentStreak = 0;
  });

  return { currentStreak, lastCompletedDate, maxStreak };
}

function computePlayStreak(puzzles, throughDateKey) {
  let cursor = throughDateKey;
  if (!isRankedCompletedProgress(cursor, puzzles[cursor], throughDateKey)) {
    cursor = shiftDateKey(cursor, -1);
  }

  let streak = 0;
  while (
    compareDateKeys(cursor, START_DATE) >= 0 &&
    isRankedCompletedProgress(cursor, puzzles[cursor], throughDateKey)
  ) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  return streak;
}

function isRankedCompletedProgress(dateKey, progress, throughDateKey) {
  return (
    compareDateKeys(dateKey, START_DATE) >= 0 &&
    compareDateKeys(dateKey, throughDateKey) <= 0 &&
    progress?.completed &&
    (progress.statsRecorded ?? true)
  );
}

export function createPuzzleProgress() {
  return {
    completed: false,
    currentGuess: "",
    guesses: [],
    statsRecorded: false,
    won: false,
  };
}


export function saveProgress(save) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
}

export function exportProgress(save) {
  return JSON.stringify({ app: "MannaGrams", version: 1, puzzles: save.puzzles }, null, 2);
}

export function mergeProgressBackup(save, text, throughDateKey = getDateKeyInTimeZone()) {
  const invalid = () => { throw new Error("This file is not a valid MannaGrams progress backup."); };
  if (text.length > 2_000_000) invalid();
  let backup;
  try { backup = JSON.parse(text); } catch { invalid(); }
  if (backup?.app !== "MannaGrams" || backup.version !== 1 || !backup.puzzles ||
      typeof backup.puzzles !== "object" || Array.isArray(backup.puzzles)) invalid();

  const puzzles = { ...save.puzzles };
  for (const [dateKey, value] of Object.entries(backup.puzzles)) {
    if (!isValidDateKey(dateKey) || dateKey > throughDateKey || !value ||
        !Array.isArray(value.guesses) || value.guesses.length > 8 ||
        !value.guesses.every((word) => typeof word === "string" && /^[A-Z]{4,6}$/.test(word)) ||
        typeof value.currentGuess !== "string" || !/^[A-Z]{0,6}$/.test(value.currentGuess) ||
        typeof value.completed !== "boolean" || typeof value.won !== "boolean" ||
        typeof value.statsRecorded !== "boolean") invalid();
    const length = value.guesses[0]?.length;
    const maxGuesses = value.maxGuesses ?? (length ? length + 2 : undefined);
    if ((length && (value.guesses.some((word) => word.length !== length) || value.currentGuess.length > length)) ||
        (maxGuesses !== undefined && (!Number.isInteger(maxGuesses) || maxGuesses < 4 || maxGuesses > 8 ||
          value.guesses.length > maxGuesses || (length && ![length, length + 2].includes(maxGuesses)))) ||
        (value.completed && (value.guesses.length === 0 || value.currentGuess !== "")) ||
        (!value.completed && (value.won || value.statsRecorded || value.guesses.length >= maxGuesses))) invalid();
    const progress = {
      completed: value.completed, currentGuess: value.currentGuess, guesses: [...value.guesses],
      statsRecorded: value.statsRecorded, won: value.won,
      ...(maxGuesses === undefined ? {} : { maxGuesses }),
    };
    const existing = puzzles[dateKey];
    // Never replace a finished local game. Otherwise retain the furthest progress.
    if (!existing || (!existing.completed &&
        (progress.completed || progress.guesses.length > existing.guesses.length ||
          (progress.guesses.length === existing.guesses.length && progress.currentGuess.length > existing.currentGuess.length)))) {
      puzzles[dateKey] = progress;
    }
  }
  const merged = createDefaultSave();
  merged.puzzles = puzzles;
  for (const [dateKey, progress] of Object.entries(puzzles)) {
    if (!isRankedCompletedProgress(dateKey, progress, throughDateKey)) continue;
    merged.stats.played += 1;
    if (progress.won) {
      merged.stats.wins += 1;
      merged.stats.totalWinningGuesses += progress.guesses.length;
      merged.stats.distribution[progress.guesses.length] += 1;
    }
  }
  return syncDerivedStats(merged, throughDateKey);
}
