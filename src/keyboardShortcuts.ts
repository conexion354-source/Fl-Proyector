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
  | "congelar"
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
  congelar: "Congelar / publicar pantalla",
  pantallaNegra: "Pantalla negra",
  limpiar: "Limpiar texto y contenido",
};

export const defaultShortcuts: Record<ShortcutAction, string> = {
  reuniones: "1",
  canciones: "2",
  fondos: "3",
  biblia: "4",
  remoto: "5",
  ajustes: "6",
  proyector: "Alt+P",
  cerrarProyector: "Alt+X",
  logo: "Alt+O",
  qr: "Alt+Q",
  congelar: "Alt+F",
  pantallaNegra: "Alt+B",
  limpiar: "Alt+L",
};

export const shortcutStorageKey = "fl-keyboard-shortcuts-v1";

export function isAllowedShortcut(value: string): boolean {
  return /^(?:Alt\+)?[A-Z0-9]$/i.test(value.trim());
}

export function shortcutFromKeyEvent(
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): string | null {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const key = event.key.toUpperCase();
  if (!/^[A-Z0-9]$/.test(key)) return null;
  return event.altKey ? `Alt+${key}` : key;
}

export function loadShortcuts(): Record<ShortcutAction, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(shortcutStorageKey) || "null");
    const merged = { ...defaultShortcuts, ...(saved && typeof saved === "object" ? saved : {}) };
    const used = new Set<string>();
    return (Object.keys(defaultShortcuts) as ShortcutAction[]).reduce((result, action) => {
      const shortcut = String(merged[action] || "").trim().toUpperCase();
      if (isAllowedShortcut(shortcut) && !used.has(shortcut)) {
        used.add(shortcut);
        result[action] = shortcut;
      } else {
        result[action] = defaultShortcuts[action];
        used.add(defaultShortcuts[action]);
      }
      return result;
    }, {} as Record<ShortcutAction, string>);
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
