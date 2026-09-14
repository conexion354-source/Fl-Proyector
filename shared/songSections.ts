import type { SongSectionType } from "./types.js";

export const songSectionOptions: Array<{
  value: SongSectionType;
  label: string;
}> = [
  { value: "verse", label: "Estrofa" },
  { value: "chorus", label: "Estribillo" },
  { value: "prechorus", label: "Pre-estribillo" },
  { value: "bridge", label: "Puente" },
  { value: "intro", label: "Introducción" },
  { value: "interlude", label: "Interludio" },
  { value: "ending", label: "Final" },
  { value: "other", label: "Otra parte" },
];

const validTypes = new Set<SongSectionType>(
  songSectionOptions.map((option) => option.value),
);

export type ParsedSongLyrics = {
  blocks: string[];
  sectionTypes: SongSectionType[];
};

const sectionHeadingPatterns: Array<{
  type: SongSectionType;
  pattern: RegExp;
}> = [
  {
    type: "prechorus",
    pattern: /^(?:pre[\s-]?(?:chorus|coro|estribillo)|preestribillo)(?:\s+\d+)?$/i,
  },
  {
    type: "chorus",
    pattern: /^(?:chorus|coro|estribillo|refr[aá]n)(?:\s+\d+)?$/i,
  },
  { type: "bridge", pattern: /^(?:bridge|puente)(?:\s+\d+)?$/i },
  {
    type: "intro",
    pattern: /^(?:intro|introducci[oó]n)(?:\s+\d+)?$/i,
  },
  {
    type: "interlude",
    pattern: /^(?:interlude|interludio|instrumental)(?:\s+\d+)?$/i,
  },
  {
    type: "ending",
    pattern: /^(?:ending|outro|final|coda)(?:\s+\d+)?$/i,
  },
  {
    type: "verse",
    pattern: /^(?:verse|verso|estrofa)(?:\s+\d+)?$/i,
  },
];

function songSectionHeading(line: string): SongSectionType | null {
  const candidate = line
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/^\(|\)$/g, "")
    .replace(/\s*[:：]\s*$/, "")
    .trim();
  return (
    sectionHeadingPatterns.find(({ pattern }) => pattern.test(candidate))
      ?.type ?? null
  );
}

function comparableLyricsBlock(block: string) {
  return block
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Interprets section headings commonly returned in plain-text lyrics and uses
 * exact repeated blocks as a conservative chorus hint. Headings and duplicate
 * blocks are omitted so the operator sees each usable section only once.
 */
export function inferSongLyricsStructure(lyrics: string): ParsedSongLyrics {
  const blocks: string[] = [];
  const explicitTypes: Array<SongSectionType | null> = [];
  let currentLines: string[] = [];
  let pendingType: SongSectionType | null = null;

  const flush = () => {
    const block = currentLines.join("\n").trim();
    if (block) {
      blocks.push(block);
      explicitTypes.push(pendingType);
    }
    currentLines = [];
    pendingType = null;
  };

  for (const rawLine of lyrics.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = songSectionHeading(rawLine);
    if (heading) {
      flush();
      pendingType = heading;
      continue;
    }
    if (!rawLine.trim()) {
      if (currentLines.length) flush();
      continue;
    }
    currentLines.push(rawLine.trim());
  }
  flush();

  const keys = blocks.map(comparableLyricsBlock);
  const occurrences = new Map<string, number>();
  const knownTypes = new Map<string, SongSectionType>();
  keys.forEach((key, index) => {
    if (!key) return;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    const explicitType = explicitTypes[index];
    if (
      explicitType &&
      (!knownTypes.has(key) || explicitType === "chorus")
    ) {
      knownTypes.set(key, explicitType);
    }
  });

  const resolvedTypes = keys.map((key, index) => {
    if ((occurrences.get(key) ?? 0) > 1) {
      return knownTypes.get(key) ?? "chorus";
    }
    if (explicitTypes[index]) return explicitTypes[index];
    const knownType = knownTypes.get(key);
    if (knownType) return knownType;
    return "verse";
  });
  const uniqueBlocks: string[] = [];
  const uniqueTypes: SongSectionType[] = [];
  const seen = new Set<string>();
  keys.forEach((key, index) => {
    if (seen.has(key)) return;
    seen.add(key);
    uniqueBlocks.push(blocks[index]);
    uniqueTypes.push(resolvedTypes[index]);
  });

  return {
    blocks: uniqueBlocks,
    sectionTypes: uniqueTypes,
  };
}

export function splitSongStanzas(html: string) {
  const marker = "___FL_STANZA___";
  const normalized = html
    .replace(/<\/p>\s*<p[^>]*>/gi, `</p>${marker}<p>`)
    .replace(/<p[^>]*>(?:\s|&nbsp;|<br\b[^>]*>)*<\/p>/gi, marker)
    .replace(/(?:<br\s*\/?\s*>\s*){2,}/gi, marker)
    .replace(/<hr[^>]*>/gi, marker);
  return normalized
    .split(marker)
    .map((section) => section.trim())
    .filter((section) => section.replace(/<[^>]+>/g, "").trim());
}

export function normalizeSongSectionTypes(
  values: unknown,
  count: number,
): SongSectionType[] {
  const source = Array.isArray(values) ? values : [];
  return Array.from({ length: count }, (_, index) => {
    const value = source[index];
    return typeof value === "string" && validTypes.has(value as SongSectionType)
      ? (value as SongSectionType)
      : "verse";
  });
}

export function songSectionLabel(
  types: SongSectionType[],
  index: number,
) {
  const type = types[index] || "verse";
  const base =
    songSectionOptions.find((option) => option.value === type)?.label ||
    "Estrofa";
  if (type !== "verse" && type !== "other") return base;
  const occurrence =
    types.slice(0, index + 1).filter((value) => value === type).length || 1;
  return `${base} ${occurrence}`;
}
