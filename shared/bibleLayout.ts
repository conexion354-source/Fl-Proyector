import type { BibleDisplaySettings } from "./types.js";

export type ProjectionDimensions = { width: number; height: number };

export function bibleTextCapacity(
  settings: BibleDisplaySettings,
  viewport: ProjectionDimensions = { width: 1920, height: 1080 },
) {
  const width = Math.max(320, viewport.width || 1920);
  const height = Math.max(240, viewport.height || 1080);
  const usableWidth = width * (1 - (settings.horizontalMargin * 2) / 100);
  const usableHeight = height * (1 - (settings.verticalMargin * 2) / 100);
  const averageGlyphWidth = Math.max(5, settings.textFontSize * 0.53);
  const charactersPerLine = Math.max(
    10,
    Math.floor(usableWidth / averageGlyphWidth),
  );
  const referenceReserve =
    settings.showReference || settings.showVersion
      ? settings.referenceFontSize * 1.7 + settings.textFontSize * 0.45
      : 0;
  const linesByHeight = Math.max(
    1,
    Math.floor(
      Math.max(settings.textFontSize, usableHeight - referenceReserve) /
        (settings.textFontSize * 1.16),
    ),
  );
  return {
    charactersPerLine,
    lines: Math.max(1, Math.min(settings.maxLinesPerSlide, linesByHeight)),
  };
}

/**
 * Estimates the wrapping used by the 16:9 projection area without ever
 * splitting a word. It gives the operator a stable definition of "long":
 * more than the operator-selected number of rendered lines.
 */
export function isLongBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const { charactersPerLine, lines: maximumLines } = bibleTextCapacity(
    settings,
    viewport,
  );
  let lines = 1;
  let lineLength = 0;
  for (const word of trimmed.split(/\s+/)) {
    const nextLength = lineLength ? lineLength + word.length + 1 : word.length;
    if (lineLength && nextLength > charactersPerLine) {
      lines += 1;
      lineLength = word.length;
    } else {
      lineLength = nextLength;
    }
  }
  return lines > maximumLines;
}

export function splitBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text];
  const { charactersPerLine, lines } = bibleTextCapacity(settings, viewport);
  // The safety factor absorbs differences between proportional fonts. The
  // projection renderer performs the final pixel-perfect fit afterwards.
  const characterBudget = Math.max(
    18,
    Math.floor(charactersPerLine * lines * 0.86),
  );
  const totalCharacters = words.reduce(
    (total, word, index) => total + word.length + (index ? 1 : 0),
    0,
  );
  const partCount = Math.max(1, Math.ceil(totalCharacters / characterBudget));
  if (partCount === 1) return [text];
  const pieces: string[] = [];
  let wordIndex = 0;
  for (let part = 0; part < partCount; part += 1) {
    const remainingParts = partCount - part;
    const remainingText = words.slice(wordIndex).join(" ");
    const target = Math.min(
      characterBudget,
      Math.ceil(remainingText.length / remainingParts),
    );
    let current = "";
    while (wordIndex < words.length) {
      const word = words[wordIndex];
      const candidate = current ? `${current} ${word}` : word;
      const wordsStillNeeded = words.length - (wordIndex + 1);
      if (current && wordsStillNeeded >= remainingParts - 1) {
        const currentDistance = Math.abs(target - current.length);
        const candidateDistance = Math.abs(target - candidate.length);
        if (
          candidate.length > characterBudget ||
          (candidate.length > target && currentDistance <= candidateDistance)
        )
          break;
      }
      current = candidate;
      wordIndex += 1;
      if (words.length - wordIndex === remainingParts - 1) break;
    }
    if (current) pieces.push(current);
  }
  return pieces.length > 1 ? pieces : [text];
}
