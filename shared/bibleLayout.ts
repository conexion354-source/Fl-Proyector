import type { BibleDisplaySettings } from "./types.js";

export type ProjectionDimensions = { width: number; height: number };

const fontWidthScale = (fontFamily: string) => {
  const family = fontFamily.toLocaleLowerCase("en-US");
  if (family.includes("bebas")) return 0.68;
  if (family.includes("courier")) return 1.12;
  if (family.includes("verdana")) return 1.06;
  if (family.includes("trebuchet")) return 0.98;
  if (family.includes("raleway")) return 0.94;
  return 1;
};

const glyphWidth = (
  character: string,
  fontSize: number,
  fontFamily: string,
) => {
  const scale = fontWidthScale(fontFamily);
  if (/\s/.test(character)) return fontSize * 0.32 * scale;
  if (/[ilI1|.,:;'!]/.test(character)) return fontSize * 0.29 * scale;
  if (/[mwMW@#%&]/.test(character)) return fontSize * 0.86 * scale;
  if (/[A-ZÁÉÍÓÚÑ]/.test(character)) return fontSize * 0.64 * scale;
  if (/[0-9]/.test(character)) return fontSize * 0.56 * scale;
  return fontSize * 0.52 * scale;
};

let measureContext: CanvasRenderingContext2D | null | undefined;

const measuredWidth = (
  text: string,
  settings: BibleDisplaySettings,
) => {
  if (typeof document !== "undefined") {
    if (measureContext === undefined)
      measureContext = document.createElement("canvas").getContext("2d");
    if (measureContext) {
      measureContext.font = `700 ${settings.textFontSize}px ${settings.textFontFamily}`;
      return measureContext.measureText(text).width;
    }
  }
  return Array.from(text).reduce(
    (width, character) =>
      width + glyphWidth(character, settings.textFontSize, settings.textFontFamily),
    0,
  ) * 1.04;
};

/**
 * Wraps exactly as the projector is expected to wrap: one word at a time,
 * using the configured font size and the real usable screen width. Keeping
 * the resulting lines lets splitting happen only when the text would exceed
 * the real usable height of the output.
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
  const spaceWidth = measuredWidth(" ", settings);
  for (let index = 0; index < words.length; index += 1) {
    const currentWordWidth = measuredWidth(words[index], settings);
    const nextWidth = usedWidth + (lines.at(-1)!.length ? spaceWidth : 0) + currentWordWidth;
    if (lines.at(-1)!.length && nextWidth > lineWidth) {
      lines.push([words[index]]);
      usedWidth = currentWordWidth;
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
  const averageGlyphWidth = Math.max(
    5,
    settings.textFontSize * 0.53 * fontWidthScale(settings.textFontFamily),
  );
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
    lines: linesByHeight,
  };
}

/**
 * Estimates the wrapping used by the real projection area without ever
 * splitting a word. A verse is long only when the configured type size would
 * physically exceed the available screen height.
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

/**
 * Returns the largest size that can keep a passage on one screen. This uses
 * the same word wrapping and reference reserve as the A/B decision, so the
 * operator, phone and settings guidance all agree.
 */
export function fittedBibleFontSize(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
  minimum = 12,
) {
  const ceiling = Math.max(minimum, settings.textFontSize);
  let low = Math.max(8, Math.min(minimum, ceiling));
  let high = ceiling;
  let best = low;
  for (let step = 0; step < 12; step += 1) {
    const middle = (low + high) / 2;
    const candidate = { ...settings, textFontSize: middle };
    if (!isLongBibleVerse(text, candidate, viewport)) {
      best = middle;
      low = middle;
    } else high = middle;
  }
  return Math.min(ceiling, best);
}

/** A/B is reserved for passages that need more than a subtle 12% reduction. */
export function shouldSplitBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  if (!isLongBibleVerse(text, settings, viewport)) return false;
  const subtleFloor = Math.max(12, settings.textFontSize * 0.88);
  return fittedBibleFontSize(text, settings, viewport, 12) < subtleFloor;
}

const recommendationSample =
  "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree no se pierda, mas tenga vida eterna.";

export function recommendedBibleFontSize(
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  const testSettings = { ...settings, textFontSize: 200 };
  return Math.max(
    24,
    Math.floor(
      fittedBibleFontSize(recommendationSample, testSettings, viewport, 24),
    ),
  );
}

export function splitBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  if (!shouldSplitBibleVerse(text, settings, viewport)) return [text];
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text];
  const maximumLines = bibleTextCapacity(settings, viewport).lines;
  let bestIndex = Math.ceil(words.length / 2);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const ratio = index / words.length;
    if (ratio < 0.24 || ratio > 0.76) continue;
    const left = words.slice(0, index).join(" ");
    const right = words.slice(index).join(" ");
    const leftLines = bibleTextLines(left, settings, viewport).length;
    const rightLines = bibleTextLines(right, settings, viewport).length;
    const overflow =
      Math.max(0, leftLines - maximumLines) +
      Math.max(0, rightLines - maximumLines);
    const punctuation = /[.!?][”"')\]]?$/.test(words[index - 1])
      ? 0
      : /[,;:][”"')\]]?$/.test(words[index - 1])
        ? 1
        : 3;
    const score =
      overflow * 100 +
      Math.abs(leftLines - rightLines) * 6 +
      Math.abs(0.5 - ratio) * 18 +
      punctuation;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  // It is always exactly A/B. If a particularly long half still needs help,
  // the renderer performs the final small safety reduction without clipping.
  return [
    words.slice(0, bestIndex).join(" "),
    words.slice(bestIndex).join(" "),
  ].filter(Boolean);
}
