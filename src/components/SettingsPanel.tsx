import { useEffect, useState } from "react";
import {
  BadgeInfo,
  BookOpen,
  Building2,
  Download,
  History,
  MonitorCog,
  Moon,
  Music2,
  RefreshCw,
  Save,
  Upload,
  X,
  Sun,
} from "lucide-react";
import {
  initialBibleDisplaySettings,
  initialChurchSettings,
  initialDisplaySettings,
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
import { projectionFonts } from "../fonts";
import { ExpanderRow } from "./ui/ExpanderRow";
import { withSaveNotification } from "./SaveNotification";

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
];
const longBiblePreviewPassage =
  "Porque de tal manera amó Dios al mundo, que ha dado á su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna. Porque no envió Dios á su Hijo al mundo, para que condene al mundo, mas para que el mundo sea salvo por él. El que en él cree, no es condenado; mas el que no cree, ya es condenado, porque no creyó en el nombre del unigénito Hijo de Dios.";

function ColorDots({
  label,
  value,
  colors,
  onChange,
  clearValue = "#ffffff",
  clearLabel = "Restablecer",
}: {
  label: string;
  value: string;
  colors: string[];
  onChange: (color: string) => void;
  clearValue?: string;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const isTransparent = value === "transparent" || value === "rgba(0,0,0,0)";
  const displayValue = isTransparent
    ? "Sin color"
    : value.startsWith("#")
      ? value.toUpperCase()
      : value;
  return (
    <div className={`bible-color-setting ${open ? "picker-open" : ""}`}>
      <span>{label}</span>
      <button
        type="button"
        className="color-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`Cambiar ${label}: ${displayValue}`}
      >
        <i
          className={isTransparent ? "transparent-swatch" : ""}
          style={isTransparent ? undefined : { backgroundColor: value }}
        />
        <code>{displayValue}</code>
      </button>
      {open && (
        <div className="color-picker-popover" role="dialog" aria-label={label}>
          <div className="color-picker-heading">
            <strong>{label}</strong>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          </div>
          <div className="color-picker-swatches">
            {colors.map((color) => (
              <button
                type="button"
                title={color}
                aria-label={`${label} ${color}`}
                className={value === color ? "active" : ""}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                key={color}
              />
            ))}
          </div>
          <label className="custom-color-input">
            Personalizado
            <input
              type="color"
              value={value.startsWith("#") ? value : "#ffffff"}
              onChange={(event) => onChange(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="clear-color-button"
            onClick={() => {
              onChange(clearValue);
              setOpen(false);
            }}
          >
            {clearLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({
  state,
  update,
  displays,
  onPreviewChange,
  onDisplayPreviewChange,
}: {
  state: ProjectionState;
  update: (patch: ProjectionPatch) => void;
  displays: DisplayInfo[];
  onPreviewChange: (preview: ProjectionState | null) => void;
  onDisplayPreviewChange: (settings: DisplaySettings | null) => void;
}) {
  const [section, setSection] = useState<
    "iglesia" | "pantalla" | "biblias" | "canciones" | "tema" | "version"
  >("pantalla");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("fl-fluent-theme-v1") &&
    localStorage.getItem("fl-interface-theme") === "dark"
      ? "dark"
      : "light",
  );
  const [settings, setSettings] = useState<DisplaySettings>(
    initialDisplaySettings,
  );
  const [church, setChurch] = useState<ChurchSettings>(initialChurchSettings);
  const [bible, setBible] = useState<BibleDisplaySettings>(
    initialBibleDisplaySettings,
  );
  const [songStyle, setSongStyle] = useState<SongDisplaySettings>(
    state.songStyle,
  );
  const [versions, setVersions] = useState<BibleVersion[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [releaseHistory, setReleaseHistory] = useState<ReleaseHistoryEntry[]>([]);
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [releaseHistoryLoading, setReleaseHistoryLoading] = useState(false);
  const [referenceDesignOpen, setReferenceDesignOpen] = useState(false);
  const reloadVersions = () =>
    window.flProyector.listBibleVersions().then(setVersions);
  useEffect(() => {
    window.flProyector.getDisplaySettings().then(setSettings);
    window.flProyector.getChurchSettings().then(setChurch);
    window.flProyector.getBibleDisplaySettings().then(setBible);
    window.flProyector.getSongDisplaySettings().then(setSongStyle);
    reloadVersions();
    window.flProyector.getUpdateStatus().then(setUpdateStatus);
    return window.flProyector.onUpdateStatus(setUpdateStatus);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("fl-interface-theme", theme);
  }, [theme]);
  const saveDisplay = async () => {
    await withSaveNotification(
      () => window.flProyector.saveDisplaySettings(settings),
      "La configuración de pantallas fue guardada.",
    );
  };
  const saveChurch = async () => {
    await withSaveNotification(async () => {
      await window.flProyector.saveChurchSettings(church);
      update({ church });
    }, "Los datos de la iglesia fueron guardados.");
  };
  const chooseLogo = async () => {
    const file = await window.flProyector.pickChurchLogo();
    if (file)
      setChurch((value) => ({
        ...value,
        logoPath: file.path,
        logoUrl: file.url,
      }));
  };
  const saveBible = async () => {
    await withSaveNotification(async () => {
      await window.flProyector.saveBibleDisplaySettings(bible);
      update({ bibleStyle: bible });
    }, "La configuración bíblica fue guardada.");
  };
  const saveSongStyle = async () => {
    await withSaveNotification(async () => {
      await window.flProyector.saveSongDisplaySettings(songStyle);
      update({ songStyle });
    }, "El diseño de canciones fue guardado.");
  };
  const importBible = async () => {
    if (await window.flProyector.importBible()) reloadVersions();
  };
  const biblePreview = buildBibleSlides(
    longBiblePreviewPassage,
    "Juan 3:16–18",
    "RV1909",
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
      fontSize:
        bible.longVerseMode === "auto-fit"
          ? bible.textFontSize
          : biblePreview.fontSize,
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

  useEffect(() => {
    if (section === "canciones") onPreviewChange(songPreviewState);
    else if (section === "biblias") onPreviewChange(previewState);
    else onPreviewChange(null);
    return () => onPreviewChange(null);
  }, [section, songStyle, bible, state, onPreviewChange]);
  useEffect(() => {
    onDisplayPreviewChange(section === "pantalla" ? settings : null);
    return () => onDisplayPreviewChange(null);
  }, [section, settings, onDisplayPreviewChange]);

  const updateBusy =
    updateStatus?.state === "checking" || updateStatus?.state === "downloading";
  const updateButtonLabel =
    updateStatus?.state === "available"
      ? "Actualizar"
      : updateStatus?.state === "downloaded"
        ? "Instalar y reiniciar"
        : updateStatus?.state === "checking"
          ? "Comprobando…"
          : updateStatus?.state === "downloading"
            ? `Descargando ${updateStatus.progress ?? 0} %`
            : updateStatus?.state === "development"
              ? "No disponible en pruebas"
            : "Comprobar actualizaciones";
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
              ? "No hay actualizaciones"
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

  return (
    <section className="settings-page">
      <aside className="settings-menu">
        <span className="eyebrow">Configuración</span>
        <button
          className={section === "pantalla" ? "active" : ""}
          onClick={() => setSection("pantalla")}
        >
          <MonitorCog />
          Pantalla
        </button>
        <button
          className={section === "iglesia" ? "active" : ""}
          onClick={() => setSection("iglesia")}
        >
          <Building2 />
          Datos de la iglesia
        </button>
        <button
          className={section === "biblias" ? "active" : ""}
          onClick={() => setSection("biblias")}
        >
          <BookOpen />
          Biblias
        </button>
        <button
          className={section === "canciones" ? "active" : ""}
          onClick={() => setSection("canciones")}
        >
          <Music2 />
          Canciones
        </button>
        <button
          className={section === "tema" ? "active" : ""}
          onClick={() => setSection("tema")}
        >
          {theme === "dark" ? <Moon /> : <Sun />}
          Tema
        </button>
        <button
          className={section === "version" ? "active" : ""}
          onClick={() => setSection("version")}
        >
          <BadgeInfo />
          Versión
        </button>
      </aside>
      <div className="settings-content">
        {section === "version" && (
          <>
            <div className="section-title compact-title">
              <div>
                <span className="eyebrow">ACTUALIZACIONES</span>
                <h2>Versión de FL Proyector</h2>
              </div>
            </div>
            <div className="version-settings-card">
              <div className="version-product-row">
                <span className="version-product-icon"><BadgeInfo /></span>
                <div>
                  <h3>FL Proyector</h3>
                  <p>
                    Versión instalada: <strong>{updateStatus?.currentVersion ?? "—"}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="version-history-button"
                  onClick={openReleaseHistory}
                >
                  <History />
                  Ver novedades
                </button>
              </div>
              <div className={`version-update-row ${updateStatus?.state ?? "idle"}`}>
                <div className="version-update-copy">
                  <span>Estado de actualización</span>
                  <strong>{updateStatusTitle}</strong>
                  <p>{updateStatus?.message ?? "Preparando el actualizador…"}</p>
                </div>
                <button
                  type="button"
                  className="primary version-update-button"
                  disabled={updateBusy || !updateStatus || updateStatus.state === "development"}
                  onClick={runUpdateAction}
                >
                  {updateBusy ? <RefreshCw className="version-update-spin" /> : <Download />}
                  {updateButtonLabel}
                </button>
              </div>
              {updateStatus?.state === "downloading" && (
                <div className="version-progress" aria-label={`Descarga ${updateStatus.progress ?? 0} %`}>
                  <i style={{ width: `${updateStatus.progress ?? 0}%` }} />
                </div>
              )}
              <p className="version-update-note">
                Al instalar una actualización, tus reuniones, canciones y configuraciones no se borran.
              </p>
            </div>
          </>
        )}
        {section === "tema" && (
          <>
            <div className="section-title compact-title">
              <div>
                <span className="eyebrow">APARIENCIA</span>
                <h2>Tema de la aplicación</h2>
              </div>
            </div>
            <div className="theme-choice-grid">
              <button
                className={theme === "dark" ? "selected" : ""}
                onClick={() => setTheme("dark")}
              >
                <Moon />
                <span>
                  <strong>Oscuro</strong>
                  <small>Ideal para operar en vivo</small>
                </span>
              </button>
              <button
                className={theme === "light" ? "selected" : ""}
                onClick={() => setTheme("light")}
              >
                <Sun />
                <span>
                  <strong>Claro</strong>
                  <small>Interfaz luminosa y limpia</small>
                </span>
              </button>
            </div>
          </>
        )}
        {section === "canciones" && (
          <>
            <div className="section-title">
              <div>
                <span className="eyebrow">TEMA GLOBAL</span>
                <h2>Diseño de canciones</h2>
              </div>
            </div>
            <div className="song-settings-layout">
              <div className="song-style-settings">
                <div className="settings-card">
                  <h3>Tipografía</h3>
                  <div className="settings-row two">
                    <label>
                      Tipo de letra
                      <select
                        value={songStyle.fontFamily}
                        onChange={(e) =>
                          setSongStyle((value) => ({
                            ...value,
                            fontFamily: e.target.value,
                          }))
                        }
                      >
                        {projectionFonts.map((font) => (
                          <option value={font.value} key={font.label}>
                            {font.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tamaño máximo
                      <input
                        className="song-font-size-input"
                        type="number"
                        min="24"
                        max={songStyle.autoFit ? 80 : 200}
                        value={songStyle.fontSize}
                        onChange={(e) =>
                          setSongStyle((value) => ({
                            ...value,
                            fontSize: Math.max(
                              24,
                              Math.min(value.autoFit ? 80 : 200, Number(e.target.value)),
                            ),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label className="toggle-row song-fit-toggle">
                    <input
                      className="win11-toggle"
                      type="checkbox"
                      checked={songStyle.autoFit}
                      onChange={(e) =>
                        setSongStyle((value) => ({
                          ...value,
                          autoFit: e.target.checked,
                          fontSize: e.target.checked ? Math.min(80, value.fontSize) : value.fontSize,
                        }))
                      }
                    />
                    <div>
                      <strong>Ajuste automático de seguridad</strong>
                      <span>Usa el tamaño máximo que entra en pantalla.</span>
                    </div>
                  </label>
                  <label className="toggle-row">
                    <input className="win11-toggle" type="checkbox" checked={songStyle.uppercase} onChange={(e) => setSongStyle((value) => ({ ...value, uppercase: e.target.checked }))} />
                    <div><strong>Todo en mayúsculas</strong><span>Solo afecta lo que se proyecta.</span></div>
                  </label>
                  <ColorDots
                    label="Color del texto"
                    value={songStyle.textColor}
                    colors={textColors}
                    onChange={(textColor) =>
                      setSongStyle((value) => ({ ...value, textColor }))
                    }
                  />
                  <ExpanderRow
                    className="song-title-expander"
                    title="Mostrar título de la canción"
                    checked={songStyle.showTitle}
                    onCheckedChange={(showTitle) =>
                      setSongStyle((value) => ({ ...value, showTitle }))
                    }
                  >
                    <div className="win11-expander-grid song-title-options">
                      <ColorDots
                        label="Color del título"
                        value={songStyle.titleColor}
                        colors={textColors}
                        onChange={(titleColor) =>
                          setSongStyle((value) => ({ ...value, titleColor }))
                        }
                      />
                      <label>
                        Fuente del título
                        <select
                          value={songStyle.titleFontFamily}
                          onChange={(e) =>
                            setSongStyle((value) => ({
                              ...value,
                              titleFontFamily: e.target.value,
                            }))
                          }
                        >
                          {projectionFonts.map((font) => (
                            <option value={font.value} key={font.label}>
                              {font.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Tamaño del título
                        <input
                          type="number"
                          min="14"
                          max="96"
                          value={songStyle.titleFontSize}
                          onChange={(e) =>
                            setSongStyle((value) => ({
                              ...value,
                              titleFontSize: Math.max(
                                14,
                                Math.min(96, Number(e.target.value)),
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Diseño del zócalo
                        <select
                          value={songStyle.titleStyle}
                          onChange={(e) =>
                            setSongStyle((value) => ({
                              ...value,
                              titleStyle: e.target
                                .value as SongDisplaySettings["titleStyle"],
                            }))
                          }
                        >
                          <option value="none">Sin zócalo</option>
                          <option value="bar">Franja clásica</option>
                          <option value="pill">Pastilla</option>
                          <option value="glass">Vidrio</option>
                          <option value="ribbon">Cinta</option>
                          <option value="accent">Acento lateral</option>
                        </select>
                      </label>
                      {songStyle.titleStyle !== "none" && (
                        <ColorDots
                          label="Color del zócalo del título"
                          value={songStyle.titleBackground}
                          colors={backgroundColors}
                          clearValue="transparent"
                          clearLabel="Sin color"
                          onChange={(titleBackground) =>
                            setSongStyle((value) => ({
                              ...value,
                              titleBackground,
                            }))
                          }
                        />
                      )}
                      <label className="song-title-position">
                        Ubicación del título
                        <select
                          value={songStyle.titlePosition}
                          onChange={(e) =>
                            setSongStyle((value) => ({
                              ...value,
                              titlePosition: e.target
                                .value as SongDisplaySettings["titlePosition"],
                            }))
                          }
                        >
                          <option value="top">Parte superior</option>
                          <option value="center">Centro</option>
                          <option value="bottom">Pie de pantalla</option>
                        </select>
                      </label>
                    </div>
                  </ExpanderRow>
                </div>
                <div className="settings-card song-text-layout-card">
                  <h3>Ubicación y fondo del texto</h3>
                  <div className="song-placement-row">
                    <label>
                      Posición
                      <select
                        value={songStyle.position}
                        onChange={(e) =>
                          setSongStyle((value) => ({
                            ...value,
                            position: e.target
                              .value as SongDisplaySettings["position"],
                          }))
                        }
                      >
                        <option value="top">Arriba</option>
                        <option value="center">Centro</option>
                        <option value="bottom">Abajo</option>
                        <option value="lower">Zócalo</option>
                      </select>
                    </label>
                    <label>
                      Alineación
                      <select
                        value={songStyle.align}
                        onChange={(e) =>
                          setSongStyle((value) => ({
                            ...value,
                            align: e.target
                              .value as SongDisplaySettings["align"],
                          }))
                        }
                      >
                        <option value="left">Izquierda</option>
                        <option value="center">Centrada</option>
                        <option value="right">Derecha</option>
                      </select>
                    </label>
                    <label>
                    Diseño de fondo
                    <select
                      value={songStyle.template}
                      onChange={(e) =>
                        setSongStyle((value) => ({
                          ...value,
                          template: e.target
                            .value as SongDisplaySettings["template"],
                        }))
                      }
                    >
                      <option value="plain">Sin fondo</option>
                      <option value="classic">Clásico</option>
                      <option value="accent">Acento</option>
                      <option value="glass">Cristal</option>
                      <option value="solid">Sólido</option>
                      <option value="gradient">Degradado</option>
                    </select>
                  </label>
                  </div>
                  {songStyle.template !== "plain" && (
                    <ColorDots
                      label="Color del fondo"
                      value={songStyle.backgroundColor.slice(0, 7)}
                      colors={backgroundColors}
                      onChange={(backgroundColor) =>
                        setSongStyle((value) => ({ ...value, backgroundColor }))
                      }
                    />
                  )}
                  <button className="save-settings primary song-theme-save" onClick={saveSongStyle}>
                    <Save size={17} />Guardar
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
        {section === "iglesia" && (
          <>
            <div className="section-title">
              <div>
                <span className="eyebrow">IDENTIDAD VISUAL</span>
                <h2>Datos de la iglesia</h2>
              </div>
            </div>
            <div className="church-settings-grid">
              <div>
                <div className="settings-card church-fields">
                  <h3>Información institucional</h3>
                  <label>
                    Nombre de la iglesia
                    <input
                      value={church.name}
                      onChange={(event) =>
                        setChurch((value) => ({
                          ...value,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Ej. Iglesia Fuente de Vida"
                    />
                  </label>
                </div>
              </div>
              <div>
                <div className="settings-card logo-settings">
                  <h3>Logo para la proyección</h3>
                  <div
                    className={`church-logo-preview ${church.logoMode}`}
                    style={{ backgroundColor: church.logoBackgroundColor }}
                  >
                    {church.logoUrl ? (
                      <img src={church.logoUrl} />
                    ) : (
                      <div>
                        <Building2 />
                        <span>Todavía no cargaste un logo</span>
                      </div>
                    )}
                  </div>
                  <button className="logo-upload" onClick={chooseLogo}>
                    <Upload />
                    Cargar PNG o JPG
                  </button>
                </div>
              </div>
            </div>
            <button className="save-settings primary" onClick={saveChurch}>
              <Save size={17} />
              Guardar
            </button>
          </>
        )}
        {section === "pantalla" && (
          <>
            <div className="section-title">
              <div>
                <span className="eyebrow">SALIDAS DE VIDEO</span>
                <h2>Configuración de pantallas</h2>
              </div>
            </div>
            <div className="display-settings-grid">
            <div className="settings-card">
              <label>
                Pantalla principal de proyección
                <select
                  value={settings.mainDisplayId ?? ""}
                  onChange={(e) =>
                    setSettings((value) => ({
                      ...value,
                      mainDisplayId: e.target.value
                        ? Number(e.target.value)
                        : null,
                      aspectRatio: "auto",
                    }))
                  }
                >
                  <option value="">Detectar automáticamente</option>
                  {displays.map((display) => (
                    <option value={display.id} key={display.id}>
                      {display.label} · {display.width}×{display.height}
                      {display.scaleFactor !== 1
                        ? ` · ${Math.round(display.scaleFactor * 100)}%`
                        : ""}
                      {display.primary ? " (principal)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-row">
                <label>
                  Relación de aspecto
                  <select
                    value={settings.aspectRatio}
                    onChange={(e) =>
                      setSettings((value) => ({
                        ...value,
                        aspectRatio: e.target
                          .value as DisplaySettings["aspectRatio"],
                      }))
                    }
                  >
                    <option value="auto">Automática según la pantalla</option>
                    <option>16:9</option>
                    <option>16:10</option>
                    <option>4:3</option>
                    <option>custom</option>
                  </select>
                </label>
                <label>
                  Resolución
                  <select
                    value={settings.resolution}
                    onChange={(e) =>
                      setSettings((value) => ({
                        ...value,
                        resolution: e.target
                          .value as DisplaySettings["resolution"],
                      }))
                    }
                  >
                    <option value="display">Nativa de pantalla</option>
                    <option value="1920x1080">1920×1080</option>
                    <option value="1280x720">1280×720</option>
                    <option value="1024x768">1024×768</option>
                  </select>
                </label>
                <ColorDots
                  label="Color sin contenido"
                  value={settings.backgroundColor}
                  colors={backgroundColors}
                  onChange={(backgroundColor) =>
                    setSettings((value) => ({ ...value, backgroundColor }))
                  }
                />
              </div>
            </div>
            <ExpanderRow
              className="third-display-expander"
              title="Habilitar tercera pantalla"
              description="Duplica la salida de proyección en otro monitor conectado."
              checked={settings.thirdDisplayEnabled}
              onCheckedChange={(thirdDisplayEnabled) =>
                setSettings((value) => ({ ...value, thirdDisplayEnabled }))
              }
            >
              <div className="win11-expander-grid single-column">
                <label>
                  Tercera pantalla
                  <select
                    value={settings.thirdDisplayId ?? ""}
                    onChange={(e) =>
                      setSettings((value) => ({
                        ...value,
                        thirdDisplayId: e.target.value
                          ? Number(e.target.value)
                          : null,
                      }))
                    }
                  >
                    <option value="">Seleccionar pantalla</option>
                    {displays.map((display) => (
                      <option value={display.id} key={display.id}>
                        {display.label} · {display.width}×{display.height}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </ExpanderRow>
            </div>
            <button className="save-settings primary" onClick={saveDisplay}>
              <Save size={17} />
              Guardar
            </button>
          </>
        )}
        {section === "biblias" && (
          <>
            <div className="section-title">
              <div>
                <span className="eyebrow">BIBLIAS Y DISEÑO</span>
                <h2>Configuración bíblica</h2>
              </div>
              <button className="import-button" onClick={importBible}>
                <Download />
                Importar Biblia XML o JSON
              </button>
            </div>
            <div className="bible-settings-layout">
              <div className="bible-settings-form">
                <div className="settings-card bible-reference-settings">
                  <h3>Referencias</h3>
                  <div className="reference-visibility">
                    <label className="toggle-row">
                      <input
                        className="win11-toggle"
                        type="checkbox"
                        checked={bible.showReference}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            showReference: e.target.checked,
                          }))
                        }
                      />
                      <div>
                        <strong>Mostrar cita bíblica</strong>
                      </div>
                    </label>
                    <label className="toggle-row">
                      <input
                        className="win11-toggle"
                        type="checkbox"
                        checked={bible.showVersion}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            showVersion: e.target.checked,
                          }))
                        }
                      />
                      <div>
                        <strong>Mostrar versión</strong>
                      </div>
                    </label>
                  </div>
                  <div className="settings-row reference-grid">
                    <label>
                      Ubicación
                      <select
                        value={bible.referencePosition}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            referencePosition: e.target
                              .value as BibleDisplaySettings["referencePosition"],
                          }))
                        }
                      >
                        <option value="before">Al principio</option>
                        <option value="after">Al final</option>
                      </select>
                    </label>
                    <label>
                      Diseño del zócalo
                      <button
                        type="button"
                        className="reference-design-trigger"
                        onClick={() => setReferenceDesignOpen(true)}
                      >
                        <span>
                          {
                            referenceDesigns.find(
                              (design) => design.value === bible.referenceStyle,
                            )?.label
                          }
                        </span>
                        Elegir diseño
                      </button>
                    </label>
                  </div>
                  <div className="settings-row two">
                    <label>
                      Tipo de letra
                      <select
                        value={bible.referenceFontFamily}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            referenceFontFamily: e.target.value,
                          }))
                        }
                      >
                        {projectionFonts.map((font) => (
                          <option value={font.value} key={font.label}>
                            {font.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tamaño
                      <input
                        type="number"
                        min="10"
                        max="120"
                        value={bible.referenceFontSize}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            referenceFontSize: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="reference-colors">
                    <ColorDots
                      label="Color de referencia"
                      value={bible.referenceColor}
                      colors={textColors}
                      onChange={(referenceColor) =>
                        setBible((v) => ({ ...v, referenceColor }))
                      }
                    />
                    <ColorDots
                      label="Fondo del zócalo"
                      value={bible.referenceBackground}
                      colors={backgroundColors}
                      clearValue="transparent"
                      clearLabel="Sin color"
                      onChange={(referenceBackground) =>
                        setBible((v) => ({ ...v, referenceBackground }))
                      }
                    />
                  </div>
                </div>
                <div className="settings-card bible-typography">
                  <h3>Texto del versículo</h3>
                  <label className="toggle-row">
                    <input
                      className="win11-toggle"
                      type="checkbox"
                      checked={bible.uppercase}
                      onChange={(e) =>
                        setBible((value) => ({
                          ...value,
                          uppercase: e.target.checked,
                        }))
                      }
                    />
                    <div>
                      <strong>Todo en mayúsculas</strong>
                      <span>Solo afecta el texto que se proyecta.</span>
                    </div>
                  </label>
                  <div className="settings-row two">
                    <label>
                      Tipo de letra
                      <select
                        value={bible.textFontFamily}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            textFontFamily: e.target.value,
                          }))
                        }
                      >
                        {projectionFonts.map((font) => (
                          <option value={font.value} key={font.label}>
                            {font.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tamaño
                      <input
                        type="number"
                        min="32"
                        max="110"
                        value={bible.textFontSize}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            textFontSize: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <ColorDots
                    label="Color del versículo"
                    value={bible.textColor}
                    colors={textColors}
                    onChange={(textColor) =>
                      setBible((v) => ({ ...v, textColor }))
                    }
                  />
                </div>
                <ExpanderRow
                  className="bible-shadow-settings"
                  title="Activar sombra del texto"
                  description="Mejora la lectura sobre imágenes y videos."
                  checked={bible.textShadowEnabled}
                  onCheckedChange={(textShadowEnabled) =>
                    setBible((v) => ({ ...v, textShadowEnabled }))
                  }
                >
                    <div className="settings-row two">
                      <ColorDots
                        label="Color de la sombra"
                        value={bible.textShadowColor}
                        colors={[
                          "#000000",
                          "#111827",
                          "#312e81",
                          "#7f1d1d",
                          "#ffffff",
                        ]}
                        onChange={(textShadowColor) =>
                          setBible((v) => ({ ...v, textShadowColor }))
                        }
                      />
                      <label>
                        Intensidad
                        <input
                          aria-label="Intensidad de sombra bíblica"
                          type="number"
                          min="0"
                          max="40"
                          value={bible.textShadowBlur}
                          onChange={(e) =>
                            setBible((v) => ({
                              ...v,
                              textShadowBlur: Math.max(
                                0,
                                Math.min(40, Number(e.target.value)),
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>
                </ExpanderRow>
              </div>
              <aside className="bible-settings-preview">
                <div className="bible-versions-card">
                  <h3>Versiones instaladas</h3>
                  <div className="installed-bibles">
                    {versions.map((version) => (
                      <label key={version.id} className="installed-bible-toggle">
                        <input
                          type="checkbox"
                          checked={version.enabled !== false}
                          onChange={async (event) => {
                            await window.flProyector.setBibleVersionEnabled(version.id, event.target.checked);
                            reloadVersions();
                          }}
                        />
                        <BookOpen />
                        <span>
                          <strong>{version.name}</strong>
                          <small>
                            {version.code} · {version.language.toUpperCase()}
                          </small>
                        </span>
                      </label>
                    ))}
                    {!versions.length && (
                      <small className="no-bibles">
                        Todavía no importaste una Biblia.
                      </small>
                    )}
                  </div>
                </div>
                <ExpanderRow
                  className="bible-fill-card"
                  title="Rellenar pantalla"
                  description="Amplía el texto automáticamente hasta aprovechar el área segura."
                  checked={bible.fillScreen}
                  onCheckedChange={(fillScreen) =>
                    setBible((v) => ({ ...v, fillScreen }))
                  }
                >
                  <div className="bible-margin-grid">
                    <label>
                      Lateral %
                      <input
                        type="number"
                        min="2"
                        max="25"
                        value={bible.horizontalMargin}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            horizontalMargin: Math.max(
                              2,
                              Math.min(25, Number(e.target.value) || 2),
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      Vertical %
                      <input
                        type="number"
                        min="2"
                        max="25"
                        value={bible.verticalMargin}
                        onChange={(e) =>
                          setBible((v) => ({
                            ...v,
                            verticalMargin: Math.max(
                              2,
                              Math.min(25, Number(e.target.value) || 2),
                            ),
                          }))
                        }
                      />
                    </label>
                  </div>
                </ExpanderRow>
                  <div className="settings-card long-verse-settings">
                    <h3>Versículos largos</h3>
                    <div className="long-verse-controls">
                      <label>Comportamiento
                        <select value={bible.longVerseMode === "split" ? "split-halves" : bible.longVerseMode} onChange={(e) => setBible((value) => ({ ...value, longVerseMode: e.target.value as BibleDisplaySettings["longVerseMode"] }))}>
                          <option value="auto-fit">Reducir automáticamente</option>
                          <option value="split-halves">Dividir en A y B</option>
                        </select>
                      </label>
                      <label>Líneas máximas
                        <input type="number" min="2" max="8" disabled={bible.longVerseMode === "auto-fit"} value={bible.maxLinesPerSlide} onChange={(event) => setBible((value) => ({ ...value, maxLinesPerSlide: Math.max(2, Math.min(8, Number(event.target.value) || 3)) }))} />
                      </label>
                    </div>
                    <small className="setting-note">
                      El cálculo usa la resolución real, los márgenes y el tamaño
                      máximo. En “Dividir en A y B” crea las partes necesarias sin
                      cortar palabras ni superar las líneas elegidas.
                    </small>
                  </div>
                  <button className="save-settings primary bible-save" onClick={saveBible}>
                    <Save size={16} />
                    Guardar
                  </button>
              </aside>
            </div>
          </>
        )}
        {referenceDesignOpen && (
          <div className="modal-backdrop">
            <div className="reference-design-dialog">
              <button
                className="dialog-close"
                onClick={() => setReferenceDesignOpen(false)}
              >
                <X />
              </button>
              <span className="eyebrow">DISEÑOS DE REFERENCIA</span>
              <h2>Elegí un zócalo bíblico</h2>
              <p>
                El diseño se aplica a la vista previa. Guardá la configuración
                cuando termines.
              </p>
              <div className="reference-design-grid">
                {referenceDesigns.map((design) => (
                  <button
                    className={
                      bible.referenceStyle === design.value ? "active" : ""
                    }
                    onClick={() => {
                      setBible((value) => ({
                        ...value,
                        referenceStyle: design.value,
                      }));
                      setReferenceDesignOpen(false);
                    }}
                    key={design.value}
                  >
                    <i className={`reference-design-sample ${design.value}`}>
                      Juan 3:16
                    </i>
                    <strong>{design.label}</strong>
                    <small>{design.detail}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {releaseHistoryOpen && (
          <div
            className="modal-backdrop version-history-backdrop"
            onMouseDown={() => setReleaseHistoryOpen(false)}
          >
            <div
              className="version-history-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="version-history-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <span className="version-product-icon"><History /></span>
                <div>
                  <span className="eyebrow">HISTORIAL DE VERSIONES</span>
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
                        {release.changes.map((change) => <li key={change}>{change}</li>)}
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
      </div>
    </section>
  );
}
