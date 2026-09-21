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
    const latest = shiftDateKey(today, -1).slice(0, 7);
    const save = getSave();
    const completed = Object.values(save.archive).filter((progress) => progress.completed);
    dialog.querySelector("#archiveStats").textContent =
      `Archive: ${completed.length} played · ${completed.filter((progress) => progress.won).length} solved`;
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
      const progress = archiveProgress(save, dateKey);
      button.disabled = !isArchiveDate(dateKey, today) || !progress?.completed;
      const daily = save.puzzles[dateKey]?.completed;
      const status = progress?.completed ? (progress.won ? "Solved" : "Not solved")
        : "Missed";
      const marker = progress?.completed ? (progress.won ? "✓" : "×") : "";
      button.classList.toggle("won", Boolean(progress?.won));
      button.classList.toggle("lost", Boolean(progress?.completed && !progress.won));
      const day = document.createElement("span");
      day.textContent = String(Number(dateKey.slice(-2)));
      const symbol = document.createElement("span");
      symbol.className = "archive-marker";
      symbol.textContent = marker;
      symbol.setAttribute("aria-hidden", "true");
      button.append(day, symbol);
      button.setAttribute("aria-label", `${formatDateKey(dateKey)}: ${!isArchiveDate(dateKey, today) ? "Unavailable" : `${status}${daily ? " (daily result)" : ""}`}`);
      button.addEventListener("click", () => {
        dialog.close();
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
      month = (isArchiveDate(dateKey, getToday()) ? dateKey : shiftDateKey(getToday(), -1)).slice(0, 7);
      if (month < START_DATE.slice(0, 7)) month = START_DATE.slice(0, 7);
      render();
      dialog.showModal();
    },
  };
}
