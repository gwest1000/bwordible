import { STATUS_SYMBOL, evaluateGuess, getKeyboardStatuses } from "./game-engine.mjs";
import { loadSave, createPuzzleProgress, recordStats, syncDerivedStats, saveProgress, exportProgress, mergeProgressBackup } from "./progress-store.mjs";
import { shareResult } from "./sharing.mjs";
import { getAccess, getGuessAllowance } from "./entitlements.mjs";
import { createArchive, isArchiveDate, archiveProgress } from "./archive.mjs";
import {
  START_DATE,
  TIME_ZONE,
  compareDateKeys,
  formatDateKey,
  getDateKeyInTimeZone,
  selectPuzzleForDateKey,
} from "./puzzle-utils.mjs";

const ANSWERS_PATH = "./jwordl_tier1_expanded_core_vocab_4to6.json";
const GUESSES_PATH = "./bwordible_allowed_guesses_4to6.json";
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
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const elements = {
  board: document.querySelector("#board"),
  menuButton: document.querySelector("#menuButton"),
  menuDialog: document.querySelector("#menuDialog"),
  closeMenuButton: document.querySelector("#closeMenuButton"),
  dayDialog: document.querySelector("#dayDialog"),
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
  exportButton: document.querySelector("#exportButton"),
  importFile: document.querySelector("#importFile"),
  statsAverage: document.querySelector("#statsAverage"),
  statsMaxStreak: document.querySelector("#statsMaxStreak"),
  statsWins: document.querySelector("#statsWins"),
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
  dialog: document.querySelector("#historyCalendar"),
  getSave: () => appState.save,
  getToday: () => appState.todayKey,
  onSelect: showDayDetails,
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
  const localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname) && !window.Capacitor?.isNativePlatform();
  appState.simulatedTodayKey = localPreview ? sanitizeDateKey(params.get("today")) : null;
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
  startGame();
  const sidebarLayout = window.matchMedia("(min-width: 760px) and (min-height: 600px)");
  sidebarLayout.addEventListener("change", syncMenuPresentation);
  syncMenuPresentation();
  const layoutObserver = new ResizeObserver(scheduleBoardFit);
  for (const selector of [".brand-card", ".keyboard-card", "#resultPanel"]) {
    layoutObserver.observe(document.querySelector(selector));
  }
  window.addEventListener("resize", scheduleBoardFit);
  window.visualViewport?.addEventListener("resize", scheduleBoardFit);
  if (isArchiveDate(archivedDate, appState.todayKey) && appState.access.archive) showDayDetails(archivedDate);
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
  elements.menuButton.addEventListener("click", () => {
    if (!appState.ready) return;
    renderStats();
    archive.open(appState.todayKey);
    elements.menuDialog.showModal();
    elements.menuButton.setAttribute("aria-expanded", "true");
  });
  elements.closeMenuButton.addEventListener("click", () => elements.menuDialog.close());
  elements.menuDialog.addEventListener("close", () => elements.menuButton.setAttribute("aria-expanded", "false"));
  elements.shareButton.addEventListener("click", handleShare);
  elements.resultShareButton.addEventListener("click", handleShare);
  elements.keyboard.addEventListener("click", handleVirtualKeyboard);
  elements.exportButton.addEventListener("click", handleExport);
  elements.importFile.addEventListener("change", handleImport);

}

function syncMenuPresentation() {
  const sidebar = window.matchMedia("(min-width: 760px) and (min-height: 600px)").matches;
  const previousFocus = document.activeElement;
  if (elements.menuDialog.open) elements.menuDialog.close();
  if (sidebar) {
    elements.menuDialog.setAttribute("role", "complementary");
    archive.open(appState.todayKey);
    elements.menuDialog.show();
  } else {
    elements.menuDialog.removeAttribute("role");
  }
  // Switching from a modal drawer must release its focus trap before gameplay resumes.
  if (previousFocus === document.body || previousFocus === elements.menuButton ||
      previousFocus === elements.closeMenuButton || !previousFocus?.getClientRects().length) {
    elements.board.focus({ preventScroll: true });
  } else {
    previousFocus.focus({ preventScroll: true });
  }
  scheduleBoardFit();
}

function startGame() {
  const dateKey = appState.todayKey;
  const switchingPuzzle = appState.ready;
  clearTimeout(appState.winAnimationTimer);
  clearTimeout(appState.keyFlashTimer);
  clearTimeout(appState.toastTimer);
  elements.toast.hidden = true;
  const puzzleData = selectPuzzleForDateKey(appState.answers, dateKey);
  const progress = appState.save.puzzles[dateKey];
  appState.puzzle = {
    ...puzzleData,
    maxGuesses: getGuessAllowance(puzzleData.length, appState.access, progress),
    displayDate: formatDateKey(dateKey, TIME_ZONE),
    isPreview: compareDateKeys(dateKey, START_DATE) < 0,
    key: dateKey,
  };
  appState.ready = true;

  if (!appState.save.puzzles[appState.puzzle.key]) {
    appState.save.puzzles[appState.puzzle.key] = createPuzzleProgress();
  }
  getProgress().maxGuesses = appState.puzzle.maxGuesses;
  persistSave();
  const url = new URL(window.location.href);
  url.searchParams.delete("archive");
  window.history.replaceState(null, "", url);

  renderTodaySummary();
  renderBoard();
  renderResultPanel();
  renderKeyboard(getKeyboardStatuses(getProgress(), appState.puzzle.answer), null);
  renderStats();
  renderShareState();
  startRolloverMonitor();
  scheduleBoardFit();
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
    `<time class="today-line" datetime="${puzzle.key}">${dateLabel}</time>`,
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
  if (event.target instanceof HTMLInputElement) return;

  if (
    event.target instanceof HTMLButtonElement &&
    (event.key === "Enter" || event.key === " ")
  ) {
    return;
  }

  if (elements.helpDialog.open || elements.menuDialog.matches(":modal") || elements.dayDialog.open) {
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
    if (!puzzle.isPreview) {
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
  elements.board.style.setProperty("--word-length", String(puzzle.length));

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

let boardFitFrame;
function scheduleBoardFit() {
  cancelAnimationFrame(boardFitFrame);
  boardFitFrame = requestAnimationFrame(fitBoardToScreen);
}

function fitBoardToScreen() {
  if (!appState.ready) return;
  const card = document.querySelector(".board-card");
  const keyboard = document.querySelector(".keyboard-card");
  const panel = document.querySelector(".game-panel");
  const cardStyle = getComputedStyle(card);
  const number = (value) => Number.parseFloat(value) || 0;
  const sideBySide = window.matchMedia("(min-width: 600px) and (max-height: 500px)").matches;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const panelGap = number(getComputedStyle(panel).rowGap);
  const bottomPadding = number(getComputedStyle(document.querySelector(".app-shell")).paddingBottom);
  const resultHeight = elements.resultPanel.hidden ? 0 :
    elements.resultPanel.getBoundingClientRect().height + number(cardStyle.rowGap) +
    number(getComputedStyle(elements.resultPanel).marginTop);
  const availableHeight = viewportHeight - (card.getBoundingClientRect().top + window.scrollY) -
    number(cardStyle.paddingTop) - number(cardStyle.paddingBottom) - bottomPadding -
    (sideBySide ? 0 : keyboard.getBoundingClientRect().height + panelGap) - resultHeight;
  const availableWidth = card.clientWidth - number(cardStyle.paddingLeft) - number(cardStyle.paddingRight);
  const gap = number(getComputedStyle(elements.board).rowGap);
  const { length, maxGuesses } = appState.puzzle;
  const size = Math.max(32, Math.floor(Math.min(
    86,
    (availableWidth - (length - 1) * gap) / length,
    (availableHeight - (maxGuesses - 1) * gap) / maxGuesses,
  )));
  elements.board.style.setProperty("--tile-size", `${size}px`);
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
  elements.resultLabel.textContent = progress.won ? "Solved" : "Today’s word";
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

  elements.winStreak.textContent = String(stats.currentStreak);
  elements.playStreak.textContent = String(stats.playStreak);
  elements.winRate.textContent = `${winRate}%`;
  elements.playedCount.textContent = String(stats.played);
  elements.statsWins.textContent = String(stats.wins);
  elements.statsMaxStreak.textContent = String(stats.maxStreak);
  elements.statsAverage.textContent = average;

  renderDistribution(stats.distribution);
  if (elements.menuDialog.open) archive.open(appState.todayKey);
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

function showDayDetails(dateKey) {
  if (!appState.access.archive) return showToast("Game history is included with Premium.");
  if (!isArchiveDate(dateKey, appState.todayKey) && dateKey !== appState.todayKey) return;
  const progress = archiveProgress(appState.save, dateKey) ?? appState.save.puzzles[dateKey];
  const puzzle = selectPuzzleForDateKey(appState.answers, dateKey);
  document.querySelector("#dayTitle").textContent = formatDateKey(dateKey, TIME_ZONE);
  document.querySelector("#dayStatus").textContent = progress?.completed
    ? progress.won ? `Solved in ${progress.guesses.length}/${progress.maxGuesses ?? puzzle.maxGuesses} guesses.` : "Not solved."
    : progress?.guesses.length || progress?.currentGuess ? "Unfinished. Past puzzles cannot be resumed."
    : dateKey === appState.todayKey ? "Today's puzzle is ready to play." : "Not played. Missed puzzles cannot be played.";
  document.querySelector("#dayWord").textContent = progress?.completed && progress.won ? puzzle.answer : "";
  const board = document.querySelector("#dayGuesses");
  board.replaceChildren();
  if (progress?.completed) {
    for (const guess of progress.guesses) {
      const row = document.createElement("div");
      row.className = "board-row";
      row.style.setProperty("--word-length", String(puzzle.length));
      const statuses = evaluateGuess(guess, puzzle.answer);
      [...guess].forEach((letter, index) => {
        const tile = document.createElement("div");
        tile.className = `tile filled ${statuses[index]}`;
        tile.setAttribute("aria-label", `${letter}: ${STATUS_LABEL[statuses[index]]}`);
        const symbol = document.createElement("span");
        symbol.className = "tile-symbol";
        symbol.textContent = STATUS_SYMBOL[statuses[index]];
        symbol.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.className = "tile-letter";
        text.textContent = letter;
        tile.append(symbol, text);
        row.append(tile);
      });
      board.append(row);
    }
  }
  elements.dayDialog.showModal();
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

function getProgress() {
  return appState.save.puzzles[appState.puzzle.key];
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
