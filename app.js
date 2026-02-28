import {
  START_DATE,
  TIME_ZONE,
  compareDateKeys,
  dateToIndex,
  formatDateKey,
  getDateKeyInTimeZone,
  isValidDateKey,
  selectPuzzleForDateKey,
  shiftDateKey,
} from "./puzzle-utils.mjs";

const ANSWERS_PATH = "./jwordl_tier1_expanded_core_vocab_4to6.json";
const GUESSES_PATH = "./bwordible_allowed_guesses_4to6.json";
const STORAGE_KEY = "bwordible-state-v2";
const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
];
const STATUS_RANK = {
  absent: 1,
  present: 2,
  correct: 3,
};
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const CALENDAR_WINDOW_DAYS = 35;

const elements = {
  answerCount: document.querySelector("#answerCount"),
  archiveButton: document.querySelector("#archiveButton"),
  archiveCalendar: document.querySelector("#archiveCalendar"),
  archiveDialog: document.querySelector("#archiveDialog"),
  archiveEmptyState: document.querySelector("#archiveEmptyState"),
  archiveLaunchButton: document.querySelector("#archiveLaunchButton"),
  archiveMonthLabel: document.querySelector("#archiveMonthLabel"),
  archiveNextButton: document.querySelector("#archiveNextButton"),
  archivePrevButton: document.querySelector("#archivePrevButton"),
  archiveSummary: document.querySelector("#archiveSummary"),
  board: document.querySelector("#board"),
  calendarRangeLabel: document.querySelector("#calendarRangeLabel"),
  countdown: document.querySelector("#countdown"),
  currentStreak: document.querySelector("#currentStreak"),
  distribution: document.querySelector("#distribution"),
  guessCount: document.querySelector("#guessCount"),
  guessRule: document.querySelector("#guessRule"),
  helpButton: document.querySelector("#helpButton"),
  helpDialog: document.querySelector("#helpDialog"),
  keyboard: document.querySelector("#keyboard"),
  modeValue: document.querySelector("#modeValue"),
  noticeBanner: document.querySelector("#noticeBanner"),
  noticeText: document.querySelector("#noticeText"),
  puzzleDate: document.querySelector("#puzzleDate"),
  puzzleLabel: document.querySelector("#puzzleLabel"),
  puzzleMeta: document.querySelector("#puzzleMeta"),
  returnTodayButton: document.querySelector("#returnTodayButton"),
  shareButton: document.querySelector("#shareButton"),
  statsAverage: document.querySelector("#statsAverage"),
  statsButton: document.querySelector("#statsButton"),
  statsCalendar: document.querySelector("#statsCalendar"),
  statsCalendarRangeLabel: document.querySelector("#statsCalendarRangeLabel"),
  statsDialog: document.querySelector("#statsDialog"),
  statsMaxStreak: document.querySelector("#statsMaxStreak"),
  statsPlayed: document.querySelector("#statsPlayed"),
  statsWins: document.querySelector("#statsWins"),
  statusBanner: document.querySelector("#statusBanner"),
  streakCalendar: document.querySelector("#streakCalendar"),
  toast: document.querySelector("#toast"),
  winRate: document.querySelector("#winRate"),
};

const appState = {
  answers: [],
  allowedByLength: new Map(),
  archiveMonth: null,
  puzzle: null,
  ready: false,
  save: loadSave(),
  simulatedTodayKey: null,
  todayKey: null,
  toastTimer: null,
};

init().catch((error) => {
  console.error(error);
  const localFileHint =
    window.location.protocol === "file:"
      ? " Open the folder through a local web server because browsers block JSON loading over file://."
      : "";
  setStatus(`Unable to load the bWORDibLE data files.${localFileHint}`, "error");
});

async function init() {
  attachEvents();

  const params = new URLSearchParams(window.location.search);
  const simulatedTodayKey = sanitizeDateKey(params.get("today"));
  appState.simulatedTodayKey = simulatedTodayKey;
  appState.todayKey = simulatedTodayKey ?? getDateKeyInTimeZone(new Date(), TIME_ZONE);

  renderKeyboard({}, null);
  renderStats();

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

  syncCounts(answers.length, guesses.metadata.count_total);

  const initialDateKey = normalizeRequestedDateKey(params.get("date"));
  openPuzzle(initialDateKey, { replaceHistory: false });
  document.body.classList.add("app-ready");
}

function attachEvents() {
  document.addEventListener("keydown", handlePhysicalKeyboard);
  elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.statsButton.addEventListener("click", () => {
    renderStats();
    elements.statsDialog.showModal();
  });
  elements.archiveButton.addEventListener("click", openArchiveDialog);
  elements.archiveLaunchButton.addEventListener("click", openArchiveDialog);
  elements.archivePrevButton.addEventListener("click", () => changeArchiveMonth(-1));
  elements.archiveNextButton.addEventListener("click", () => changeArchiveMonth(1));
  elements.archiveCalendar.addEventListener("click", handleArchiveSelection);
  elements.shareButton.addEventListener("click", handleShare);
  elements.keyboard.addEventListener("click", handleVirtualKeyboard);
  elements.returnTodayButton.addEventListener("click", () => {
    openPuzzle(appState.todayKey);
  });
}

function openArchiveDialog() {
  appState.archiveMonth = getArchiveMonthSeed();
  renderArchiveBrowser();
  elements.archiveDialog.showModal();
}

function getArchiveMonthSeed() {
  const source = isArchiveMode() ? appState.puzzle.key : getMaxArchiveDateKey() ?? START_DATE;
  return source.slice(0, 7);
}

function changeArchiveMonth(delta) {
  if (!appState.archiveMonth) {
    appState.archiveMonth = getArchiveMonthSeed();
  }

  const [year, month] = appState.archiveMonth.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  const nextMonth = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
  const minMonth = START_DATE.slice(0, 7);
  const maxArchiveDateKey = getMaxArchiveDateKey();
  const maxMonth = maxArchiveDateKey ? maxArchiveDateKey.slice(0, 7) : minMonth;

  if (compareDateKeys(nextMonth, minMonth) < 0 || compareDateKeys(nextMonth, maxMonth) > 0) {
    return;
  }

  appState.archiveMonth = nextMonth;
  renderArchiveBrowser();
}

function handleArchiveSelection(event) {
  const button = event.target.closest("button[data-date]");
  if (!button) {
    return;
  }

  const dateKey = button.dataset.date;
  openPuzzle(dateKey);
  elements.archiveDialog.close();
}

function openPuzzle(dateKey, { replaceHistory = true } = {}) {
  const normalizedDateKey = normalizeRequestedDateKey(dateKey);
  const mode = resolveMode(normalizedDateKey);
  const selectionKey = mode === "preview" ? appState.todayKey : normalizedDateKey;
  const puzzleData = selectPuzzleForDateKey(appState.answers, selectionKey);
  const puzzle = {
    ...puzzleData,
    displayDate: formatDateKey(normalizedDateKey, TIME_ZONE),
    isRanked: mode === "daily",
    key: normalizedDateKey,
    mode,
    todayKey: appState.todayKey,
  };

  appState.puzzle = puzzle;
  appState.ready = true;

  if (!appState.save.puzzles[puzzle.key]) {
    appState.save.puzzles[puzzle.key] = createPuzzleProgress();
    persistSave();
  }

  if (replaceHistory) {
    syncLocation();
  }

  renderGame();
  clearInterval(openPuzzle.countdownTimer);
  openPuzzle.countdownTimer = setInterval(updateCountdown, 60_000);
}

function renderGame() {
  const puzzle = appState.puzzle;
  const progress = getProgress();

  elements.puzzleDate.textContent = puzzle.displayDate;
  elements.puzzleMeta.textContent = `${puzzle.length} letters • ${puzzle.maxGuesses} guesses`;
  elements.guessRule.textContent = `${puzzle.length} letters • ${puzzle.maxGuesses} guesses`;
  elements.modeValue.textContent =
    puzzle.mode === "daily" ? "Ranked daily" : puzzle.mode === "archive" ? "Archive" : "Preview";
  elements.puzzleLabel.textContent =
    puzzle.mode === "daily" ? "Today’s puzzle" : puzzle.mode === "archive" ? "Archive puzzle" : "Preview puzzle";

  renderNotice();
  setStatus(getStatusMessage(progress), "calm");
  renderBoard();
  renderKeyboard(getKeyboardStatuses(), null);
  renderStats();
  renderArchiveBrowser();
  updateCountdown();
}

function renderNotice() {
  const puzzle = appState.puzzle;
  const maxArchiveDateKey = getMaxArchiveDateKey();
  let message = "";
  let showReturn = false;

  if (puzzle.mode === "preview") {
    message =
      "Preview mode: the live daily rotation begins on March 1, 2026 in America/New_York. This puzzle uses the opening answer and does not affect stats.";
  } else if (puzzle.mode === "archive") {
    message = "Archive mode: progress is saved for this date, but stats and streaks are unchanged.";
    showReturn = true;
  } else if (!maxArchiveDateKey) {
    message = "Archive browsing unlocks after the first live daily puzzle is released.";
  }

  elements.noticeBanner.hidden = !message;
  elements.noticeText.textContent = message;
  elements.returnTodayButton.hidden = !showReturn;
}

function handlePhysicalKeyboard(event) {
  if (!appState.ready) {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (document.activeElement?.tagName === "BUTTON") {
    document.activeElement.blur();
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

  const key = button.dataset.key;
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
    if (puzzle.isRanked) {
      recordStats(progress.guesses.length);
    }
  } else if (progress.guesses.length >= puzzle.maxGuesses) {
    progress.completed = true;
    progress.won = false;
    if (puzzle.isRanked) {
      recordStats(null);
    }
  }

  persistSave();
  setStatus(getStatusMessage(progress), "calm");
  renderBoard({ revealRowIndex: progress.guesses.length - 1 });
  renderKeyboard(getKeyboardStatuses(), null);
  renderStats();

  if (progress.completed) {
    elements.statsDialog.open || elements.statsDialog.showModal();
  }
}

function renderBoard(options = {}) {
  const { popCell = null, revealRowIndex = null } = options;
  const puzzle = appState.puzzle;
  const progress = getProgress();
  const blockedCount = 6 - puzzle.length;
  const evaluations = progress.guesses.map((guess) => evaluateGuess(guess, puzzle.answer));

  elements.board.innerHTML = "";

  for (let rowIndex = 0; rowIndex < puzzle.maxGuesses; rowIndex += 1) {
    const row = document.createElement("div");
    row.className = "board-row";
    row.dataset.row = String(rowIndex);

    const guess = progress.guesses[rowIndex] ?? "";
    const activeWord = !progress.completed && rowIndex === progress.guesses.length ? progress.currentGuess : "";
    const letters = guess || activeWord;
    const statuses = evaluations[rowIndex] ?? [];

    for (let columnIndex = 0; columnIndex < 6; columnIndex += 1) {
      const tile = document.createElement("div");
      tile.className = "tile";

      if (columnIndex < blockedCount) {
        tile.classList.add("blocked");
        tile.setAttribute("aria-hidden", "true");
        row.appendChild(tile);
        continue;
      }

      const letterIndex = columnIndex - blockedCount;
      const letter = letters[letterIndex] ?? "";
      const status = statuses[letterIndex];

      tile.textContent = letter;
      tile.dataset.row = String(rowIndex);
      tile.dataset.col = String(columnIndex);

      if (letter) {
        tile.classList.add("filled");
      }

      if (status) {
        tile.classList.add(status);
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
      button.textContent = key === "BACKSPACE" ? "Delete" : key;

      if (key === "ENTER" || key === "BACKSPACE") {
        button.classList.add("wide");
      }

      const status = statuses[key];
      if (status) {
        button.classList.add(status);
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
  const stats = appState.save.stats;
  const winRate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const average = stats.wins ? (stats.totalWinningGuesses / stats.wins).toFixed(1) : "-";
  const currentStreak = computeDisplayedCurrentStreak();

  elements.currentStreak.textContent = String(currentStreak);
  elements.winRate.textContent = `${winRate}%`;
  elements.statsPlayed.textContent = String(stats.played);
  elements.statsWins.textContent = String(stats.wins);
  elements.statsMaxStreak.textContent = String(stats.maxStreak);
  elements.statsAverage.textContent = average;

  renderDistribution(stats.distribution);
  renderActivityCalendar(elements.streakCalendar, CALENDAR_WINDOW_DAYS, "compact");
  renderActivityCalendar(elements.statsCalendar, CALENDAR_WINDOW_DAYS, "full");

  const rangeText = buildCalendarRangeLabel(CALENDAR_WINDOW_DAYS);
  elements.calendarRangeLabel.textContent = rangeText;
  elements.statsCalendarRangeLabel.textContent = rangeText;
  elements.archiveSummary.textContent = buildArchiveSummary();
}

function renderDistribution(distribution) {
  const max = Math.max(1, ...Object.values(distribution));
  elements.distribution.innerHTML = "";

  for (let guessCount = 1; guessCount <= 7; guessCount += 1) {
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

function renderActivityCalendar(container, totalDays, variant) {
  if (!container) {
    return;
  }

  const startDateKey = shiftDateKey(appState.todayKey, -(totalDays - 1));
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

  for (let offset = 0; offset < totalDays; offset += 1) {
    const dateKey = shiftDateKey(startDateKey, offset);
    const status = getDayStatus(dateKey);
    const cell = document.createElement("div");
    cell.className = `day-cell ${variant} ${status}`;
    cell.dataset.date = dateKey;
    cell.title = `${formatDateKey(dateKey, TIME_ZONE)}: ${status}`;

    if (dateKey === appState.puzzle?.key) {
      cell.classList.add("selected");
    }

    if (variant === "compact") {
      cell.textContent = String(Number(dateKey.slice(-2)));
    } else {
      cell.textContent = String(Number(dateKey.slice(-2)));
    }

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

function renderArchiveBrowser() {
  const maxArchiveDateKey = getMaxArchiveDateKey();

  if (!appState.archiveMonth) {
    appState.archiveMonth = getArchiveMonthSeed();
  }

  elements.archiveEmptyState.hidden = Boolean(maxArchiveDateKey);
  elements.archiveCalendar.innerHTML = "";

  const minMonth = START_DATE.slice(0, 7);
  const maxMonth = maxArchiveDateKey ? maxArchiveDateKey.slice(0, 7) : minMonth;
  elements.archivePrevButton.disabled = compareDateKeys(appState.archiveMonth, minMonth) <= 0;
  elements.archiveNextButton.disabled = compareDateKeys(appState.archiveMonth, maxMonth) >= 0;

  const [year, month] = appState.archiveMonth.split("-").map(Number);
  elements.archiveMonthLabel.textContent = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  if (!maxArchiveDateKey) {
    return;
  }

  const weekdays = document.createElement("div");
  weekdays.className = "calendar-weekdays";
  WEEKDAY_LABELS.forEach((label) => {
    const cell = document.createElement("div");
    cell.className = "weekday";
    cell.textContent = label;
    weekdays.appendChild(cell);
  });
  elements.archiveCalendar.appendChild(weekdays);

  const grid = document.createElement("div");
  grid.className = "archive-month-grid";

  const firstDate = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = firstDate.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  for (let index = 0; index < firstWeekday; index += 1) {
    const filler = document.createElement("div");
    filler.className = "archive-day empty";
    grid.appendChild(filler);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${pad(month)}-${pad(day)}`;
    const button = document.createElement("button");
    button.className = "archive-day";
    button.type = "button";
    button.dataset.date = dateKey;
    button.setAttribute("aria-label", formatDateKey(dateKey, TIME_ZONE));

    const isPlayable =
      compareDateKeys(dateKey, START_DATE) >= 0 && compareDateKeys(dateKey, maxArchiveDateKey) <= 0;
    const status = isPlayable ? getDayStatus(dateKey) : "disabled";

    if (!isPlayable) {
      button.disabled = true;
    }

    if (status !== "disabled") {
      button.classList.add(status);
    }

    if (dateKey === appState.todayKey) {
      button.classList.add("is-today");
    }

    if (dateKey === appState.puzzle?.key) {
      button.classList.add("is-selected");
    }

    const dayNumber = document.createElement("span");
    dayNumber.className = "archive-day-number";
    dayNumber.textContent = String(day);

    const meta = document.createElement("span");
    meta.className = "archive-day-meta";
    meta.textContent = describeDayStatus(status);

    button.append(dayNumber, meta);
    grid.appendChild(button);
  }

  elements.archiveCalendar.appendChild(grid);
}

function updateCountdown() {
  if (!appState.puzzle) {
    return;
  }

  if (appState.puzzle.mode !== "daily") {
    elements.countdown.textContent = "Static";
    return;
  }

  const now = new Date();
  const nextMidnight = getNextNewYorkMidnight(now);
  const diffMs = Math.max(0, nextMidnight.getTime() - now.getTime());
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  elements.countdown.textContent = `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function handleShare() {
  if (!appState.ready) {
    return;
  }

  const progress = getProgress();
  if (!progress.completed) {
    showToast("Finish the puzzle before sharing.");
    return;
  }

  const shareText = buildShareText();

  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(shareText)
      .then(() => showToast("Result copied to clipboard."))
      .catch(() => showToast(shareText, 5000));
    return;
  }

  showToast(shareText, 5000);
}

function buildShareText() {
  const puzzle = appState.puzzle;
  const progress = getProgress();
  const result = progress.won ? `${progress.guesses.length}/${puzzle.maxGuesses}` : `X/${puzzle.maxGuesses}`;
  const blockedCount = 6 - puzzle.length;
  const modeLabel = puzzle.mode === "daily" ? "" : puzzle.mode === "archive" ? " Archive" : " Preview";
  const lines = progress.guesses.map((guess) => {
    const statuses = evaluateGuess(guess, puzzle.answer);
    const left = "⬛".repeat(blockedCount);
    const right = statuses
      .map((status) => {
        if (status === "correct") {
          return "🟩";
        }
        if (status === "present") {
          return "🟨";
        }
        return "⬜";
      })
      .join("");
    return `${left}${right}`;
  });

  return [`bWORDibLE${modeLabel} ${puzzle.displayDate} ${result}`, ...lines].join("\n");
}

function getKeyboardStatuses() {
  const progress = getProgress();
  const statuses = {};

  progress.guesses.forEach((guess) => {
    const evaluation = evaluateGuess(guess, appState.puzzle.answer);
    evaluation.forEach((status, index) => {
      const letter = guess[index];
      const existing = statuses[letter];
      if (!existing || STATUS_RANK[status] > STATUS_RANK[existing]) {
        statuses[letter] = status;
      }
    });
  });

  return statuses;
}

function evaluateGuess(guess, answer) {
  const statuses = Array.from({ length: guess.length }, () => "absent");
  const remaining = {};

  for (let index = 0; index < answer.length; index += 1) {
    if (guess[index] === answer[index]) {
      statuses[index] = "correct";
    } else {
      remaining[answer[index]] = (remaining[answer[index]] ?? 0) + 1;
    }
  }

  for (let index = 0; index < answer.length; index += 1) {
    const letter = guess[index];
    if (statuses[index] === "correct") {
      continue;
    }

    if ((remaining[letter] ?? 0) > 0) {
      statuses[index] = "present";
      remaining[letter] -= 1;
    }
  }

  return statuses;
}

function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultSave();
    }

    const parsed = JSON.parse(raw);
    return {
      puzzles: parsed.puzzles ?? {},
      stats: {
        ...createDefaultSave().stats,
        ...(parsed.stats ?? {}),
      },
    };
  } catch (error) {
    console.warn("Failed to load saved game state.", error);
    return createDefaultSave();
  }
}

function createDefaultSave() {
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
      },
      lastCompletedDate: null,
      maxStreak: 0,
      played: 0,
      totalWinningGuesses: 0,
      wins: 0,
    },
  };
}

function createPuzzleProgress() {
  return {
    completed: false,
    currentGuess: "",
    guesses: [],
    statsRecorded: false,
    won: false,
  };
}

function getProgress() {
  return appState.save.puzzles[appState.puzzle.key];
}

function persistSave() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.save));
}

function recordStats(winningGuesses) {
  const progress = getProgress();
  const stats = appState.save.stats;

  if (progress.statsRecorded) {
    return;
  }

  stats.played += 1;

  if (winningGuesses) {
    stats.wins += 1;
    const streakContinues =
      stats.lastCompletedDate &&
      dateToIndex(appState.puzzle.key, stats.lastCompletedDate) === 1;
    stats.currentStreak = streakContinues ? stats.currentStreak + 1 : 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
    stats.totalWinningGuesses += winningGuesses;
    stats.distribution[String(winningGuesses)] += 1;
  } else {
    stats.currentStreak = 0;
  }

  stats.lastCompletedDate = appState.puzzle.key;
  progress.statsRecorded = true;
}

function syncCounts(answerCount, guessCount) {
  elements.answerCount.textContent = answerCount.toLocaleString("en-US");
  elements.guessCount.textContent = guessCount.toLocaleString("en-US");
}

function setStatus(message, tone = "calm") {
  elements.statusBanner.textContent = message;
  elements.statusBanner.dataset.tone = tone;
  elements.statusBanner.classList.remove("pulse");
  void elements.statusBanner.offsetWidth;
  elements.statusBanner.classList.add("pulse");
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

function getStatusMessage(progress) {
  if (!progress.completed) {
    return isArchiveMode() ? "Replay the released Bible-themed puzzle." : "Guess the Bible-themed word.";
  }

  if (progress.won) {
    return appState.puzzle.mode === "archive"
      ? `Archive solved in ${progress.guesses.length}/${appState.puzzle.maxGuesses}.`
      : appState.puzzle.mode === "preview"
        ? `Preview solved in ${progress.guesses.length}/${appState.puzzle.maxGuesses}.`
        : `Solved in ${progress.guesses.length}/${appState.puzzle.maxGuesses}.`;
  }

  return appState.puzzle.mode === "archive"
    ? `Archive complete. The answer was ${appState.puzzle.answer}.`
    : appState.puzzle.mode === "preview"
      ? `Preview complete. The answer was ${appState.puzzle.answer}.`
      : `No more guesses. The answer was ${appState.puzzle.answer}.`;
}

function computeDisplayedCurrentStreak() {
  if (compareDateKeys(appState.todayKey, START_DATE) < 0) {
    return 0;
  }

  let cursor = appState.todayKey;
  const todayProgress = appState.save.puzzles[cursor];

  if (!todayProgress?.completed || !todayProgress.won) {
    cursor = shiftDateKey(cursor, -1);
  }

  let streak = 0;

  while (compareDateKeys(cursor, START_DATE) >= 0) {
    const progress = appState.save.puzzles[cursor];
    if (!progress?.completed || !progress.won) {
      break;
    }
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  return streak;
}

function buildCalendarRangeLabel(totalDays) {
  const start = shiftDateKey(appState.todayKey, -(totalDays - 1));
  return `${formatDateKey(start, TIME_ZONE)} to ${formatDateKey(appState.todayKey, TIME_ZONE)}`;
}

function buildArchiveSummary() {
  const maxArchiveDateKey = getMaxArchiveDateKey();
  if (!maxArchiveDateKey) {
    return "Archive browsing unlocks once the live daily schedule starts.";
  }

  const released = dateToIndex(maxArchiveDateKey, START_DATE) + 1;
  const selectedLabel =
    appState.puzzle?.mode === "archive" ? ` Viewing ${appState.puzzle.displayDate}.` : "";
  return `${released} released puzzles are available from ${formatDateKey(START_DATE, TIME_ZONE)} onward.${selectedLabel}`;
}

function getDayStatus(dateKey) {
  if (compareDateKeys(dateKey, START_DATE) < 0) {
    return "empty";
  }

  const maxArchiveDateKey = getMaxArchiveDateKey();
  if (!maxArchiveDateKey || compareDateKeys(dateKey, maxArchiveDateKey) > 0) {
    return "empty";
  }

  const progress = appState.save.puzzles[dateKey];
  if (progress?.completed) {
    return progress.won ? "won" : "lost";
  }

  if (dateKey === appState.todayKey) {
    return "today";
  }

  return compareDateKeys(dateKey, appState.todayKey) < 0 ? "missed" : "today";
}

function describeDayStatus(status) {
  switch (status) {
    case "won":
      return "Won";
    case "lost":
      return "Lost";
    case "missed":
      return "Missed";
    case "today":
      return "Today";
    default:
      return "Locked";
  }
}

function getNextNewYorkMidnight(date) {
  const currentDateKey = getDateKeyInTimeZone(date, TIME_ZONE);
  let candidate = new Date(date.getTime());

  candidate.setUTCSeconds(0, 0);
  candidate = new Date(candidate.getTime() + 60_000);

  while (getDateKeyInTimeZone(candidate, TIME_ZONE) === currentDateKey) {
    candidate = new Date(candidate.getTime() + 60_000);
  }

  return candidate;
}

function isArchiveMode() {
  return appState.puzzle?.mode === "archive";
}

function getMaxArchiveDateKey() {
  return compareDateKeys(appState.todayKey, START_DATE) >= 0 ? appState.todayKey : null;
}

function resolveMode(dateKey) {
  if (compareDateKeys(appState.todayKey, START_DATE) < 0 && dateKey === appState.todayKey) {
    return "preview";
  }

  return dateKey === appState.todayKey ? "daily" : "archive";
}

function normalizeRequestedDateKey(rawDateKey) {
  const sanitized = sanitizeDateKey(rawDateKey);
  const maxArchiveDateKey = getMaxArchiveDateKey();

  if (!sanitized) {
    return appState.todayKey;
  }

  if (sanitized === appState.todayKey) {
    return sanitized;
  }

  if (!maxArchiveDateKey) {
    return appState.todayKey;
  }

  if (compareDateKeys(sanitized, START_DATE) < 0 || compareDateKeys(sanitized, maxArchiveDateKey) > 0) {
    return appState.todayKey;
  }

  return sanitized;
}

function sanitizeDateKey(value) {
  return isValidDateKey(value) ? value : null;
}

function syncLocation() {
  const params = new URLSearchParams(window.location.search);

  if (appState.simulatedTodayKey) {
    params.set("today", appState.simulatedTodayKey);
  } else {
    params.delete("today");
  }

  if (appState.puzzle.mode === "archive") {
    params.set("date", appState.puzzle.key);
  } else {
    params.delete("date");
  }

  const query = params.toString();
  const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState({}, "", nextUrl);
}

function flashKey(key) {
  renderKeyboard(getKeyboardStatuses(), key);
}

function shakeBoard() {
  elements.board.classList.remove("shake");
  void elements.board.offsetWidth;
  elements.board.classList.add("shake");
}

function pad(value) {
  return String(value).padStart(2, "0");
}
