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

export function splitBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  const maximumLines = bibleTextCapacity(settings, viewport).lines;
  const renderedLines = bibleTextLines(text, settings, viewport);
  if (renderedLines.length <= maximumLines) return [text];
  // Long passages are divided once, into two balanced screens. If either half
  // remains unusually long, ProjectionStage's safety fit reduces its type just
  // enough to keep it inside the safe area; it must never create C or D.
  const splitAfterLine = Math.ceil(renderedLines.length / 2);
  return [
    renderedLines.slice(0, splitAfterLine).join(" "),
    renderedLines.slice(splitAfterLine).join(" "),
  ].filter(Boolean);
}
