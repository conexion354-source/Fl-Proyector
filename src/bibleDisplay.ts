import type { BibleDisplaySettings } from "../shared/types";
import { isLongBibleVerse } from "../shared/bibleLayout";

export type BibleSlide = { html: string; fontSize: number; label: string };

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char]!,
  );

function splitByConfiguredLines(
  text: string,
  settings: BibleDisplaySettings,
) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text];
  const usableWidth = 1920 * (1 - (settings.horizontalMargin * 2) / 100);
  const averageGlyphWidth = Math.max(8, settings.textFontSize * 0.53);
  const charactersPerLine = Math.max(
    16,
    Math.floor(usableWidth / averageGlyphWidth),
  );
  // A small safety factor accounts for proportional glyphs and keeps the
  // rendered slide at or below the operator-selected line count.
  const characterBudget = Math.max(
    24,
    Math.floor(charactersPerLine * settings.maxLinesPerSlide * 0.9),
  );
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > characterBudget) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces.length > 1 ? pieces : [text];
}

export function buildBibleSlides(
  text: string,
  reference: string,
  version: string,
  settings: BibleDisplaySettings,
): BibleSlide[] {
  // A/B is used only for passages that cross the configured long-text limit.
  // Short verses remain a single, quick-to-select item for the operator.
  const pieces =
    settings.longVerseMode !== "auto-fit" &&
    isLongBibleVerse(text, settings) &&
    text.trim().split(/\s+/).length > 1
      ? splitByConfiguredLines(text, settings)
      : [text];
  return pieces.map((piece, index) => {
    const overflow = Math.max(0, piece.length - 110);
    const fontSize =
      settings.longVerseMode === "auto-fit"
        ? Math.max(
            settings.minimumFontSize,
            settings.textFontSize - Math.ceil(overflow / 24) * 3,
          )
        : settings.textFontSize;
    const partSuffix =
      pieces.length > 1 ? String.fromCharCode(97 + Math.min(index, 25)) : "";
    const displayedReference = settings.showReference
      ? `${reference}${partSuffix}`
      : "";
    const referenceText = [
      displayedReference,
      settings.showVersion ? version : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const refRatio = Math.max(
      0.2,
      Math.min(1.5, settings.referenceFontSize / fontSize),
    );
    const referenceBase = `color:${settings.referenceColor};font-family:${settings.referenceFontFamily};font-size:${refRatio}em;font-weight:750`;
    const referenceStyle =
      settings.referenceStyle === "minimal"
        ? `${referenceBase};letter-spacing:.03em;font-weight:650`
        : settings.referenceStyle === "bar"
          ? `display:block;${referenceBase};background:${settings.referenceBackground};padding:.45em .8em;border-left:.22em solid ${settings.referenceColor}`
          : settings.referenceStyle === "glass"
            ? `display:inline-block;${referenceBase};background:${settings.referenceBackground}bb;padding:.38em .78em;border:1px solid ${settings.referenceColor}88;border-radius:.35em;box-shadow:0 .25em .9em #0008;backdrop-filter:blur(8px)`
            : settings.referenceStyle === "underline"
              ? `display:inline-block;${referenceBase};padding:0 .05em .16em;border-bottom:.14em solid ${settings.referenceBackground};letter-spacing:.025em`
              : settings.referenceStyle === "ribbon"
                ? `display:inline-block;${referenceBase};background:${settings.referenceBackground};padding:.42em 1em .42em .72em;clip-path:polygon(0 0,100% 0,92% 50%,100% 100%,0 100%,.3em 50%)`
                : `display:inline-block;${referenceBase};background:${settings.referenceBackground};padding:.35em .75em;border-radius:999px`;
    const ref = referenceText
      ? `<p style="margin:${settings.referencePosition === "before" ? "0 0 .7em" : ".7em 0 0"};text-shadow:none"><span style="${referenceStyle}">${escapeHtml(referenceText)}</span></p>`
      : "";
    const verse = `<p style="font-family:${escapeHtml(settings.textFontFamily)};color:${settings.textColor}">${escapeHtml(piece)}</p>`;
    return {
      html:
        settings.referencePosition === "before"
          ? `${ref}${verse}`
          : `${verse}${ref}`,
      fontSize,
      label: `${reference}${partSuffix}`,
    };
  });
}
