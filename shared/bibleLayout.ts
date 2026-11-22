import type { BibleDisplaySettings } from "./types.js";
import {
  REFERENCE_RESERVE,
  idealSizeFor,
  largestFit,
  maxLinesAt,
  measureText,
  planText,
  sizeBand,
  textArea,
  wrapLines,
  type ProjectionDimensions,
  type TextBox,
  type TextPlan,
  type TextSizeRules,
} from "./textFit.js";

export type { ProjectionDimensions } from "./textFit.js";

/*
 * Reglas de Biblia sobre el motor compartido (shared/textFit.ts). Todas las
 * funciones usan la misma geometría que el proyector, así el operador, el
 * teléfono, la vista previa y la salida real toman la misma decisión.
 */

// La navegación con flechas consulta estas decisiones muchas veces seguidas.
const planCache = new Map<string, TextPlan>();
const MAX_PLAN_CACHE_ENTRIES = 480;

export function bibleSizeRules(settings: BibleDisplaySettings): TextSizeRules {
  return {
    size: settings.textFontSize,
    growPercent: settings.growPercent ?? 15,
    shrinkPercent: settings.shrinkPercent ?? 20,
  };
}

export function bibleTextBox(
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
): TextBox {
  return {
    viewport,
    horizontalMargin: settings.horizontalMargin,
    verticalMargin: settings.verticalMargin,
    reservedHeight:
      settings.showReference || settings.showVersion
        ? settings.referenceFontSize * REFERENCE_RESERVE
        : 0,
  };
}

const bibleFont = (settings: BibleDisplaySettings) => ({
  fontFamily: settings.textFontFamily,
  uppercase: settings.uppercase,
});

function cachedPlan(
  text: string,
  settings: BibleDisplaySettings,
  viewport: ProjectionDimensions | undefined,
  allowSplit: boolean,
  forcedSplitAt?: number,
) {
  const key = [
    text,
    settings.textFontFamily,
    settings.textFontSize,
    settings.growPercent,
    settings.shrinkPercent,
    settings.referenceFontSize,
    settings.horizontalMargin,
    settings.verticalMargin,
    settings.uppercase,
    settings.showReference,
    settings.showVersion,
    viewport?.width ?? 1920,
    viewport?.height ?? 1080,
    allowSplit,
    forcedSplitAt ?? "",
  ].join("|");
  const cached = planCache.get(key);
  if (cached) {
    planCache.delete(key);
    planCache.set(key, cached);
    return cached;
  }
  const plan = planText(
    text,
    bibleFont(settings),
    bibleTextBox(settings, viewport),
    bibleSizeRules(settings),
    allowSplit,
    forcedSplitAt,
  );
  planCache.set(key, plan);
  if (planCache.size > MAX_PLAN_CACHE_ENTRIES)
    planCache.delete(planCache.keys().next().value!);
  return plan;
}

/** Plan completo de un pasaje: partes y tamaño común. */
export function planBiblePassage(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
  options: { allowSplit?: boolean; splitAtWord?: number } = {},
) {
  return cachedPlan(
    text.trim(),
    settings,
    viewport,
    options.allowSplit ?? settings.longVerseMode !== "auto-fit",
    options.splitAtWord,
  );
}

export function bibleSplitOverrideKey(
  version: string,
  book: string,
  chapter: number,
  verse: string | number,
) {
  return `${version.trim().toLocaleLowerCase("es-AR")}|${book
    .trim()
    .toLocaleLowerCase("es-AR")}|${chapter}|${verse}`;
}

export function bibleTextCapacity(
  settings: BibleDisplaySettings,
  viewport: ProjectionDimensions = { width: 1920, height: 1080 },
) {
  const box = bibleTextBox(settings, viewport);
  const { lineWidth } = textArea(box, settings.textFontSize);
  return {
    charactersPerLine: Math.max(10, Math.floor(lineWidth / (settings.textFontSize * 0.53))),
    lineWidth,
    lines: maxLinesAt(box, settings.textFontSize),
  };
}

/** Cortes de línea al tamaño configurado, como los haría el proyector. */
export function bibleTextLines(
  text: string,
  settings: BibleDisplaySettings,
  viewport: ProjectionDimensions = { width: 1920, height: 1080 },
) {
  const { lineWidth } = bibleTextCapacity(settings, viewport);
  return wrapLines(text, bibleFont(settings), settings.textFontSize, lineWidth);
}

/** ¿El pasaje supera la pantalla al tamaño normal? */
export function isLongBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  if (!text.trim()) return false;
  return bibleTextLines(text, settings, viewport).length > bibleTextCapacity(settings, viewport).lines;
}

/** Mayor tamaño que mantiene el pasaje completo en una pantalla. */
export function fittedBibleFontSize(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
  minimum = 12,
) {
  return largestFit(
    measureText(text, bibleFont(settings)),
    bibleTextBox(settings, viewport),
    Math.max(8, minimum),
    Math.max(minimum, settings.textFontSize),
  );
}

/**
 * Hay que dividir cuando el pasaje no entra ni siquiera achicado al máximo
 * permitido (tamaño normal − % de achique).
 */
export function shouldSplitBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  if (!text.trim()) return false;
  return cachedPlan(text.trim(), settings, viewport, true).needsSplit;
}

/** Tamaño que aprovecha toda el área con un versículo de largo típico. */
export function recommendedBibleFontSize(
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  return Math.max(
    24,
    idealSizeFor([typicalVerse], bibleFont(settings), bibleTextBox(settings, viewport)),
  );
}

/** Divide en A y B con el mejor corte posible (o devuelve el texto entero). */
export function splitBibleVerse(
  text: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
) {
  const plan = cachedPlan(text.trim(), settings, viewport, true);
  return plan.needsSplit ? plan.parts : [text];
}

export function bibleSizeBand(settings: BibleDisplaySettings) {
  return sizeBand(bibleSizeRules(settings));
}

/** Juan 3:16: largo representativo de un versículo para calcular el tamaño ideal. */
export const typicalVerse =
  "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree no se pierda, mas tenga vida eterna.";
