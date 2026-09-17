import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  protocol,
  net,
  dialog,
  shell,
  safeStorage,
} from "electron";
import { join, basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, readdir, copyFile, readFile, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import chokidar from "chokidar";
import { XMLParser } from "fast-xml-parser";
import { AppDatabase } from "./database.js";
import { startRemoteServer } from "./server.js";
import {
  initialProjectionState,
  type BibleDisplaySettings,
  type ChurchSettings,
  type DisplaySettings,
  type ProjectionPatch,
  type ProjectionState,
  type SongDisplaySettings,
  type MediaItem,
  type LyricsSearchResult,
  type PexelsMediaResult,
  type PexelsSearchResponse,
  type ReleaseHistoryEntry,
  type UpdateStatus,
} from "../shared/types.js";
import { splitSongStanzas } from "../shared/songSections.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "fl-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as
  | string
  | null;
const { autoUpdater } = createRequire(import.meta.url)(
  "electron-updater",
) as typeof import("electron-updater");

type BibleData = Record<string, Record<string, Record<string, string>>>;

const xmlList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function parseXmlBible(xml: string): BibleData {
  const document = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    trimValues: true,
  }).parse(xml) as { XMLBIBLE?: { BIBLEBOOK?: unknown } };
  const data: BibleData = {};

  for (const book of xmlList(document.XMLBIBLE?.BIBLEBOOK) as Record<
    string,
    unknown
  >[]) {
    const bookName = String(book["@_bname"] || "").trim();
    if (!bookName) continue;
    const chapters: Record<string, Record<string, string>> = {};
    for (const chapter of xmlList(book.CHAPTER) as Record<string, unknown>[]) {
      const chapterNumber = String(chapter["@_cnumber"] || "").trim();
      if (!chapterNumber) continue;
      const verses: Record<string, string> = {};
      for (const verse of xmlList(chapter.VERS) as Record<string, unknown>[]) {
        const verseNumber = String(verse["@_vnumber"] || "").trim();
        const text = String(verse["#text"] || "")
          .replace(/\s+/g, " ")
          .trim();
        if (verseNumber && text) verses[verseNumber] = text;
      }
      if (Object.keys(verses).length) chapters[chapterNumber] = verses;
    }
    if (Object.keys(chapters).length) data[bookName] = chapters;
  }
  if (!Object.keys(data).length)
    throw new Error("El archivo XML no contiene versículos bíblicos válidos.");
  return data;
}

let controlWindow: BrowserWindow | null = null;
let projectionWindow: BrowserWindow | null = null;
let thirdProjectionWindow: BrowserWindow | null = null;
let liveAudienceWindow: BrowserWindow | null = null;
let tagsDialogWindow: BrowserWindow | null = null;
let projectionDisplayId: number | null = null;
let state: ProjectionState = structuredClone(initialProjectionState);
let database: AppDatabase;
let remoteServer: ReturnType<typeof startRemoteServer>;
let remoteActiveMediaItemId: number | null = null;
let remoteReturnState: Pick<ProjectionState, "background" | "video"> | null = null;
let videoReturnBackground: ProjectionState["background"] | null = null;
let videoFinishScheduled = false;
let mediaDir = "";
let meetingMediaDir = "";
let churchAssetsDir = "";
let updaterConfigured = false;
let liveAudienceCaptureTimer: ReturnType<typeof setTimeout> | null = null;
let liveAudienceCaptureRetryTimer: ReturnType<typeof setTimeout> | null = null;
const pexelsSearchCache = new Map<
  string,
  { expiresAt: number; value: PexelsSearchResponse }
>();
let updateStatus: UpdateStatus = {
  state: app.isPackaged ? "idle" : "development",
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  message: app.isPackaged
    ? "Todavía no se buscaron actualizaciones."
    : "La búsqueda está desactivada mientras se prueba el sistema.",
  packaged: app.isPackaged,
};

const bundledReleaseHistory: ReleaseHistoryEntry[] = [
  {
    version: "10.11.10",
    title: "Proyección estable y aplicación móvil más confiable",
    publishedAt: "2026-09-16T17:46:06Z",
    changes: [
      "La referencia bíblica reserva un espacio independiente y ya no queda cortada ni superpuesta con el versículo en pantallas Full HD.",
      "Los cambios rápidos de diapositiva de PowerPoint se agrupan y ejecutan en modo presentación para evitar bloqueos o mostrar la interfaz del operador.",
      "La salida de proyección se recupera automáticamente si su proceso deja de responder y permanece oculta durante desconexiones momentáneas del monitor.",
      "Al cerrar FL Proyector también se cierran las salidas secundaria y tercera, la captura en vivo y las ventanas auxiliares.",
      "FL Remoto incorpora manifiesto, iconos y caché PWA completos, además de un instalador Android directo cuando el navegador no admite la instalación web.",
      "La navegación remota de PowerPoint acepta comandos mientras todavía se está detectando la cantidad total de diapositivas.",
    ],
  },
  {
    version: "10.11.8",
    title: "Colaboración y lectura en vivo más completas",
    publishedAt: "2026-09-14T19:52:07Z",
    changes: [
      "Las estrofas pueden editarse, dividirse o eliminarse individualmente desde el orden de la reunión.",
      "El colaborador puede corregir canciones, dividir estrofas y agregar canciones a la reunión; los cambios activos se reflejan sin interrumpir la proyección.",
      "La lectura en vivo por QR limpia su contenido al usar Limpiar texto, Pantalla negra o Mostrar logo.",
      "Se añadió una captura desde el celular para guardar o compartir solamente el versículo, la letra o la diapositiva visible.",
      "PowerPoint se transmite como imagen JPEG optimizada incluso con la salida física cerrada, con reintentos, deduplicación y compresión adaptativa.",
      "Se corrigieron las transiciones de videos para que se quiten del aire al primer intento y no permanezcan como fondo.",
      "El ajuste automático de Biblia y canciones protege el texto contra recortes tanto en la vista previa como en la pantalla proyectada.",
      "El cartel QR incorpora instrucciones más claras, en mayúsculas y con tipografía de alta visibilidad.",
    ],
  },
  {
    version: "10.11.7",
    title: "Canciones más ágiles y controles más claros",
    publishedAt: "2026-09-14T17:28:00Z",
    changes: [
      "Las canciones pueden crearse manualmente o buscarse por título y artista desde el servidor de letras.",
      "La importación reconoce estrofas, estribillos, puentes y otras partes, elimina repeticiones idénticas y aplica colores de identificación sólo dentro del sistema.",
      "Cada estrofa puede editarse, reclasificarse o eliminarse individualmente desde su menú contextual.",
      "El ajuste automático de canciones mide los límites visuales reales y reduce el texto sólo cuando podría quedar cortado en la pantalla.",
      "Se incorporaron categorías de canciones, búsqueda rápida de libros bíblicos y navegación de versículos con el teclado.",
      "La barra lateral puede plegarse y el botón para dejar únicamente el fondo agiliza la operación en vivo.",
      "Los fondos admiten nombres y etiquetas editables con validaciones y mensajes más claros.",
      "Se corrigieron colores, sombras, botones y tarjetas para respetar correctamente los temas claro y oscuro.",
    ],
  },
  {
    version: "10.11.6",
    title: "Lectura en vivo, colaboración y encuadre inteligente",
    publishedAt: "2026-09-14T15:21:10Z",
    changes: [
      "Se incorporó una lectura en vivo por QR para que teléfonos y otros dispositivos sigan canciones y pasajes bíblicos en tiempo real.",
      "El control maestro del QR restaura correctamente el contenido anterior al quitarlo de la proyección.",
      "El modo colaborador permite organizar reuniones, crear y corregir canciones y editar anuncios con sincronización inmediata.",
      "Los videos restauran el fondo al finalizar y se encuadran completos en pantallas 4:3, 16:9 y otras proporciones sin recortarse.",
      "Rellenar pantalla aprovecha mejor el área disponible y reduce sutilmente texto y referencia cuando una tipografía podría quedar cortada.",
      "La división bíblica A/B evita partes innecesarias y protege cada fragmento contra desbordes visuales.",
    ],
  },
  {
    version: "10.11.5",
    title: "Pantallas, diseño y proyección más confiables",
    publishedAt: "2026-09-12T18:00:00Z",
    changes: [
      "Los cambios de monitor principal y tercera pantalla se aplican en vivo, creando, moviendo o cerrando cada salida correctamente.",
      "La relación 16:9, 16:10 o 4:3 y la resolución elegida ahora se respetan en la salida real, manteniendo la ventana de Windows en pantalla completa.",
      "El color sin contenido se muestra también en la pantalla de proyección y se reforzó el uso de márgenes seguros.",
      "Anuncios y referencias incorporan nuevos zócalos, movimientos, fuentes Montserrat y Oswald y sombras consistentes.",
      "Se completó la transmisión de estilos y controles desde el sistema principal y el control remoto.",
    ],
  },
  {
    version: "10.11.4",
    title: "Versículos completos y división A/B inteligente",
    publishedAt: "2026-09-11T16:55:00Z",
    changes: [
      "Los versículos permanecen completos mientras entren físicamente en la pantalla al tamaño elegido.",
      "Los textos que desbordan se dividen una sola vez en dos partes equilibradas: A y B, nunca C o D.",
      "El cálculo considera la resolución real, los márgenes seguros y el espacio reservado para la referencia.",
      "El tamaño preferido de Biblia y canciones ahora admite valores de hasta 200.",
      "Biblia incorpora una protección automática que reduce el texto solo lo indispensable para evitar cortes.",
    ],
  },
  {
    version: "10.11.3",
    title: "Lectura bíblica más clara y estable",
    publishedAt: "2026-09-11T16:33:24Z",
    changes: [
      "El zócalo de referencia mantiene el tamaño configurado aunque cambie la longitud del pasaje.",
      "El texto bíblico utiliza un área independiente y ya no se superpone con la referencia.",
      "Los versículos se dividen solamente cuando superan la cantidad de líneas configurada.",
      "La división llena cada pantalla antes de crear las partes A, B o siguientes, sin cortar palabras.",
    ],
  },
  {
    version: "10.11.2",
    title: "Proyección y trabajo en red más confiables",
    publishedAt: "2026-09-11T14:26:08Z",
    changes: [
      "Se adaptaron los textos bíblicos y las canciones a la resolución real de la pantalla, sin cortar palabras.",
      "Se mejoró la división inteligente de versículos largos y el uso de los márgenes seguros.",
      "Se incorporó la clasificación de estrofas, coros, puentes y otras partes de las canciones.",
      "Se corrigió la restauración del fondo al quitar videos desde el control remoto.",
      "El instalador habilita el modo colaborador en el Firewall de Windows para la red local.",
      "Se eliminó la barra File/Edit/View de Windows y se mejoró el historial de actualizaciones.",
    ],
  },
  {
    version: "10.11.1",
    title: "Control remoto más confiable",
    publishedAt: "2026-09-10T13:34:11Z",
    changes: [
      "Se corrigió el control de reproducción multimedia desde el teléfono.",
      "Se mejoró la reconexión de la app móvil con FL Proyector.",
    ],
  },
  {
    version: "10.11.0",
    title: "Primera versión pública",
    publishedAt: "2026-09-09T20:33:22Z",
    changes: [
      "Se publicó el instalador de Windows en GitHub.",
      "Se incorporó la comprobación y descarga de actualizaciones.",
    ],
  },
];
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

// No FL Proyector window uses Electron's default File/Edit/View menu. Applying
// this to every BrowserWindow prevents the menu from returning after pressing
// Alt or when a secondary window is created on Windows.
app.on("browser-window-created", (_event, window) => {
  window.setAutoHideMenuBar(true);
  window.setMenuBarVisibility(false);
  window.setMenu(null);
});

const rendererUrl = (route = "") =>
  process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}${route ? `#/${route}` : ""}`
    : pathToFileURL(join(app.getAppPath(), "dist/index.html")).toString() +
      (route ? `#/${route}` : "");

function publishUpdateStatus(patch: Partial<UpdateStatus>) {
  updateStatus = { ...updateStatus, ...patch };
  if (controlWindow && !controlWindow.isDestroyed())
    controlWindow.webContents.send("updates:status", updateStatus);
  return updateStatus;
}

async function githubUpdateRepository() {
  let repository = process.env.FL_UPDATE_REPOSITORY?.trim() || "";
  if (!repository) {
    try {
      const metadata = JSON.parse(
        await readFile(join(app.getAppPath(), "package.json"), "utf8"),
      ) as { repository?: string | { url?: string } };
      repository =
        typeof metadata.repository === "string"
          ? metadata.repository
          : metadata.repository?.url || "";
    } catch {
      repository = "";
    }
  }
  const normalized = repository
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const match = normalized.match(
    /(?:github\.com[/:])?([^/:\s]+)\/([^/\s]+)$/i,
  );
  return match ? { owner: match[1], repo: match[2] } : null;
}

async function getReleaseHistory(): Promise<ReleaseHistoryEntry[]> {
  const repository = await githubUpdateRepository();
  if (!repository) return bundledReleaseHistory;
  try {
    const response = await net.fetch(
      `https://api.github.com/repos/${repository.owner}/${repository.repo}/releases`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "FL-Proyector",
        },
      },
    );
    if (!response.ok) return bundledReleaseHistory;
    const releases = (await response.json()) as Array<{
      tag_name?: string;
      name?: string;
      published_at?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
    }>;
    const history = releases
      .filter((release) => !release.draft && !release.prerelease && release.tag_name)
      .map((release): ReleaseHistoryEntry => {
        const version = String(release.tag_name).replace(/^v/i, "");
        const bundled = bundledReleaseHistory.find((item) => item.version === version);
        const changes = String(release.body || "")
          .split(/\r?\n/)
          .map((line) => line.trim().replace(/^[-*]\s+/, ""))
          .filter(
            (line) =>
              Boolean(line) &&
              !/^#+\s/.test(line) &&
              !/^\*\*Full Changelog\*\*/i.test(line),
          );
        return {
          version,
          title: bundled?.title || release.name || `Versión ${version}`,
          publishedAt: release.published_at || bundled?.publishedAt || null,
          changes: bundled?.changes || (changes.length ? changes : ["Mejoras generales del sistema."]),
        };
      });
    return history.length ? history : bundledReleaseHistory;
  } catch {
    return bundledReleaseHistory;
  }
}

async function configureAutoUpdater() {
  if (updaterConfigured) return true;
  const repository = await githubUpdateRepository();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  // Published installers include app-update.yml. A repository override is
  // useful for local release testing but is not required in production.
  if (repository) autoUpdater.setFeedURL({ provider: "github", ...repository });
  updaterConfigured = true;
  return true;
}

function registerAutoUpdaterEvents() {
  autoUpdater.on("update-available", (info) => {
    publishUpdateStatus({
      state: "available",
      availableVersion: info.version,
      progress: null,
      message: `La versión ${info.version} está lista para descargar.`,
    });
  });
  autoUpdater.on("update-not-available", () => {
    publishUpdateStatus({
      state: "current",
      availableVersion: null,
      progress: null,
      message: "No hay una versión nueva para instalar.",
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    publishUpdateStatus({
      state: "downloading",
      progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
      message: "Descargando la actualización…",
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishUpdateStatus({
      state: "downloaded",
      availableVersion: info.version,
      progress: 100,
      message: "La actualización está descargada. Instalála para terminar.",
    });
  });
  autoUpdater.on("error", (error) => {
    publishUpdateStatus({
      state: "error",
      progress: null,
      message: `No se pudo actualizar: ${error.message}`,
    });
  });
}

function mergeState(patch: ProjectionPatch) {
  if (
    patch.video?.playing === true &&
    patch.video.loop === false &&
    state.video.loop !== false
  )
    videoReturnBackground = { ...state.background };
  if (patch.video?.loop === true) videoReturnBackground = null;
  state = {
    ...state,
    ...patch,
    background: { ...state.background, ...patch.background },
    text: { ...state.text, ...patch.text },
    lowerThird: { ...state.lowerThird, ...patch.lowerThird },
    presentation: { ...state.presentation, ...patch.presentation },
    video: { ...state.video, ...patch.video },
    bibleStyle: { ...state.bibleStyle, ...patch.bibleStyle },
    songStyle: { ...state.songStyle, ...patch.songStyle },
    church: { ...state.church, ...patch.church },
    timer: { ...state.timer, ...patch.timer },
    clock: { ...state.clock, ...patch.clock },
    alert: { ...state.alert, ...patch.alert },
    outputViewport: { ...state.outputViewport, ...patch.outputViewport },
  };
  if (
    patch.outputViewport &&
    liveAudienceWindow &&
    !liveAudienceWindow.isDestroyed()
  )
    liveAudienceWindow.setContentSize(
      Math.max(320, Math.round(state.outputViewport.width)),
      Math.max(240, Math.round(state.outputViewport.height)),
    );
  if (
    !state.video.loop &&
    state.video.playing &&
    state.video.duration > 0 &&
    state.video.duration - state.video.currentTime <= 0.45 &&
    !videoFinishScheduled
  ) {
    videoFinishScheduled = true;
    setImmediate(() => {
      videoFinishScheduled = false;
      finishVideoPlayback();
    });
  }
  for (const win of [
    controlWindow,
    projectionWindow,
    thirdProjectionWindow,
    liveAudienceWindow,
  ])
    if (win && !win.isDestroyed())
      win.webContents.send("projection:state", state);
  remoteServer?.broadcast(state);
  scheduleLiveAudienceFrame();
}

function scheduleLiveAudienceFrame() {
  if (!remoteServer?.needsLiveFrame(state)) {
    if (liveAudienceCaptureTimer) clearTimeout(liveAudienceCaptureTimer);
    if (liveAudienceCaptureRetryTimer)
      clearTimeout(liveAudienceCaptureRetryTimer);
    liveAudienceCaptureTimer = null;
    liveAudienceCaptureRetryTimer = null;
    return;
  }
  if (liveAudienceCaptureTimer) clearTimeout(liveAudienceCaptureTimer);
  if (liveAudienceCaptureRetryTimer)
    clearTimeout(liveAudienceCaptureRetryTimer);
  liveAudienceCaptureRetryTimer = null;
  // Trailing throttle: several rapid slide changes produce one capture of the
  // final frame, never a queue of obsolete JPEGs.
  liveAudienceCaptureTimer = setTimeout(async () => {
    liveAudienceCaptureTimer = null;
    await captureLiveAudienceFrame();
    if (!state.presentation.visible) return;
    const presentationKey = `${state.presentation.url}|${state.presentation.slideIndex}`;
    let retries = 2;
    const retry = () => {
      liveAudienceCaptureRetryTimer = setTimeout(async () => {
        liveAudienceCaptureRetryTimer = null;
        if (
          !remoteServer?.needsLiveFrame(state) ||
          `${state.presentation.url}|${state.presentation.slideIndex}` !==
            presentationKey
        )
          return;
        await captureLiveAudienceFrame();
        retries -= 1;
        if (retries > 0) retry();
      }, 1400);
    };
    retry();
  }, 500);
}

async function captureLiveAudienceFrame() {
  if (!remoteServer?.needsLiveFrame(state)) return;
  const source = projectionWindow && !projectionWindow.isDestroyed()
    ? projectionWindow
    : thirdProjectionWindow && !thirdProjectionWindow.isDestroyed()
      ? thirdProjectionWindow
      : liveAudienceWindow && !liveAudienceWindow.isDestroyed()
        ? liveAudienceWindow
        : null;
  if (!source) return;
  try {
    const captured = await source.webContents.capturePage();
    const size = captured.getSize();
    const resized = size.width > 960
      ? captured.resize({ width: 960, quality: "good" })
      : captured;
    const quality = remoteServer.getLiveAudienceStatus().viewers > 50 ? 40 : 50;
    remoteServer.broadcastLiveFrame(resized.toJPEG(quality));
  } catch (error) {
    console.error("[live-audience] no se pudo capturar la salida", error);
  }
}

function projectionViewport(settings: DisplaySettings) {
  const { mainTarget } = projectionTargets(settings);
  const target = mainTarget ?? screen.getPrimaryDisplay();
  const floatingPreview = !mainTarget;
  const requested =
    settings.resolution === "display"
      ? null
      : settings.resolution.split("x").map(Number);
  let width = requested
    ? Math.min(requested[0], target.bounds.width)
    : floatingPreview
      ? Math.min(960, target.bounds.width)
      : target.bounds.width;
  let height = requested
    ? Math.min(requested[1], target.bounds.height)
    : floatingPreview
      ? Math.min(540, target.bounds.height)
      : target.bounds.height;
  const ratio =
    settings.aspectRatio === "16:9"
      ? 16 / 9
      : settings.aspectRatio === "16:10"
        ? 16 / 10
        : settings.aspectRatio === "4:3"
          ? 4 / 3
          : settings.aspectRatio === "custom"
            ? 16 / 9
            : null;
  if (ratio) {
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    scaleFactor: target.scaleFactor || 1,
  };
}

function projectionTargets(settings: DisplaySettings) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const mainTarget =
    displays.find((display) => display.id === settings.mainDisplayId) ??
    displays.find((display) => display.id !== primary.id);
  // With no external monitor, automatic mode opens a floating preview on the
  // primary display. That display is still occupied and cannot be reused as a
  // third projection output.
  const occupiedMainId = mainTarget?.id ?? primary.id;
  const thirdTarget = settings.thirdDisplayEnabled
    ? displays.find(
        (display) =>
          display.id === settings.thirdDisplayId &&
          display.id !== primary.id &&
          display.id !== occupiedMainId,
      )
    : undefined;
  return { mainTarget, thirdTarget };
}

async function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#090b10",
    title: "Fl Proyector",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  controlWindow.setMenu(null);
  controlWindow.setMenuBarVisibility(false);
  controlWindow.setAutoHideMenuBar(true);
  controlWindow.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "selectAll" },
    ]).popup({ window: controlWindow ?? undefined });
  });
  controlWindow.on("closed", () => {
    controlWindow = null;
    // Hidden/cross-display windows otherwise keep Electron alive and can
    // leave a frozen frame on the projector after the operator closes FL.
    for (const auxiliary of [
      projectionWindow,
      thirdProjectionWindow,
      liveAudienceWindow,
      tagsDialogWindow,
    ])
      if (auxiliary && !auxiliary.isDestroyed()) auxiliary.destroy();
    projectionWindow = null;
    thirdProjectionWindow = null;
    liveAudienceWindow = null;
    tagsDialogWindow = null;
    projectionDisplayId = null;
  });
  await controlWindow.loadURL(rendererUrl());
}

async function openProjection() {
  const settings = database.getDisplaySettings();
  if (projectionWindow && !projectionWindow.isDestroyed()) {
    await synchronizeProjectionWindows(settings);
    if (projectionWindow.isVisible()) projectionWindow.moveTop();
    return;
  }
  const { mainTarget } = projectionTargets(settings);
  projectionDisplayId = mainTarget?.id ?? null;
  const mainWindow = await createProjectionWindow(mainTarget, settings);
  projectionWindow = mainWindow;
  mainWindow.on("closed", () => {
    if (projectionWindow === mainWindow) projectionWindow = null;
    projectionDisplayId = null;
    if (thirdProjectionWindow && !thirdProjectionWindow.isDestroyed())
      thirdProjectionWindow.close();
    controlWindow?.webContents.send("projection:status-changed", false);
  });
  await synchronizeProjectionWindows(settings);
}

async function ensureLiveAudienceWindow() {
  if (liveAudienceWindow && !liveAudienceWindow.isDestroyed()) return;
  const settings = database.getDisplaySettings();
  const width = Math.max(320, Math.round(state.outputViewport.width));
  const height = Math.max(240, Math.round(state.outputViewport.height));
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    frame: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: settings.backgroundColor,
    webPreferences: {
      preload: join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  liveAudienceWindow = win;
  win.on("closed", () => {
    if (liveAudienceWindow === win) liveAudienceWindow = null;
  });
  await win.loadURL(rendererUrl("projection"));
  if (win.isDestroyed()) return;
  win.webContents.send("projection:display-settings", settings);
  win.webContents.send("projection:state", state);
}

function closeLiveAudienceWindow() {
  if (liveAudienceWindow && !liveAudienceWindow.isDestroyed())
    liveAudienceWindow.destroy();
  liveAudienceWindow = null;
}

async function createProjectionWindow(
  target: Electron.Display | undefined,
  settings: DisplaySettings,
) {
  const resolution =
    settings.resolution === "display"
      ? null
      : settings.resolution.split("x").map(Number);
  const width = target?.bounds.width ?? resolution?.[0] ?? 960;
  const height = target?.bounds.height ?? resolution?.[1] ?? 540;
  const safeWidth = target ? Math.min(width, target.bounds.width) : width;
  const safeHeight = target ? Math.min(height, target.bounds.height) : height;
  const nativeFullscreen = Boolean(target);
  const windowsKiosk = process.platform === "win32" && nativeFullscreen;
  const win = new BrowserWindow({
    // A preset resolution creates an exact, borderless raster on the selected
    // display. Native mode stays fullscreen and uses the display's own size.
    x: target
      ? target.bounds.x + Math.round((target.bounds.width - safeWidth) / 2)
      : undefined,
    y: target
      ? target.bounds.y + Math.round((target.bounds.height - safeHeight) / 2)
      : undefined,
    width: safeWidth,
    height: safeHeight,
    frame: false,
    // Windows kiosk mode is more reliable than ordinary fullscreen when the
    // taskbar is configured to stay above borderless windows.
    fullscreen: process.platform !== "win32" && nativeFullscreen,
    kiosk: windowsKiosk,
    resizable: false,
    movable: false,
    minimizable: false,
    focusable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    alwaysOnTop: false,
    backgroundColor: settings.backgroundColor,
    webPreferences: {
      preload: join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  win.setMenuBarVisibility(false);
  win.setAutoHideMenuBar(true);
  let recovering = false;
  const sendProjectionState = () => {
    recovering = false;
    if (win.isDestroyed()) return;
    win.webContents.send("projection:display-settings", settings);
    win.webContents.send("projection:state", state);
  };
  const recoverProjectionRenderer = () => {
    if (recovering || win.isDestroyed()) return;
    recovering = true;
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload();
    }, 180);
  };
  win.webContents.on("did-finish-load", sendProjectionState);
  win.on("unresponsive", recoverProjectionRenderer);
  win.webContents.on("render-process-gone", recoverProjectionRenderer);
  await win.loadURL(rendererUrl("projection"));
  if (windowsKiosk && target) {
    win.setBounds(target.bounds, false);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setKiosk(true);
  }
  return win;
}

function applyDisplaySettingsToWindow(
  win: BrowserWindow,
  target: Electron.Display | undefined,
  settings: DisplaySettings,
) {
  const resolution =
    settings.resolution === "display"
      ? null
      : settings.resolution.split("x").map(Number);
  const host = target ?? screen.getPrimaryDisplay();
  win.setBackgroundColor(settings.backgroundColor);
  if (!target) {
    const requestedWidth = resolution?.[0] ?? 960;
    const requestedHeight = resolution?.[1] ?? 540;
    const width = Math.min(requestedWidth, host.bounds.width);
    const height = Math.min(requestedHeight, host.bounds.height);
    if (win.isKiosk()) win.setKiosk(false);
    if (win.isFullScreen()) win.setFullScreen(false);
    win.setAlwaysOnTop(false);
    win.setBounds({
      x: host.bounds.x + Math.round((host.bounds.width - width) / 2),
      y: host.bounds.y + Math.round((host.bounds.height - height) / 2),
      width,
      height,
    });
  } else if (process.platform === "win32") {
    // Kiosk plus screen-saver level guarantees that the secondary taskbar
    // cannot cover the bottom edge of the projection.
    win.setBounds(target.bounds, false);
    win.setAlwaysOnTop(true, "screen-saver");
    if (!win.isKiosk()) win.setKiosk(true);
  } else {
    win.setAlwaysOnTop(false);
    win.setBounds(target.bounds, false);
    if (!win.isFullScreen()) win.setFullScreen(true);
  }
  win.webContents.send("projection:display-settings", settings);
}

async function synchronizeProjectionWindows(settings: DisplaySettings) {
  if (!projectionWindow || projectionWindow.isDestroyed()) return;
  const { mainTarget, thirdTarget } = projectionTargets(settings);
  // A brief HDMI/display reset must never move the projection window onto the
  // operator's primary monitor. Hide it until Windows reports an external
  // display again, then restore it without taking keyboard focus.
  if (!mainTarget && projectionDisplayId !== null) {
    projectionWindow.hide();
    if (thirdProjectionWindow && !thirdProjectionWindow.isDestroyed())
      thirdProjectionWindow.hide();
    return;
  }
  projectionDisplayId = mainTarget?.id ?? null;
  applyDisplaySettingsToWindow(projectionWindow, mainTarget, settings);
  if (!projectionWindow.isVisible()) projectionWindow.showInactive();

  if (!thirdTarget) {
    if (thirdProjectionWindow && !thirdProjectionWindow.isDestroyed())
      thirdProjectionWindow.close();
    return;
  }
  if (!thirdProjectionWindow || thirdProjectionWindow.isDestroyed()) {
    const thirdWindow = await createProjectionWindow(thirdTarget, settings);
    thirdProjectionWindow = thirdWindow;
    thirdWindow.on("closed", () => {
      if (thirdProjectionWindow === thirdWindow) thirdProjectionWindow = null;
    });
    return;
  }
  applyDisplaySettingsToWindow(thirdProjectionWindow, thirdTarget, settings);
  if (!thirdProjectionWindow.isVisible()) thirdProjectionWindow.showInactive();
}

function refreshProjectionGeometry() {
  const settings = database.getDisplaySettings();
  mergeState({ outputViewport: projectionViewport(settings) });
  void synchronizeProjectionWindows(settings);
}

const imageExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
];
const videoExtensions = [
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".m4v",
  ".avi",
  ".wmv",
  ".flv",
  ".mpeg",
  ".mpg",
  ".ts",
  ".mts",
  ".m2ts",
  ".ogv",
  ".3gp",
  ".vob",
  ".asf",
  ".divx",
  ".rm",
  ".rmvb",
  ".f4v",
  ".mxf",
  ".dv",
];
const validMedia = (name: string) =>
  [...imageExtensions, ...videoExtensions].includes(
    extname(name).toLowerCase(),
  );
const mediaUrl = (path: string) =>
  `fl-media://local/${encodeURIComponent(path)}`;

const meetingMediaFromPayload = (payload: Record<string, unknown>) => {
  const embedded = payload.meetingMedia as MediaItem | undefined;
  if (embedded?.path && embedded.url) return embedded;
  return database
    .listMedia(mediaUrl)
    .find((item) => item.id === Number(payload.mediaId));
};

async function importMeetingMediaFile(source: string): Promise<MediaItem> {
  const extension = extname(source).toLowerCase();
  const filename = `${Date.now()}-${basename(source)}`;
  const destination = join(meetingMediaDir, filename);
  await copyFile(source, destination);
  return {
    // Meeting attachments intentionally don't belong to the global Fondos library.
    id: -Date.now(),
    name: basename(source),
    path: destination,
    url: mediaUrl(destination),
    tags: [],
    favoriteSlot: null,
    kind: imageExtensions.includes(extension) ? "image" : "video",
  };
}

function localNetworkAddresses() {
  const priority = (address: string) => {
    if (address.startsWith("192.168.")) return 0;
    if (address.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };
  return Object.values(networkInterfaces())
    .flat()
    .filter(
      (item): item is NonNullable<typeof item> =>
        Boolean(item) && item!.family === "IPv4" && !item!.internal && !item!.address.startsWith("169.254."),
    )
    .map((item) => item.address)
    .sort((first, second) => priority(first) - priority(second));
}

function enableWindowsRemoteAccess() {
  if (process.platform !== "win32") return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const ruleArguments = [
      "advfirewall",
      "firewall",
      "add",
      "rule",
      "name=FL Proyector - Control remoto",
      "dir=in",
      "action=allow",
      "protocol=TCP",
      "localport=3001",
      "remoteip=localsubnet",
      "profile=any",
      "enable=yes",
    ];
    const escapedArguments = ruleArguments
      .map((value) => `'${value.replace(/'/g, "''")}'`)
      .join(",");
    const command = [
      `$process = Start-Process -FilePath 'netsh.exe' -ArgumentList @(${escapedArguments}) -Verb RunAs -Wait -PassThru`,
      "exit $process.ExitCode",
    ].join("; ");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true },
    );
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

function remoteMultimediaItems(
  meetingId: number,
): Array<{
  id: number;
  title: string;
  type: "media" | "presentation" | "announcement";
  kind: "image" | "video" | "presentation" | "announcement";
}> {
  const media = new Map(database.listMedia(mediaUrl).map((item) => [item.id, item]));
  const result: Array<{
    id: number;
    title: string;
    type: "media" | "presentation" | "announcement";
    kind: "image" | "video" | "presentation" | "announcement";
  }> = [];
  for (const item of database.listMeetingItems(meetingId)) {
    if (item.type === "announcement")
      result.push({ id: item.id, title: item.title, type: "announcement", kind: "announcement" });
    if (item.type === "presentation")
      result.push({ id: item.id, title: item.title, type: "presentation", kind: "presentation" });
    if (item.type === "media") {
      const source = meetingMediaFromPayload(item.payload as Record<string, unknown>);
      if (source)
        result.push({ id: item.id, title: item.title || source.name, type: "media", kind: source.kind });
    }
  }
  return result;
}

function beginRemoteMultimedia(itemId: number) {
  if (remoteActiveMediaItemId === null)
    remoteReturnState = {
      background: { ...state.background },
      video: { ...state.video },
    };
  remoteActiveMediaItemId = itemId;
}

function remoteBasePatch(): ProjectionPatch {
  if (!remoteReturnState) return {};
  const returnsToVideo = remoteReturnState.background.kind === "video";
  return {
    background: { ...remoteReturnState.background },
    video: {
      ...remoteReturnState.video,
      playing: returnsToVideo ? remoteReturnState.video.playing : false,
      loop: true,
      commandId: state.video.commandId + 1,
    },
  };
}

function clearRemoteMultimedia() {
  const restore = remoteBasePatch();
  remoteActiveMediaItemId = null;
  remoteReturnState = null;
  videoReturnBackground = null;
  mergeState({
    ...restore,
    blackout: false,
    logo: false,
    text: { visible: false },
    lowerThird: { visible: false },
    presentation: { visible: false },
  });
}

function finishVideoPlayback() {
  if (state.video.loop || !videoReturnBackground) return;
  if (remoteActiveMediaItemId !== null) {
    clearRemoteMultimedia();
    return;
  }
  const background = { ...videoReturnBackground };
  videoReturnBackground = null;
  mergeState({
    background,
    video: {
      playing: false,
      loop: true,
      seekTime: 0,
      currentTime: 0,
      commandId: state.video.commandId + 1,
    },
  });
}

function projectRemoteMultimedia(itemId: number) {
  const item = database
    .listMeetings()
    .flatMap((meeting) => database.listMeetingItems(meeting.id))
    .find((value) => value.id === itemId);
  if (!item) return;
  beginRemoteMultimedia(itemId);
  const payload = item.payload as Record<string, unknown>;
  if (item.type === "presentation") {
    const slideCount = Number(payload.slideCount || (payload.previewSlides as unknown[] | undefined)?.length || 0);
    mergeState({
      ...remoteBasePatch(), blackout: false, logo: false, text: { visible: false }, lowerThird: { visible: false },
      presentation: { path: String(payload.path || ""), url: String(payload.url || ""), name: String(payload.name || item.title), previewSlides: payload.previewSlides as string[] | undefined, slideIndex: 0, slideCount, visible: true },
    });
    return;
  }
  if (item.type === "announcement") {
    mergeState({
      ...remoteBasePatch(), blackout: false, logo: false, presentation: { visible: false }, lowerThird: { visible: false },
      text: {
        html: String(payload.html || ""), kind: "anuncio", visible: true,
        position: (payload.position as ProjectionState["text"]["position"]) || "center",
        fontSize: Number(payload.fontSize || 64), fontFamily: String(payload.fontFamily || "Inter"),
        color: String(payload.color || "#ffffff"), backgroundColor: String(payload.backgroundColor || "rgba(0,0,0,0)"),
        align: (payload.align as ProjectionState["text"]["align"]) || "center",
        borderRadius: Number(payload.borderRadius || 0),
        template: (payload.template as ProjectionState["text"]["template"]) || "plain",
        animation:
          (payload.animation as ProjectionState["text"]["animation"]) || "fade",
        shadowEnabled: payload.shadowEnabled !== false,
        shadowColor: String(payload.shadowColor || "#000000"),
        shadowBlur: Number(payload.shadowBlur ?? 14),
      },
    });
    return;
  }
  if (item.type !== "media") return;
  const source = meetingMediaFromPayload(payload);
  if (!source) return;
  if (source.kind === "image") {
    mergeState({
      ...remoteBasePatch(), blackout: false, logo: false, text: { visible: false }, lowerThird: { visible: false },
      presentation: { path: null, url: source.url, name: source.name, previewSlides: [source.url], slideIndex: 0, slideCount: 1, visible: true },
    });
    return;
  }
  mergeState({
    blackout: false, logo: false, text: { visible: false }, lowerThird: { visible: false }, presentation: { visible: false },
    background: { id: source.id, url: source.url, name: source.name, kind: source.kind },
    video: source.kind === "video"
      ? {
          playing: true,
          loop: false,
          seekTime: 0,
          currentTime: 0,
          duration: 0,
          commandId: state.video.commandId + 1,
        }
      : { playing: false, loop: true },
  });
}
const hydrateChurch = (settings: ChurchSettings): ChurchSettings => ({
  ...settings,
  logoUrl: settings.logoPath
    ? settings.logoUrl || mediaUrl(settings.logoPath)
    : null,
});

async function syncMedia() {
  const names = await readdir(mediaDir).catch(() => []);
  database.syncMedia(
    names.filter(validMedia).map((name) => join(mediaDir, name)),
  );
  controlWindow?.webContents.send("media:changed");
}

async function importMediaFile(source: string) {
  const extension = extname(source).toLowerCase();
  if (
    videoExtensions.includes(extension) &&
    ![".mp4", ".webm"].includes(extension) &&
    ffmpegPath
  ) {
    const destination = join(mediaDir, `${basename(source, extension)}.mp4`);
    await new Promise<void>((resolve, reject) => {
      const executable = app.isPackaged
        ? ffmpegPath.replace("app.asar", "app.asar.unpacked")
        : ffmpegPath;
      const process = spawn(executable, [
        "-y",
        "-i",
        source,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        destination,
      ]);
      process.once("error", reject);
      process.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`FFmpeg terminó con código ${code}`)),
      );
    });
    return destination;
  }
  const destination = join(mediaDir, basename(source));
  if (source !== destination) await copyFile(source, destination);
  return destination;
}

const pexelsSecretKey = "pexels-api-key";
const pexelsDownloadHosts = new Set([
  "images.pexels.com",
  "videos.pexels.com",
]);

function readPexelsApiKey() {
  const saved = database.getIntegrationSecret(pexelsSecretKey);
  if (!saved) return "";
  if (!saved.startsWith("encrypted:")) return saved.replace(/^plain:/, "");
  try {
    return safeStorage.decryptString(
      Buffer.from(saved.slice("encrypted:".length), "base64"),
    );
  } catch {
    return "";
  }
}

function storePexelsApiKey(value: string) {
  const key = value.trim();
  if (!key) {
    database.saveIntegrationSecret(pexelsSecretKey, "");
    return;
  }
  const stored = safeStorage.isEncryptionAvailable()
    ? `encrypted:${safeStorage.encryptString(key).toString("base64")}`
    : `plain:${key}`;
  database.saveIntegrationSecret(pexelsSecretKey, stored);
}

async function pexelsRequest(endpoint: URL, apiKey = readPexelsApiKey()) {
  if (!apiKey)
    throw new Error("Configurá tu clave gratuita de Pexels para buscar fondos.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await net.fetch(endpoint.toString(), {
      signal: controller.signal,
      headers: { Authorization: apiKey },
    });
    if (response.status === 401)
      throw new Error("La clave de Pexels no es válida.");
    if (response.status === 429)
      throw new Error("Se alcanzó el límite de búsquedas de Pexels. Intentá más tarde.");
    if (!response.ok)
      throw new Error("Pexels no está disponible en este momento.");
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchPexels(
  query: string,
  kind: "image" | "video",
  orientation: "all" | "landscape" | "portrait" | "square",
  page: number,
): Promise<PexelsSearchResponse> {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  if (!normalizedQuery) return { items: [], page: 1, totalResults: 0, hasMore: false };
  const safePage = Math.max(1, Math.floor(page || 1));
  const cacheKey = `${kind}:${orientation}:${safePage}:${normalizedQuery.toLocaleLowerCase("es-AR")}`;
  const cached = pexelsSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const endpoint = new URL(
    kind === "image"
      ? "https://api.pexels.com/v1/search"
      : "https://api.pexels.com/videos/search",
  );
  endpoint.searchParams.set("query", normalizedQuery);
  endpoint.searchParams.set("page", String(safePage));
  endpoint.searchParams.set("per_page", "24");
  if (orientation !== "all") endpoint.searchParams.set("orientation", orientation);
  const payload = (await (await pexelsRequest(endpoint)).json()) as {
    photos?: Array<Record<string, unknown>>;
    videos?: Array<Record<string, unknown>>;
    page?: number;
    per_page?: number;
    total_results?: number;
    next_page?: string;
  };
  const records = kind === "image" ? payload.photos ?? [] : payload.videos ?? [];
  const items = records.flatMap((record): PexelsMediaResult[] => {
    const externalId = Number(record.id || 0);
    const user = (record.user ?? {}) as Record<string, unknown>;
    const photographer = String(record.photographer ?? user.name ?? "Pexels");
    const sourceUrl = String(record.url || "https://www.pexels.com");
    if (!externalId) return [];
    if (kind === "image") {
      const sources = (record.src ?? {}) as Record<string, unknown>;
      const previewUrl = String(sources.medium || sources.small || "");
      const downloadUrl = String(sources.original || sources.large2x || sources.large || "");
      if (!previewUrl || !downloadUrl) return [];
      return [{
        provider: "Pexels",
        externalId,
        kind,
        title: `${normalizedQuery} · ${photographer}`,
        query: normalizedQuery,
        previewUrl,
        downloadUrl,
        sourceUrl,
        photographer,
        photographerUrl: String(record.photographer_url || sourceUrl),
        width: Number(record.width || 0),
        height: Number(record.height || 0),
        duration: null,
      }];
    }
    const files = Array.isArray(record.video_files)
      ? (record.video_files as Array<Record<string, unknown>>)
          .filter((file) => String(file.file_type || "").includes("mp4") && file.link)
          .sort((left, right) => {
            const leftWidth = Number(left.width || 0);
            const rightWidth = Number(right.width || 0);
            const leftScore = leftWidth <= 1920 ? 10_000 + leftWidth : 1920 - leftWidth;
            const rightScore = rightWidth <= 1920 ? 10_000 + rightWidth : 1920 - rightWidth;
            return rightScore - leftScore;
          })
      : [];
    const selectedFile = files[0];
    const previewUrl = String(record.image || "");
    const downloadUrl = String(selectedFile?.link || "");
    if (!previewUrl || !downloadUrl) return [];
    return [{
      provider: "Pexels",
      externalId,
      kind,
      title: `${normalizedQuery} · ${photographer}`,
      query: normalizedQuery,
      previewUrl,
      downloadUrl,
      sourceUrl,
      photographer,
      photographerUrl: String(user.url || sourceUrl),
      width: Number(selectedFile?.width || record.width || 0),
      height: Number(selectedFile?.height || record.height || 0),
      duration: Number(record.duration || 0) || null,
    }];
  });
  const totalResults = Number(payload.total_results || items.length);
  const value = {
    items,
    page: Number(payload.page || safePage),
    totalResults,
    hasMore: Boolean(payload.next_page),
  };
  pexelsSearchCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, value });
  return value;
}

async function importPexelsMedia(item: PexelsMediaResult) {
  const remoteUrl = new URL(item.downloadUrl);
  if (remoteUrl.protocol !== "https:" || !pexelsDownloadHosts.has(remoteUrl.hostname))
    throw new Error("El archivo no proviene de un servidor válido de Pexels.");
  const rawExtension = extname(remoteUrl.pathname).toLowerCase();
  const extension = item.kind === "video"
    ? ".mp4"
    : imageExtensions.includes(rawExtension) ? rawExtension : ".jpg";
  const destination = join(mediaDir, `pexels-${Math.max(0, Number(item.externalId))}${extension}`);
  const temporaryDestination = `${destination}.download`;
  const response = await net.fetch(remoteUrl.toString());
  if (!response.ok || !response.body)
    throw new Error("No se pudo descargar el fondo desde Pexels.");
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      createWriteStream(temporaryDestination),
    );
    // Replace a previous copy only after the new download finished. This avoids
    // registering truncated images or videos when the network is interrupted.
    await rm(destination, { force: true });
    await rename(temporaryDestination, destination);
  } catch (error) {
    await rm(temporaryDestination, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncMedia();
  const imported = database
    .listMedia(mediaUrl)
    .find((media) => media.path === destination);
  if (imported) {
    const name = String(item.title || `Pexels ${item.externalId}`).trim();
    const tags = [
      "Pexels",
      item.query,
      item.kind === "image" ? "imagen" : "video",
      item.width > item.height ? "horizontal" : item.height > item.width ? "vertical" : "cuadrado",
      item.photographer,
    ].filter(Boolean);
    database.updateMediaDetails(imported.id, name, [...new Set(tags)]);
  }
  controlWindow?.webContents.send("media:changed");
  return database.listMedia(mediaUrl);
}

if (hasSingleInstanceLock)
  app.whenReady().then(async () => {
    // Keep only the native title bar controls (minimize, maximize and close).
    Menu.setApplicationMenu(null);
    mediaDir = join(app.getPath("documents"), "IglesiaPro", "Fondos");
    meetingMediaDir = join(app.getPath("documents"), "IglesiaPro", "Reuniones", "Medios");
    churchAssetsDir = join(app.getPath("userData"), "church-assets");
    await mkdir(mediaDir, { recursive: true });
    await mkdir(meetingMediaDir, { recursive: true });
    await mkdir(churchAssetsDir, { recursive: true });
    database = new AppDatabase(
      join(app.getPath("userData"), "fl-proyector.sqlite"),
    );
    database.removeBundledDemoMeeting();
    state.church = hydrateChurch(database.getChurchSettings());
    state.bibleStyle = database.getBibleDisplaySettings();
    state.songStyle = database.getSongDisplaySettings();
    state.outputViewport = projectionViewport(database.getDisplaySettings());
    // Windows may report a new usable size after changing scaling, resolution,
    // orientation or reconnecting HDMI. Recalculate the safe canvas immediately.
    screen.on("display-added", refreshProjectionGeometry);
    screen.on("display-removed", refreshProjectionGeometry);
    screen.on("display-metrics-changed", refreshProjectionGeometry);
    const biblePath = join(app.getAppPath(), "assets", "bibles", "rv1909.json");
    const bibleData = JSON.parse(
      await readFile(biblePath, "utf8"),
    ) as BibleData;
    database.seedBible("RV1909", "Reina-Valera 1909", bibleData);
    const bundledXmlBibles = [
      ["DHH", "Biblia Dios Habla Hoy", "dhh.xml"],
      ["LBLA", "La Biblia de las Américas", "lbla.xml"],
      ["NTV", "Nueva Traducción Viviente", "ntv.xml"],
      ["NVI", "Nueva Versión Internacional", "nvi.xml"],
      ["RVR1960", "Reina-Valera 1960", "rvr1960.xml"],
      ["TLA", "Traducción en Lenguaje Actual", "tla.xml"],
      ["BLH", "Biblia Latinoamericana de Hoy", "blh.xml"],
    ] as const;
    for (const [code, name, file] of bundledXmlBibles) {
      if (database.hasBibleVersion(code)) continue;
      const xml = await readFile(
        join(app.getAppPath(), "assets", "bibles", "xml", file),
        "utf8",
      );
      database.seedBible(code, name, parseXmlBible(xml));
    }
    protocol.handle("fl-media", (request) => {
      const url = new URL(request.url);
      return net.fetch(
        pathToFileURL(decodeURIComponent(url.pathname.slice(1))).toString(),
      );
    });
    remoteServer = startRemoteServer(() => state, mergeState, {
      listVersions: () => database.listBibleVersions(true),
      listBooks: (versionId) => database.listBibleBooks(versionId),
      listVerses: (versionId, book, chapter) =>
        database.listBibleVerses(versionId, book, chapter),
    }, {
      listMeetings: () => database.listMeetings(),
      listItems: remoteMultimediaItems,
      project: projectRemoteMultimedia,
      clear: clearRemoteMultimedia,
      activeItemId: () => remoteActiveMediaItemId,
    }, {
      getCode: () => database.getCollaboratorCode(),
      listSongs: () => database.listSongs(""),
      saveSong: (song) => database.saveSong(song),
      songSaved: (id) => {
        if (
          state.text.kind !== "canto" ||
          state.text.sourceSongId !== id
        )
          return;
        const song = database.listSongs("").find((entry) => entry.id === id);
        if (!song) return;
        const stanzas = splitSongStanzas(song.content);
        const comparable = (html: string) =>
          html
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase("es-AR");
        const currentSection = comparable(state.text.html);
        const matchingIndex = stanzas.findIndex(
          (stanza) => comparable(stanza) === currentSection,
        );
        const storedIndex = Math.max(
          0,
          Math.min(
            Number(state.text.sourceSectionIndex || 0),
            Math.max(stanzas.length - 1, 0),
          ),
        );
        const index = matchingIndex >= 0 ? matchingIndex : storedIndex;
        mergeState({
          text: {
            html: stanzas[index] || song.content,
            title: state.songStyle.showTitle ? song.title : "",
            sourceSectionIndex: index,
          },
        });
      },
      listMeetings: () => database.listMeetings(),
      createMeeting: (name, date) => database.createMeeting(name, date),
      updateMeeting: (id, patch) => database.updateMeeting(id, patch),
      deleteMeeting: (id) => database.deleteMeeting(id),
      listMeetingItems: (meetingId) => database.listMeetingItems(meetingId),
      saveMeetingItem: (item) => database.saveMeetingItem(item),
      deleteMeetingItem: (id) => database.deleteMeetingItem(id),
      reorderMeetingItems: (meetingId, ids) => database.reorderMeetingItems(meetingId, ids),
      notifyChanged: (scope) => {
        if (controlWindow && !controlWindow.isDestroyed())
          controlWindow.webContents.send("library:changed", scope);
      },
    });
    await syncMedia();
    chokidar
      .watch(mediaDir, { ignoreInitial: true })
      .on("all", () => syncMedia());

    registerAutoUpdaterEvents();
    ipcMain.handle("updates:get-status", () => updateStatus);
    ipcMain.handle("updates:release-history", () => getReleaseHistory());
    ipcMain.handle("updates:check", async () => {
      if (!app.isPackaged)
        return publishUpdateStatus({
          state: "development",
          currentVersion: app.getVersion(),
          availableVersion: null,
          progress: null,
          message:
            "La búsqueda está desactivada mientras se prueba el sistema.",
        });
      if (!(await configureAutoUpdater()))
        return publishUpdateStatus({
          state: "error",
          availableVersion: null,
          progress: null,
          message:
            "Todavía falta vincular el sistema con su repositorio de GitHub.",
        });
      publishUpdateStatus({
        state: "checking",
        availableVersion: null,
        progress: null,
        message: "Consultando las versiones publicadas…",
      });
      try {
        await autoUpdater.checkForUpdates();
      } catch (error) {
        publishUpdateStatus({
          state: "error",
          progress: null,
          message: `No se pudo comprobar: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return updateStatus;
    });
    ipcMain.handle("updates:download", async () => {
      if (updateStatus.state !== "available") return updateStatus;
      publishUpdateStatus({
        state: "downloading",
        progress: 0,
        message: "Preparando la descarga…",
      });
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        publishUpdateStatus({
          state: "error",
          progress: null,
          message: `No se pudo descargar: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return updateStatus;
    });
    ipcMain.handle("updates:install", () => {
      if (updateStatus.state !== "downloaded") return false;
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return true;
    });

    ipcMain.handle("projection:get-state", () => state);
    ipcMain.handle("app:open-external", async (_event, value: unknown) => {
      if (typeof value !== "string") return false;
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.hostname !== "wa.me") return false;
        await shell.openExternal(url.toString());
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle(
      "projection:update-state",
      (_event, patch: ProjectionPatch) => mergeState(patch),
    );
    ipcMain.handle("projection:video-ended", finishVideoPlayback);
    ipcMain.handle("projection:open", openProjection);
    ipcMain.handle("projection:close", () => {
      projectionWindow?.close();
      thirdProjectionWindow?.close();
    });
    ipcMain.handle("projection:status", () => {
      const addresses = remoteServer?.isAvailable()
        ? localNetworkAddresses()
        : [];
      return {
        open: Boolean(projectionWindow),
        displays: screen.getAllDisplays().map((display) => ({
          id: display.id,
          label: display.label || `Pantalla ${display.id}`,
          width: Math.round(display.bounds.width * display.scaleFactor),
          height: Math.round(display.bounds.height * display.scaleFactor),
          cssWidth: display.bounds.width,
          cssHeight: display.bounds.height,
          scaleFactor: display.scaleFactor,
          primary: display.id === screen.getPrimaryDisplay().id,
        })),
        remoteUrls: addresses.map((address) => `http://${address}:3001`),
      };
    });
    ipcMain.handle("remote:enable-windows-access", enableWindowsRemoteAccess);
    ipcMain.handle("live-audience:status", () =>
      remoteServer.getLiveAudienceStatus(),
    );
    ipcMain.handle("live-audience:start", async () => {
      await ensureLiveAudienceWindow();
      const result = remoteServer.startLiveAudience(state);
      scheduleLiveAudienceFrame();
      return result;
    });
    ipcMain.handle("live-audience:stop", () => {
      if (liveAudienceCaptureTimer) clearTimeout(liveAudienceCaptureTimer);
      if (liveAudienceCaptureRetryTimer)
        clearTimeout(liveAudienceCaptureRetryTimer);
      liveAudienceCaptureTimer = null;
      liveAudienceCaptureRetryTimer = null;
      closeLiveAudienceWindow();
      return remoteServer.stopLiveAudience();
    });
    ipcMain.handle("media:list", () => database.listMedia(mediaUrl));
    ipcMain.handle("media:import", async (_event, paths: string[]) => {
      for (const source of paths.filter(validMedia))
        await importMediaFile(source);
      await syncMedia();
      return database.listMedia(mediaUrl);
    });
    ipcMain.handle("media:choose", async () => {
      const result = await dialog.showOpenDialog(controlWindow!, {
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Imágenes y videos",
            extensions: [...imageExtensions, ...videoExtensions].map((value) =>
              value.slice(1),
            ),
          },
        ],
      });
      if (result.canceled) return database.listMedia(mediaUrl);
      for (const source of result.filePaths.filter(validMedia))
        await importMediaFile(source);
      await syncMedia();
      return database.listMedia(mediaUrl);
    });
    ipcMain.handle("media:choose-for-meeting", async () => {
      const result = await dialog.showOpenDialog(controlWindow!, {
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Imágenes y videos",
            extensions: [...imageExtensions, ...videoExtensions].map((value) =>
              value.slice(1),
            ),
          },
        ],
      });
      if (result.canceled) return [];
      return Promise.all(
        result.filePaths.filter(validMedia).map(importMeetingMediaFile),
      );
    });
    ipcMain.handle("pexels:status", () => ({
      configured: Boolean(readPexelsApiKey()),
    }));
    ipcMain.handle("pexels:save-key", async (_event, value: string) => {
      const key = String(value || "").trim();
      if (!key) {
        storePexelsApiKey("");
        pexelsSearchCache.clear();
        return { configured: false };
      }
      const endpoint = new URL("https://api.pexels.com/v1/curated?per_page=1");
      await pexelsRequest(endpoint, key);
      storePexelsApiKey(key);
      pexelsSearchCache.clear();
      return { configured: true };
    });
    ipcMain.handle(
      "pexels:search",
      (
        _event,
        query: string,
        kind: "image" | "video",
        orientation: "all" | "landscape" | "portrait" | "square",
        page = 1,
      ) => searchPexels(query, kind, orientation, page),
    );
    ipcMain.handle(
      "pexels:import",
      (_event, item: PexelsMediaResult) => importPexelsMedia(item),
    );
    ipcMain.handle(
      "media:favorite",
      (_event, id: number, slot: number | null) => {
        database.setFavorite(id, slot);
        controlWindow?.webContents.send("media:changed");
      },
    );
    ipcMain.handle(
      "media:edit-tags",
      async (event, _id: number, tags: string[]) => {
        if (!controlWindow) return null;
        if (tagsDialogWindow && !tagsDialogWindow.isDestroyed()) {
          tagsDialogWindow.focus();
          return null;
        }
        const escaped = JSON.stringify(tags.join(", ")).replace(
          /</g,
          "\\u003c",
        );
        const darkTheme = await event.sender
          .executeJavaScript("document.documentElement.dataset.theme === 'dark'", true)
          .catch(() => false);
        const dialogColors = darkTheme
          ? { bg: "#202020", surface: "#2b2b2b", input: "#252525", border: "#505050", text: "#ffffff", muted: "#c5c5c5", accent: "#60aee8", onAccent: "#071018" }
          : { bg: "#f3f3f3", surface: "#ffffff", input: "#fbfbfb", border: "#d2d2d2", text: "#1a1a1a", muted: "#616161", accent: "#0078d4", onAccent: "#ffffff" };
        const html = `<!doctype html><html><head><meta charset="UTF-8"><style>
      :root{font-family:"Segoe UI Variable Text","Segoe UI",sans-serif;color:${dialogColors.text};background:${dialogColors.bg}}*{box-sizing:border-box}body{margin:0;padding:20px 22px 16px;background:${dialogColors.surface};font-size:14px}label{display:block;margin-bottom:7px;color:${dialogColors.muted};font-size:12px}input{display:block;width:100%;height:32px;padding:0 10px;border:1px solid ${dialogColors.border};border-bottom-color:${dialogColors.muted};border-radius:4px;background:${dialogColors.input};color:${dialogColors.text};font-size:14px;outline:0}input:focus{border-color:${dialogColors.accent};box-shadow:0 0 0 1px ${dialogColors.accent}}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}button{min-width:88px;height:32px;padding:0 14px;border:1px solid ${dialogColors.border};border-radius:4px;background:${dialogColors.surface};color:${dialogColors.text};font-weight:600;cursor:pointer}button.primary{border-color:${dialogColors.accent};background:${dialogColors.accent};color:${dialogColors.onAccent}}button:hover{filter:brightness(.96)}</style></head><body><form><label for="tags">Etiquetas separadas por coma</label><input id="tags" autofocus value=${escaped}><div class="actions"><button type="button" id="cancel">Cancelar</button><button class="primary" type="submit">Aceptar</button></div></form><script>const input=document.getElementById('tags');document.querySelector('form').onsubmit=event=>{event.preventDefault();window.flProyector.submitMediaTags(input.value)};document.getElementById('cancel').onclick=()=>window.flProyector.submitMediaTags(null);input.select();</script></body></html>`;
        return await new Promise<string[] | null>((resolve) => {
          const parent = controlWindow!;
          const win = new BrowserWindow({
            parent,
            modal: true,
            width: 430,
            height: 190,
            resizable: false,
            title: "Editar etiquetas",
            autoHideMenuBar: true,
            webPreferences: {
              preload: join(app.getAppPath(), "electron", "preload.cjs"),
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          win.setMenu(null);
          win.setMenuBarVisibility(false);
          win.setAutoHideMenuBar(true);
          tagsDialogWindow = win;
          let finished = false;
          const finish = (value: string[] | null) => {
            if (finished) return;
            finished = true;
            ipcMain.removeListener("media:tags-dialog-result", onResult);
            if (tagsDialogWindow === win) tagsDialogWindow = null;
            if (!win.isDestroyed()) win.close();
            resolve(value);
          };
          const onResult = (
            event: Electron.IpcMainEvent,
            value: string | null,
          ) => {
            if (event.sender !== win.webContents) return;
            finish(
              value === null
                ? null
                : value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
            );
          };
          ipcMain.on("media:tags-dialog-result", onResult);
          win.on("closed", () => finish(null));
          win.loadURL(
            `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`,
          );
        });
      },
    );
    ipcMain.handle("media:tags", (_event, id: number, tags: string[]) => {
      database.setTags(id, tags);
      controlWindow?.webContents.send("media:changed");
    });
    ipcMain.handle(
      "media:update-details",
      (_event, id: number, name: string, tags: string[]) => {
        const normalizedName = String(name || "").trim();
        if (!normalizedName) throw new Error("El nombre del fondo es obligatorio.");
        database.updateMediaDetails(id, normalizedName, tags);
        controlWindow?.webContents.send("media:changed");
      },
    );
    ipcMain.handle("media:delete", async (_event, id: number) => {
      const path = database.getMediaPath(id);
      if (!path) return false;
      await shell.trashItem(path);
      await syncMedia();
      controlWindow?.webContents.send("media:changed");
      return true;
    });
    ipcMain.handle(
      "songs:list",
      (_event, search: string, categoryId?: number | null) =>
        database.listSongs(search, categoryId),
    );
    ipcMain.handle("songs:categories", () => database.listCategories());
    ipcMain.handle("songs:save", (_event, song) => database.saveSong(song));
    ipcMain.handle("songs:delete", (_event, id: number) =>
      database.deleteSong(id),
    );
    ipcMain.handle("songs:create-category", (_event, name: string) =>
      database.createCategory(name),
    );
    ipcMain.handle(
      "lyrics:search",
      async (_event, title: string, artist: string): Promise<LyricsSearchResult[]> => {
        const normalizedTitle = String(title || "").trim();
        const normalizedArtist = String(artist || "").trim();
        if (!normalizedTitle) return [];
        const endpoint = new URL("https://lrclib.net/api/search");
        endpoint.searchParams.set("track_name", normalizedTitle);
        if (normalizedArtist)
          endpoint.searchParams.set("artist_name", normalizedArtist);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
          const response = await net.fetch(endpoint.toString(), {
            signal: controller.signal,
            headers: {
              "Lrclib-Client": `FL-Proyector v${app.getVersion()} (https://github.com/conexion354-source/Fl-Proyector)`,
            },
          });
          if (response.status === 429)
            throw new Error("El servidor recibió demasiadas búsquedas. Esperá unos segundos.");
          if (!response.ok)
            throw new Error("El servidor de letras no está disponible en este momento.");
          const records = (await response.json()) as Array<{
            id?: unknown;
            trackName?: unknown;
            name?: unknown;
            artistName?: unknown;
            albumName?: unknown;
            duration?: unknown;
            instrumental?: unknown;
            plainLyrics?: unknown;
          }>;
          if (!Array.isArray(records)) return [];
          return records
            .filter(
              (record) =>
                record.instrumental !== true &&
                typeof record.plainLyrics === "string" &&
                record.plainLyrics.trim(),
            )
            .slice(0, 20)
            .map((record) => ({
              provider: "LRCLIB" as const,
              externalId: Number(record.id || 0),
              title: String(record.trackName || record.name || normalizedTitle).trim(),
              artist: String(record.artistName || "Artista desconocido").trim(),
              album: (() => {
                const value = String(record.albumName || "").trim();
                return /^(null|undefined)$/i.test(value) ? "" : value;
              })(),
              duration: Math.max(0, Number(record.duration || 0)),
              lyrics: String(record.plainLyrics).replace(/\r\n?/g, "\n").trim(),
            }));
        } catch (error) {
          if (controller.signal.aborted)
            throw new Error("La búsqueda tardó demasiado. Revisá la conexión a Internet.");
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
    );
    ipcMain.handle("bible:versions", () => database.listBibleVersions());
    ipcMain.handle("bible:version-enabled", (_event, id: number, enabled: boolean) =>
      database.setBibleVersionEnabled(id, enabled),
    );
    ipcMain.handle("bible:books", (_event, versionId: number) =>
      database.listBibleBooks(versionId),
    );
    ipcMain.handle(
      "bible:verses",
      (_event, versionId: number, book: string, chapter: number) =>
        database.listBibleVerses(versionId, book, chapter),
    );
    ipcMain.handle(
      "bible:search",
      (_event, versionId: number, search: string) =>
        database.searchBible(versionId, search),
    );
    ipcMain.handle("bible:import", async () => {
      const result = await dialog.showOpenDialog(controlWindow!, {
        properties: ["openFile"],
        filters: [{ name: "Biblia XML o JSON", extensions: ["xml", "json"] }],
      });
      if (result.canceled || !result.filePaths[0]) return false;
      const path = result.filePaths[0];
      const source = await readFile(path, "utf8");
      const data =
        extname(path).toLowerCase() === ".xml"
          ? parseXmlBible(source)
          : (JSON.parse(source) as BibleData);
      database.seedBible(
        basename(path, extname(path)).toUpperCase(),
        basename(path, extname(path)),
        data,
      );
      return true;
    });
    ipcMain.handle("settings:display:get", () => database.getDisplaySettings());
    ipcMain.handle(
      "settings:display:set",
      async (_event, settings: DisplaySettings) => {
        database.saveDisplaySettings(settings);
        mergeState({ outputViewport: projectionViewport(settings) });
        await synchronizeProjectionWindows(settings);
        // The operator preview uses the same display setting as the actual
        // projector. Notify it too, not only the projection windows.
        controlWindow?.webContents.send("projection:display-settings", settings);
      },
    );
    ipcMain.handle("settings:church:get", () =>
      hydrateChurch(database.getChurchSettings()),
    );
    ipcMain.handle(
      "settings:church:set",
      (_event, settings: ChurchSettings) => {
        const hydrated = hydrateChurch(settings);
        database.saveChurchSettings(hydrated);
        mergeState({ church: hydrated });
      },
    );
    ipcMain.handle("settings:church:pick-logo", async () => {
      const result = await dialog.showOpenDialog(controlWindow!, {
        properties: ["openFile"],
        filters: [
          {
            name: "Logo o imagen de la iglesia",
            extensions: ["png", "jpg", "jpeg"],
          },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const source = result.filePaths[0],
        extension = extname(source).toLowerCase(),
        destination = join(churchAssetsDir, `logo${extension}`);
      if (source !== destination) await copyFile(source, destination);
      return {
        path: destination,
        url: `${mediaUrl(destination)}?v=${Date.now()}`,
      };
    });
    ipcMain.handle("settings:bible:get", () =>
      database.getBibleDisplaySettings(),
    );
    ipcMain.handle(
      "settings:bible:set",
      (_event, settings: BibleDisplaySettings) => {
        database.saveBibleDisplaySettings(settings);
        mergeState({ bibleStyle: settings });
      },
    );
    ipcMain.handle("settings:songs:get", () =>
      database.getSongDisplaySettings(),
    );
    ipcMain.handle(
      "settings:songs:set",
      (_event, settings: SongDisplaySettings) => {
        database.saveSongDisplaySettings(settings);
        mergeState({ songStyle: settings });
      },
    );
    ipcMain.handle("settings:collaborator:get", () => database.getCollaboratorCode());
    ipcMain.handle("settings:collaborator:set", (_event, code: string) =>
      database.saveCollaboratorCode(code),
    );
    ipcMain.handle("meetings:list", () => database.listMeetings());
    ipcMain.handle(
      "meetings:create",
      (_event, name: string, date?: string | null) =>
        database.createMeeting(name, date),
    );
    ipcMain.handle("meetings:delete", (_event, id: number) =>
      database.deleteMeeting(id),
    );
    ipcMain.handle(
      "meetings:update",
      (_event, id: number, patch: { name?: string; color?: string }) =>
        database.updateMeeting(id, patch),
    );
    ipcMain.handle("meeting-items:list", (_event, meetingId: number) =>
      database.listMeetingItems(meetingId),
    );
    ipcMain.handle("meeting-items:save", (_event, item) =>
      database.saveMeetingItem(item),
    );
    ipcMain.handle("meeting-items:delete", (_event, id: number) =>
      database.deleteMeetingItem(id),
    );
    ipcMain.handle(
      "meeting-items:reorder",
      (_event, meetingId: number, ids: number[]) =>
        database.reorderMeetingItems(meetingId, ids),
    );
    ipcMain.handle("presentation:import", async () => {
      const result = await dialog.showOpenDialog(controlWindow!, {
        properties: ["openFile"],
        filters: [
          {
            name: "PowerPoint moderno",
            extensions: ["pptx", "ppsx", "pptm", "potx"],
          },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const directory = join(
        app.getPath("documents"),
        "IglesiaPro",
        "Presentaciones",
      );
      await mkdir(directory, { recursive: true });
      const source = result.filePaths[0],
        destination = join(directory, basename(source));
      if (source !== destination) await copyFile(source, destination);
      return {
        path: destination,
        url: mediaUrl(destination),
        name: basename(destination),
      };
    });
    ipcMain.handle("presentation:read", async (_event, path: string) => {
      const source = String(path || "").trim();
      const extension = extname(source).toLowerCase();
      if (!source || ![".pptx", ".ppsx", ".pptm", ".potx"].includes(extension))
        throw new Error("El archivo no es una presentación compatible.");
      const content = await readFile(source);
      // All supported Office Open XML formats are ZIP containers. Rejecting
      // an invalid/empty file here produces a useful error before the React
      // viewer tries to parse it in every projection window.
      if (
        content.length < 4 ||
        content[0] !== 0x50 ||
        content[1] !== 0x4b
      )
        throw new Error("El archivo de PowerPoint está vacío o dañado.");
      return content;
    });
    ipcMain.handle("presentation:open", (_event, path: string) =>
      shell.openPath(path),
    );
    await createControlWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
    });
  });

app.on("second-instance", () => {
  if (!controlWindow) return;
  if (controlWindow.isMinimized()) controlWindow.restore();
  controlWindow.show();
  controlWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => remoteServer?.close());
