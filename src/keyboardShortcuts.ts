export type ShortcutAction =
  | "reuniones"
  | "canciones"
  | "fondos"
  | "biblia"
  | "remoto"
  | "ajustes"
  | "proyector"
  | "cerrarProyector"
  | "logo"
  | "qr"
  | "pantallaNegra"
  | "limpiar";

export const shortcutLabels: Record<ShortcutAction, string> = {
  reuniones: "Ir a Reuniones",
  canciones: "Ir a Canciones",
  fondos: "Ir a Fondos",
  biblia: "Ir a Biblia",
  remoto: "Abrir control remoto",
  ajustes: "Abrir Ajustes",
  proyector: "Enviar al proyector",
  cerrarProyector: "Cerrar segunda pantalla",
  logo: "Mostrar / ocultar logo",
  qr: "Mostrar / ocultar QR",
  pantallaNegra: "Pantalla negra",
  limpiar: "Limpiar texto y contenido",
};

export const defaultShortcuts: Record<ShortcutAction, string> = {
  reuniones: "Ctrl+1",
  canciones: "Ctrl+2",
  fondos: "Ctrl+3",
  biblia: "Ctrl+4",
  remoto: "Ctrl+5",
  ajustes: "Ctrl+6",
  proyector: "Alt+P",
  cerrarProyector: "Alt+Shift+P",
  logo: "Alt+O",
  qr: "Alt+Q",
  pantallaNegra: "Alt+B",
  limpiar: "Alt+L",
};

export const shortcutStorageKey = "fl-keyboard-shortcuts-v1";

export function loadShortcuts(): Record<ShortcutAction, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(shortcutStorageKey) || "null");
    return { ...defaultShortcuts, ...(saved && typeof saved === "object" ? saved : {}) };
  } catch {
    return { ...defaultShortcuts };
  }
}

export function normalizeShortcut(event: KeyboardEvent): string {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const parts = [
    event.ctrlKey ? "Ctrl" : "",
    event.metaKey ? "Meta" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean);
  return [...parts, key === " " ? "Space" : key].join("+");
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}
