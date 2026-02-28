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
const STORAGE_KEY = "bwordible-state-v2";
const CALENDAR_WINDOW_DAYS = 35;
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
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const elements = {
  bestStreak: document.querySelector("#bestStreak"),
  board: document.querySelector("#board"),
  calendarRangeLabel: document.querySelector("#calendarRangeLabel"),
  currentStreak: document.querySelector("#currentStreak"),
  distribution: document.querySelector("#distribution"),
  helpButton: document.querySelector("#helpButton"),
  helpDialog: document.querySelector("#helpDialog"),
  keyboard: document.querySelector("#keyboard"),
  playedCount: document.querySelector("#playedCount"),
  shareButton: document.querySelector("#shareButton"),
  statsAverage: document.querySelector("#statsAverage"),
  statsButton: document.querySelector("#statsButton"),
  statsCalendar: document.querySelector("#statsCalendar"),
  statsCalendarRangeLabel: document.querySelector("#statsCalendarRangeLabel"),
  statsDialog: document.querySelector("#statsDialog"),
  statsMaxStreak: document.querySelector("#statsMaxStreak"),
  statsPlayed: document.querySelector("#statsPlayed"),
  statsWins: document.querySelector("#statsWins"),
  streakCalendar: document.querySelector("#streakCalendar"),
  toast: document.querySelector("#toast"),
  todaySummary: document.querySelector("#todaySummary"),
  winRate: document.querySelector("#winRate"),
};

const appState = {
  answers: [],
  allowedByLength: new Map(),
  keyFlashTimer: null,
  puzzle: null,
  ready: false,
  save: loadSave(),
  simulatedTodayKey: null,
  toastTimer: null,
  todayKey: null,
};

init().catch((error) => {
  console.error(error);
  const localFileHint =
    window.location.protocol === "file:"
      ? " Open the folder through a local web server because browsers block JSON loading over file://."
      : "";
  showToast(`Unable to load the bWORDibLE data files.${localFileHint}`, 5000);
  elements.todaySummary.textContent = "Today: unavailable";
});

async function init() {
  attachEvents();

  const params = new URLSearchParams(window.location.search);
  appState.simulatedTodayKey = sanitizeDateKey(params.get("today"));
  appState.todayKey = appState.simulatedTodayKey ?? getDateKeyInTimeZone(new Date(), TIME_ZONE);

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

  startGame();
  document.body.classList.add("app-ready");
}

function attachEvents() {
  document.addEventListener("keydown", handlePhysicalKeyboard);
  elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.statsButton.addEventListener("click", () => {
    renderStats();
    elements.statsDialog.showModal();
  });
  elements.shareButton.addEventListener("click", handleShare);
  elements.keyboard.addEventListener("click", handleVirtualKeyboard);
}

function startGame() {
  const puzzleData = selectPuzzleForDateKey(appState.answers, appState.todayKey);
  appState.puzzle = {
    ...puzzleData,
    displayDate: formatDateKey(appState.todayKey, TIME_ZONE),
    isPreview: compareDateKeys(appState.todayKey, START_DATE) < 0,
    key: appState.todayKey,
  };
  appState.ready = true;

  if (!appState.save.puzzles[appState.puzzle.key]) {
    appState.save.puzzles[appState.puzzle.key] = createPuzzleProgress();
    persistSave();
  }

  renderTodaySummary();
  renderBoard();
  renderKeyboard(getKeyboardStatuses(), null);
  renderStats();
}

function renderTodaySummary() {
  const puzzle = appState.puzzle;
  const dateLabel = formatTodaySummaryDate(appState.todayKey);
  elements.todaySummary.textContent = `Today: ${dateLabel} | ${puzzle.length}-letter word | ${puzzle.maxGuesses} guesses`;
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

  if (elements.helpDialog.open || elements.statsDialog.open) {
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
    if (!puzzle.isPreview) {
      recordStats(progress.guesses.length);
    }
    showToast(`Solved in ${progress.guesses.length}/${puzzle.maxGuesses}.`);
  } else if (progress.guesses.length >= puzzle.maxGuesses) {
    progress.completed = true;
    progress.won = false;
    if (!puzzle.isPreview) {
      recordStats(null);
    }
    showToast(`The answer was ${puzzle.answer}.`, 3500);
  }

  persistSave();
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
  const rangeText = buildCalendarRangeLabel(CALENDAR_WINDOW_DAYS);

  elements.currentStreak.textContent = String(currentStreak);
  elements.winRate.textContent = `${winRate}%`;
  elements.playedCount.textContent = String(stats.played);
  elements.bestStreak.textContent = String(stats.maxStreak);
  elements.statsPlayed.textContent = String(stats.played);
  elements.statsWins.textContent = String(stats.wins);
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
    const status = getDayStatus(dateKey);

    cell.className = `day-cell ${status}`;
    cell.dataset.date = dateKey;
    cell.textContent = String(Number(dateKey.slice(-2)));
    cell.title = `${formatDateKey(dateKey, TIME_ZONE)}: ${describeDayStatus(status)}`;

    grid.appendChild(cell);
  }

  container.appendChild(grid);
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

  return [`bWORDibLE ${puzzle.displayDate} ${result}`, ...lines].join("\n");
}

function flashKey(key) {
  clearTimeout(appState.keyFlashTimer);
  renderKeyboard(getKeyboardStatuses(), key);
  appState.keyFlashTimer = setTimeout(() => {
    renderKeyboard(getKeyboardStatuses(), null);
  }, 130);
}

function shakeBoard() {
  elements.board.classList.remove("shake");
  void elements.board.offsetWidth;
  elements.board.classList.add("shake");
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

function getDayStatus(dateKey) {
  if (dateKey === appState.todayKey) {
    return "today";
  }

  if (compareDateKeys(dateKey, START_DATE) < 0) {
    return "empty";
  }

  if (compareDateKeys(dateKey, appState.todayKey) > 0) {
    return "empty";
  }

  const progress = appState.save.puzzles[dateKey];
  if (progress?.completed) {
    return progress.won ? "won" : "lost";
  }

  return "missed";
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
      return "No puzzle";
  }
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
