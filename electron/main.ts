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
import { mkdir, readdir, copyFile, readFile } from "node:fs/promises";
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
  type UpdateStatus,
} from "../shared/types.js";

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
let tagsDialogWindow: BrowserWindow | null = null;
let state: ProjectionState = structuredClone(initialProjectionState);
let database: AppDatabase;
let remoteServer: ReturnType<typeof startRemoteServer>;
let mediaDir = "";
let meetingMediaDir = "";
let churchAssetsDir = "";
let updaterConfigured = false;
let updateStatus: UpdateStatus = {
  state: app.isPackaged ? "idle" : "development",
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  message: app.isPackaged
    ? "Comprobá si existe una versión nueva de Fl Proyector."
    : "Las actualizaciones se comprueban desde la aplicación instalada.",
  packaged: app.isPackaged,
};
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

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
      state: "idle",
      availableVersion: null,
      progress: null,
      message: "Ya tenés instalada la versión más reciente.",
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
  };
  for (const win of [controlWindow, projectionWindow, thirdProjectionWindow])
    if (win && !win.isDestroyed())
      win.webContents.send("projection:state", state);
  remoteServer?.broadcast(state);
}

async function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#090b10",
    title: "Fl Proyector",
    webPreferences: {
      preload: join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
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
  await controlWindow.loadURL(rendererUrl());
}

async function openProjection() {
  if (projectionWindow && !projectionWindow.isDestroyed()) {
    projectionWindow.focus();
    return;
  }
  const displays = screen.getAllDisplays();
  const settings = database.getDisplaySettings();
  const external =
    displays.find((display) => display.id === settings.mainDisplayId) ??
    displays.find((display) => display.id !== screen.getPrimaryDisplay().id);
  projectionWindow = await createProjectionWindow(external, settings);
  projectionWindow.on("closed", () => {
    projectionWindow = null;
    controlWindow?.webContents.send("projection:status-changed", false);
  });
  if (settings.thirdDisplayEnabled) {
    const third = displays.find(
      (display) =>
        display.id === settings.thirdDisplayId && display.id !== external?.id,
    );
    if (third) {
      thirdProjectionWindow = await createProjectionWindow(third, settings);
      thirdProjectionWindow.on("closed", () => {
        thirdProjectionWindow = null;
      });
    }
  }
}

async function createProjectionWindow(
  target: Electron.Display | undefined,
  settings: DisplaySettings,
) {
  const resolution =
    settings.resolution === "display"
      ? null
      : settings.resolution.split("x").map(Number);
  const width = resolution?.[0] ?? target?.bounds.width ?? 960;
  const height = resolution?.[1] ?? target?.bounds.height ?? 540;
  const win = new BrowserWindow({
    // A preset resolution creates an exact, borderless raster on the selected
    // display. Native mode stays fullscreen and uses the display's own size.
    x: target
      ? target.bounds.x + Math.round((target.bounds.width - width) / 2)
      : undefined,
    y: target
      ? target.bounds.y + Math.round((target.bounds.height - height) / 2)
      : undefined,
    width,
    height,
    frame: false,
    fullscreen: Boolean(target && !resolution),
    resizable: false,
    alwaysOnTop: false,
    backgroundColor: settings.backgroundColor,
    webPreferences: {
      preload: join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  await win.loadURL(rendererUrl("projection"));
  win.webContents.once("did-finish-load", () =>
    win.webContents.send("projection:state", state),
  );
  return win;
}

function applyDisplaySettingsToOpenWindows(settings: DisplaySettings) {
  const resolution =
    settings.resolution === "display"
      ? null
      : settings.resolution.split("x").map(Number);
  for (const win of [projectionWindow, thirdProjectionWindow]) {
    if (!win || win.isDestroyed()) continue;
    const target = screen.getDisplayMatching(win.getBounds());
    win.setBackgroundColor(settings.backgroundColor);
    if (resolution) {
      const [width, height] = resolution;
      if (win.isFullScreen()) win.setFullScreen(false);
      win.setBounds({
        x: target.bounds.x + Math.round((target.bounds.width - width) / 2),
        y: target.bounds.y + Math.round((target.bounds.height - height) / 2),
        width,
        height,
      });
    } else if (!win.isFullScreen()) {
      win.setBounds(target.bounds);
      win.setFullScreen(true);
    }
    win.webContents.send("projection:display-settings", settings);
  }
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

function projectRemoteMultimedia(itemId: number) {
  const item = database
    .listMeetings()
    .flatMap((meeting) => database.listMeetingItems(meeting.id))
    .find((value) => value.id === itemId);
  if (!item) return;
  const payload = item.payload as Record<string, unknown>;
  if (item.type === "presentation") {
    const slideCount = Number(payload.slideCount || (payload.previewSlides as unknown[] | undefined)?.length || 0);
    mergeState({
      blackout: false, logo: false, text: { visible: false }, lowerThird: { visible: false }, video: { playing: false },
      presentation: { path: String(payload.path || ""), url: String(payload.url || ""), name: String(payload.name || item.title), previewSlides: payload.previewSlides as string[] | undefined, slideIndex: 0, slideCount, visible: true },
    });
    return;
  }
  if (item.type === "announcement") {
    mergeState({
      blackout: false, logo: false, presentation: { visible: false }, lowerThird: { visible: false }, video: { playing: false },
      text: {
        html: String(payload.html || ""), kind: "anuncio", visible: true,
        position: (payload.position as ProjectionState["text"]["position"]) || "center",
        fontSize: Number(payload.fontSize || 64), fontFamily: String(payload.fontFamily || "Inter"),
        color: String(payload.color || "#ffffff"), backgroundColor: String(payload.backgroundColor || "rgba(0,0,0,0)"),
        align: (payload.align as ProjectionState["text"]["align"]) || "center",
        borderRadius: Number(payload.borderRadius || 0),
        template: (payload.template as ProjectionState["text"]["template"]) || "plain",
      },
    });
    return;
  }
  if (item.type !== "media") return;
  const source = meetingMediaFromPayload(payload);
  if (!source) return;
  if (source.kind === "image") {
    mergeState({
      blackout: false, logo: false, text: { visible: false }, lowerThird: { visible: false }, video: { playing: false },
      presentation: { path: null, url: source.url, name: source.name, previewSlides: [source.url], slideIndex: 0, slideCount: 1, visible: true },
    });
    return;
  }
  mergeState({
    blackout: false, logo: false, text: { visible: false }, lowerThird: { visible: false }, presentation: { visible: false },
    background: { id: source.id, url: source.url, name: source.name, kind: source.kind },
    video: source.kind === "video" ? { playing: true, seekTime: 0, commandId: state.video.commandId + 1 } : { playing: false },
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

if (hasSingleInstanceLock)
  app.whenReady().then(async () => {
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
    }, {
      getCode: () => database.getCollaboratorCode(),
      listSongs: () => database.listSongs(""),
      saveSong: (song) => database.saveSong(song),
      listMeetings: () => database.listMeetings(),
      createMeeting: (name, date) => database.createMeeting(name, date),
      listMeetingItems: (meetingId) => database.listMeetingItems(meetingId),
      saveMeetingItem: (item) => database.saveMeetingItem(item),
    });
    await syncMedia();
    chokidar
      .watch(mediaDir, { ignoreInitial: true })
      .on("all", () => syncMedia());

    registerAutoUpdaterEvents();
    ipcMain.handle("updates:get-status", () => updateStatus);
    ipcMain.handle("updates:check", async () => {
      if (!app.isPackaged)
        return publishUpdateStatus({
          state: "development",
          currentVersion: app.getVersion(),
          availableVersion: null,
          progress: null,
          message:
            "La comprobación real estará disponible en el ejecutable instalado.",
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
        message: "Buscando actualizaciones en GitHub…",
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
          width: display.bounds.width,
          height: display.bounds.height,
          primary: display.id === screen.getPrimaryDisplay().id,
        })),
        remoteUrls: addresses.map((address) => `http://${address}:3001`),
      };
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
            webPreferences: {
              preload: join(app.getAppPath(), "electron", "preload.cjs"),
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
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
      (_event, settings: DisplaySettings) => {
        database.saveDisplaySettings(settings);
        applyDisplaySettingsToOpenWindows(settings);
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
