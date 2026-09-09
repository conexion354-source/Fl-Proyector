import type { BibleDisplaySettings } from "./types.js";

/**
 * Estimates the wrapping used by the 16:9 projection area without ever
 * splitting a word. It gives the operator a stable definition of "long":
 * more than the operator-selected number of rendered lines.
 */
export function isLongBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const usableWidth = 1920 * (1 - (settings.horizontalMargin * 2) / 100);
  const averageGlyphWidth = Math.max(8, settings.textFontSize * 0.53);
  const charactersPerLine = Math.max(16, Math.floor(usableWidth / averageGlyphWidth));
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
  return lines > settings.maxLinesPerSlide;
}
