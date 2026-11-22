import type { BibleDisplaySettings } from "../shared/types";
import {
  planBiblePassage,
  type ProjectionDimensions,
} from "../shared/bibleLayout";

export type BibleSlide = {
  html: string;
  contentHtml: string;
  fontSize: number;
  /** Tamaño calculado para este pasaje dentro del rango permitido. */
  fittedFontSize: number;
  label: string;
  sourceText: string;
  reference: string;
  version: string;
};

export type BibleSlideMode = "automatic" | "full" | "split";

export type BibleSlideOptions = {
  mode?: BibleSlideMode;
  splitAtWord?: number;
};

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
  options: BibleSlideOptions = {},
): BibleSlide[] {
  // Un solo cálculo decide si el pasaje entra completo, si se divide en A y B
  // y con qué tamaño. El proyector respeta ese mismo rango de tamaño.
  const manualSplitAt = Math.floor(options.splitAtWord ?? 0);
  const plan = planBiblePassage(text, settings, viewport, {
    allowSplit: options.mode === "full" ? false : settings.longVerseMode !== "auto-fit",
    splitAtWord:
      options.mode === "full"
        ? undefined
        : manualSplitAt > 0 &&
          (options.mode === "split" ||
            (settings.longVerseMode !== "auto-fit" && planBiblePassage(text, settings, viewport).needsSplit))
          ? manualSplitAt
          : options.mode === "split"
            ? -1
            : undefined,
  });
  const pieces = plan.parts;
  return pieces.map((piece, index) => {
    const fontSize = settings.textFontSize;
    const fittedFontSize = Math.round(plan.fontSize);
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
                : settings.referenceStyle === "lower-third"
                  ? `${referenceBase};background:linear-gradient(90deg,${settings.referenceBackground},${settings.referenceBackground}d9 72%,transparent);border-left:.28em solid ${settings.referenceColor};border-radius:.12em`
                  : settings.referenceStyle === "broadcast"
                    ? `${referenceBase};background:${settings.referenceBackground};border-left:.28em solid ${settings.referenceColor};border-bottom:.12em solid ${settings.referenceColor};clip-path:polygon(0 0,94% 0,100% 100%,0 100%)`
                : `${referenceBase};background:${settings.referenceBackground};border-radius:999px`;
    const ref = referenceText
      ? `<div class="bible-reference-slot reference-${settings.referencePosition}" style="text-shadow:none"><span class="bible-reference-label reference-style-${settings.referenceStyle} reference-animation-${settings.referenceAnimation}" style="${referenceStyle}">${escapeHtml(referenceText)}</span></div>`
      : "";
    const verse = `<div class="bible-verse-slot"><p class="bible-verse-text" style="font-family:${escapeHtml(settings.textFontFamily)};color:${settings.textColor}">${escapeHtml(piece)}</p></div>`;
    return {
      // Las partes A y B llevan el mismo tope de tamaño, para que no se vea
      // una parte grande y la otra chica.
      html: `<div class="bible-slide bible-reference-${settings.referencePosition}"${
        pieces.length > 1 ? ` data-fit-cap="${fittedFontSize}"` : ""
      }>${
        settings.referencePosition === "before" ? `${ref}${verse}` : `${verse}${ref}`
      }</div>`,
      // Operator cards deliberately contain only the passage. The configured
      // projection typeface, size and reference lower-third belong exclusively
      // to the preview and the physical output.
      contentHtml: escapeHtml(piece),
      fontSize,
      fittedFontSize,
      label: `${reference}${partSuffix}`,
      sourceText: text,
      reference,
      version,
    };
  });
}
