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
