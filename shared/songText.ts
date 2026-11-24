/**
 * Letra de canción como texto plano con marcas de sección, al estilo de
 * EasyWorship / ProPresenter:
 *
 *   [Estribillo]
 *   Dios de pactos
 *   Que guardas tus promesas
 *
 *   [Estrofa 1]
 *   ...
 *
 * - Una línea entre corchetes abre una sección.
 * - Una línea en blanco dentro de una sección empieza otra diapositiva.
 * - Sin ninguna marca, cada bloque separado por una línea en blanco es una
 *   sección (y los bloques repetidos se reconocen como estribillo).
 *
 * El "orden de presentación" (arrangement) repite secciones sin repetir la
 * letra. Al guardar se genera el HTML de siempre (una estrofa por
 * diapositiva), así la proyección, el control remoto y las reuniones siguen
 * funcionando igual.
 */
import type { SongSectionType } from "./types.js";
import {
  inferSongLyricsStructure,
  songSectionLabel,
  songSectionOptions,
  splitSongStanzas,
  normalizeSongSectionTypes,
} from "./songSections.js";

export type SongTextSection = {
  /** Nombre tal como se escribió, por ejemplo "Estrofa 1" o "Estribillo". */
  name: string;
  type: SongSectionType;
  /** Diapositivas de la sección, cada una con sus renglones. */
  slides: string[][];
};

const headingTypes: Array<{ type: SongSectionType; pattern: RegExp }> = [
  { type: "prechorus", pattern: /^(?:pre[\s-]?(?:chorus|coro|estribillo)|preestribillo)\b/i },
  { type: "chorus", pattern: /^(?:chorus|coro|estribillo|refr[aá]n)\b/i },
  { type: "bridge", pattern: /^(?:bridge|puente)\b/i },
  { type: "intro", pattern: /^(?:intro|introducci[oó]n)\b/i },
  { type: "interlude", pattern: /^(?:interlude|interludio|instrumental)\b/i },
  { type: "ending", pattern: /^(?:ending|outro|final|coda)\b/i },
  { type: "verse", pattern: /^(?:verse|verso|estrofa)\b/i },
];

export function sectionTypeFromName(name: string): SongSectionType {
  return headingTypes.find(({ pattern }) => pattern.test(name.trim()))?.type ?? "other";
}

const headingLine = /^\s*\[([^\]]{1,40})\]\s*$/;

export function parseSongText(text: string): SongTextSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => headingLine.test(line))) {
    // Sin marcas: se reconoce la estructura como al importar letras.
    const inferred = inferSongLyricsStructure(text);
    const counts = new Map<SongSectionType, number>();
    return inferred.blocks.map((block, index) => {
      const type = inferred.sectionTypes[index] ?? "verse";
      counts.set(type, (counts.get(type) ?? 0) + 1);
      return {
        name: defaultSectionName(type, counts.get(type)!),
        type,
        slides: [block.split("\n").map((line) => line.trim()).filter(Boolean)],
      };
    });
  }
  const sections: SongTextSection[] = [];
  let current: SongTextSection | null = null;
  let slide: string[] = [];
  const closeSlide = () => {
    if (slide.length && current) current.slides.push(slide);
    slide = [];
  };
  for (const raw of lines) {
    const heading = headingLine.exec(raw);
    if (heading) {
      closeSlide();
      const name = heading[1].trim();
      current = { name, type: sectionTypeFromName(name), slides: [] };
      sections.push(current);
      continue;
    }
    const line = raw.trim();
    if (!line) {
      closeSlide();
      continue;
    }
    if (!current) {
      current = { name: "Estrofa 1", type: "verse", slides: [] };
      sections.push(current);
    }
    slide.push(line);
  }
  closeSlide();
  // Nombres repetidos ("Estrofa", "Estrofa") se numeran para distinguirlos.
  const seen = new Map<string, number>();
  for (const section of sections) {
    const key = section.name.toLocaleLowerCase("es-AR");
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) section.name = `${section.name} (${count})`;
  }
  return sections.filter((section) => section.slides.length);
}

function defaultSectionName(type: SongSectionType, occurrence: number) {
  const base = songSectionOptions.find((option) => option.value === type)?.label ?? "Estrofa";
  return type === "verse" || type === "other" ? `${base} ${occurrence}` : base;
}

/** Corta las diapositivas que superan el máximo de renglones. */
function limitLines(slides: string[][], maxLines: number) {
  if (!maxLines || maxLines < 1) return slides;
  return slides.flatMap((lines) => {
    if (lines.length <= maxLines) return [lines];
    // Partes parejas: 6 renglones con máximo 4 → 3 + 3, no 4 + 2.
    const parts = Math.ceil(lines.length / maxLines);
    const size = Math.ceil(lines.length / parts);
    const result: string[][] = [];
    for (let index = 0; index < lines.length; index += size) result.push(lines.slice(index, index + size));
    return result;
  });
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type BuiltSong = {
  content: string;
  sectionTypes: SongSectionType[];
  /** Para la vista previa: de qué sección viene cada diapositiva. */
  slides: Array<{ section: string; type: SongSectionType; lines: string[] }>;
};

export function resolveArrangement(sections: SongTextSection[], arrangement: string[] | null | undefined) {
  const names = new Set(sections.map((section) => section.name));
  const valid = (arrangement ?? []).filter((name) => names.has(name));
  return valid.length ? valid : sections.map((section) => section.name);
}

export function buildSongFromText(text: string, arrangement?: string[] | null, maxLines = 0): BuiltSong {
  const sections = parseSongText(text);
  const order = resolveArrangement(sections, arrangement);
  const byName = new Map(sections.map((section) => [section.name, section]));
  const slides: BuiltSong["slides"] = [];
  for (const name of order) {
    const section = byName.get(name);
    if (!section) continue;
    for (const lines of limitLines(section.slides, maxLines)) slides.push({ section: section.name, type: section.type, lines });
  }
  return {
    content: slides.map((slide) => `<p>${slide.lines.map(escapeHtml).join("<br>")}</p>`).join(""),
    sectionTypes: slides.map((slide) => slide.type),
    slides,
  };
}

const htmlToLines = (html: string) => {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
};

/** Convierte una canción guardada (HTML) a texto con marcas y orden. */
export function songToText(content: string, sectionTypes: unknown): { text: string; arrangement: string[] } {
  const stanzas = splitSongStanzas(content);
  const types = normalizeSongSectionTypes(sectionTypes, stanzas.length);
  const sections: Array<{ name: string; key: string; lines: string[] }> = [];
  const arrangement: string[] = [];
  stanzas.forEach((stanza, index) => {
    const lines = htmlToLines(stanza);
    const key = `${types[index]}|${lines.join("\n").toLocaleLowerCase("es-AR")}`;
    // Una estrofa idéntica que se repite (el estribillo) se escribe una vez
    // y se repite en el orden de presentación.
    const existing = sections.find((section) => section.key === key);
    if (existing) {
      arrangement.push(existing.name);
      return;
    }
    const base = songSectionLabel(types, index);
    let name = base;
    // Partes distintas con el mismo nombre (un estribillo de dos
    // diapositivas): "Estribillo", "Estribillo B", "Estribillo C"…
    for (let letter = 1; sections.some((section) => section.name === name); letter += 1)
      name = `${base} ${String.fromCharCode(65 + letter)}`;
    sections.push({ name, key, lines });
    arrangement.push(name);
  });
  const text = sections.map((section) => `[${section.name}]\n${section.lines.join("\n")}`).join("\n\n");
  const natural = sections.map((section) => section.name);
  const sameOrder = natural.length === arrangement.length && natural.every((name, index) => name === arrangement[index]);
  return { text, arrangement: sameOrder ? [] : arrangement };
}

/** ¿El HTML tiene formato (colores, negrita…) que el texto plano perdería? */
export function contentHasFormatting(content: string) {
  return /<(strong|b|em|i|u|s|mark|span[^>]*style|h[1-6])\b/i.test(content);
}
