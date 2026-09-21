import { STATUS_SYMBOL, evaluateGuess } from "./game-engine.mjs";

const SHARE_TEXT_SYMBOL = {
  absent: "×",
  present: "↔",
  correct: "✓",
};
const SHARE_TEXT_LEGEND = "[✓] correct spot · [↔] wrong place · [×] not present";

export async function shareResult(puzzle, progress, showToast) {
  if (!progress.completed) {
    showToast("Finish the puzzle before sharing.");
    return;
  }

  const shareText = buildShareText(puzzle, progress);

  if (window.Capacitor?.isNativePlatform()) {
    try {
      const { shareFile } = await import("./native.mjs");
      await shareFile("mannagrams-result.png", await buildShareImage(puzzle, progress), shareText);
    } catch {
      showToast("Sharing closed. Tap Share to try again.");
    }
    return;
  }

  if (navigator.share) {
    try {
      const shareImage = await buildShareImage(puzzle, progress);
      const shareFile = new File([shareImage], "mannagrams-result.png", {
        type: "image/png",
      });
      const shareData = {
        text: shareText,
        title: "MannaGrams",
      };

      if (navigator.canShare?.({ files: [shareFile] })) {
        shareData.files = [shareFile];
      }

      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
      showToast("Result copied to clipboard.");
    } catch {
      showToast(shareText, 5000);
    }
    return;
  }

  showToast(shareText, 5000);
}

export function buildShareText(puzzle, progress) {
  const result = progress.won ? `${progress.guesses.length}/${puzzle.maxGuesses}` : `X/${puzzle.maxGuesses}`;
  const blockedCount = 6 - puzzle.length;
  const lines = progress.guesses.map((guess) => {
    const statuses = evaluateGuess(guess, puzzle.answer);
    const filled = statuses.map((status) => `[${SHARE_TEXT_SYMBOL[status]}]`);
    const blocked = Array.from({ length: blockedCount }, () => "[ ]");
    return [...filled, ...blocked].join(" ");
  });

  return [`MannaGrams ${puzzle.displayDate} ${result}`, ...lines, "", SHARE_TEXT_LEGEND].join("\n");
}

export function buildShareImage(puzzle, progress) {
  const width = 1080;
  const tileSize = 118;
  const tileGap = 22;
  const rowGap = 22;
  const top = 250;
  const height = top + progress.guesses.length * (tileSize + rowGap) + 140;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;

  context.fillStyle = "#f6f3ea";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#17251e";
  context.font = '700 72px Georgia, "Times New Roman", serif';
  context.textAlign = "center";
  context.fillText("MannaGrams", width / 2, 94);

  const result = progress.won ? `${progress.guesses.length}/${puzzle.maxGuesses}` : `X/${puzzle.maxGuesses}`;
  context.fillStyle = "#526158";
  context.font = '500 34px "Avenir Next", "Segoe UI", sans-serif';
  context.fillText(`${puzzle.displayDate}  •  ${result}`, width / 2, 158);

  const totalRowWidth = puzzle.length * tileSize + (puzzle.length - 1) * tileGap;
  const left = (width - totalRowWidth) / 2;

  progress.guesses.forEach((guess, rowIndex) => {
    const statuses = evaluateGuess(guess, puzzle.answer);
    statuses.forEach((status, columnIndex) => {
      const x = left + columnIndex * (tileSize + tileGap);
      const y = top + rowIndex * (tileSize + rowGap);
      drawShareTile(context, x, y, tileSize, status);
    });
  });

  context.fillStyle = "#526158";
  context.font = '500 28px "Avenir Next", "Segoe UI", sans-serif';
  context.fillText("Your Daily Bible Word Game", width / 2, height - 56);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Unable to create the share image."));
    }, "image/png");
  });
}

function drawShareTile(context, x, y, size, status) {
  const colors = {
    absent: { border: "#c72e32", fill: "#fde8e8" },
    present: { border: "#db861e", fill: "#fff0d9" },
    correct: { border: "#128342", fill: "#e3f3e9" },
  };
  const color = colors[status];
  const radius = 22;

  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + size - radius, y);
  context.quadraticCurveTo(x + size, y, x + size, y + radius);
  context.lineTo(x + size, y + size - radius);
  context.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
  context.lineTo(x + radius, y + size);
  context.quadraticCurveTo(x, y + size, x, y + size - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fillStyle = color.fill;
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = color.border;
  context.stroke();

  context.fillStyle = color.border;
  context.font = '900 76px "Arial Black", "Segoe UI Symbol", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(STATUS_SYMBOL[status], x + size / 2, y + size / 2 + 2);
  context.textBaseline = "alphabetic";
}
