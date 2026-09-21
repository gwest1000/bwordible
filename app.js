import { STATUS_SYMBOL, evaluateGuess, getKeyboardStatuses } from "./game-engine.mjs";
import { loadSave, createPuzzleProgress, recordStats, syncDerivedStats, saveProgress, exportProgress, mergeProgressBackup } from "./progress-store.mjs";
import { shareResult } from "./sharing.mjs";
import { getAccess, getGuessAllowance } from "./entitlements.mjs";
import { createArchive, isArchiveDate, archiveProgress } from "./archive.mjs";
import {
  START_DATE,
  TIME_ZONE,
  compareDateKeys,
  dateToIndex,
  formatDateKey,
  getDateKeyInTimeZone,
  selectPuzzleForDateKey,
  shiftDateKey,
} from "./puzzle-utils.mjs";

const ANSWERS_PATH = "./jwordl_tier1_expanded_core_vocab_4to6.json";
const GUESSES_PATH = "./bwordible_allowed_guesses_4to6.json";
const CALENDAR_WINDOW_DAYS = 35;
const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
];
const STATUS_LABEL = {
  absent: "not present",
  present: "right letter, wrong place",
  correct: "right letter, right place",
};
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const elements = {
  board: document.querySelector("#board"),
  calendarRangeLabel: document.querySelector("#calendarRangeLabel"),
  distribution: document.querySelector("#distribution"),
  helpButton: document.querySelector("#helpButton"),
  helpDialog: document.querySelector("#helpDialog"),
  keyboard: document.querySelector("#keyboard"),
  nextPuzzleCountdown: document.querySelector("#nextPuzzleCountdown"),
  playStreak: document.querySelector("#playStreak"),
  playedCount: document.querySelector("#playedCount"),
  resultLabel: document.querySelector("#resultLabel"),
  resultPanel: document.querySelector("#resultPanel"),
  resultScore: document.querySelector("#resultScore"),
  resultShareButton: document.querySelector("#resultShareButton"),
  resultWord: document.querySelector("#resultWord"),
  shareButton: document.querySelector("#shareButton"),
  archiveButton: document.querySelector("#archiveButton"),
  archiveDialog: document.querySelector("#archiveDialog"),
  todayButton: document.querySelector("#todayButton"),
  exportButton: document.querySelector("#exportButton"),
  importFile: document.querySelector("#importFile"),
  statsAverage: document.querySelector("#statsAverage"),
  statsButton: document.querySelector("#statsButton"),
  statsCalendar: document.querySelector("#statsCalendar"),
  statsCalendarRangeLabel: document.querySelector("#statsCalendarRangeLabel"),
  statsDialog: document.querySelector("#statsDialog"),
  statsMaxStreak: document.querySelector("#statsMaxStreak"),
  statsPlayStreak: document.querySelector("#statsPlayStreak"),
  statsPlayed: document.querySelector("#statsPlayed"),
  statsWinStreak: document.querySelector("#statsWinStreak"),
  statsWins: document.querySelector("#statsWins"),
  streakCalendar: document.querySelector("#streakCalendar"),
  toast: document.querySelector("#toast"),
  todaySummary: document.querySelector("#todaySummary"),
  winRate: document.querySelector("#winRate"),
  winStreak: document.querySelector("#winStreak"),
};

const appState = {
  answers: [],
  allowedByLength: new Map(),
  countdownTimer: null,
  keyFlashTimer: null,
  puzzle: null,
  ready: false,
  save: loadSave(),
  // Full testing access until Play Billing is connected; no trial clock starts yet.
  access: getAccess({ testing: true }),
  simulatedTodayKey: null,
  toastTimer: null,
  winAnimationTimer: null,
  todayKey: null,
};

const archive = createArchive({
  dialog: elements.archiveDialog,
  getSave: () => appState.save,
  getToday: () => appState.todayKey,
  onSelect: (dateKey) => startGame(dateKey),
});

init().catch((error) => {
  console.error(error);
  const localFileHint =
    window.location.protocol === "file:"
      ? " Open the folder through a local web server because browsers block JSON loading over file://."
      : "";
  showToast(`Unable to load the MannaGrams data files.${localFileHint}`, 5000);
  elements.todaySummary.textContent = "Today: unavailable";
});

async function init() {
  attachEvents();

  const params = new URLSearchParams(window.location.search);
  appState.simulatedTodayKey = sanitizeDateKey(params.get("today"));
  appState.todayKey = appState.simulatedTodayKey ?? getDateKeyInTimeZone(new Date(), TIME_ZONE);

  renderKeyboard({}, null);

  const [answerResponse, guessesResponse] = await Promise.all([
    fetch(ANSWERS_PATH),
    fetch(GUESSES_PATH),
  ]);

  if (!answerResponse.ok || !guessesResponse.ok) {
    throw new Error("Failed to fetch game data.");
  }

  const [answers, guesses] = await Promise.all([
    answerResponse.json(),
    guessesResponse.json(),
  ]);

  appState.answers = answers;
  appState.allowedByLength = new Map(
    Object.entries(guesses.by_length).map(([length, words]) => [
      Number(length),
      new Set(words),
    ]),
  );

  const archivedDate = params.get("archive");
  startGame(isArchiveDate(archivedDate, appState.todayKey) ? archivedDate : appState.todayKey);
  document.body.classList.add("app-ready");
  registerServiceWorker();
}

function registerServiceWorker() {
  if (window.Capacitor?.isNativePlatform() || !("serviceWorker" in navigator)) {
    return;
  }

  const register = () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("MannaGrams offline mode could not start.", error);
    });
  };

  if (document.readyState === "complete") {
    register();
    return;
  }

  window.addEventListener("load", register, { once: true });
}

function attachEvents() {
  document.addEventListener("keydown", handlePhysicalKeyboard);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.statsButton.addEventListener("click", () => {
    renderStats();
    elements.statsDialog.showModal();
  });
  elements.shareButton.addEventListener("click", handleShare);
  elements.resultShareButton.addEventListener("click", handleShare);
  elements.keyboard.addEventListener("click", handleVirtualKeyboard);
  elements.exportButton.addEventListener("click", handleExport);
  elements.importFile.addEventListener("change", handleImport);
  elements.archiveButton.addEventListener("click", () => {
    if (!appState.ready) return;
    if (!appState.access.archive) return showToast("The archive is included with Premium.");
    archive.open(appState.puzzle.key);
  });
  elements.todayButton.addEventListener("click", () => startGame());
}

function startGame(dateKey = appState.todayKey) {
  const switchingPuzzle = appState.ready;
  if (dateKey !== appState.todayKey && (!appState.access.archive || !isArchiveDate(dateKey, appState.todayKey))) {
    dateKey = appState.todayKey;
  }
  clearTimeout(appState.winAnimationTimer);
  clearTimeout(appState.keyFlashTimer);
  clearTimeout(appState.toastTimer);
  elements.toast.hidden = true;
  const isArchive = dateKey !== appState.todayKey;
  const puzzleData = selectPuzzleForDateKey(appState.answers, dateKey);
  if (isArchive && !archiveProgress(appState.save, dateKey)) {
    const unfinished = appState.save.puzzles[dateKey];
    appState.save.archive[dateKey] = {
      ...createPuzzleProgress(),
      ...(unfinished ? { guesses: [...unfinished.guesses], currentGuess: unfinished.currentGuess } : {}),
      maxGuesses: puzzleData.maxGuesses,
    };
  }
  const progress = isArchive ? archiveProgress(appState.save, dateKey) : appState.save.puzzles[dateKey];
  appState.puzzle = {
    ...puzzleData,
    maxGuesses: getGuessAllowance(puzzleData.length, appState.access, progress),
    displayDate: formatDateKey(dateKey, TIME_ZONE),
    isPreview: compareDateKeys(dateKey, START_DATE) < 0,
    isArchive,
    key: dateKey,
  };
  appState.ready = true;

  if (!isArchive && !appState.save.puzzles[appState.puzzle.key]) {
    appState.save.puzzles[appState.puzzle.key] = createPuzzleProgress();
  }
  getProgress().maxGuesses = appState.puzzle.maxGuesses;
  persistSave();
  const url = new URL(window.location.href);
  if (isArchive) url.searchParams.set("archive", dateKey);
  else url.searchParams.delete("archive");
  window.history.replaceState(null, "", url);
  elements.todayButton.hidden = !isArchive;

  renderTodaySummary();
  renderBoard();
  renderResultPanel();
  renderKeyboard(getKeyboardStatuses(getProgress(), appState.puzzle.answer), null);
  renderStats();
  renderShareState();
  startRolloverMonitor();
  if (switchingPuzzle) elements.board.focus({ preventScroll: true });
}

function handleVisibilityChange() {
  if (!document.hidden && appState.ready) {
    updateNextPuzzleCountdown();
  }
}

function startRolloverMonitor() {
  clearInterval(appState.countdownTimer);

  if (appState.simulatedTodayKey) {
    return;
  }

  appState.countdownTimer = setInterval(updateNextPuzzleCountdown, 60_000);
}

function renderTodaySummary() {
  const puzzle = appState.puzzle;
  const dateLabel = formatTodaySummaryDate(puzzle.key);
  elements.todaySummary.innerHTML = [
    `<span class="today-line">${puzzle.isArchive ? "Archive" : "Today"}: ${dateLabel}</span>`,
    `<span class="today-meta">${puzzle.length}-letter word | ${puzzle.maxGuesses} guesses</span>`,
  ].join("");
}

function handlePhysicalKeyboard(event) {
  if (!appState.ready) {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
    return;
  }

  if (
    event.target instanceof HTMLButtonElement &&
    (event.key === "Enter" || event.key === " ")
  ) {
    return;
  }

  if (elements.helpDialog.open || elements.statsDialog.open || elements.archiveDialog.open) {
    return;
  }

  const key = event.key.toUpperCase();

  if (key === "ENTER") {
    event.preventDefault();
    flashKey("ENTER");
    submitGuess();
    return;
  }

  if (key === "BACKSPACE") {
    event.preventDefault();
    flashKey("BACKSPACE");
    backspace();
    return;
  }

  if (/^[A-Z]$/.test(key)) {
    event.preventDefault();
    flashKey(key);
    addLetter(key);
  }
}

function handleVirtualKeyboard(event) {
  const button = event.target.closest("button[data-key]");
  if (!button || !appState.ready) {
    return;
  }

  pressVirtualKey(button.dataset.key);
  if (event.detail > 0) {
    button.blur();
  }
}

function pressVirtualKey(key) {
  flashKey(key);

  if (key === "ENTER") {
    submitGuess();
    return;
  }

  if (key === "BACKSPACE") {
    backspace();
    return;
  }

  addLetter(key);
}

function addLetter(letter) {
  const progress = getProgress();
  if (progress.completed || progress.currentGuess.length >= appState.puzzle.length) {
    return;
  }

  const popCell = {
    letterIndex: progress.currentGuess.length,
    rowIndex: progress.guesses.length,
  };
  progress.currentGuess += letter;
  persistSave();
  renderBoard({ popCell });
}

function backspace() {
  const progress = getProgress();
  if (progress.completed || !progress.currentGuess) {
    return;
  }

  progress.currentGuess = progress.currentGuess.slice(0, -1);
  persistSave();
  renderBoard();
}

function submitGuess() {
  const puzzle = appState.puzzle;
  const progress = getProgress();

  if (progress.completed) {
    showToast("This puzzle is already finished.");
    return;
  }

  if (progress.currentGuess.length !== puzzle.length) {
    showToast(`Enter a ${puzzle.length}-letter word.`);
    shakeBoard();
    return;
  }

  const guess = progress.currentGuess.toUpperCase();
  const allowed = appState.allowedByLength.get(puzzle.length);
  const isAnswer = puzzle.answer === guess;

  if (!allowed?.has(guess) && !isAnswer) {
    showToast("Word not in the allowed list.");
    shakeBoard();
    return;
  }

  progress.guesses.push(guess);
  progress.currentGuess = "";

  if (guess === puzzle.answer) {
    progress.completed = true;
    progress.won = true;
    if (!puzzle.isPreview && !puzzle.isArchive) {
      recordStats(appState.save, appState.puzzle.key, progress.guesses.length);
    }
  } else if (progress.guesses.length >= puzzle.maxGuesses) {
    progress.completed = true;
    progress.won = false;
    if (!puzzle.isPreview && !puzzle.isArchive) {
      recordStats(appState.save, appState.puzzle.key, null);
    }
  }

  persistSave();
  renderBoard({ revealRowIndex: progress.guesses.length - 1 });
  renderResultPanel();
  renderKeyboard(getKeyboardStatuses(getProgress(), appState.puzzle.answer), null);
  renderStats();
  renderShareState();

  if (progress.won) {
    queueWinCelebration(progress.guesses.length - 1);
  } else if (progress.completed) {
    showToast(`The word was ${puzzle.answer}.`, 4200);
  }
}

function renderBoard(options = {}) {
  const { popCell = null, revealRowIndex = null } = options;
  const puzzle = appState.puzzle;
  const progress = getProgress();
  const evaluations = progress.guesses.map((guess) => evaluateGuess(guess, puzzle.answer));

  elements.board.innerHTML = "";
  elements.board.dataset.wordLength = String(puzzle.length);

  for (let rowIndex = 0; rowIndex < puzzle.maxGuesses; rowIndex += 1) {
    const row = document.createElement("div");
    row.className = "board-row";
    row.style.setProperty("--word-length", String(puzzle.length));

    const guess = progress.guesses[rowIndex] ?? "";
    const activeWord = !progress.completed && rowIndex === progress.guesses.length ? progress.currentGuess : "";
    const letters = guess || activeWord;
    const statuses = evaluations[rowIndex] ?? [];

    for (let columnIndex = 0; columnIndex < puzzle.length; columnIndex += 1) {
      const tile = document.createElement("div");
      tile.className = "tile";

      const letterIndex = columnIndex;
      const letter = letters[letterIndex] ?? "";
      const status = statuses[letterIndex];

      tile.dataset.row = String(rowIndex);
      tile.dataset.col = String(columnIndex);

      if (letter) {
        const letterElement = document.createElement("span");
        letterElement.className = "tile-letter";
        letterElement.textContent = letter;
        tile.appendChild(letterElement);
        tile.classList.add("filled");
      }

      if (status) {
        const symbol = document.createElement("span");
        symbol.className = "tile-symbol";
        symbol.setAttribute("aria-hidden", "true");
        symbol.textContent = STATUS_SYMBOL[status];
        tile.prepend(symbol);
        tile.classList.add(status);
        tile.setAttribute("aria-label", `${letter}: ${STATUS_LABEL[status]}`);
        if (rowIndex === revealRowIndex) {
          tile.classList.add("reveal");
          tile.style.animationDelay = `${letterIndex * 90}ms`;
        }
      } else if (
        !progress.completed &&
        rowIndex === progress.guesses.length &&
        letterIndex === progress.currentGuess.length
      ) {
        tile.classList.add("active");
      }

      if (
        popCell &&
        rowIndex === popCell.rowIndex &&
        letterIndex === popCell.letterIndex &&
        letter
      ) {
        tile.classList.add("pop");
      }

      row.appendChild(tile);
    }

    elements.board.appendChild(row);
  }
}

function queueWinCelebration(rowIndex) {
  clearTimeout(appState.winAnimationTimer);
  const delay = appState.puzzle.length * 90 + 440;

  appState.winAnimationTimer = setTimeout(() => {
    celebrateWin(rowIndex);
    showToast(`Solved in ${getProgress().guesses.length}/${appState.puzzle.maxGuesses}.`, 2600);
  }, delay);
}

function renderResultPanel() {
  const progress = getProgress();

  if (!progress.completed) {
    elements.resultPanel.hidden = true;
    return;
  }

  const result = progress.won
    ? `${progress.guesses.length}/${appState.puzzle.maxGuesses} guesses`
    : "Not solved";

  elements.resultPanel.hidden = false;
  elements.resultPanel.classList.toggle("won", progress.won);
  elements.resultPanel.classList.toggle("lost", !progress.won);
  elements.resultLabel.textContent = progress.won ? "Solved" : appState.puzzle.isArchive ? "Archive word" : "Today’s word";
  elements.resultWord.textContent = appState.puzzle.answer;
  elements.resultScore.textContent = result;

  updateNextPuzzleCountdown();
}

function renderShareState() {
  const completed = getProgress().completed;
  elements.shareButton.disabled = !completed;
  elements.shareButton.title = completed ? "Share your result" : "Finish the puzzle to share";
  elements.shareButton.classList.toggle("primary-button", completed);
  elements.shareButton.classList.toggle("ghost-button", !completed);
}

function updateNextPuzzleCountdown() {
  if (appState.puzzle?.isArchive) {
    elements.nextPuzzleCountdown.textContent = "Archive results do not affect daily streaks.";
    if (!appState.simulatedTodayKey && getDateKeyInTimeZone() !== appState.todayKey) window.location.reload();
    return;
  }
  if (appState.simulatedTodayKey) {
    elements.nextPuzzleCountdown.textContent = "Preview puzzle";
    return;
  }

  const now = new Date();
  const currentDateKey = getDateKeyInTimeZone(now, TIME_ZONE);
  if (currentDateKey !== appState.todayKey) {
    window.location.reload();
    return;
  }

  const remaining = Math.max(0, findNextPuzzleTime(now).getTime() - now.getTime());
  const totalMinutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  elements.nextPuzzleCountdown.textContent = `Next puzzle in ${hours}h ${minutes}m`;
}

function findNextPuzzleTime(now) {
  const currentDateKey = getDateKeyInTimeZone(now, TIME_ZONE);
  let lower = now.getTime();
  let upper = lower + 30 * 60 * 60 * 1000;

  while (upper - lower > 1_000) {
    const midpoint = Math.floor((lower + upper) / 2);
    if (getDateKeyInTimeZone(new Date(midpoint), TIME_ZONE) === currentDateKey) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }

  return new Date(upper);
}

function celebrateWin(rowIndex) {
  const tiles = [...elements.board.querySelectorAll(`.tile[data-row="${rowIndex}"].correct`)];
  tiles.forEach((tile, index) => {
    tile.classList.remove("celebrate");
    void tile.offsetWidth;
    tile.classList.add("celebrate");
    tile.style.animationDelay = `${index * 120}ms`;
  });
}

function renderKeyboard(statuses, pressedKey) {
  elements.keyboard.innerHTML = "";

  KEYBOARD_ROWS.forEach((rowKeys) => {
    const row = document.createElement("div");
    row.className = "keyboard-row";

    rowKeys.forEach((key) => {
      const button = document.createElement("button");
      button.className = "key";
      button.dataset.key = key;
      button.type = "button";
      button.textContent = key === "BACKSPACE" ? "⌫" : key;

      if (key === "ENTER" || key === "BACKSPACE") {
        button.classList.add("wide");
      }
      if (key === "BACKSPACE") {
        button.setAttribute("aria-label", "Delete");
        button.title = "Delete";
      }

      const status = statuses[key];
      if (status) {
        button.classList.add(status);
        button.setAttribute("aria-label", `${key}: ${STATUS_LABEL[status]}`);
      }

      if (pressedKey === key) {
        button.classList.add("pressed");
      }

      row.appendChild(button);
    });

    elements.keyboard.appendChild(row);
  });
}

function renderStats() {
  syncDerivedStats(appState.save, appState.todayKey);
  const stats = appState.save.stats;
  const winRate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const average = stats.wins ? (stats.totalWinningGuesses / stats.wins).toFixed(1) : "-";
  const rangeText = buildCalendarRangeLabel(CALENDAR_WINDOW_DAYS);

  elements.winStreak.textContent = String(stats.currentStreak);
  elements.playStreak.textContent = String(stats.playStreak);
  elements.winRate.textContent = `${winRate}%`;
  elements.playedCount.textContent = String(stats.played);
  elements.statsPlayed.textContent = String(stats.played);
  elements.statsWins.textContent = String(stats.wins);
  elements.statsWinStreak.textContent = String(stats.currentStreak);
  elements.statsPlayStreak.textContent = String(stats.playStreak);
  elements.statsMaxStreak.textContent = String(stats.maxStreak);
  elements.statsAverage.textContent = average;
  elements.calendarRangeLabel.textContent = rangeText;
  elements.statsCalendarRangeLabel.textContent = rangeText;

  renderDistribution(stats.distribution);
  renderActivityCalendar(elements.streakCalendar, CALENDAR_WINDOW_DAYS);
  renderActivityCalendar(elements.statsCalendar, CALENDAR_WINDOW_DAYS);
}

function renderDistribution(distribution) {
  const max = Math.max(1, ...Object.values(distribution));
  elements.distribution.innerHTML = "";

  for (let guessCount = 1; guessCount <= 8; guessCount += 1) {
    const value = distribution[String(guessCount)] ?? 0;
    const row = document.createElement("div");
    row.className = "distribution-row";

    const label = document.createElement("span");
    label.textContent = String(guessCount);

    const bar = document.createElement("div");
    bar.className = "distribution-bar";

    const fill = document.createElement("div");
    fill.className = "distribution-fill";
    fill.style.width = `${(value / max) * 100}%`;
    bar.appendChild(fill);

    const count = document.createElement("strong");
    count.textContent = String(value);

    row.append(label, bar, count);
    elements.distribution.appendChild(row);
  }
}

function renderActivityCalendar(container, totalDays) {
  container.innerHTML = "";

  const weekdays = document.createElement("div");
  weekdays.className = "calendar-weekdays";
  WEEKDAY_LABELS.forEach((label) => {
    const cell = document.createElement("div");
    cell.className = "weekday";
    cell.textContent = label;
    weekdays.appendChild(cell);
  });
  container.appendChild(weekdays);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  const startDateKey = shiftDateKey(appState.todayKey, -(totalDays - 1));

  for (let offset = 0; offset < totalDays; offset += 1) {
    const dateKey = shiftDateKey(startDateKey, offset);
    const cell = document.createElement("div");
    const state = getDayState(dateKey);

    cell.className = `day-cell ${state.type}`;
    cell.dataset.date = dateKey;
    cell.textContent = String(Number(dateKey.slice(-2)));
    if (state.intensity !== null) {
      cell.style.setProperty("--win-strength", String(state.intensity));
    }
    if (state.isToday) {
      cell.classList.add("today");
    }
    cell.title = `${formatDateKey(dateKey, TIME_ZONE)}: ${describeDayState(state)}`;

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

function handleShare() {
  if (appState.ready) return shareResult(appState.puzzle, getProgress(), showToast);
}

async function handleExport() {
  try {
    const text = exportProgress(appState.save);
    const filename = `mannagrams-progress-${appState.todayKey}.json`;
    if (window.Capacitor?.isNativePlatform()) {
      const { shareFile } = await import("./native.mjs");
      await shareFile(filename, new Blob([text], { type: "application/json" }));
    } else {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  } catch {
    showToast("Could not export progress. Please try again.", 4000);
  }
}

async function handleImport() {
  const file = elements.importFile.files[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error("This backup is too large.");
    const merged = mergeProgressBackup(appState.save, await file.text());
    saveProgress(merged);
    appState.save = merged;
    startGame();
    showToast("Progress imported. Your completed games were kept.", 4000);
  } catch (error) {
    showToast(error.message || "Could not import progress.", 5000);
  } finally {
    elements.importFile.value = "";
  }
}

function flashKey(key) {
  clearTimeout(appState.keyFlashTimer);
  renderKeyboard(getKeyboardStatuses(getProgress(), appState.puzzle.answer), key);
  appState.keyFlashTimer = setTimeout(() => {
    renderKeyboard(getKeyboardStatuses(getProgress(), appState.puzzle.answer), null);
  }, 130);
}

function shakeBoard() {
  elements.board.classList.remove("shake");
  void elements.board.offsetWidth;
  elements.board.classList.add("shake");
}

function buildCalendarRangeLabel(totalDays) {
  const start = shiftDateKey(appState.todayKey, -(totalDays - 1));
  return `${formatDateKey(start, TIME_ZONE)} to ${formatDateKey(appState.todayKey, TIME_ZONE)}`;
}

function getDayState(dateKey) {
  if (compareDateKeys(dateKey, START_DATE) < 0) {
    return { intensity: null, isToday: dateKey === appState.todayKey, type: "empty" };
  }

  if (compareDateKeys(dateKey, appState.todayKey) > 0) {
    return { intensity: null, isToday: false, type: "empty" };
  }

  const progress = appState.save.puzzles[dateKey];
  if (progress?.completed) {
    if (progress.won) {
      return {
        intensity: getWinIntensity(dateKey, progress.guesses.length),
        guessesText: `${progress.guesses.length}/${progress.maxGuesses ?? selectPuzzleForDateKey(appState.answers, dateKey).maxGuesses}`,
        isToday: dateKey === appState.todayKey,
        type: "won",
      };
    }

    return { intensity: null, isToday: dateKey === appState.todayKey, type: "lost" };
  }

  if (dateKey === appState.todayKey) {
    return { intensity: null, isToday: true, type: "today" };
  }

  return { intensity: null, isToday: false, type: "missed" };
}

function describeDayState(state) {
  switch (state.type) {
    case "won":
      return `Won in ${state.guessesText ?? "?"}`;
    case "lost":
      return "Lost";
    case "missed":
      return "Missed";
    case "today":
      return "Today";
    default:
      return "No puzzle";
  }
}

function getWinIntensity(dateKey, guessCount) {
  if (!appState.answers.length) {
    return 0.5;
  }

  const puzzle = selectPuzzleForDateKey(appState.answers, dateKey);
  puzzle.maxGuesses = appState.save.puzzles[dateKey]?.maxGuesses ?? puzzle.maxGuesses;
  if (puzzle.maxGuesses <= 1) {
    return 1;
  }

  const normalized = (puzzle.maxGuesses - guessCount) / (puzzle.maxGuesses - 1);
  return Math.max(0.08, Math.min(1, normalized));
}

function getProgress() {
  return appState.puzzle.isArchive ? archiveProgress(appState.save, appState.puzzle.key) : appState.save.puzzles[appState.puzzle.key];
}

function persistSave() {
  saveProgress(appState.save);
}

function showToast(message, timeout = 2200) {
  clearTimeout(appState.toastTimer);
  elements.toast.hidden = false;
  elements.toast.textContent = message;
  elements.toast.classList.remove("show");
  void elements.toast.offsetWidth;
  elements.toast.classList.add("show");
  appState.toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, timeout);
}

function sanitizeDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : null;
}

function formatTodaySummaryDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${day} ${MONTH_LABELS[month - 1]}, ${year}`;
}
