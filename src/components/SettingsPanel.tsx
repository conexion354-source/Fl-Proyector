import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BadgeInfo,
  BookOpen,
  Building2,
  ChevronDown,
  Download,
  History,
  ImageIcon,
  Keyboard,
  MonitorCog,
  Moon,
  Music2,
  Palette,
  RefreshCw,
  Save,
  Sparkles,
  Type,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  initialBibleDisplaySettings,
  initialChurchSettings,
  initialDisplaySettings,
  initialSongDisplaySettings,
  type BibleDisplaySettings,
  type BibleVersion,
  type ChurchSettings,
  type DisplayInfo,
  type DisplaySettings,
  type ProjectionPatch,
  type ProjectionState,
  type ReleaseHistoryEntry,
  type SongDisplaySettings,
  type UpdateStatus,
} from "../../shared/types";
import { buildBibleSlides } from "../bibleDisplay";
import { bibleSizeBand, bibleTextBox, planBiblePassage, typicalVerse } from "../../shared/bibleLayout";
import { idealSizeFor } from "../../shared/textFit";
import { projectionFonts } from "../fonts";
import { notifySaveError, notifySaved } from "./SaveNotification";
import {
  defaultShortcuts,
  shortcutFromKeyEvent,
  loadShortcuts,
  shortcutLabels,
  shortcutStorageKey,
  type ShortcutAction,
} from "../keyboardShortcuts";

/* ------------------------------------------------------------------------ */
/* Constantes                                                               */
/* ------------------------------------------------------------------------ */

const textColors = [
  "#ffffff",
  "#fde68a",
  "#facc15",
  "#86efac",
  "#67e8f9",
  "#93c5fd",
  "#c4b5fd",
  "#f9a8d4",
];
const backgroundColors = [
  "#000000",
  "#1f2937",
  "#312e81",
  "#4f46e5",
  "#075985",
  "#166534",
  "#9a3412",
  "#9f1239",
];
const shadowColors = ["#000000", "#111827", "#312e81", "#7f1d1d", "#ffffff"];
const defaultSongPanelColor = "#1f2937";

type Section =
  | "pantalla"
  | "texto"
  | "iglesia"
  | "biblias"
  | "canciones"
  | "tema"
  | "atajos"
  | "version";

const sections: Array<{
  id: Section;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  { id: "pantalla", label: "Pantallas", description: "Proyector, resolución y salidas adicionales", icon: <MonitorCog /> },
  { id: "texto", label: "Texto en pantalla", description: "Letra, tamaño y diseño de la Biblia y las canciones", icon: <Type /> },
  { id: "iglesia", label: "Iglesia y logo", description: "Nombre, dirección y logo que se proyecta", icon: <Building2 /> },
  { id: "tema", label: "Apariencia", description: "Tema claro u oscuro de la aplicación", icon: <Palette /> },
  { id: "atajos", label: "Atajos de teclado", description: "Teclas rápidas para operar en vivo", icon: <Keyboard /> },
  { id: "version", label: "Actualizaciones", description: "Versión instalada y novedades", icon: <BadgeInfo /> },
];

/** Pestañas de "Texto en pantalla": lo común y lo propio de cada tipo. */
const textTabs: Array<{ id: Section; label: string }> = [
  { id: "texto", label: "General" },
  { id: "biblias", label: "Biblia" },
  { id: "canciones", label: "Canciones" },
];

const referenceDesigns: Array<{
  value: BibleDisplaySettings["referenceStyle"];
  label: string;
  detail: string;
}> = [
  { value: "minimal", label: "Texto limpio", detail: "Sin fondo" },
  { value: "pill", label: "Pastilla", detail: "Redondeado" },
  { value: "bar", label: "Franja", detail: "Bloque lateral" },
  { value: "glass", label: "Cristal", detail: "Transparente" },
  { value: "underline", label: "Subrayado", detail: "Acento sutil" },
  { value: "ribbon", label: "Cinta", detail: "Etiqueta gráfica" },
  { value: "lower-third", label: "Lower third", detail: "Franja profesional" },
  { value: "broadcast", label: "TV en vivo", detail: "Doble acento" },
];

/** Parámetros de tamaño y reparto compartidos por Biblia y canciones. */
type TextLayout = {
  fontFamily: string;
  textColor: string;
  uppercase: boolean;
  size: number;
  growPercent: number;
  shrinkPercent: number;
  horizontalMargin: number;
  verticalMargin: number;
  longVerseMode: "split-halves" | "auto-fit";
  stableSongSize: boolean;
};

const initialLayout: TextLayout = {
  fontFamily: initialBibleDisplaySettings.textFontFamily,
  textColor: initialBibleDisplaySettings.textColor,
  uppercase: initialBibleDisplaySettings.uppercase,
  size: initialBibleDisplaySettings.textFontSize,
  growPercent: initialBibleDisplaySettings.growPercent,
  shrinkPercent: initialBibleDisplaySettings.shrinkPercent,
  horizontalMargin: initialBibleDisplaySettings.horizontalMargin,
  verticalMargin: initialBibleDisplaySettings.verticalMargin,
  longVerseMode: "split-halves",
  stableSongSize: true,
};

function withBibleLayout(value: BibleDisplaySettings, layout: TextLayout): BibleDisplaySettings {
  return {
    ...value,
    textFontFamily: layout.fontFamily,
    textColor: layout.textColor,
    uppercase: layout.uppercase,
    textFontSize: layout.size,
    growPercent: layout.growPercent,
    shrinkPercent: layout.shrinkPercent,
    minimumFontSize: Math.max(12, Math.round(layout.size * (1 - layout.shrinkPercent / 100))),
    horizontalMargin: layout.horizontalMargin,
    verticalMargin: layout.verticalMargin,
    longVerseMode: layout.longVerseMode,
  };
}

function withSongLayout(value: SongDisplaySettings, layout: TextLayout): SongDisplaySettings {
  return {
    ...value,
    fontFamily: layout.fontFamily,
    textColor: layout.textColor,
    uppercase: layout.uppercase,
    fontSize: layout.size,
    growPercent: layout.growPercent,
    shrinkPercent: layout.shrinkPercent,
    minimumFontSize: Math.max(12, Math.round(layout.size * (1 - layout.shrinkPercent / 100))),
    horizontalMargin: layout.horizontalMargin,
    verticalMargin: layout.verticalMargin,
    stableFontSize: layout.stableSongSize,
  };
}

/** Ejemplos para ver cómo se comporta el texto con distintos largos. */
const bibleSamples = {
  corto: { text: "Jesús lloró.", reference: "Juan 11:35" },
  normal: { text: typicalVerse, reference: "Juan 3:16" },
  largo: {
    text: "Entonces fueron llamados los escribanos del rey en el mes tercero, que es Siván, a los veintitrés días de ese mes; y se escribió conforme a todo lo que mandó Mardoqueo, a los judíos, y a los sátrapas, los capitanes y los príncipes de las provincias que había desde la India hasta Etiopía, ciento veintisiete provincias; a cada provincia según su escritura, y a cada pueblo conforme a su lengua, a los judíos también conforme a su escritura y lengua.",
    reference: "Ejemplo largo",
  },
} as const;
const songSamples = {
  corto: "<p>Te alabaré<br>con todo el corazón</p>",
  normal: "<p>Cantaré de tu bondad cada mañana<br>porque tu amor me sostiene al caminar<br>en la noche más oscura tu luz brilla<br>y en tus brazos siempre puedo descansar</p>",
  largo: "<p>Cantaré de tu bondad cada mañana<br>porque tu amor me sostiene al caminar<br>en la noche más oscura tu luz brilla<br>y en tus brazos siempre puedo descansar<br>no hay montaña que me impida seguirte<br>no hay tormenta que me aparte de tu voz<br>levantaré mis manos en tu presencia<br>porque grande y fiel eres tú, mi Dios</p>",
} as const;
type SampleLength = keyof typeof songSamples;

const fallbackBiblePreview = {
  text: "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree no se pierda, sino que tenga vida eterna.",
  reference: "Juan 3:16",
  version: "RVR1960",
};

/* ------------------------------------------------------------------------ */
/* Utilidades                                                               */
/* ------------------------------------------------------------------------ */

function isTransparentColor(color: string) {
  const normalized = color.replace(/\s/g, "").toLowerCase();
  return (
    normalized === "transparent" ||
    normalized === "rgba(0,0,0,0)" ||
    normalized === "#00000000"
  );
}

/** Devuelve un color hexadecimal de 6 dígitos o null si no se puede expresar así. */
function hexOrNull(color: string) {
  const match = /^#([0-9a-f]{6})/i.exec(color.trim());
  return match ? `#${match[1]}` : null;
}

function biblePreviewSource(state: ProjectionState) {
  const savedText = state.text.sourceBibleText?.trim();
  if (savedText)
    return {
      text: savedText,
      reference: state.text.sourceBibleReference?.trim() || fallbackBiblePreview.reference,
      version: state.text.sourceBibleVersion?.trim() || "",
    };
  if (state.text.kind !== "biblia" || !state.text.html.trim())
    return fallbackBiblePreview;
  const holder = document.createElement("div");
  holder.innerHTML = state.text.html;
  const text = holder.querySelector(".bible-verse-text")?.textContent?.replace(/\s+/g, " ").trim();
  if (!text) return fallbackBiblePreview;
  const referenceParts = holder
    .querySelector(".bible-reference-label")
    ?.textContent?.split("·")
    .map((part) => part.trim())
    .filter(Boolean) ?? [];
  return {
    text,
    reference: referenceParts[0] || fallbackBiblePreview.reference,
    version: referenceParts[1] || "",
  };
}

function clampNumber(raw: string | number, min: number, max: number, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && String(raw).trim() !== ""
    ? Math.max(min, Math.min(max, Math.round(parsed)))
    : fallback;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Ejecuta un guardado, muestra el aviso y devuelve si salió bien. */
async function runSave(action: () => Promise<unknown> | unknown, message: string) {
  try {
    await action();
    notifySaved(message);
    return true;
  } catch (error) {
    notifySaveError(error);
    return false;
  }
}

/* ------------------------------------------------------------------------ */
/* Controles con estilo Windows 11                                          */
/* ------------------------------------------------------------------------ */

function SettingsGroup({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="w11-group">
      {(title || action) && (
        <header className="w11-group-header">
          {title && <h3>{title}</h3>}
          {action}
        </header>
      )}
      <div className="w11-group-items">{children}</div>
    </section>
  );
}

function SettingRow({
  icon,
  title,
  description,
  children,
  disabled = false,
  stacked = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  stacked?: boolean;
}) {
  return (
    <div className={`w11-row ${disabled ? "disabled" : ""} ${stacked ? "stacked" : ""}`}>
      {icon && <span className="w11-row-icon" aria-hidden="true">{icon}</span>}
      <div className="w11-row-copy">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </div>
      {children && <div className="w11-row-control">{children}</div>}
    </div>
  );
}

function SettingExpander({
  icon,
  title,
  description,
  control,
  children,
  defaultOpen = false,
  disabled = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  control?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`w11-expander ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}>
      <div className="w11-row w11-expander-head">
        <button
          type="button"
          className="w11-expander-hit"
          aria-expanded={open}
          aria-label={`${open ? "Contraer" : "Expandir"} ${title}`}
          onClick={() => setOpen((value) => !value)}
          disabled={disabled}
        />
        {icon && <span className="w11-row-icon" aria-hidden="true">{icon}</span>}
        <div className="w11-row-copy">
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </div>
        {control && <div className="w11-row-control">{control}</div>}
        <ChevronDown className="w11-expander-chevron" aria-hidden="true" />
      </div>
      {open && <div className="w11-expander-body">{children}</div>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="w11-toggle">
      <span className="w11-toggle-state">{checked ? "Activado" : "Desactivado"}</span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="w11-select"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Campo numérico que deja borrar y escribir libremente y valida al salir. */
function NumberBox({
  value,
  min,
  max,
  onChange,
  label,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = clampNumber(draft, min, max, value);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <span className="w11-number">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() && Number.isFinite(parsed) && parsed >= min && parsed <= max)
            onChange(Math.round(parsed));
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

function FontSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const known = projectionFonts.some((font) => font.value === value);
  return (
    <select
      className="w11-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {!known && <option value={value}>{value}</option>}
      {projectionFonts.map((font) => (
        <option value={font.value} key={font.label}>
          {font.label}
        </option>
      ))}
    </select>
  );
}

function ColorPicker({
  label,
  value,
  colors,
  onChange,
  clearValue,
  clearLabel = "Sin color",
}: {
  label: string;
  value: string;
  colors: string[];
  onChange: (color: string) => void;
  clearValue?: string;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  const transparent = isTransparentColor(value);
  const hex = hexOrNull(value);
  const display = transparent ? clearLabel : (hex ?? value).toUpperCase();
  return (
    <div className="w11-color" ref={ref}>
      <button
        type="button"
        className="w11-color-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${label}: ${display}`}
      >
        <i
          className={transparent ? "transparent" : ""}
          style={transparent ? undefined : { backgroundColor: value }}
        />
        <span>{display}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="w11-color-flyout" role="dialog" aria-label={label}>
          <strong>{label}</strong>
          <div className="w11-color-swatches">
            {colors.map((color) => (
              <button
                type="button"
                title={color.toUpperCase()}
                aria-label={`${label} ${color}`}
                className={hex?.toLowerCase() === color.toLowerCase() ? "active" : ""}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                key={color}
              />
            ))}
          </div>
          <div className="w11-color-footer">
            <label>
              <input
                type="color"
                value={hex ?? "#ffffff"}
                onChange={(event) => onChange(event.target.value)}
              />
              Personalizado
            </label>
            {clearValue !== undefined && (
              <button
                type="button"
                className="w11-button subtle"
                onClick={() => {
                  onChange(clearValue);
                  setOpen(false);
                }}
              >
                {clearLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveBar({
  dirty,
  onSave,
  onDiscard,
  saving,
}: {
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  return (
    <div className={`w11-savebar ${dirty ? "dirty" : ""}`} role="region" aria-label="Guardar cambios">
      <span>
        {dirty ? (
          <>
            <i aria-hidden="true" /> Tenés cambios sin guardar
          </>
        ) : (
          "Todos los cambios están guardados"
        )}
      </span>
      <button type="button" className="w11-button" disabled={!dirty || saving} onClick={onDiscard}>
        Descartar
      </button>
      <button type="button" className="w11-button accent" disabled={!dirty || saving} onClick={onSave}>
        <Save aria-hidden="true" />
        {saving ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Panel de ajustes                                                         */
/* ------------------------------------------------------------------------ */

export function SettingsPanel({
  state,
  update,
  displays,
  onPreviewChange,
  onDisplayPreviewChange,
  openVersionSectionSignal = 0,
}: {
  state: ProjectionState;
  update: (patch: ProjectionPatch) => void;
  displays: DisplayInfo[];
  onPreviewChange: (preview: ProjectionState | null) => void;
  onDisplayPreviewChange: (settings: DisplaySettings | null) => void;
  openVersionSectionSignal?: number;
}) {
  const [section, setSection] = useState<Section>("pantalla");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("fl-interface-theme") === "dark" ? "dark" : "light",
  );

  // Cada sección guarda una copia de lo que está en disco para saber si hay
  // cambios pendientes y poder descartarlos.
  const [settings, setSettings] = useState<DisplaySettings>(initialDisplaySettings);
  const [savedSettings, setSavedSettings] = useState<DisplaySettings>(initialDisplaySettings);
  const [church, setChurch] = useState<ChurchSettings>(initialChurchSettings);
  const [savedChurch, setSavedChurch] = useState<ChurchSettings>(initialChurchSettings);
  const [bible, setBible] = useState<BibleDisplaySettings>(initialBibleDisplaySettings);
  const [savedBible, setSavedBible] = useState<BibleDisplaySettings>(initialBibleDisplaySettings);
  const [songStyle, setSongStyle] = useState<SongDisplaySettings>(state.songStyle);
  const [savedSongStyle, setSavedSongStyle] = useState<SongDisplaySettings>(state.songStyle);
  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, string>>(() => loadShortcuts());
  const [savedShortcuts, setSavedShortcuts] = useState<Record<ShortcutAction, string>>(() => loadShortcuts());
  const [shortcutError, setShortcutError] = useState("");
  const [layout, setLayout] = useState<TextLayout>(initialLayout);
  const [savedLayout, setSavedLayout] = useState<TextLayout>(initialLayout);
  const [layoutPreview, setLayoutPreview] = useState<"biblia" | "canto">("biblia");
  const [sampleLength, setSampleLength] = useState<SampleLength>("normal");
  const [saving, setSaving] = useState(false);

  const [versions, setVersions] = useState<BibleVersion[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [releaseHistory, setReleaseHistory] = useState<ReleaseHistoryEntry[]>([]);
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [releaseHistoryLoading, setReleaseHistoryLoading] = useState(false);

  const reloadVersions = () => window.flProyector.listBibleVersions().then(setVersions);

  useEffect(() => {
    window.flProyector.getDisplaySettings().then((saved) => {
      const normalized = saved.aspectRatio === "custom" ? { ...saved, aspectRatio: "auto" as const } : saved;
      setSettings(normalized);
      setSavedSettings(normalized);
    });
    window.flProyector.getChurchSettings().then((value) => {
      const normalized = { ...initialChurchSettings, ...value };
      setChurch(normalized);
      setSavedChurch(normalized);
    });
    window.flProyector.getBibleDisplaySettings().then((value) => {
      const normalized = { ...initialBibleDisplaySettings, ...value };
      setBible(normalized);
      setSavedBible(normalized);
      const fromBible: Partial<TextLayout> = {
        fontFamily: normalized.textFontFamily,
        textColor: normalized.textColor,
        uppercase: normalized.uppercase,
        size: normalized.textFontSize,
        growPercent: normalized.growPercent,
        shrinkPercent: normalized.shrinkPercent,
        horizontalMargin: normalized.horizontalMargin,
        verticalMargin: normalized.verticalMargin,
        longVerseMode: normalized.longVerseMode === "auto-fit" ? "auto-fit" : "split-halves",
      };
      setLayout((current) => ({ ...current, ...fromBible }));
      setSavedLayout((current) => ({ ...current, ...fromBible }));
    });
    window.flProyector.getSongDisplaySettings().then((value) => {
      const normalized = { ...initialSongDisplaySettings, ...value, autoFit: true };
      setSongStyle(normalized);
      setSavedSongStyle(normalized);
      const stableSongSize = normalized.stableFontSize !== false;
      setLayout((current) => ({ ...current, stableSongSize }));
      setSavedLayout((current) => ({ ...current, stableSongSize }));
    });
    reloadVersions();
    window.flProyector.getUpdateStatus().then(setUpdateStatus);
    return window.flProyector.onUpdateStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    if (openVersionSectionSignal > 0) setSection("version");
  }, [openVersionSectionSignal]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("fl-interface-theme", theme);
  }, [theme]);

  const dirty: Partial<Record<Section, boolean>> = {
    pantalla: !same(settings, savedSettings),
    texto: !same(layout, savedLayout),
    iglesia: !same(church, savedChurch),
    biblias: !same(bible, savedBible),
    canciones: !same(songStyle, savedSongStyle),
    atajos: !same(shortcuts, savedShortcuts),
  };
  const anyDirty = Object.values(dirty).some(Boolean);

  // Avisar si se sale de Ajustes con cambios pendientes: antes se perdían sin
  // ningún mensaje.
  const anyDirtyRef = useRef(anyDirty);
  anyDirtyRef.current = anyDirty;
  useEffect(
    () => () => {
      if (anyDirtyRef.current)
        notifySaveError(new Error("Saliste de Ajustes sin guardar: los cambios pendientes se descartaron."));
    },
    [],
  );

  /* ---------------- Pantallas ---------------- */

  const effectiveMainDisplay =
    displays.find((display) => display.id === settings.mainDisplayId) ??
    displays.find((display) => !display.primary) ??
    displays.find((display) => display.primary);
  const availableThirdDisplays = displays.filter(
    (display) => !display.primary && display.id !== effectiveMainDisplay?.id,
  );
  const availablePreviewDisplays = displays.filter(
    (display) =>
      !display.primary &&
      display.id !== effectiveMainDisplay?.id &&
      display.id !== (settings.thirdDisplayEnabled ? settings.thirdDisplayId : null),
  );
  useEffect(() => {
    if (
      !settings.thirdDisplayEnabled ||
      availableThirdDisplays.some((display) => display.id === settings.thirdDisplayId)
    )
      return;
    setSettings((value) => ({ ...value, thirdDisplayEnabled: false, thirdDisplayId: null }));
  }, [settings.mainDisplayId, settings.thirdDisplayEnabled, settings.thirdDisplayId, displays]);
  useEffect(() => {
    if (
      !settings.previewEnabled ||
      settings.previewDisplayId === null ||
      availablePreviewDisplays.some((display) => display.id === settings.previewDisplayId)
    )
      return;
    setSettings((value) => ({ ...value, previewDisplayId: null }));
  }, [settings.previewEnabled, settings.previewDisplayId, availablePreviewDisplays]);

  const displayLabel = (display: DisplayInfo) =>
    `${display.label} · ${display.width}×${display.height}${
      display.scaleFactor !== 1 ? ` · ${Math.round(display.scaleFactor * 100)}%` : ""
    }${display.primary ? " (esta computadora)" : ""}`;

  const saveDisplay = () =>
    runSave(async () => {
      if (
        settings.thirdDisplayEnabled &&
        !availableThirdDisplays.some((display) => display.id === settings.thirdDisplayId)
      )
        throw new Error("Elegí una tercera pantalla externa distinta de la salida principal.");
      if (
        settings.previewEnabled &&
        settings.previewDisplayId !== null &&
        !availablePreviewDisplays.some((display) => display.id === settings.previewDisplayId)
      )
        throw new Error("Elegí un monitor de vista previa distinto de las salidas principales.");
      await window.flProyector.saveDisplaySettings(settings);
      setSavedSettings(settings);
    }, "La configuración de pantallas fue guardada.");

  /* ---------------- Iglesia ---------------- */

  const saveChurch = () =>
    runSave(async () => {
      const next = { ...church, name: church.name.trim(), address: church.address.trim(), city: church.city.trim() };
      await window.flProyector.saveChurchSettings(next);
      update({ church: next });
      setChurch(next);
      setSavedChurch(next);
    }, "Los datos de la iglesia fueron guardados.");
  const chooseLogo = async () => {
    const file = await window.flProyector.pickChurchLogo();
    if (file) setChurch((value) => ({ ...value, logoPath: file.path, logoUrl: file.url }));
  };

  /* ---------------- Biblias ---------------- */

  const saveBible = () => {
    const nextBible: BibleDisplaySettings = {
      ...bible,
      // La protección contra cortes y el uso del área configurada son fijos,
      // así la vista previa y el proyector coinciden siempre.
      autoFit: true,
      fillScreen: false,
      minimumFontSize: Math.min(bible.minimumFontSize, bible.textFontSize),
    };
    const source = biblePreviewSource(state);
    const hasLiveBibleSource = Boolean(
      state.text.sourceBibleText?.trim() ||
        (state.text.kind === "biblia" && state.text.html.includes("bible-verse-text")),
    );
    const liveSlide =
      state.text.kind === "biblia" && hasLiveBibleSource
        ? buildBibleSlides(source.text, source.reference, source.version, nextBible, state.outputViewport)[0]
        : null;
    return runSave(async () => {
      await window.flProyector.saveBibleDisplaySettings(nextBible);
      update({
        bibleStyle: nextBible,
        ...(liveSlide
          ? {
              text: {
                html: liveSlide.html,
                fontSize: nextBible.textFontSize,
                fontFamily: nextBible.textFontFamily,
                color: nextBible.textColor,
                shadowEnabled: nextBible.textShadowEnabled,
                shadowColor: nextBible.textShadowColor,
                shadowBlur: nextBible.textShadowBlur,
                sourceBibleText: liveSlide.sourceText,
                sourceBibleReference: liveSlide.reference,
                sourceBibleVersion: liveSlide.version,
              },
            }
          : {}),
      });
      setBible(nextBible);
      setSavedBible(nextBible);
    }, "La configuración bíblica fue guardada.");
  };
  const importBible = async () => {
    if (await window.flProyector.importBible()) reloadVersions();
  };
  const enabledVersions = versions.filter((version) => version.enabled !== false).length;

  /* ---------------- Canciones ---------------- */

  const saveSongStyle = () => {
    const nextSongStyle: SongDisplaySettings = {
      ...songStyle,
      // Nunca guardar una configuración que pueda dejar la letra cortada.
      autoFit: true,
      stableFontSize: songStyle.stableFontSize ?? true,
      horizontalMargin: songStyle.horizontalMargin ?? 8,
      verticalMargin: songStyle.verticalMargin ?? 10,
    };
    return runSave(async () => {
      await window.flProyector.saveSongDisplaySettings(nextSongStyle);
      update({
        songStyle: nextSongStyle,
        ...(state.text.kind === "canto"
          ? {
              text: {
                ...state.text,
                fontSize: nextSongStyle.fontSize,
                fontFamily: nextSongStyle.fontFamily,
                color: nextSongStyle.textColor,
                backgroundColor: nextSongStyle.backgroundColor,
                position: nextSongStyle.position,
                align: nextSongStyle.align,
                borderRadius: nextSongStyle.borderRadius,
                template: nextSongStyle.template,
                title: nextSongStyle.showTitle ? state.text.title : "",
                titlePosition: nextSongStyle.titlePosition,
                titleColor: nextSongStyle.titleColor,
                titleBackground: nextSongStyle.titleBackground,
                titleFontSize: nextSongStyle.titleFontSize,
                titleStyle: nextSongStyle.titleStyle,
              },
            }
          : {}),
      });
      setSongStyle(nextSongStyle);
      setSavedSongStyle(nextSongStyle);
    }, "El diseño de canciones fue guardado.");
  };

  /* ---------------- Texto en pantalla ---------------- */

  const saveLayout = () =>
    runSave(async () => {
      const nextBible = withBibleLayout(savedBible, layout);
      const nextSong = withSongLayout(savedSongStyle, layout);
      await window.flProyector.saveBibleDisplaySettings(nextBible);
      await window.flProyector.saveSongDisplaySettings(nextSong);
      update({
        bibleStyle: nextBible,
        songStyle: nextSong,
        ...(state.text.kind === "biblia" || state.text.kind === "canto"
          ? {
              text: {
                ...state.text,
                fontSize: layout.size,
                fontFamily: layout.fontFamily,
                color: layout.textColor,
              },
            }
          : {}),
      });
      setSavedBible(nextBible);
      setSavedSongStyle(nextSong);
      setBible((value) => withBibleLayout(value, layout));
      setSongStyle((value) => withSongLayout(value, layout));
      setSavedLayout(layout);
    }, "El tamaño del texto se guardó para Biblia y canciones.");
  const layoutBible = withBibleLayout(bible, layout);
  const layoutBand = bibleSizeBand(layoutBible);
  const calculateIdealSize = () => {
    const ideal = idealSizeFor(
      [typicalVerse],
      { fontFamily: layout.fontFamily, uppercase: layout.uppercase },
      bibleTextBox(layoutBible, state.outputViewport),
    );
    setLayout((value) => ({ ...value, size: Math.max(24, Math.min(200, ideal)) }));
  };
  const samplePlans = (Object.keys(bibleSamples) as SampleLength[]).map((length) => ({
    length,
    plan: planBiblePassage(bibleSamples[length].text, layoutBible, state.outputViewport),
  }));

  /* ---------------- Atajos ---------------- */

  const saveShortcuts = () =>
    runSave(() => {
      localStorage.setItem(shortcutStorageKey, JSON.stringify(shortcuts));
      window.dispatchEvent(new CustomEvent("fl-shortcuts-changed"));
      setSavedShortcuts(shortcuts);
      setShortcutError("");
    }, "Los atajos fueron guardados.");

  /* ---------------- Guardar / descartar ---------------- */

  const saveCurrent = async () => {
    const save = {
      pantalla: saveDisplay,
      texto: saveLayout,
      iglesia: saveChurch,
      biblias: saveBible,
      canciones: saveSongStyle,
      atajos: saveShortcuts,
    }[section as "pantalla"];
    if (!save) return;
    setSaving(true);
    try {
      await save();
    } finally {
      setSaving(false);
    }
  };
  const discardCurrent = () => {
    if (section === "pantalla") setSettings(savedSettings);
    if (section === "texto") setLayout(savedLayout);
    if (section === "iglesia") setChurch(savedChurch);
    if (section === "biblias") setBible(savedBible);
    if (section === "canciones") setSongStyle(savedSongStyle);
    if (section === "atajos") {
      setShortcuts(savedShortcuts);
      setShortcutError("");
    }
  };

  /* ---------------- Vista previa en el panel derecho ---------------- */

  const previewBibleSource = biblePreviewSource(state);
  const biblePreview = buildBibleSlides(
    previewBibleSource.text,
    previewBibleSource.reference,
    previewBibleSource.version,
    bible,
    state.outputViewport,
  )[0];
  const previewState: ProjectionState = {
    ...state,
    bibleStyle: bible,
    text: {
      ...state.text,
      html: biblePreview.html,
      kind: "biblia",
      visible: true,
      fontSize: bible.longVerseMode === "auto-fit" ? bible.textFontSize : biblePreview.fontSize,
      fontFamily: bible.textFontFamily,
      color: bible.textColor,
      shadowEnabled: bible.textShadowEnabled,
      shadowColor: bible.textShadowColor,
      shadowBlur: bible.textShadowBlur,
      position: "center",
      align: "center",
      backgroundColor: "rgba(0,0,0,.25)",
    },
    presentation: { ...state.presentation, visible: false },
    blackout: false,
    logo: false,
  };
  const songPreviewState: ProjectionState = {
    ...state,
    songStyle,
    text: {
      ...state.text,
      html: "<p>Señor mi Dios, al contemplar los cielos<br>El firmamento y las estrellas mil</p>",
      kind: "canto",
      sourceSongStanzas: null,
      visible: true,
      fontSize: songStyle.fontSize,
      fontFamily: songStyle.fontFamily,
      color: songStyle.textColor,
      backgroundColor: songStyle.backgroundColor,
      position: songStyle.position,
      align: songStyle.align,
      borderRadius: songStyle.borderRadius,
      template: songStyle.template,
      title: songStyle.showTitle ? "Cuán grande es Él" : "",
      titlePosition: songStyle.titlePosition,
      titleColor: songStyle.titleColor,
      titleBackground: songStyle.titleBackground,
      titleFontSize: songStyle.titleFontSize,
      titleStyle: songStyle.titleStyle,
    },
    presentation: { ...state.presentation, visible: false },
    blackout: false,
    logo: false,
  };
  const logoPreviewState: ProjectionState = {
    ...state,
    church,
    logo: true,
    blackout: false,
    text: { ...state.text, visible: false },
    presentation: { ...state.presentation, visible: false },
  };
  const layoutSample = bibleSamples[sampleLength];
  const layoutBibleSlide = buildBibleSlides(
    layoutSample.text,
    layoutSample.reference,
    "RVR1960",
    layoutBible,
    state.outputViewport,
  )[0];
  const layoutPreviewState: ProjectionState =
    layoutPreview === "biblia"
      ? {
          ...previewState,
          bibleStyle: layoutBible,
          text: {
            ...previewState.text,
            html: layoutBibleSlide.html,
            fontSize: layout.size,
            sourceBibleText: null,
          },
        }
      : {
          ...songPreviewState,
          songStyle: withSongLayout(songStyle, layout),
          text: { ...songPreviewState.text, html: songSamples[sampleLength], fontSize: layout.size },
        };
  useEffect(() => {
    if (section === "texto") onPreviewChange(layoutPreviewState);
    else if (section === "canciones") onPreviewChange(songPreviewState);
    else if (section === "biblias") onPreviewChange(previewState);
    else if (section === "iglesia") onPreviewChange(logoPreviewState);
    else onPreviewChange(null);
    return () => onPreviewChange(null);
  }, [section, songStyle, bible, church, state, onPreviewChange, layout, layoutPreview, sampleLength]);
  useEffect(() => {
    onDisplayPreviewChange(section === "pantalla" ? settings : null);
    return () => onDisplayPreviewChange(null);
  }, [section, settings, onDisplayPreviewChange]);

  /* ---------------- Actualizaciones ---------------- */

  const updateBusy = updateStatus?.state === "checking" || updateStatus?.state === "downloading";
  const updateButtonLabel =
    updateStatus?.state === "available"
      ? "Descargar actualización"
      : updateStatus?.state === "downloaded"
        ? "Instalar y reiniciar"
        : updateStatus?.state === "checking"
          ? "Comprobando…"
          : updateStatus?.state === "downloading"
            ? `Descargando ${updateStatus.progress ?? 0} %`
            : updateStatus?.state === "development"
              ? "No disponible en pruebas"
              : "Buscar actualizaciones";
  const updateStatusTitle =
    updateStatus?.state === "available"
      ? `Versión ${updateStatus.availableVersion} disponible`
      : updateStatus?.state === "downloaded"
        ? "Lista para instalar"
        : updateStatus?.state === "downloading"
          ? "Descargando actualización"
          : updateStatus?.state === "checking"
            ? "Buscando actualizaciones"
            : updateStatus?.state === "current"
              ? "Estás al día"
              : updateStatus?.state === "development"
                ? "Modo de prueba"
                : updateStatus?.state === "error"
                  ? "No se pudo comprobar"
                  : "Sin comprobar";
  const runUpdateAction = async () => {
    if (updateStatus?.state === "available") {
      setUpdateStatus(await window.flProyector.downloadUpdate());
      return;
    }
    if (updateStatus?.state === "downloaded") {
      await window.flProyector.installUpdate();
      return;
    }
    setUpdateStatus(await window.flProyector.checkForUpdates());
  };
  const openReleaseHistory = async () => {
    setReleaseHistoryOpen(true);
    setReleaseHistoryLoading(true);
    try {
      setReleaseHistory(await window.flProyector.getReleaseHistory());
    } finally {
      setReleaseHistoryLoading(false);
    }
  };

  const navSection: Section = section === "biblias" || section === "canciones" ? "texto" : section;
  const current = sections.find((item) => item.id === navSection)!;
  const savable = section in dirty;

  /* ------------------------------------------------------------------------ */

  return (
    <section className="settings-page w11-settings">
      <aside className="w11-settings-nav" aria-label="Secciones de ajustes">
        <h2>Ajustes</h2>
        <nav>
          {sections.map((item) => {
            const active = navSection === item.id;
            const itemDirty =
              item.id === "texto" ? textTabs.some((tab) => dirty[tab.id]) : dirty[item.id];
            return (
              <button
                type="button"
                key={item.id}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => setSection(item.id)}
              >
                {item.id === "tema" ? (theme === "dark" ? <Moon /> : <Sun />) : item.icon}
                <span>{item.label}</span>
                {itemDirty && <i className="w11-dirty-dot" title="Cambios sin guardar" />}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="w11-settings-body">
        <div className="w11-settings-scroll">
          <header className="w11-page-header">
            <span className="w11-breadcrumb">Ajustes</span>
            <h1>{current.label}</h1>
            <p>{current.description}</p>
            {navSection === "texto" && (
              <nav className="w11-pivot" aria-label="Partes de Texto en pantalla">
                {textTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    className={section === tab.id ? "active" : ""}
                    aria-current={section === tab.id ? "page" : undefined}
                    onClick={() => setSection(tab.id)}
                  >
                    {tab.label}
                    {dirty[tab.id] && <i className="w11-dirty-dot" title="Cambios sin guardar" />}
                  </button>
                ))}
              </nav>
            )}
          </header>

          {/* ============================ PANTALLAS ============================ */}
          {section === "pantalla" && (
            <>
              <SettingsGroup title="Salida principal">
                <SettingRow
                  icon={<MonitorCog />}
                  title="Pantalla del proyector"
                  description={
                    displays.length > 1
                      ? "Monitor o proyector donde se muestra la proyección."
                      : "Conectá el proyector para poder elegirlo. Mientras tanto se usa esta pantalla."
                  }
                >
                  <select
                    className="w11-select wide"
                    aria-label="Pantalla del proyector"
                    value={settings.mainDisplayId ?? ""}
                    onChange={(e) =>
                      setSettings((value) => ({
                        ...value,
                        mainDisplayId: e.target.value ? Number(e.target.value) : null,
                        aspectRatio: "auto",
                      }))
                    }
                  >
                    <option value="">Detectar automáticamente</option>
                    {displays.map((display) => (
                      <option value={display.id} key={display.id}>
                        {displayLabel(display)}
                      </option>
                    ))}
                  </select>
                </SettingRow>
                <SettingRow
                  title="Relación de aspecto"
                  description="Automática usa la forma real del monitor elegido."
                >
                  <Select
                    label="Relación de aspecto"
                    value={settings.aspectRatio as "auto" | "16:9" | "16:10" | "4:3"}
                    onChange={(aspectRatio) => setSettings((value) => ({ ...value, aspectRatio }))}
                    options={[
                      { value: "auto", label: "Automática" },
                      { value: "16:9", label: "16:9 (panorámica)" },
                      { value: "16:10", label: "16:10" },
                      { value: "4:3", label: "4:3 (proyector clásico)" },
                    ]}
                  />
                </SettingRow>
                <SettingRow title="Resolución de salida" description="Nativa aprovecha toda la nitidez del proyector.">
                  <Select
                    label="Resolución"
                    value={settings.resolution}
                    onChange={(resolution) => setSettings((value) => ({ ...value, resolution }))}
                    options={[
                      { value: "display", label: "Nativa de la pantalla" },
                      { value: "1920x1080", label: "1920 × 1080 (Full HD)" },
                      { value: "1280x720", label: "1280 × 720 (HD)" },
                      { value: "1024x768", label: "1024 × 768" },
                    ]}
                  />
                </SettingRow>
                <SettingRow title="Color sin contenido" description="Se ve cuando no hay fondo ni texto en el aire.">
                  <ColorPicker
                    label="Color sin contenido"
                    value={settings.backgroundColor}
                    colors={backgroundColors}
                    onChange={(backgroundColor) => setSettings((value) => ({ ...value, backgroundColor }))}
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Salidas adicionales">
                <SettingExpander
                  title="Tercera pantalla"
                  description={
                    availableThirdDisplays.length
                      ? "Duplica la proyección en otro monitor externo (por ejemplo, para el escenario)."
                      : "Necesitás dos pantallas externas conectadas para usar esta salida."
                  }
                  disabled={!availableThirdDisplays.length}
                  control={
                    <Toggle
                      label="Tercera pantalla"
                      checked={settings.thirdDisplayEnabled}
                      disabled={!availableThirdDisplays.length}
                      onChange={(thirdDisplayEnabled) =>
                        setSettings((value) => ({
                          ...value,
                          thirdDisplayEnabled,
                          thirdDisplayId: thirdDisplayEnabled
                            ? value.thirdDisplayId ?? availableThirdDisplays[0]?.id ?? null
                            : value.thirdDisplayId,
                        }))
                      }
                    />
                  }
                >
                  <SettingRow title="Monitor" disabled={!settings.thirdDisplayEnabled}>
                    <select
                      className="w11-select wide"
                      aria-label="Tercera pantalla"
                      disabled={!settings.thirdDisplayEnabled}
                      value={settings.thirdDisplayId ?? ""}
                      onChange={(e) =>
                        setSettings((value) => ({
                          ...value,
                          thirdDisplayId: e.target.value ? Number(e.target.value) : null,
                        }))
                      }
                    >
                      <option value="">Seleccionar pantalla</option>
                      {availableThirdDisplays.map((display) => (
                        <option value={display.id} key={display.id}>
                          {displayLabel(display)}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                </SettingExpander>
                <SettingExpander
                  title="Pantalla de vista previa"
                  description="Muestra lo que estás preparando con el formato real del proyector."
                  control={
                    <Toggle
                      label="Pantalla de vista previa"
                      checked={settings.previewEnabled}
                      onChange={(previewEnabled) =>
                        setSettings((value) => ({
                          ...value,
                          previewEnabled,
                          previewDisplayId: previewEnabled ? value.previewDisplayId : null,
                        }))
                      }
                    />
                  }
                >
                  <SettingRow title="Dónde mostrarla" disabled={!settings.previewEnabled}>
                    <select
                      className="w11-select wide"
                      aria-label="Ubicación de la vista previa"
                      disabled={!settings.previewEnabled}
                      value={settings.previewDisplayId ?? ""}
                      onChange={(event) =>
                        setSettings((value) => ({
                          ...value,
                          previewDisplayId: event.target.value ? Number(event.target.value) : null,
                        }))
                      }
                    >
                      <option value="">Ventana flotante en esta computadora</option>
                      {availablePreviewDisplays.map((display) => (
                        <option value={display.id} key={display.id}>
                          {displayLabel(display)}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                </SettingExpander>
              </SettingsGroup>

              <SettingsGroup title="Monitores detectados">
                {displays.length ? (
                  displays.map((display) => (
                    <SettingRow
                      key={display.id}
                      icon={<MonitorCog />}
                      title={display.label}
                      description={`${display.width} × ${display.height}${
                        display.scaleFactor !== 1 ? ` · escala ${Math.round(display.scaleFactor * 100)} %` : ""
                      }`}
                    >
                      <span className="w11-tag">
                        {display.id === effectiveMainDisplay?.id && displays.length > 1
                          ? "Proyector"
                          : display.primary
                            ? "Esta computadora"
                            : "Externo"}
                      </span>
                    </SettingRow>
                  ))
                ) : (
                  <SettingRow title="No se detectaron monitores" description="Revisá la conexión del cable o del proyector." />
                )}
              </SettingsGroup>
            </>
          )}

          {/* ======================== TEXTO EN PANTALLA ======================== */}
          {section === "texto" && (
            <>

              <SettingsGroup title="Letra">
                <SettingRow title="Tipo de letra">
                  <FontSelect
                    label="Tipo de letra"
                    value={layout.fontFamily}
                    onChange={(fontFamily) => setLayout((value) => ({ ...value, fontFamily }))}
                  />
                </SettingRow>
                <SettingRow title="Color">
                  <ColorPicker
                    label="Color del texto"
                    value={layout.textColor}
                    colors={textColors}
                    onChange={(textColor) => setLayout((value) => ({ ...value, textColor }))}
                  />
                </SettingRow>
                <SettingRow title="Todo en mayúsculas" description="Solo cambia lo que se proyecta.">
                  <Toggle
                    label="Todo en mayúsculas"
                    checked={layout.uppercase}
                    onChange={(uppercase) => setLayout((value) => ({ ...value, uppercase }))}
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Tamaño">
                <SettingRow
                  icon={<Type />}
                  title="Tamaño normal"
                  description="El tamaño de lectura habitual. «Calcular» elige el que aprovecha toda el área con un versículo de largo típico."
                >
                  <button type="button" className="w11-button" onClick={calculateIdealSize}>
                    <Sparkles aria-hidden="true" /> Calcular
                  </button>
                  <NumberBox
                    label="Tamaño normal"
                    value={layout.size}
                    min={24}
                    max={200}
                    suffix="px"
                    onChange={(size) => setLayout((value) => ({ ...value, size }))}
                  />
                </SettingRow>
                <SettingRow title="Agrandar textos cortos hasta" description="Cuánto más grande puede verse un texto que sobra espacio.">
                  <Select
                    label="Agrandar textos cortos hasta"
                    value={String(layout.growPercent) as "0"}
                    onChange={(growPercent) => setLayout((value) => ({ ...value, growPercent: Number(growPercent) }))}
                    options={[0, 10, 15, 25, 40].map((percent) => ({
                      value: String(percent) as "0",
                      label: percent === 0 ? "No agrandar" : `${percent} % más`,
                    }))}
                  />
                </SettingRow>
                <SettingRow
                  title="Achicar textos largos hasta"
                  description="Si un texto necesita achicarse más que esto, se divide en partes en lugar de quedar chico."
                >
                  <Select
                    label="Achicar textos largos hasta"
                    value={String(layout.shrinkPercent) as "0"}
                    onChange={(shrinkPercent) => setLayout((value) => ({ ...value, shrinkPercent: Number(shrinkPercent) }))}
                    options={[10, 15, 20, 30, 40].map((percent) => ({
                      value: String(percent) as "0",
                      label: `${percent} % menos`,
                    }))}
                  />
                </SettingRow>
                <div className="w11-size-band" aria-label="Rango de tamaño resultante">
                  <span>
                    <small>Mínimo</small>
                    <strong>{Math.round(layoutBand.floor)} px</strong>
                  </span>
                  <i aria-hidden="true">
                    <b
                      style={{
                        left: `${(layoutBand.floor / layoutBand.ceiling) * 100}%`,
                        width: `${100 - (layoutBand.floor / layoutBand.ceiling) * 100}%`,
                      }}
                    />
                    <em style={{ left: `${(layoutBand.normal / layoutBand.ceiling) * 100}%` }} />
                  </i>
                  <span>
                    <small>Normal</small>
                    <strong>{Math.round(layoutBand.normal)} px</strong>
                  </span>
                  <span>
                    <small>Máximo</small>
                    <strong>{Math.round(layoutBand.ceiling)} px</strong>
                  </span>
                </div>
              </SettingsGroup>

              <SettingsGroup title="Área de la pantalla">
                <SettingRow title="Margen lateral" description="Espacio libre a izquierda y derecha. Menos margen = más texto por línea.">
                  <NumberBox
                    label="Margen lateral"
                    value={layout.horizontalMargin}
                    min={2}
                    max={25}
                    suffix="%"
                    onChange={(horizontalMargin) => setLayout((value) => ({ ...value, horizontalMargin }))}
                  />
                </SettingRow>
                <SettingRow title="Margen vertical" description="Espacio libre arriba y abajo. La cita bíblica queda fuera de esta zona.">
                  <NumberBox
                    label="Margen vertical"
                    value={layout.verticalMargin}
                    min={2}
                    max={25}
                    suffix="%"
                    onChange={(verticalMargin) => setLayout((value) => ({ ...value, verticalMargin }))}
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Textos largos">
                <SettingRow
                  icon={<BookOpen />}
                  title="Versículos que no entran"
                  description="Dividir busca el mejor corte (punto, punto y coma, coma o «porque», «pero»…) y deja las dos partes del mismo tamaño."
                >
                  <Select
                    label="Versículos que no entran"
                    value={layout.longVerseMode}
                    onChange={(longVerseMode) => setLayout((value) => ({ ...value, longVerseMode }))}
                    options={[
                      { value: "split-halves", label: "Dividir en A y B" },
                      { value: "auto-fit", label: "Achicar hasta que entre" },
                    ]}
                  />
                </SettingRow>
                <SettingRow
                  icon={<Music2 />}
                  title="Mismo tamaño en toda la canción"
                  description="Todas las estrofas usan un solo tamaño. Si una es mucho más larga, solo esa se achica."
                >
                  <Toggle
                    label="Mismo tamaño en toda la canción"
                    checked={layout.stableSongSize}
                    onChange={(stableSongSize) => setLayout((value) => ({ ...value, stableSongSize }))}
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup
                title="Probar con ejemplos"
                action={
                  <div className="w11-segmented" role="radiogroup" aria-label="Tipo de texto de prueba">
                    {(
                      [
                        ["biblia", "Biblia"],
                        ["canto", "Canción"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={layoutPreview === value}
                        className={layoutPreview === value ? "active" : ""}
                        key={value}
                        onClick={() => setLayoutPreview(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                }
              >
                <div className="w11-sample-grid" role="radiogroup" aria-label="Largo del ejemplo">
                  {samplePlans.map(({ length, plan }) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sampleLength === length}
                      className={sampleLength === length ? "active" : ""}
                      key={length}
                      onClick={() => setSampleLength(length)}
                    >
                      <strong>{length === "corto" ? "Texto corto" : length === "normal" ? "Texto normal" : "Texto largo"}</strong>
                      {layoutPreview === "biblia" ? (
                        <small>
                          {plan.parts.length > 1 ? "Se divide en A y B" : "Una pantalla"} · {Math.round(plan.fontSize)} px
                        </small>
                      ) : (
                        <small>Mirá la vista previa</small>
                      )}
                    </button>
                  ))}
                </div>
                <p className="w11-group-note">
                  La vista previa de la derecha muestra el ejemplo elegido con la pantalla real del proyector.
                </p>
              </SettingsGroup>
            </>
          )}

          {/* ============================ IGLESIA ============================ */}
          {section === "iglesia" && (
            <>
              <SettingsGroup title="Información">
                <SettingRow
                  icon={<Building2 />}
                  title="Nombre de la iglesia"
                  description="Aparece debajo del logo centrado."
                >
                  <input
                    className="w11-text wide"
                    aria-label="Nombre de la iglesia"
                    value={church.name}
                    onChange={(event) => setChurch((value) => ({ ...value, name: event.target.value }))}
                    placeholder="Ej. Iglesia Fuente de Vida"
                  />
                </SettingRow>
                <SettingRow title="Dirección" description="Opcional. Se muestra junto al logo centrado.">
                  <input
                    className="w11-text wide"
                    aria-label="Dirección"
                    value={church.address}
                    onChange={(event) => setChurch((value) => ({ ...value, address: event.target.value }))}
                    placeholder="Ej. Av. Colón 1234"
                  />
                </SettingRow>
                <SettingRow title="Ciudad" description="Opcional.">
                  <input
                    className="w11-text wide"
                    aria-label="Ciudad"
                    value={church.city}
                    onChange={(event) => setChurch((value) => ({ ...value, city: event.target.value }))}
                    placeholder="Ej. Córdoba"
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Logo para la proyección">
                <div className="w11-row w11-logo-row">
                  <div
                    className={`w11-logo-preview ${church.logoMode}`}
                    style={{ backgroundColor: church.logoBackgroundColor }}
                  >
                    {church.logoUrl ? (
                      <img src={church.logoUrl} alt={church.name.trim() || "Logo de la iglesia"} />
                    ) : (
                      <span>
                        <ImageIcon aria-hidden="true" />
                        Sin logo
                      </span>
                    )}
                  </div>
                  <div className="w11-row-copy">
                    <strong>{church.logoUrl ? "Logo cargado" : "Todavía no cargaste un logo"}</strong>
                    <small>PNG con fondo transparente o JPG. Se muestra con el botón «Mostrar logo».</small>
                  </div>
                  <div className="w11-row-control">
                    {church.logoUrl && (
                      <button
                        type="button"
                        className="w11-button subtle"
                        onClick={() => setChurch((value) => ({ ...value, logoPath: null, logoUrl: null }))}
                      >
                        <Trash2 aria-hidden="true" /> Quitar
                      </button>
                    )}
                    <button type="button" className="w11-button" onClick={chooseLogo}>
                      <Upload aria-hidden="true" /> {church.logoUrl ? "Cambiar" : "Cargar imagen"}
                    </button>
                  </div>
                </div>
                <SettingRow title="Forma de mostrarlo" description="Centrado deja espacio para el nombre; pantalla completa ocupa todo.">
                  <Select
                    label="Forma de mostrar el logo"
                    value={church.logoMode}
                    onChange={(logoMode) => setChurch((value) => ({ ...value, logoMode }))}
                    options={[
                      { value: "centered", label: "Centrado con nombre" },
                      { value: "fullscreen", label: "Pantalla completa" },
                    ]}
                  />
                </SettingRow>
                <SettingRow title="Color de fondo" description="Color detrás del logo.">
                  <ColorPicker
                    label="Color de fondo del logo"
                    value={church.logoBackgroundColor}
                    colors={["#090b10", ...backgroundColors.slice(1), "#ffffff"]}
                    onChange={(logoBackgroundColor) => setChurch((value) => ({ ...value, logoBackgroundColor }))}
                  />
                </SettingRow>
              </SettingsGroup>
            </>
          )}

          {/* ============================ BIBLIAS ============================ */}
          {section === "biblias" && (
            <>
              <SettingsGroup
                title="Versiones instaladas"
                action={
                  <button type="button" className="w11-button" onClick={importBible}>
                    <Download aria-hidden="true" /> Importar XML o JSON
                  </button>
                }
              >
                {versions.map((version) => {
                  const enabled = version.enabled !== false;
                  const lastEnabled = enabled && enabledVersions <= 1;
                  return (
                    <SettingRow
                      key={version.id}
                      icon={<BookOpen />}
                      title={version.name}
                      description={`${version.code} · ${version.language.toUpperCase()}${
                        lastEnabled ? " · Tiene que quedar al menos una activa" : ""
                      }`}
                    >
                      <Toggle
                        label={`Mostrar ${version.name} en el operador bíblico`}
                        checked={enabled}
                        disabled={lastEnabled}
                        onChange={async (checked) => {
                          await window.flProyector.setBibleVersionEnabled(version.id, checked);
                          reloadVersions();
                        }}
                      />
                    </SettingRow>
                  );
                })}
                {!versions.length && (
                  <SettingRow title="Todavía no importaste una Biblia" description="Usá «Importar XML o JSON» para agregar una versión." />
                )}
                <p className="w11-group-note">Activar o desactivar una versión se aplica al instante.</p>
              </SettingsGroup>

              <SettingsGroup title="Cita bíblica">
                <SettingRow title="Mostrar la cita" description="Libro, capítulo y versículo (ej. Juan 3:16).">
                  <Toggle
                    label="Mostrar la cita"
                    checked={bible.showReference}
                    onChange={(showReference) => setBible((v) => ({ ...v, showReference }))}
                  />
                </SettingRow>
                <SettingRow title="Mostrar la versión" description="Agrega la sigla, por ejemplo RVR1960." disabled={!bible.showReference}>
                  <Toggle
                    label="Mostrar la versión"
                    checked={bible.showVersion}
                    disabled={!bible.showReference}
                    onChange={(showVersion) => setBible((v) => ({ ...v, showVersion }))}
                  />
                </SettingRow>
                <SettingRow title="Ubicación" disabled={!bible.showReference}>
                  <Select
                    label="Ubicación de la cita"
                    value={bible.referencePosition}
                    disabled={!bible.showReference}
                    onChange={(referencePosition) => setBible((v) => ({ ...v, referencePosition }))}
                    options={[
                      { value: "before", label: "Arriba (encabezado)" },
                      { value: "after", label: "Abajo (pie de pantalla)" },
                    ]}
                  />
                </SettingRow>
                <SettingExpander
                  title="Diseño del zócalo"
                  description={referenceDesigns.find((design) => design.value === bible.referenceStyle)?.label}
                  disabled={!bible.showReference}
                >
                  <div className="w11-design-grid">
                    {referenceDesigns.map((design) => (
                      <button
                        type="button"
                        className={bible.referenceStyle === design.value ? "active" : ""}
                        aria-pressed={bible.referenceStyle === design.value}
                        onClick={() => setBible((value) => ({ ...value, referenceStyle: design.value }))}
                        key={design.value}
                      >
                        <i className={`reference-design-sample ${design.value}`}>Juan 3:16</i>
                        <strong>{design.label}</strong>
                        <small>{design.detail}</small>
                      </button>
                    ))}
                  </div>
                </SettingExpander>
                <SettingRow title="Tipo de letra" disabled={!bible.showReference}>
                  <FontSelect
                    label="Tipo de letra de la cita"
                    value={bible.referenceFontFamily}
                    onChange={(referenceFontFamily) => setBible((v) => ({ ...v, referenceFontFamily }))}
                  />
                </SettingRow>
                <SettingRow title="Tamaño" description="Entre 10 y 120 px." disabled={!bible.showReference}>
                  <NumberBox
                    label="Tamaño de la cita"
                    value={bible.referenceFontSize}
                    min={10}
                    max={120}
                    suffix="px"
                    onChange={(referenceFontSize) => setBible((v) => ({ ...v, referenceFontSize }))}
                  />
                </SettingRow>
                <SettingRow title="Color del texto" disabled={!bible.showReference}>
                  <ColorPicker
                    label="Color de la cita"
                    value={bible.referenceColor}
                    colors={textColors}
                    onChange={(referenceColor) => setBible((v) => ({ ...v, referenceColor }))}
                  />
                </SettingRow>
                <SettingRow title="Color del zócalo" disabled={!bible.showReference}>
                  <ColorPicker
                    label="Color del zócalo"
                    value={bible.referenceBackground}
                    colors={backgroundColors}
                    clearValue="transparent"
                    onChange={(referenceBackground) => setBible((v) => ({ ...v, referenceBackground }))}
                  />
                </SettingRow>
                <SettingRow title="Animación de entrada" disabled={!bible.showReference}>
                  <Select
                    label="Animación de la cita"
                    value={bible.referenceAnimation}
                    disabled={!bible.showReference}
                    onChange={(referenceAnimation) => setBible((v) => ({ ...v, referenceAnimation }))}
                    options={[
                      { value: "none", label: "Sin movimiento" },
                      { value: "fade", label: "Aparecer suavemente" },
                      { value: "slide-left", label: "Desde la izquierda" },
                      { value: "slide-up", label: "Desde abajo" },
                      { value: "zoom", label: "Zoom suave" },
                    ]}
                  />
                </SettingRow>
              </SettingsGroup>

              <SettingsGroup title="Lectura sobre fondos">
                <SettingExpander
                  title="Sombra del texto"
                  description="Mejora la lectura sobre imágenes y videos."
                  control={
                    <Toggle
                      label="Sombra del texto"
                      checked={bible.textShadowEnabled}
                      onChange={(textShadowEnabled) => setBible((v) => ({ ...v, textShadowEnabled }))}
                    />
                  }
                >
                  <SettingRow title="Color de la sombra" disabled={!bible.textShadowEnabled}>
                    <ColorPicker
                      label="Color de la sombra"
                      value={bible.textShadowColor}
                      colors={shadowColors}
                      onChange={(textShadowColor) => setBible((v) => ({ ...v, textShadowColor }))}
                    />
                  </SettingRow>
                  <SettingRow title="Intensidad" description="De 0 a 40." disabled={!bible.textShadowEnabled}>
                    <NumberBox
                      label="Intensidad de la sombra"
                      value={bible.textShadowBlur}
                      min={0}
                      max={40}
                      onChange={(textShadowBlur) => setBible((v) => ({ ...v, textShadowBlur }))}
                    />
                  </SettingRow>
                </SettingExpander>
              </SettingsGroup>

            </>
          )}

          {/* ============================ CANCIONES ============================ */}
          {section === "canciones" && (
            <>
              <SettingsGroup title="Ubicación y fondo">
                <SettingRow title="Posición">
                  <Select
                    label="Posición de la letra"
                    value={songStyle.position}
                    onChange={(position) => setSongStyle((value) => ({ ...value, position }))}
                    options={[
                      { value: "top", label: "Arriba" },
                      { value: "center", label: "Centro" },
                      { value: "bottom", label: "Abajo" },
                      { value: "lower", label: "Zócalo inferior" },
                    ]}
                  />
                </SettingRow>
                <SettingRow title="Alineación">
                  <div className="w11-segmented" role="radiogroup" aria-label="Alineación">
                    {(
                      [
                        ["left", "Izquierda"],
                        ["center", "Centro"],
                        ["right", "Derecha"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={songStyle.align === value}
                        className={songStyle.align === value ? "active" : ""}
                        key={value}
                        onClick={() => setSongStyle((style) => ({ ...style, align: value }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow title="Fondo detrás de la letra">
                  <Select
                    label="Fondo detrás de la letra"
                    value={songStyle.template}
                    onChange={(template) =>
                      setSongStyle((value) => ({
                        ...value,
                        template,
                        backgroundColor:
                          template !== "plain" && isTransparentColor(value.backgroundColor)
                            ? defaultSongPanelColor
                            : value.backgroundColor,
                      }))
                    }
                    options={[
                      { value: "plain", label: "Sin fondo" },
                      { value: "classic", label: "Clásico" },
                      { value: "accent", label: "Acento" },
                      { value: "glass", label: "Cristal" },
                      { value: "solid", label: "Sólido" },
                      { value: "gradient", label: "Degradado" },
                    ]}
                  />
                </SettingRow>
                {songStyle.template !== "plain" && (
                  <SettingRow title="Color del fondo">
                    <ColorPicker
                      label="Color del fondo de la letra"
                      value={hexOrNull(songStyle.backgroundColor) ?? defaultSongPanelColor}
                      colors={backgroundColors}
                      onChange={(backgroundColor) => setSongStyle((value) => ({ ...value, backgroundColor }))}
                    />
                  </SettingRow>
                )}
              </SettingsGroup>

              <SettingsGroup title="Título de la canción">
                <SettingExpander
                  title="Mostrar el título"
                  description="Muestra el nombre de la canción mientras se proyecta la letra."
                  control={
                    <Toggle
                      label="Mostrar el título"
                      checked={songStyle.showTitle}
                      onChange={(showTitle) => setSongStyle((value) => ({ ...value, showTitle }))}
                    />
                  }
                >
                  <SettingRow title="Ubicación" disabled={!songStyle.showTitle}>
                    <Select
                      label="Ubicación del título"
                      value={songStyle.titlePosition}
                      disabled={!songStyle.showTitle}
                      onChange={(titlePosition) => setSongStyle((value) => ({ ...value, titlePosition }))}
                      options={[
                        { value: "top", label: "Arriba" },
                        { value: "center", label: "Centro" },
                        { value: "bottom", label: "Abajo" },
                      ]}
                    />
                  </SettingRow>
                  <SettingRow title="Tipo de letra" disabled={!songStyle.showTitle}>
                    <FontSelect
                      label="Tipo de letra del título"
                      value={songStyle.titleFontFamily}
                      onChange={(titleFontFamily) => setSongStyle((value) => ({ ...value, titleFontFamily }))}
                    />
                  </SettingRow>
                  <SettingRow title="Tamaño" disabled={!songStyle.showTitle}>
                    <NumberBox
                      label="Tamaño del título"
                      value={songStyle.titleFontSize}
                      min={14}
                      max={96}
                      suffix="px"
                      onChange={(titleFontSize) => setSongStyle((value) => ({ ...value, titleFontSize }))}
                    />
                  </SettingRow>
                  <SettingRow title="Color del texto" disabled={!songStyle.showTitle}>
                    <ColorPicker
                      label="Color del título"
                      value={songStyle.titleColor}
                      colors={textColors}
                      onChange={(titleColor) => setSongStyle((value) => ({ ...value, titleColor }))}
                    />
                  </SettingRow>
                  <SettingRow title="Diseño del zócalo" disabled={!songStyle.showTitle}>
                    <Select
                      label="Diseño del zócalo del título"
                      value={songStyle.titleStyle}
                      disabled={!songStyle.showTitle}
                      onChange={(titleStyle) => setSongStyle((value) => ({ ...value, titleStyle }))}
                      options={[
                        { value: "none", label: "Sin zócalo" },
                        { value: "bar", label: "Franja clásica" },
                        { value: "pill", label: "Pastilla" },
                        { value: "glass", label: "Cristal" },
                        { value: "ribbon", label: "Cinta" },
                        { value: "accent", label: "Acento lateral" },
                      ]}
                    />
                  </SettingRow>
                  {songStyle.titleStyle !== "none" && (
                    <SettingRow title="Color del zócalo" disabled={!songStyle.showTitle}>
                      <ColorPicker
                        label="Color del zócalo del título"
                        value={songStyle.titleBackground}
                        colors={backgroundColors}
                        clearValue="transparent"
                        onChange={(titleBackground) => setSongStyle((value) => ({ ...value, titleBackground }))}
                      />
                    </SettingRow>
                  )}
                </SettingExpander>
              </SettingsGroup>
            </>
          )}

          {/* ============================ APARIENCIA ============================ */}
          {section === "tema" && (
            <SettingsGroup title="Tema de la aplicación">
              <div className="w11-theme-grid" role="radiogroup" aria-label="Tema">
                {(
                  [
                    ["dark", "Oscuro", "Recomendado para operar en vivo con poca luz", <Moon key="m" />],
                    ["light", "Claro", "Interfaz luminosa para preparar durante el día", <Sun key="s" />],
                  ] as const
                ).map(([value, label, detail, icon]) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={theme === value}
                    className={`w11-theme-card ${value} ${theme === value ? "active" : ""}`}
                    onClick={() => setTheme(value)}
                    key={value}
                  >
                    <span className="w11-theme-sample" aria-hidden="true">
                      <i />
                      <b />
                      <b />
                    </span>
                    <span className="w11-theme-copy">
                      {icon}
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                  </button>
                ))}
              </div>
              <p className="w11-group-note">El tema se aplica al instante. La proyección no cambia.</p>
            </SettingsGroup>
          )}

          {/* ============================ ATAJOS ============================ */}
          {section === "atajos" && (
            <SettingsGroup
              title="Teclas rápidas"
              action={
                <button
                  type="button"
                  className="w11-button subtle"
                  onClick={() => {
                    setShortcuts({ ...defaultShortcuts });
                    setShortcutError("");
                  }}
                >
                  <RefreshCw aria-hidden="true" /> Restaurar predeterminados
                </button>
              }
            >
              <p className="w11-group-note top">
                Hacé clic en una tecla y presioná la nueva: una letra o número, solo o con Alt. Los atajos no
                funcionan mientras escribís en un campo.
              </p>
              {(Object.keys(shortcutLabels) as ShortcutAction[]).map((action) => (
                <SettingRow
                  key={action}
                  title={shortcutLabels[action]}
                  description={
                    shortcuts[action].toLowerCase() !== defaultShortcuts[action].toLowerCase()
                      ? `Predeterminado: ${defaultShortcuts[action]}`
                      : undefined
                  }
                >
                  <input
                    className="w11-keycap"
                    value={shortcuts[action]}
                    readOnly
                    aria-label={`${shortcutLabels[action]}: ${shortcuts[action]}. Presioná una tecla para cambiarlo.`}
                    onPaste={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      if (event.key === "Tab") return;
                      event.preventDefault();
                      const shortcut = shortcutFromKeyEvent(event.nativeEvent);
                      if (!shortcut) {
                        setShortcutError("Usá una letra o un número, solo o con Alt. No se permiten Ctrl ni Shift.");
                        return;
                      }
                      const duplicate = (Object.keys(shortcuts) as ShortcutAction[]).find(
                        (other) => other !== action && shortcuts[other].toLowerCase() === shortcut.toLowerCase(),
                      );
                      if (duplicate) {
                        setShortcutError(`${shortcut} ya está asignado a «${shortcutLabels[duplicate]}». Elegí otra tecla.`);
                        return;
                      }
                      setShortcutError("");
                      setShortcuts((value) => ({ ...value, [action]: shortcut }));
                    }}
                  />
                </SettingRow>
              ))}
              {shortcutError && (
                <p className="w11-infobar error" role="alert">
                  {shortcutError}
                </p>
              )}
            </SettingsGroup>
          )}

          {/* ============================ ACTUALIZACIONES ============================ */}
          {section === "version" && (
            <>
              <SettingsGroup>
                <div className={`w11-row w11-update-hero ${updateStatus?.state ?? "idle"}`}>
                  <span className="w11-update-icon" aria-hidden="true">
                    {updateBusy ? <RefreshCw className="version-update-spin" /> : <Download />}
                  </span>
                  <div className="w11-row-copy">
                    <strong>{updateStatusTitle}</strong>
                    <small>{updateStatus?.message ?? "Preparando el actualizador…"}</small>
                  </div>
                  <div className="w11-row-control">
                    <button
                      type="button"
                      className="w11-button accent"
                      disabled={updateBusy || !updateStatus || updateStatus.state === "development"}
                      onClick={runUpdateAction}
                    >
                      {updateButtonLabel}
                    </button>
                  </div>
                </div>
                {updateStatus?.state === "downloading" && (
                  <div className="w11-progress" aria-label={`Descarga ${updateStatus.progress ?? 0} %`}>
                    <i style={{ width: `${updateStatus.progress ?? 0}%` }} />
                  </div>
                )}
              </SettingsGroup>
              <SettingsGroup title="Acerca de">
                <SettingRow
                  icon={<BadgeInfo />}
                  title="FL Proyector"
                  description={`Versión instalada: ${updateStatus?.currentVersion ?? "—"}`}
                >
                  <button type="button" className="w11-button" onClick={openReleaseHistory}>
                    <History aria-hidden="true" /> Ver novedades
                  </button>
                </SettingRow>
                <p className="w11-group-note">
                  Al actualizar, tus reuniones, canciones y configuraciones se conservan.
                </p>
              </SettingsGroup>
            </>
          )}
        </div>

        {savable && (
          <SaveBar dirty={Boolean(dirty[section])} saving={saving} onSave={saveCurrent} onDiscard={discardCurrent} />
        )}
      </div>

      {releaseHistoryOpen && (
        <div className="modal-backdrop version-history-backdrop" onMouseDown={() => setReleaseHistoryOpen(false)}>
          <div
            className="version-history-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-history-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <span className="version-product-icon">
                <History />
              </span>
              <div>
                <span className="eyebrow">Historial de versiones</span>
                <h2 id="version-history-title">Novedades de FL Proyector</h2>
              </div>
              <button
                type="button"
                className="dialog-close"
                aria-label="Cerrar"
                onClick={() => setReleaseHistoryOpen(false)}
              >
                <X />
              </button>
            </header>
            <div className="version-history-list">
              {releaseHistoryLoading ? (
                <div className="version-history-empty">
                  <RefreshCw className="version-update-spin" />
                  Cargando versiones…
                </div>
              ) : releaseHistory.length ? (
                releaseHistory.map((release, index) => (
                  <article className="version-history-entry" key={release.version}>
                    <div className="version-history-heading">
                      <span>Versión {release.version}</span>
                      {index === 0 && <em>Más reciente</em>}
                      <time>
                        {release.publishedAt
                          ? new Intl.DateTimeFormat("es-AR", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            }).format(new Date(release.publishedAt))
                          : "Fecha no disponible"}
                      </time>
                    </div>
                    <h3>{release.title}</h3>
                    <ul>
                      {release.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </article>
                ))
              ) : (
                <div className="version-history-empty">No se pudo cargar el historial.</div>
              )}
            </div>
            <footer>
              <span>Las novedades se leen de las versiones publicadas en GitHub.</span>
              <button type="button" className="primary" onClick={() => setReleaseHistoryOpen(false)}>
                Cerrar
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
