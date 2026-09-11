import type { BibleDisplaySettings } from "../shared/types";
import {
  isLongBibleVerse,
  splitBibleVerse,
  type ProjectionDimensions,
} from "../shared/bibleLayout";

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

export function buildBibleSlides(
  text: string,
  reference: string,
  version: string,
  settings: BibleDisplaySettings,
  viewport?: ProjectionDimensions,
): BibleSlide[] {
  // A/B is used only for passages that cross the configured long-text limit.
  // Short verses remain a single, quick-to-select item for the operator.
  const pieces =
    settings.longVerseMode !== "auto-fit" &&
    isLongBibleVerse(text, settings, viewport) &&
    text.trim().split(/\s+/).length > 1
      ? splitBibleVerse(text, settings, viewport)
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
    // The reference uses its own configured size. It must never inherit the
    // verse's automatic font reduction, otherwise its background grows and
    // shrinks every time a passage changes length.
    const referenceBase = `color:${settings.referenceColor};font-family:${settings.referenceFontFamily};font-weight:750`;
    const referenceStyle =
      settings.referenceStyle === "minimal"
        ? `${referenceBase};letter-spacing:.03em;font-weight:650`
        : settings.referenceStyle === "bar"
          ? `${referenceBase};background:${settings.referenceBackground};border-left:.22em solid ${settings.referenceColor}`
          : settings.referenceStyle === "glass"
            ? `${referenceBase};background:${settings.referenceBackground}bb;border:1px solid ${settings.referenceColor}88;border-radius:.35em;box-shadow:0 .25em .9em #0008;backdrop-filter:blur(8px)`
            : settings.referenceStyle === "underline"
              ? `${referenceBase};border-bottom:.14em solid ${settings.referenceBackground};letter-spacing:.025em`
              : settings.referenceStyle === "ribbon"
                ? `${referenceBase};background:${settings.referenceBackground};clip-path:polygon(0 0,100% 0,92% 50%,100% 100%,0 100%,.3em 50%)`
                : `${referenceBase};background:${settings.referenceBackground};border-radius:999px`;
    const ref = referenceText
      ? `<div class="bible-reference-slot reference-${settings.referencePosition}" style="text-shadow:none"><span class="bible-reference-label reference-style-${settings.referenceStyle}" style="${referenceStyle}">${escapeHtml(referenceText)}</span></div>`
      : "";
    const verse = `<div class="bible-verse-slot"><p class="bible-verse-text" style="font-family:${escapeHtml(settings.textFontFamily)};color:${settings.textColor}">${escapeHtml(piece)}</p></div>`;
    return {
      html: `<div class="bible-slide bible-reference-${settings.referencePosition}">${
        settings.referencePosition === "before" ? `${ref}${verse}` : `${verse}${ref}`
      }</div>`,
      fontSize,
      label: `${reference}${partSuffix}`,
    };
  });
}
