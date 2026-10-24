import { START_DATE, formatDateKey, isValidDateKey, shiftDateKey } from "./puzzle-utils.mjs";

export function isArchiveDate(dateKey, todayKey) {
  return isValidDateKey(dateKey) && dateKey >= START_DATE && dateKey < todayKey;
}

export function archiveProgress(save, dateKey) {
  return save.puzzles[dateKey]?.completed ? save.puzzles[dateKey] : save.archive[dateKey];
}

export function createArchive({ dialog, getSave, getToday, onSelect }) {
  const monthLabel = dialog.querySelector("#archiveMonth");
  const grid = dialog.querySelector("#archiveGrid");
  const previous = dialog.querySelector("#archivePrevious");
  const next = dialog.querySelector("#archiveNext");
  let month;

  function render() {
    const today = getToday();
    const latest = today.slice(0, 7);
    const save = getSave();
    monthLabel.textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${month}-01T12:00:00Z`));
    previous.disabled = month <= START_DATE.slice(0, 7);
    next.disabled = month >= latest;
    grid.replaceChildren();
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      const label = document.createElement("span");
      label.className = "archive-weekday";
      label.textContent = day;
      grid.append(label);
    }
    const first = new Date(`${month}-01T12:00:00Z`);
    for (let offset = 0; offset < first.getUTCDay(); offset += 1) grid.append(document.createElement("span"));
    for (let dateKey = `${month}-01`; dateKey.startsWith(month); dateKey = shiftDateKey(dateKey, 1)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "archive-day";
      button.dataset.date = dateKey;
      const progress = archiveProgress(save, dateKey) ?? save.puzzles[dateKey];
      button.disabled = dateKey < START_DATE || dateKey > today;
      const daily = save.puzzles[dateKey]?.completed;
      const status = progress?.completed ? (progress.won ? "Solved" : "Not solved")
        : progress?.guesses.length || progress?.currentGuess ? "Unfinished" : "Not played";
      const marker = progress?.completed ? (progress.won ? "✓" : "×") : status === "Unfinished" ? "•" : "";
      button.classList.toggle("won", Boolean(progress?.won));
      button.classList.toggle("lost", Boolean(progress?.completed && !progress.won));
      button.classList.toggle("missed", !progress?.completed);
      button.classList.toggle("today", dateKey === today);
      if (progress?.won) {
        const allowance = progress.maxGuesses ?? (progress.guesses[0]?.length ?? 4) + 2;
        button.style.setProperty("--win-strength", String(Math.max(0.08, (allowance - progress.guesses.length) / (allowance - 1))));
      }
      const day = document.createElement("span");
      day.textContent = String(Number(dateKey.slice(-2)));
      const symbol = document.createElement("span");
      symbol.className = "archive-marker";
      symbol.textContent = marker;
      symbol.setAttribute("aria-hidden", "true");
      button.append(day, symbol);
      button.setAttribute("aria-label", `${formatDateKey(dateKey)}: ${button.disabled ? "Unavailable" : `${status}${daily ? " (daily result)" : ""}`}`);
      button.title = button.getAttribute("aria-label");
      button.addEventListener("click", () => {
        onSelect(dateKey);
      });
      grid.append(button);
    }
  }

  function moveMonth(delta) {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    month = date.toISOString().slice(0, 7);
    render();
  }
  previous.addEventListener("click", () => moveMonth(-1));
  next.addEventListener("click", () => moveMonth(1));
  return {
    open(dateKey) {
      month = (isArchiveDate(dateKey, getToday()) ? dateKey : getToday()).slice(0, 7);
      if (month < START_DATE.slice(0, 7)) month = START_DATE.slice(0, 7);
      render();
    },
  };
}
