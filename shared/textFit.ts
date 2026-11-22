/**
 * Motor único de medición para el texto proyectado (Biblia y canciones).
 *
 * Usa la misma geometría que el proyector (ProjectionStage + CSS):
 *   - área segura = pantalla menos los márgenes laterales y verticales (%)
 *   - bordes de seguridad: 2.5 % del tamaño a los lados y 7.5 % arriba/abajo
 *   - interlineado 1.16 y letra en negrita (700)
 *   - la cita bíblica reserva 2.55 veces su tamaño (alto + separación)
 *
 * Así, la decisión "entra / hay que dividir" que se toma en el operador es la
 * misma que después respeta la salida, y no aparecen achiques sorpresa.
 */

export type ProjectionDimensions = { width: number; height: number };

export const LINE_HEIGHT = 1.16;
export const VERTICAL_GUARD = 0.075;
export const HORIZONTAL_GUARD = 0.025;
export const REFERENCE_RESERVE = 2.55;
/** Separación de párrafos en canciones (margin .18em arriba y abajo). */
export const PARAGRAPH_GAP = 0.36;

/** Reglas de tamaño compartidas por Biblia y canciones. */
export type TextSizeRules = {
  /** Tamaño normal de lectura, en px de la salida real. */
  size: number;
  /** Cuánto puede agrandarse un texto corto (%). */
  growPercent: number;
  /** Cuánto puede achicarse un texto largo antes de dividirlo (%). */
  shrinkPercent: number;
};

export type TextBox = {
  viewport?: ProjectionDimensions;
  horizontalMargin: number;
  verticalMargin: number;
  /** Alto reservado fuera del texto (por ejemplo, la cita bíblica), en px. */
  reservedHeight?: number;
};

export type TextFont = {
  fontFamily: string;
  uppercase?: boolean;
};

export const DEFAULT_GROW_PERCENT = 15;
export const DEFAULT_SHRINK_PERCENT = 20;

export function clampPercent(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(60, Math.round(parsed))) : fallback;
}

/** Rango permitido: [tamaño − achique, tamaño + agrande]. */
export function sizeBand(rules: TextSizeRules) {
  const grow = clampPercent(rules.growPercent, DEFAULT_GROW_PERCENT);
  const shrink = clampPercent(rules.shrinkPercent, DEFAULT_SHRINK_PERCENT);
  return {
    floor: Math.max(12, rules.size * (1 - shrink / 100)),
    normal: rules.size,
    ceiling: rules.size * (1 + grow / 100),
  };
}

/* ------------------------------------------------------------------------ */
/* Medición de palabras                                                     */
/* ------------------------------------------------------------------------ */

const fontWidthScale = (fontFamily: string) => {
  const family = fontFamily.toLocaleLowerCase("en-US");
  if (family.includes("bebas")) return 0.68;
  if (family.includes("courier")) return 1.12;
  if (family.includes("verdana")) return 1.06;
  if (family.includes("trebuchet")) return 0.98;
  if (family.includes("raleway")) return 0.94;
  return 1;
};

const glyphWidth = (character: string, fontFamily: string) => {
  const scale = fontWidthScale(fontFamily) * 100;
  if (/\s/.test(character)) return 0.32 * scale;
  if (/[ilI1|.,:;'!]/.test(character)) return 0.29 * scale;
  if (/[mwMW@#%&]/.test(character)) return 0.86 * scale;
  if (/[A-ZÁÉÍÓÚÑ]/.test(character)) return 0.64 * scale;
  if (/[0-9]/.test(character)) return 0.56 * scale;
  return 0.52 * scale;
};

let measureContext: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();
const MAX_WIDTH_CACHE = 6000;

/** Ancho de un texto a 100 px. El ancho escala linealmente con el tamaño. */
function widthAt100(text: string, fontFamily: string) {
  const key = `${fontFamily}\u0000${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  let width: number;
  if (typeof document !== "undefined") {
    if (measureContext === undefined)
      measureContext = document.createElement("canvas").getContext("2d");
    if (measureContext) {
      const family = fontFamily === "Inter" ? "Inter, ui-sans-serif, system-ui, sans-serif" : fontFamily;
      measureContext.font = `700 100px ${family}`;
      width = measureContext.measureText(text).width;
    } else width = Array.from(text).reduce((sum, char) => sum + glyphWidth(char, fontFamily), 0) * 1.04;
  } else width = Array.from(text).reduce((sum, char) => sum + glyphWidth(char, fontFamily), 0) * 1.04;
  widthCache.set(key, width);
  if (widthCache.size > MAX_WIDTH_CACHE) widthCache.delete(widthCache.keys().next().value!);
  return width;
}

/** Palabras de un texto ya medidas, listas para calcular cortes de línea. */
export type MeasuredText = {
  words: string[];
  widths: number[];
  space: number;
};

export function measureText(text: string, font: TextFont): MeasuredText {
  const source = font.uppercase ? text.toLocaleUpperCase("es-AR") : text;
  const words = source.trim().split(/\s+/).filter(Boolean);
  return {
    words,
    widths: words.map((word) => widthAt100(word, font.fontFamily)),
    space: widthAt100(" ", font.fontFamily),
  };
}

/** Cantidad de líneas al envolver palabra por palabra en `lineWidth` px. */
export function countLines(measured: MeasuredText, fontSize: number, lineWidth: number, from = 0, to = measured.words.length) {
  if (to <= from) return 0;
  const factor = fontSize / 100;
  const space = measured.space * factor;
  let lines = 1;
  let used = 0;
  for (let index = from; index < to; index += 1) {
    const width = measured.widths[index] * factor;
    if (used === 0) used = width;
    else if (used + space + width > lineWidth) {
      lines += 1;
      used = width;
    } else used += space + width;
  }
  return lines;
}

/** Devuelve los cortes de línea (texto original) para mostrar o depurar. */
export function wrapLines(text: string, font: TextFont, fontSize: number, lineWidth: number) {
  const measured = measureText(text, font);
  const original = text.trim().split(/\s+/).filter(Boolean);
  const factor = fontSize / 100;
  const lines: string[][] = [];
  let used = 0;
  measured.widths.forEach((rawWidth, index) => {
    const width = rawWidth * factor;
    if (!lines.length || (used > 0 && used + measured.space * factor + width > lineWidth)) {
      lines.push([original[index]]);
      used = width;
    } else {
      lines[lines.length - 1].push(original[index]);
      used += (used > 0 ? measured.space * factor : 0) + width;
    }
  });
  return lines.map((line) => line.join(" "));
}

/* ------------------------------------------------------------------------ */
/* Geometría del área de texto                                              */
/* ------------------------------------------------------------------------ */

export function textArea(box: TextBox, fontSize: number) {
  const width = Math.max(320, box.viewport?.width || 1920);
  const height = Math.max(240, box.viewport?.height || 1080);
  const usableWidth = width * (1 - (box.horizontalMargin * 2) / 100) - fontSize * HORIZONTAL_GUARD * 2;
  const usableHeight =
    height * (1 - (box.verticalMargin * 2) / 100) -
    (box.reservedHeight ?? 0) -
    fontSize * VERTICAL_GUARD * 2;
  return {
    lineWidth: Math.max(60, usableWidth),
    height: Math.max(fontSize, usableHeight),
  };
}

export function maxLinesAt(box: TextBox, fontSize: number) {
  const { height } = textArea(box, fontSize);
  return Math.max(1, Math.floor((height + 0.5) / (fontSize * LINE_HEIGHT)));
}

/** ¿Entra el tramo de palabras [from, to) completo a este tamaño? */
export function fitsAt(measured: MeasuredText, box: TextBox, fontSize: number, from = 0, to = measured.words.length) {
  const { lineWidth } = textArea(box, fontSize);
  return countLines(measured, fontSize, lineWidth, from, to) <= maxLinesAt(box, fontSize);
}

/** Mayor tamaño (entre `low` y `high`) con el que el tramo entra completo. */
export function largestFit(
  measured: MeasuredText,
  box: TextBox,
  low: number,
  high: number,
  from = 0,
  to = measured.words.length,
) {
  if (!fitsAt(measured, box, low, from, to)) {
    // Ni siquiera entra al mínimo: buscar por debajo (seguridad, sin cortes).
    let bottom = 8;
    let top = low;
    for (let step = 0; step < 10; step += 1) {
      const middle = (bottom + top) / 2;
      if (fitsAt(measured, box, middle, from, to)) bottom = middle;
      else top = middle;
    }
    return bottom;
  }
  if (fitsAt(measured, box, high, from, to)) return high;
  let bottom = low;
  let top = high;
  for (let step = 0; step < 10; step += 1) {
    const middle = (bottom + top) / 2;
    if (fitsAt(measured, box, middle, from, to)) bottom = middle;
    else top = middle;
  }
  return bottom;
}

/* ------------------------------------------------------------------------ */
/* División inteligente en A y B                                            */
/* ------------------------------------------------------------------------ */

const PAUSE_STRONG = /[.!?][”"')\]]?$/;
const PAUSE_MEDIUM = /[;:][”"')\]]?$/;
const PAUSE_SOFT = /,[”"')\]]?$/;
/** Palabras que nunca deberían quedar al final de la parte A. */
const DANGLING = /^(y|e|o|u|ni|de|del|a|al|el|la|los|las|lo|un|una|unos|unas|que|en|por|con|para|sin|sobre|su|sus|mi|mis|tu|tus|se|me|te|le|les|nos|como|pero|porque|mas)$/i;
const CLAUSE_START =
  /^(pero|porque|aunque|mientras|cuando|entonces|sin embargo|por tanto|por lo cual|para que|pues|mas|sino|y|e|ni|o|que|el cual|la cual|los cuales|las cuales|donde|como|así)\b/;

/**
 * Elige el mejor punto para dividir en dos partes. Prioriza, en este orden:
 *  1. que las dos partes entren dentro del rango de tamaño (sin achicarse
 *     de más) y con el tamaño común más grande posible;
 *  2. cortar al final de una idea (punto, punto y coma, dos puntos, coma o
 *     antes de "porque", "pero", "para que"…);
 *  3. que las partes queden parejas.
 * Devuelve la cantidad de palabras de la parte A.
 */
export function bestSplitIndex(measured: MeasuredText, box: TextBox, rules: TextSizeRules, originalWords: string[]) {
  const total = measured.words.length;
  if (total < 4) return Math.max(1, Math.ceil(total / 2));
  const { floor, ceiling } = sizeBand(rules);
  let bestIndex = Math.ceil(total / 2);
  let bestScore = Number.NEGATIVE_INFINITY;
  const minimumPart = Math.max(2, Math.floor(total * 0.22));
  for (let index = minimumPart; index <= total - minimumPart; index += 1) {
    const sizeA = largestFit(measured, box, floor, ceiling, 0, index);
    const sizeB = largestFit(measured, box, floor, ceiling, index, total);
    const common = Math.min(sizeA, sizeB);
    const previous = originalWords[index - 1] ?? "";
    const following = originalWords.slice(index, index + 3).join(" ").toLocaleLowerCase("es-AR");
    const pause = PAUSE_STRONG.test(previous)
      ? 1
      : PAUSE_MEDIUM.test(previous)
        ? 0.8
        : PAUSE_SOFT.test(previous)
          ? 0.55
          : CLAUSE_START.test(following)
            ? 0.3
            : 0;
    const balance = 1 - Math.abs(0.5 - index / total) * 2; // 1 = mitad exacta
    const dangling = DANGLING.test(previous.replace(/[^\p{L}]/gu, "")) ? 1 : 0;
    // Tamaño relativo al normal: cada 1 % de tamaño vale más que una coma,
    // pero menos que cortar una frase al medio cuando la diferencia es chica.
    const sizeScore = (common / rules.size) * 100;
    const underFloorPenalty = common < floor - 0.5 ? (floor - common) * 4 : 0;
    const score = sizeScore * 0.7 + pause * 12 + balance * 4 - dangling * 10 - underFloorPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/* ------------------------------------------------------------------------ */
/* Plan de diapositivas                                                     */
/* ------------------------------------------------------------------------ */

export type TextPlan = {
  /** Partes del texto (1 = completo, 2 = A y B). */
  parts: string[];
  /** Tamaño recomendado para todas las partes, en px de la salida. */
  fontSize: number;
  /** El texto completo no entra sin achicarse más de lo permitido. */
  needsSplit: boolean;
};

/**
 * Decide cómo mostrar un pasaje:
 *  - si entra completo dentro del rango → una sola pantalla;
 *  - si no y se permite dividir → A y B con el mismo tamaño;
 *  - si no se permite dividir → una pantalla con el tamaño que haga falta.
 */
export function planText(
  text: string,
  font: TextFont,
  box: TextBox,
  rules: TextSizeRules,
  allowSplit: boolean,
  forcedSplitAt?: number,
): TextPlan {
  const original = text.trim().split(/\s+/).filter(Boolean);
  const measured = measureText(text, font);
  const { floor, ceiling } = sizeBand(rules);
  const whole = largestFit(measured, box, floor, ceiling);
  const needsSplit = whole < floor - 0.5 && original.length > 3;
  // forcedSplitAt: número de palabras de la parte A elegido por el operador,
  // o -1 para "dividir sí o sí, en el mejor corte".
  const manual = forcedSplitAt !== undefined && forcedSplitAt > 0 && forcedSplitAt < original.length;
  const forceBest = forcedSplitAt === -1 && original.length > 1;
  const useSplit = manual || forceBest || (forcedSplitAt === undefined && allowSplit && needsSplit);
  if (!useSplit) return { parts: [text.trim()], fontSize: Math.min(ceiling, whole), needsSplit };
  const index = manual ? forcedSplitAt! : bestSplitIndex(measured, box, rules, original);
  const sizeA = largestFit(measured, box, floor, ceiling, 0, index);
  const sizeB = largestFit(measured, box, floor, ceiling, index, original.length);
  return {
    parts: [original.slice(0, index).join(" "), original.slice(index).join(" ")],
    fontSize: Math.min(ceiling, sizeA, sizeB),
    needsSplit,
  };
}

/** Tamaño más grande con el que todas las muestras entran en una pantalla. */
export function idealSizeFor(samples: string[], font: TextFont, box: TextBox) {
  return Math.floor(
    Math.min(
      ...samples.map((sample) => largestFit(measureText(sample, font), box, 24, 220)),
    ),
  );
}
