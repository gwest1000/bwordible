const STATUS_RANK = {
  absent: 1,
  present: 2,
  correct: 3,
};
export const STATUS_SYMBOL = {
  absent: "×",
  present: "↔",
  correct: "✓",
};

export function getKeyboardStatuses(progress, answer) {
  const statuses = {};

  progress.guesses.forEach((guess) => {
    const evaluation = evaluateGuess(guess, answer);
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

export function evaluateGuess(guess, answer) {
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
