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
  type OpenverseMediaResult,
  type OpenverseSearchResponse,
  type ReleaseHistoryEntry,
  type UpdateStatus,
} from "../shared/types.js";
import { splitSongStanzas } from "../shared/songSections.js";

// A projector window must keep decoding motion backgrounds even when Windows
// considers it occluded or unfocused behind the operator window.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
}

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
let previewProjectionWindow: BrowserWindow | null = null;
let floatingPreviewWindow: BrowserWindow | null = null;
let previewState: ProjectionState | null = null;
let projectionFrozen = false;
let frozenProjectionState: ProjectionState | null = null;
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
let nativePresentationPath: string | null = null;
const openverseSearchCache = new Map<
  string,
  { expiresAt: number; value: OpenverseSearchResponse }
>();
const openverseResultCache = new Map<
  string,
  { expiresAt: number; value: OpenverseMediaResult }
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
    version: "10.11.20",
    title: "Actualizaciones visibles y fondos Openverse más confiables",
    publishedAt: "2026-09-19T00:00:00Z",
    changes: [
      "El sistema comprueba actualizaciones al iniciar y muestra un aviso flotante con acceso directo al actualizador cuando hay una versión pendiente.",
      "La búsqueda de fondos en Openverse reintenta automáticamente las conexiones anónimas rechazadas temporalmente, sin pedir cuentas ni claves.",
      "Se mantienen las mejoras de versículos largos, anuncios y controles de reuniones incluidas en esta actualización.",
    ],
  },
  {
    version: "10.11.16",
    title: "Fondos compactos, videos compatibles y control remoto estable",
    publishedAt: "2026-09-18T15:30:00Z",
    changes: [
      "La biblioteca de Fondos estrena un encabezado compacto, miniaturas más pequeñas y desplazamiento adaptable sin botones recortados.",
      "Los videos MPG, AVI, MOV y otros formatos no compatibles se convierten automáticamente a MP4 al agregarlos a una reunión.",
      "Los videos antiguos de reuniones se actualizan en segundo plano, conservando el archivo original.",
      "La app remota mantiene mejor la conexión al volver desde segundo plano e incorpora navegación clara entre estrofas.",
      "El modo colaborador se adapta a pantallas más pequeñas sin dejar controles fuera de alcance.",
    ],
  },
  {
    version: "10.11.15",
    title: "Biblioteca de fondos preparada para colecciones grandes",
    publishedAt: "2026-09-18T13:05:00Z",
    changes: [
      "La grilla de Fondos utiliza todo el alto disponible y puede desplazarse correctamente al importar carpetas con muchos archivos.",
      "El encabezado, el buscador y el botón para agregar fondos permanecen accesibles mientras se recorre la colección.",
      "Las tarjetas que todavía están fuera de pantalla se renderizan de forma diferida para mantener fluida la biblioteca.",
    ],
  },
  {
    version: "10.11.14",
    title: "Control total móvil y fondos libres sin claves",
    publishedAt: "2026-09-18T12:30:00Z",
    changes: [
      "App · Control total habilita temporalmente las canciones del orden del culto en el teléfono, con selección de estrofas y control en vivo.",
      "El permiso de canciones se valida en el servidor, se actualiza inmediatamente en los teléfonos conectados y vuelve a quedar apagado al reiniciar FL Proyector.",
      "La búsqueda de fondos usa Openverse sin cuentas ni claves y permite guardar imágenes grandes con licencias libres y sus datos de atribución.",
      "El APK Android corrige la pantalla negra mediante aceleración gráfica, navegación WebView estable y caché renovada.",
      "La aplicación web remota evita páginas antiguas almacenadas y muestra un aviso claro cuando la computadora no está disponible.",
    ],
  },
  {
    version: "10.11.13",
    title: "Acceso directo a la clave de Pexels",
    publishedAt: "2026-09-17T20:52:12Z",
    changes: [
      "El botón Obtener clave abre correctamente la página oficial de Pexels en el navegador predeterminado de Windows.",
      "La lista segura de enlaces externos admite Pexels y sus subdominios sin permitir direcciones ajenas.",
      "Si Windows no puede abrir el navegador, la pantalla informa la dirección que se debe visitar manualmente.",
    ],
  },
  {
    version: "10.11.12",
    title: "Conexión con Pexels corregida en Windows",
    publishedAt: "2026-09-17T18:20:20Z",
    changes: [
      "La validación de Pexels usa una conexión HTTPS nativa que conserva correctamente el encabezado de autorización en Windows.",
      "Las claves pegadas con espacios invisibles, comillas, el prefijo Bearer o el encabezado Authorization se limpian automáticamente.",
      "Los mensajes distinguen una clave rechazada, una cuenta sin acceso, el límite de consultas y los errores temporales del servidor.",
      "La búsqueda de videos utiliza el endpoint vigente de Pexels para evitar incompatibilidades futuras.",
      "La pantalla de configuración aclara exactamente qué parte de la clave debe copiarse.",
    ],
  },
  {
    version: "10.11.11",
    title: "Fondos desde Pexels integrados en la biblioteca",
    publishedAt: "2026-09-17T16:18:22Z",
    changes: [
      "Agregar fondos ahora permite elegir entre archivos del disco o buscar recursos desde un servidor.",
      "La integración con Pexels busca imágenes y videos y permite filtrar los resultados por orientación.",
      "Cada resultado muestra vista previa, autor, resolución y duración antes de guardarlo.",
      "Los recursos elegidos se descargan en la biblioteca local y reciben etiquetas automáticas para encontrarlos rápidamente.",
      "La clave de Pexels se valida una sola vez y se guarda protegida localmente en la computadora.",
      "Las descargas interrumpidas ya no pueden registrar imágenes o videos incompletos en la biblioteca.",
    ],
  },
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
  if (state.presentation.nativePlayback && patch.presentation?.visible === false)
    stopNativePresentation();
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
  const liveState = currentLiveState();
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send("projection:state", state);
    controlWindow.webContents.send("projection:live-state", liveState);
  }
  for (const win of [projectionWindow, thirdProjectionWindow, liveAudienceWindow])
    if (win && !win.isDestroyed())
      win.webContents.send("projection:state", liveState);
  if (previewProjectionWindow && !previewProjectionWindow.isDestroyed())
    previewProjectionWindow.webContents.send("projection:state", previewState ?? state);
  if (floatingPreviewWindow && !floatingPreviewWindow.isDestroyed())
    floatingPreviewWindow.webContents.send("projection:state", previewState ?? state);
  remoteServer?.broadcast(liveState);
  scheduleLiveAudienceFrame();
}

type NativePresentationResult = {
  ok: boolean;
  slideIndex?: number;
  error?: string;
};

function runPowerShell(script: string, presentationPath?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      {
        windowsHide: true,
        env: {
          ...process.env,
          ...(presentationPath ? { FL_PRESENTATION_PATH: presentationPath } : {}),
        },
      },
    );
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (error += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) return resolve(output.trim());
      reject(new Error(error.trim() || "Microsoft PowerPoint no respondió."));
    });
  });
}

async function startNativePresentation(path: string): Promise<NativePresentationResult> {
  if (process.platform !== "win32")
    return { ok: false, error: "La reproducción nativa está disponible en Windows." };
  try {
    await runPowerShell(String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:FL_PRESENTATION_PATH
if (-not $path -or -not (Test-Path -LiteralPath $path)) { throw 'No se encontró el archivo de PowerPoint.' }
try { $powerPoint = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { $powerPoint = New-Object -ComObject PowerPoint.Application }
$powerPoint.Visible = $true
$presentation = $null
foreach ($candidate in $powerPoint.Presentations) { if ($candidate.FullName -eq $path) { $presentation = $candidate; break } }
if (-not $presentation) { $presentation = $powerPoint.Presentations.Open($path, $false, $false, $true) }
if ($powerPoint.SlideShowWindows.Count -eq 0) { $presentation.SlideShowSettings.Run() | Out-Null }
`, path);
    nativePresentationPath = path;
    return { ok: true, slideIndex: 0 };
  } catch (reason) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

async function navigateNativePresentation(
  direction: -1 | 1,
): Promise<NativePresentationResult> {
  if (process.platform !== "win32" || !nativePresentationPath)
    return { ok: false, error: "No hay una presentación nativa activa." };
  try {
    const slide = await runPowerShell(String.raw`
$ErrorActionPreference = 'Stop'
try { $powerPoint = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { throw 'Microsoft PowerPoint no está abierto.' }
if ($powerPoint.SlideShowWindows.Count -eq 0) { throw 'La presentación no está en modo diapositivas.' }
$view = $powerPoint.SlideShowWindows.Item(1).View
if ('${direction}' -eq '1') { $view.Next() } else { $view.Previous() }
$view.CurrentShowPosition
`);
    const position = Number(slide.trim());
    return {
      ok: true,
      ...(Number.isFinite(position) && position > 0
        ? { slideIndex: position - 1 }
        : {}),
    };
  } catch (reason) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

function stopNativePresentation() {
  nativePresentationPath = null;
  if (process.platform !== "win32") return;
  void runPowerShell(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$powerPoint = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
if ($powerPoint -and $powerPoint.SlideShowWindows.Count -gt 0) { $powerPoint.SlideShowWindows.Item(1).View.Exit() }
`).catch(() => undefined);
}

function moveNativePresentation(direction: -1 | 1) {
  void navigateNativePresentation(direction).then((result) => {
    if (!result.ok) {
      console.warn("No se pudo avanzar PowerPoint nativo:", result.error);
      return;
    }
    if (result.slideIndex !== undefined)
      mergeState({ presentation: { slideIndex: result.slideIndex } });
  });
}

function currentLiveState() {
  return projectionFrozen && frozenProjectionState
    ? frozenProjectionState
    : state;
}

function publishFreezeStatus() {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  controlWindow.webContents.send("projection:freeze-status", projectionFrozen);
  controlWindow.webContents.send("projection:live-state", currentLiveState());
}

function setProjectionFrozen(frozen: boolean) {
  if (frozen === projectionFrozen) return projectionFrozen;
  if (frozen) {
    frozenProjectionState = structuredClone(state);
    projectionFrozen = true;
  } else {
    projectionFrozen = false;
    frozenProjectionState = null;
    const liveState = currentLiveState();
    for (const win of [projectionWindow, thirdProjectionWindow, liveAudienceWindow])
      if (win && !win.isDestroyed())
        win.webContents.send("projection:state", liveState);
    remoteServer?.broadcast(liveState);
    scheduleLiveAudienceFrame();
  }
  publishFreezeStatus();
  return projectionFrozen;
}

function scheduleLiveAudienceFrame() {
  const liveState = currentLiveState();
  if (!remoteServer?.needsLiveFrame(liveState)) {
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
    const capturedState = currentLiveState();
    if (!capturedState.presentation.visible) return;
    const presentationKey = `${capturedState.presentation.url}|${capturedState.presentation.navigationId}`;
    let retries = 2;
    const retry = () => {
      liveAudienceCaptureRetryTimer = setTimeout(async () => {
        liveAudienceCaptureRetryTimer = null;
        if (
          !remoteServer?.needsLiveFrame(currentLiveState()) ||
          `${currentLiveState().presentation.url}|${currentLiveState().presentation.navigationId}` !==
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
  if (!remoteServer?.needsLiveFrame(currentLiveState())) return;
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
  const previewTarget = settings.previewEnabled
    ? displays.find(
        (display) =>
          display.id === settings.previewDisplayId &&
          display.id !== primary.id &&
          display.id !== occupiedMainId &&
          display.id !== thirdTarget?.id,
      )
    : undefined;
  return { mainTarget, thirdTarget, previewTarget };
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
      previewProjectionWindow,
      floatingPreviewWindow,
      liveAudienceWindow,
      tagsDialogWindow,
    ])
      if (auxiliary && !auxiliary.isDestroyed()) auxiliary.destroy();
    projectionWindow = null;
    thirdProjectionWindow = null;
    previewProjectionWindow = null;
    floatingPreviewWindow = null;
    previewState = null;
    projectionFrozen = false;
    frozenProjectionState = null;
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
    if (previewProjectionWindow && !previewProjectionWindow.isDestroyed())
      previewProjectionWindow.close();
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
  win.webContents.send("projection:state", currentLiveState());
}

function closeLiveAudienceWindow() {
  if (liveAudienceWindow && !liveAudienceWindow.isDestroyed())
    liveAudienceWindow.destroy();
  liveAudienceWindow = null;
}

function previewAspectRatio(settings: DisplaySettings) {
  if (settings.aspectRatio === "16:10") return 16 / 10;
  if (settings.aspectRatio === "4:3") return 4 / 3;
  if (settings.aspectRatio === "custom" || settings.aspectRatio === "16:9")
    return 16 / 9;
  const viewport = projectionViewport(settings);
  return viewport.width / Math.max(1, viewport.height);
}

async function openFloatingPreview() {
  if (floatingPreviewWindow && !floatingPreviewWindow.isDestroyed()) {
    floatingPreviewWindow.show();
    floatingPreviewWindow.focus();
    return true;
  }
  const settings = database.getDisplaySettings();
  const ratio = previewAspectRatio(settings);
  const primary = screen.getPrimaryDisplay();
  const width = Math.min(760, Math.max(420, primary.workAreaSize.width - 80));
  const height = Math.round(width / ratio);
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 360,
    minHeight: Math.round(360 / ratio),
    useContentSize: true,
    title: "Vista previa · FL Proyector",
    backgroundColor: settings.backgroundColor,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  floatingPreviewWindow = win;
  win.setAspectRatio(ratio);
  win.setMenu(null);
  win.setMenuBarVisibility(false);
  win.on("closed", () => {
    if (floatingPreviewWindow === win) floatingPreviewWindow = null;
    controlWindow?.webContents.send("preview:window-status", false);
  });
  win.webContents.on("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.webContents.send("projection:display-settings", settings);
    win.webContents.send("projection:state", previewState ?? state);
  });
  await win.loadURL(rendererUrl("projection"));
  controlWindow?.webContents.send("preview:window-status", true);
  return true;
}

function closeFloatingPreview() {
  if (floatingPreviewWindow && !floatingPreviewWindow.isDestroyed())
    floatingPreviewWindow.close();
  floatingPreviewWindow = null;
}

async function createProjectionWindow(
  target: Electron.Display | undefined,
  settings: DisplaySettings,
  preview = false,
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
    win.webContents.send(
      "projection:state",
      preview ? (previewState ?? state) : currentLiveState(),
    );
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
    if (previewProjectionWindow && !previewProjectionWindow.isDestroyed())
      previewProjectionWindow.hide();
    return;
  }
  projectionDisplayId = mainTarget?.id ?? null;
  applyDisplaySettingsToWindow(projectionWindow, mainTarget, settings);
  if (!projectionWindow.isVisible()) projectionWindow.showInactive();

  if (!thirdTarget) {
    if (thirdProjectionWindow && !thirdProjectionWindow.isDestroyed())
      thirdProjectionWindow.close();
  } else if (!thirdProjectionWindow || thirdProjectionWindow.isDestroyed()) {
    const thirdWindow = await createProjectionWindow(thirdTarget, settings);
    thirdProjectionWindow = thirdWindow;
    thirdWindow.on("closed", () => {
      if (thirdProjectionWindow === thirdWindow) thirdProjectionWindow = null;
    });
  } else {
    applyDisplaySettingsToWindow(thirdProjectionWindow, thirdTarget, settings);
    if (!thirdProjectionWindow.isVisible()) thirdProjectionWindow.showInactive();
  }

  const previewTarget = projectionTargets(settings).previewTarget;
  if (!previewTarget) {
    if (previewProjectionWindow && !previewProjectionWindow.isDestroyed())
      previewProjectionWindow.close();
    return;
  }
  if (!previewProjectionWindow || previewProjectionWindow.isDestroyed()) {
    const previewWindow = await createProjectionWindow(previewTarget, settings, true);
    previewProjectionWindow = previewWindow;
    previewWindow.on("closed", () => {
      if (previewProjectionWindow === previewWindow) previewProjectionWindow = null;
    });
  } else {
    applyDisplaySettingsToWindow(previewProjectionWindow, previewTarget, settings);
    if (!previewProjectionWindow.isVisible()) previewProjectionWindow.showInactive();
  }
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

// An .mp4 may still use HEVC or an unsupported audio stream. Normalize every
// imported video to the browser-safe H.264 + AAC format.
const needsVideoConversion = (extension: string) => videoExtensions.includes(extension);

async function transcodeVideoToMp4(source: string, destination: string) {
  if (!ffmpegPath) {
    throw new Error("FFmpeg no está disponible para convertir este video.");
  }
  const executable = app.isPackaged
    ? ffmpegPath.replace("app.asar", "app.asar.unpacked")
    : ffmpegPath;
  try {
    await new Promise<void>((resolve, reject) => {
      const process = spawn(executable, [
        "-y",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
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
        "-b:a",
        "192k",
        "-ac",
        "2",
        "-ar",
        "48000",
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
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

const meetingMediaFromPayload = (payload: Record<string, unknown>) => {
  const embedded = payload.meetingMedia as MediaItem | undefined;
  if (embedded?.path && embedded.url) return embedded;
  return database
    .listMedia(mediaUrl)
    .find((item) => item.id === Number(payload.mediaId));
};

async function importMeetingMediaFile(source: string): Promise<MediaItem> {
  const extension = extname(source).toLowerCase();
  const filename = needsVideoConversion(extension)
    ? `${Date.now()}-${basename(source, extension)}.mp4`
    : `${Date.now()}-${basename(source)}`;
  const destination = join(meetingMediaDir, filename);
  if (needsVideoConversion(extension)) {
    await transcodeVideoToMp4(source, destination);
  } else {
    await copyFile(source, destination);
  }
  return {
    // Meeting attachments intentionally don't belong to the global Fondos library.
    id: -Date.now(),
    name: basename(destination),
    path: destination,
    url: mediaUrl(destination),
    tags: [],
    favoriteSlot: null,
    kind: imageExtensions.includes(extension) ? "image" : "video",
  };
}

async function migrateMeetingVideosToMp4() {
  for (const meeting of database.listMeetings()) {
    for (const item of database.listMeetingItems(meeting.id)) {
      if (item.type !== "media") continue;
      const embedded = item.payload.meetingMedia as MediaItem | undefined;
      if (!embedded?.path) continue;
      const extension = extname(embedded.path).toLowerCase();
      if (
        !needsVideoConversion(extension) ||
        embedded.path.toLowerCase().endsWith("-compatible.mp4")
      )
        continue;

      const destination = join(
        meetingMediaDir,
        `${basename(embedded.path, extension)}-compatible.mp4`,
      );
      try {
        await transcodeVideoToMp4(embedded.path, destination);
        database.saveMeetingItem({
          ...item,
          payload: {
            ...item.payload,
            meetingMedia: {
              ...embedded,
              name: `${basename(embedded.name || embedded.path, extension)}.mp4`,
              path: destination,
              url: mediaUrl(destination),
              kind: "video",
            } satisfies MediaItem,
          },
        });
      } catch (error) {
        console.warn(
          `No se pudo convertir el video de la reunión: ${embedded.path}`,
          error,
        );
      }
    }
  }
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

function clearProjectionContent() {
  const remoteRestore = remoteReturnState;
  const restoredBackground = remoteRestore?.background ?? videoReturnBackground;
  const background = restoredBackground
    ? { ...restoredBackground }
    : { ...state.background };
  const backgroundIsVideo = background.kind === "video";
  const restoredVideo = remoteRestore?.video;
  const resumeLoopingBackground =
    backgroundIsVideo &&
    (restoredBackground ? restoredVideo?.playing !== false : state.video.loop);
  remoteActiveMediaItemId = null;
  remoteReturnState = null;
  videoReturnBackground = null;
  mergeState({
    background,
    blackout: false,
    logo: false,
    text: { visible: false, html: "" },
    lowerThird: { visible: false },
    presentation: { visible: false },
    alert: { visible: false },
    video: {
      ...(restoredVideo ?? {}),
      playing: resumeLoopingBackground,
      loop: true,
      seekTime: resumeLoopingBackground
        ? Number(restoredVideo?.seekTime ?? state.video.seekTime ?? 0)
        : 0,
      currentTime: resumeLoopingBackground
        ? Number(restoredVideo?.currentTime ?? state.video.currentTime ?? 0)
        : 0,
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
    if (payload.nativeOnly) {
      void shell.openPath(String(payload.path || ""));
      return;
    }
    const slideCount = Number(payload.slideCount || (payload.previewSlides as unknown[] | undefined)?.length || 0);
    const nativePlayback = process.platform === "win32" && Boolean(payload.path);
    if (nativePlayback)
      void startNativePresentation(String(payload.path)).then((result) => {
        if (!result.ok) console.warn("No se pudo abrir PowerPoint nativo:", result.error);
      });
    mergeState({
      ...remoteBasePatch(), blackout: false, logo: false, text: { visible: false }, lowerThird: { visible: false },
      presentation: { path: String(payload.path || ""), url: String(payload.url || ""), name: String(payload.name || item.title), previewSlides: payload.previewSlides as string[] | undefined, slideIndex: 0, slideCount, navigationId: state.presentation.navigationId, navigationDirection: 1, nativePlayback, visible: true },
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
      presentation: { path: null, url: source.url, name: source.name, previewSlides: [source.url], slideIndex: 0, slideCount: 1, navigationId: state.presentation.navigationId, navigationDirection: 1, nativePlayback: false, visible: true },
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
  if (needsVideoConversion(extension)) {
    const destination = join(mediaDir, `${basename(source, extension)}-compatible.mp4`);
    await transcodeVideoToMp4(source, destination);
    return destination;
  }
  const destination = join(mediaDir, basename(source));
  if (source !== destination) await copyFile(source, destination);
  return destination;
}

async function openverseRequest(endpoint: URL) {
  const requestHeaders = {
    Accept: "application/json",
    "Cache-Control": "no-cache",
    "User-Agent": "FL-Proyector/1.0 (Openverse background search)",
  };
  const readResponse = async (response: Response) => {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 12 * 1024 * 1024)
      throw new Error("La respuesta de Openverse es demasiado grande.");
    return { status: response.status, body };
  };
  const requestWithElectron = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await net.fetch(endpoint.toString(), {
        method: "GET",
        headers: requestHeaders,
        signal: controller.signal,
      });
      return await readResponse(response);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new Error("Openverse tardó demasiado en responder.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
  // Electron's network stack follows the system proxy and certificate store,
  // which is more reliable than a raw Node request on Windows installations.
  const response = await requestWithElectron();
  if (response.status === 429)
    throw new Error("Openverse recibió demasiadas búsquedas. Esperá un momento e intentá nuevamente.");
  if (response.status === 401 || response.status === 403)
    throw new Error("Openverse rechazó temporalmente la conexión. Volvé a intentar en unos segundos.");
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Openverse no está disponible en este momento (código ${response.status}).`);
  try {
    return JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    throw new Error("Openverse respondió con datos que no se pudieron interpretar.");
  }
}

async function searchOpenverse(
  query: string,
  orientation: "all" | "landscape" | "portrait" | "square",
  page: number,
): Promise<OpenverseSearchResponse> {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  if (!normalizedQuery) return { items: [], page: 1, totalResults: 0, hasMore: false };
  const safePage = Math.max(1, Math.floor(page || 1));
  const cacheKey = `${orientation}:${safePage}:${normalizedQuery.toLocaleLowerCase("es-AR")}`;
  const cached = openverseSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const endpoint = new URL("https://api.openverse.org/v1/images/");
  endpoint.searchParams.set("q", normalizedQuery);
  endpoint.searchParams.set("page", String(safePage));
  // Openverse limits anonymous searches to 20 results per page.
  endpoint.searchParams.set("page_size", "20");
  endpoint.searchParams.set("mature", "false");
  endpoint.searchParams.set("size", "large");
  endpoint.searchParams.set("license", "cc0,pdm,by,by-sa");
  if (orientation !== "all") {
    endpoint.searchParams.set(
      "aspect_ratio",
      orientation === "landscape" ? "wide" : orientation === "portrait" ? "tall" : "square",
    );
  }
  const payload = (await openverseRequest(endpoint)) as {
    results?: Array<Record<string, unknown>>;
    page?: number;
    page_count?: number;
    result_count?: number;
  };
  const items = (payload.results ?? []).flatMap((record): OpenverseMediaResult[] => {
    const externalId = String(record.id || "").trim();
    const creator = String(record.creator || "Autor no informado").trim();
    const previewUrl = String(record.thumbnail || "").trim();
    const downloadUrl = String(record.url || "").trim();
    const width = Number(record.width || 0);
    const height = Number(record.height || 0);
    if (!externalId) return [];
    if (!previewUrl || !downloadUrl) return [];
    const item: OpenverseMediaResult = {
      provider: "Openverse",
      externalId,
      kind: "image",
      title: String(record.title || `${normalizedQuery} · ${creator}`).trim(),
      query: normalizedQuery,
      previewUrl,
      downloadUrl,
      sourceUrl: `https://openverse.org/image/${encodeURIComponent(externalId)}`,
      creator,
      creatorUrl: String(record.creator_url || "").trim(),
      width,
      height,
      license: [String(record.license || "").toUpperCase(), record.license_version]
        .filter(Boolean)
        .join(" "),
      licenseUrl: String(record.license_url || "").trim(),
      source: String(record.source || "Openverse").trim(),
    };
    openverseResultCache.set(externalId, {
      expiresAt: Date.now() + 2 * 60 * 60_000,
      value: item,
    });
    return [item];
  });
  const totalResults = Number(payload.result_count || items.length);
  const currentPage = Number(payload.page || safePage);
  const pageCount = Number(payload.page_count || currentPage);
  const value = {
    items,
    page: currentPage,
    totalResults,
    hasMore: currentPage < pageCount,
  };
  openverseSearchCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, value });
  return value;
}

const openversePreviewCache = new Map<string, { expiresAt: number; value: string }>();

async function loadOpenversePreview(url: string): Promise<string | null> {
  let remote: URL;
  try {
    remote = new URL(String(url));
  } catch {
    return null;
  }
  const hostname = remote.hostname.toLowerCase();
  const allowedHost =
    remote.protocol === "https:" &&
    (hostname === "openverse.org" || hostname.endsWith(".openverse.org") ||
      hostname === "upload.wikimedia.org" || hostname.endsWith(".wikimedia.org") ||
      hostname.endsWith(".staticflickr.com"));
  if (!allowedHost) return null;
  const cacheKey = remote.toString();
  const cached = openversePreviewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await net.fetch(cacheKey, {
    method: "GET",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: "https://openverse.org/",
      "User-Agent": "FL-Proyector/1.0",
    },
  });
  if (!response.ok || !response.body) return null;
  const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  if (!contentType.startsWith("image/")) return null;
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 8 * 1024 * 1024) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) return null;
  const value = `data:${contentType};base64,${bytes.toString("base64")}`;
  openversePreviewCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, value });
  return value;
}

async function importOpenverseMedia(candidate: OpenverseMediaResult) {
  const cached = openverseResultCache.get(String(candidate.externalId || ""));
  if (!cached || cached.expiresAt <= Date.now())
    throw new Error("Este resultado venció. Realizá nuevamente la búsqueda antes de guardarlo.");
  const item = cached.value;
  const remoteUrl = new URL(item.downloadUrl);
  const hostname = remoteUrl.hostname.toLowerCase();
  if (
    remoteUrl.protocol !== "https:" ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) throw new Error("Openverse devolvió una dirección de descarga no permitida.");
  const rawExtension = extname(remoteUrl.pathname).toLowerCase();
  const extension = imageExtensions.includes(rawExtension) ? rawExtension : ".jpg";
  const destination = join(mediaDir, `openverse-${item.externalId}${extension}`);
  const temporaryDestination = `${destination}.download`;
  const response = await net.fetch(remoteUrl.toString());
  if (!response.ok || !response.body)
    throw new Error("No se pudo descargar el fondo desde Openverse.");
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!contentType.toLowerCase().startsWith("image/"))
    throw new Error("El resultado seleccionado no contiene una imagen válida.");
  if (contentLength > 100 * 1024 * 1024)
    throw new Error("La imagen supera el límite de descarga de 100 MB.");
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
    const name = String(item.title || `Openverse ${item.externalId}`).trim();
    const tags = [
      "Openverse",
      item.query,
      "imagen",
      item.width > item.height ? "horizontal" : item.height > item.width ? "vertical" : "cuadrado",
      item.creator,
      item.license,
      item.source,
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
    // Openverse does not require credentials. Remove the obsolete Pexels key
    // left by versions 10.11.11–10.11.13.
    database.saveIntegrationSecret("pexels-api-key", "");
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
    remoteServer = startRemoteServer(() => state, mergeState, moveNativePresentation, {
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
            sourceSongStanzas: stanzas,
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
    ipcMain.handle("projection:get-live-state", () => currentLiveState());
    ipcMain.handle("projection:freeze:get", () => projectionFrozen);
    ipcMain.handle("projection:freeze:set", (_event, frozen: boolean) =>
      setProjectionFrozen(Boolean(frozen)),
    );
    ipcMain.handle("preview:set-state", (_event, next: ProjectionState | null) => {
      previewState = next ? structuredClone(next) : null;
      if (previewProjectionWindow && !previewProjectionWindow.isDestroyed())
        previewProjectionWindow.webContents.send("projection:state", previewState ?? state);
      if (floatingPreviewWindow && !floatingPreviewWindow.isDestroyed())
        floatingPreviewWindow.webContents.send("projection:state", previewState ?? state);
    });
    ipcMain.handle("preview:clear", () => {
      previewState = null;
      if (previewProjectionWindow && !previewProjectionWindow.isDestroyed())
        previewProjectionWindow.webContents.send("projection:state", state);
      if (floatingPreviewWindow && !floatingPreviewWindow.isDestroyed())
        floatingPreviewWindow.webContents.send("projection:state", state);
    });
    ipcMain.handle("preview:window:get", () =>
      Boolean(floatingPreviewWindow && !floatingPreviewWindow.isDestroyed()),
    );
    ipcMain.handle("preview:window:set", async (_event, open: boolean) => {
      if (open) await openFloatingPreview();
      else closeFloatingPreview();
      return Boolean(floatingPreviewWindow && !floatingPreviewWindow.isDestroyed());
    });
    ipcMain.handle("projection:clear-content", clearProjectionContent);
    ipcMain.handle("app:open-external", async (_event, value: unknown) => {
      if (typeof value !== "string") return false;
      try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        const isAllowedHost =
          hostname === "wa.me" ||
          hostname === "openverse.org" ||
          hostname.endsWith(".openverse.org");
        if (url.protocol !== "https:" || !isAllowedHost) return false;
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
      previewProjectionWindow?.close();
      previewState = null;
      setProjectionFrozen(false);
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
    ipcMain.handle("remote:full-control:get", () =>
      remoteServer.getFullControlStatus(),
    );
    ipcMain.handle("remote:full-control:set", (_event, enabled: boolean) =>
      remoteServer.setFullControlEnabled(Boolean(enabled)),
    );
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
    ipcMain.handle(
      "openverse:search",
      (
        _event,
        query: string,
        orientation: "all" | "landscape" | "portrait" | "square",
        page = 1,
      ) => searchOpenverse(query, orientation, page),
    );
    ipcMain.handle("openverse:preview", (_event, url: string) =>
      loadOpenversePreview(url),
    );
    ipcMain.handle(
      "openverse:import",
      (_event, item: OpenverseMediaResult) => importOpenverseMedia(item),
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
      try {
        await shell.trashItem(path);
      } catch {
        // Windows can reject shell.trashItem for files just downloaded by the
        // app. This exact file is inside the managed media directory, so it
        // is safe to remove it as a fallback.
        if (path.startsWith(mediaDir)) await rm(path, { force: true });
        else throw new Error("No se pudo enviar el fondo a la papelera.");
      }
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
        if (settings.previewEnabled && settings.previewDisplayId === null)
          await openFloatingPreview();
        else if (settings.previewDisplayId !== null)
          closeFloatingPreview();
        if (floatingPreviewWindow && !floatingPreviewWindow.isDestroyed()) {
          const ratio = previewAspectRatio(settings);
          floatingPreviewWindow.setAspectRatio(ratio);
          floatingPreviewWindow.webContents.send("projection:display-settings", settings);
        }
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
            name: "PowerPoint (todos los formatos)",
            extensions: ["ppt", "pps", "pot", "pptx", "ppsx", "pptm", "ppsm", "potx", "potm"],
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
        nativeOnly: [".ppt", ".pps", ".pot"].includes(extname(destination).toLowerCase()),
      };
    });
    ipcMain.handle("presentation:read", async (_event, path: string) => {
      const source = String(path || "").trim();
      const extension = extname(source).toLowerCase();
      if (!source || ![".pptx", ".ppsx", ".pptm", ".ppsm", ".potx", ".potm"].includes(extension))
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
    ipcMain.handle("presentation:open", async (_event, path: string) => {
      const source = String(path || "");
      if (process.platform === "win32") return startNativePresentation(source);
      const error = await shell.openPath(source);
      return error ? { ok: false, error } : { ok: true };
    });
    ipcMain.handle("presentation:navigate-native", (_event, direction: -1 | 1) =>
      navigateNativePresentation(direction === -1 ? -1 : 1),
    );
    await createControlWindow();
    const savedDisplaySettings = database.getDisplaySettings();
    if (savedDisplaySettings.previewEnabled && savedDisplaySettings.previewDisplayId === null)
      await openFloatingPreview();
    // Existing MPG/AVI/MOV attachments are upgraded in the background so a
    // large meeting cannot delay the opening of the control window.
    void migrateMeetingVideosToMp4()
      .then(() => {
        if (controlWindow && !controlWindow.isDestroyed())
          controlWindow.webContents.send("library:changed", "meetings");
      })
      .catch((error) =>
        console.warn("No se pudieron revisar los videos de las reuniones.", error),
      );
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
