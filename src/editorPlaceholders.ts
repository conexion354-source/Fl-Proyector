export const emptyRichText = "<p></p>";

const normalizePromptText = (html: string) =>
  String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/…/g, "...")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");

const legacyPrompts = {
  song: new Set(["escribi aqui la letra del canto..."]),
  // “Bienvenidos” is a perfectly valid announcement, not a placeholder.
  // Only the explicit editor hint is discarded when loading legacy records.
  announcement: new Set(["escribi el anuncio aqui"]),
};

export function withoutLegacyEditorPrompt(
  html: string | null | undefined,
  kind: keyof typeof legacyPrompts,
) {
  const source = String(html || "");
  if (!source.trim() || legacyPrompts[kind].has(normalizePromptText(source)))
    return emptyRichText;
  return source;
}
