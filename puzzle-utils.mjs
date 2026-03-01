export const TIME_ZONE = "America/New_York";
export const START_DATE = "2026-03-01";
export const BASE_SEED = "bwordible-v1";

export function selectPuzzleForDateKey(answers, dateKey) {
  const effectiveDateKey = compareDateKeys(dateKey, START_DATE) < 0 ? START_DATE : dateKey;
  const cycleYear = getCycleYearForDateKey(effectiveDateKey);
  const cycleStartDateKey = `${cycleYear}-03-01`;
  const positionInCycle = Math.max(0, dateToIndex(effectiveDateKey, cycleStartDateKey));
  const order = buildPermutation(answers.length, `${BASE_SEED}:${cycleYear}`);
  const answerIndex = order[positionInCycle];
  if (answerIndex === undefined) {
    throw new RangeError(`Not enough answers for the ${cycleYear} cycle.`);
  }
  const answer = getAnswerWord(answers[answerIndex]);

  return {
    answer,
    answerIndex,
    cycleStartDateKey,
    cycleYear,
    length: answer.length,
    maxGuesses: answer.length + 2,
    positionInCycle,
  };
}

export function buildPermutation(length, seedText) {
  const sequence = Array.from({ length }, (_, index) => index);
  const seed = xmur3(seedText)();
  const rng = mulberry32(seed);

  for (let index = length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [sequence[index], sequence[swapIndex]] = [sequence[swapIndex], sequence[index]];
  }

  return sequence;
}

export function getDateKeyInTimeZone(date = new Date(), timeZone = TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  const day = Number(parts.find((part) => part.type === "day").value);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function formatDateKey(dateKey, timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

export function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function compareDateKeys(left, right) {
  return left.localeCompare(right);
}

export function shiftDateKey(dateKey, deltaDays) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

export function dateToIndex(dateKey, startDateKey) {
  const [yearA, monthA, dayA] = dateKey.split("-").map(Number);
  const [yearB, monthB, dayB] = startDateKey.split("-").map(Number);
  const utcA = Date.UTC(yearA, monthA - 1, dayA);
  const utcB = Date.UTC(yearB, monthB - 1, dayB);
  return Math.floor((utcA - utcB) / 86_400_000);
}

export function getCycleYearForDateKey(dateKey) {
  if (compareDateKeys(dateKey, START_DATE) < 0) {
    return Number(START_DATE.slice(0, 4));
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  if (month > 3 || (month === 3 && day >= 1)) {
    return year;
  }

  return year - 1;
}

function xmur3(input) {
  let hash = 1779033703 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return function seed() {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function mulberry32(seed) {
  return function next() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function getAnswerWord(entry) {
  return typeof entry === "string" ? entry.toUpperCase() : entry.word.toUpperCase();
}
