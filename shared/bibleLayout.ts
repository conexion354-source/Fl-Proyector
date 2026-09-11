import type { BibleDisplaySettings } from "./types.js";

export type ProjectionDimensions = { width: number; height: number };

const glyphWidth = (character: string, fontSize: number) => {
  if (/\s/.test(character)) return fontSize * 0.32;
  if (/[ilI1|.,:;'!]/.test(character)) return fontSize * 0.29;
  if (/[mwMW@#%&]/.test(character)) return fontSize * 0.86;
  if (/[A-ZÁÉÍÓÚÑ]/.test(character)) return fontSize * 0.64;
  if (/[0-9]/.test(character)) return fontSize * 0.56;
  return fontSize * 0.52;
};

const wordWidth = (word: string, fontSize: number) =>
  Array.from(word).reduce(
    (width, character) => width + glyphWidth(character, fontSize),
    0,
  ) * 1.04;

/**
 * Wraps exactly as the projector is expected to wrap: one word at a time,
 * using the configured font size and the real usable screen width. Keeping
 * the resulting lines lets splitting happen only after maxLinesPerSlide.
 */
export function bibleTextLines(
  text: string,
  settings: BibleDisplaySettings,
  viewport: ProjectionDimensions = { width: 1920, height: 1080 },
) {
  const { lineWidth } = bibleTextCapacity(settings, viewport);
  const source = settings.uppercase ? text.toLocaleUpperCase("es-AR") : text;
  const words = source.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[][] = [[]];
  let usedWidth = 0;
  const spaceWidth = glyphWidth(" ", settings.textFontSize);
  for (let index = 0; index < words.length; index += 1) {
    const measuredWidth = wordWidth(words[index], settings.textFontSize);
    const nextWidth = usedWidth + (lines.at(-1)!.length ? spaceWidth : 0) + measuredWidth;
    if (lines.at(-1)!.length && nextWidth > lineWidth) {
      lines.push([words[index]]);
      usedWidth = measuredWidth;
    } else {
      lines.at(-1)!.push(words[index]);
      usedWidth = nextWidth;
    }
  }
  // Return word ranges from the original spelling; uppercase only affects the
  // width calculation and remains a projection preference.
  let consumed = 0;
  const originalWords = text.trim().split(/\s+/).filter(Boolean);
  return lines.map((line) => {
    const originalLine = originalWords.slice(consumed, consumed + line.length);
    consumed += line.length;
    return originalLine.join(" ");
  });
}

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
    lineWidth: Math.max(120, usableWidth * 0.98),
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
  const { lines: maximumLines } = bibleTextCapacity(settings, viewport);
  return bibleTextLines(trimmed, settings, viewport).length > maximumLines;
}

export function splitBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  const maximumLines = bibleTextCapacity(settings, viewport).lines;
  const renderedLines = bibleTextLines(text, settings, viewport);
  if (renderedLines.length <= maximumLines) return [text];
  const pieces: string[] = [];
  for (let index = 0; index < renderedLines.length; index += maximumLines) {
    pieces.push(renderedLines.slice(index, index + maximumLines).join(" "));
  }
  return pieces.length > 1 ? pieces : [text];
}
