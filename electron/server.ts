import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collaboratorHtml } from "./collaboratorPage.js";
import {
  shouldSplitBibleVerse,
  splitBibleVerse,
} from "../shared/bibleLayout.js";
import {
  normalizeSongSectionTypes,
  songSectionLabel,
  splitSongStanzas,
} from "../shared/songSections.js";
import type {
  BibleBook,
  BibleVerse,
  BibleVersion,
  Meeting,
  MeetingItem,
  ProjectionPatch,
  ProjectionState,
  Song,
  LiveAudienceStatus,
} from "../shared/types.js";

// This is served by the projector itself. Update checks for the remote never
// need an Internet connection: the phone compares against the PC on its LAN.
const remoteClientVersion = "10.11.32";

type LiveAudiencePayload =
  | {
      type: "waiting";
      hash: string;
      message: string;
    }
  | {
      type: "blank";
      hash: string;
    }
  | {
      type: "text";
      hash: string;
      kind: ProjectionState["text"]["kind"];
      html: string;
      title: string;
      fontFamily: string;
      color: string;
      align: ProjectionState["text"]["align"];
      alert: string;
    }
  | {
      type: "image";
      hash: string;
      url: string;
    };

type BibleRemoteSource = {
  listVersions: () => BibleVersion[];
  listBooks: (versionId: number) => BibleBook[];
  listVerses: (
    versionId: number,
    book: string,
    chapter: number,
  ) => BibleVerse[];
};

type RemoteMultimediaItem = {
  id: number;
  title: string;
  type: "media" | "presentation" | "announcement";
  kind: "image" | "video" | "presentation" | "announcement";
};

type MultimediaRemoteSource = {
  listMeetings: () => Meeting[];
  listItems: (meetingId: number) => RemoteMultimediaItem[];
  project: (itemId: number) => void;
  clear: () => void;
  activeItemId: () => number | null;
};

type CollaboratorSource = {
  getCode: () => string;
  listSongs: () => Song[];
  saveSong: (song: Partial<Song> & { title: string; content: string }) => number;
  songSaved?: (id: number) => void;
  listMeetings: () => Meeting[];
  createMeeting: (name: string, date?: string | null) => number;
  updateMeeting: (id: number, patch: Partial<Pick<Meeting, "name" | "color">>) => void;
  deleteMeeting: (id: number) => void;
  listMeetingItems: (meetingId: number) => MeetingItem[];
  saveMeetingItem: (item: Partial<MeetingItem> & { meetingId: number; type: string; title: string; color: string; payload: Record<string, unknown> }) => number;
  deleteMeetingItem: (id: number) => void;
  reorderMeetingItems: (meetingId: number, ids: number[]) => void;
  notifyChanged: (scope: "songs" | "meetings") => void;
};

export function startRemoteServer(
  getState: () => ProjectionState,
  applyPatch: (patch: ProjectionPatch) => void,
  bible: BibleRemoteSource,
  multimedia: MultimediaRemoteSource,
  collaborator: CollaboratorSource,
) {
  const app = express();
  const server = createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });
  let liveCode: string | null = null;
  let livePayload: LiveAudiencePayload | null = null;
  let liveFrame: { hash: string; jpeg: Buffer } | null = null;
  let liveViewerAnnouncementTimer: ReturnType<typeof setTimeout> | null = null;
  // This permission is intentionally memory-only. Every desktop restart puts
  // the phone back in the safer Biblia + Multimedia mode.
  let fullControlEnabled = false;
  const liveRoom = () => (liveCode ? `live:${liveCode}` : null);
  const liveViewerCount = () => {
    const room = liveRoom();
    return room ? io.sockets.adapter.rooms.get(room)?.size ?? 0 : 0;
  };
  const liveStatus = (): LiveAudienceStatus => ({
    active: Boolean(liveCode),
    code: liveCode,
    viewers: liveViewerCount(),
  });
  const announceLiveViewerCount = (room: string) => {
    if (liveViewerAnnouncementTimer) clearTimeout(liveViewerAnnouncementTimer);
    liveViewerAnnouncementTimer = setTimeout(() => {
      liveViewerAnnouncementTimer = null;
      const viewers = io.sockets.adapter.rooms.get(room)?.size ?? 0;
      io.to(room).emit("live:viewers", viewers);
      console.info(`Live: ${viewers} viewers conectados`);
    }, 60);
  };
  const contentHash = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex").slice(0, 20);
  const waitingPayload = (message = "Esperando contenido…"): LiveAudiencePayload => ({
    type: "waiting",
    hash: contentHash(`waiting:${message}`),
    message,
  });
  const blankPayload = (reason: string): LiveAudiencePayload => ({
    type: "blank",
    hash: contentHash(`blank:${reason}`),
  });
  const audiencePayloadForState = (
    state: ProjectionState,
  ): LiveAudiencePayload | null => {
    if (state.blackout) return blankPayload("blackout");
    if (state.logo) return blankPayload("logo");
    if (state.text.visible && !state.text.html.includes("data-live-audience-qr")) {
      const source = {
        kind: state.text.kind,
        html: state.text.html,
        title: state.text.title,
        fontFamily: state.text.fontFamily,
        color: state.text.color,
        align: state.text.align,
        alert: state.alert.visible ? state.alert.message : "",
      };
      return { type: "text", hash: contentHash(JSON.stringify(source)), ...source };
    }
    if (state.lowerThird.visible) {
      const source = {
        kind: "anuncio" as const,
        html: `<p>${escapeAudienceHtml(state.lowerThird.subtitle)}</p>`,
        title: state.lowerThird.title,
        fontFamily: "Inter",
        color: "#ffffff",
        align: "center" as const,
        alert: state.alert.visible ? state.alert.message : "",
      };
      return { type: "text", hash: contentHash(JSON.stringify(source)), ...source };
    }
    if (state.presentation.visible) return null;
    if (!state.text.visible && !state.text.html.trim())
      return blankPayload("clear-text");
    // Images and PowerPoint slides are supplied by capturePage after the
    // projector has rendered the final frame. Videos are deliberately not
    // streamed over Wi-Fi to keep audience mode lightweight.
    if (
      state.background.kind === "image" && Boolean(state.background.url)
    )
      return null;
    if (state.background.kind === "video" && state.background.url)
      return waitingPayload("Video en reproducción en la pantalla principal.");
    if (state.alert.visible) {
      const source = {
        kind: "anuncio" as const,
        html: `<p>${escapeAudienceHtml(state.alert.message)}</p>`,
        title: "Alerta",
        fontFamily: "Inter",
        color: state.alert.color,
        align: "center" as const,
        alert: "",
      };
      return { type: "text", hash: contentHash(JSON.stringify(source)), ...source };
    }
    return waitingPayload();
  };
  const emitLivePayload = (payload: LiveAudiencePayload) => {
    if (!liveCode || payload.hash === livePayload?.hash) return;
    livePayload = payload;
    io.to(`live:${liveCode}`).emit("live:update", payload);
  };
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const remoteApkPath = path.resolve(
    moduleDirectory,
    "../../assets/FL-Remoto.apk",
  );
  const remoteIcon192Path = path.resolve(
    moduleDirectory,
    "../../assets/remote-icon-192.png",
  );
  const remoteIcon512Path = path.resolve(
    moduleDirectory,
    "../../assets/remote-icon-512.png",
  );
  app.use(express.json({ limit: "256kb" }));

  const collaboratorTokens = new Set<string>();
  const collaboratorChanged = (scope: "songs" | "meetings") => {
    collaborator.notifyChanged(scope);
    io.emit("collaborator:changed", scope);
  };
  const collaboratorSession = (request: express.Request) => {
    const match = request.headers.cookie?.match(/(?:^|;\s*)fl_collaborator=([^;]+)/);
    return Boolean(match?.[1] && collaboratorTokens.has(match[1]));
  };
  const collaboratorOnly: express.RequestHandler = (request, response, next) => {
    if (collaboratorSession(request)) return next();
    return response.status(401).json({ error: "Acceso no autorizado" });
  };
  const fullControlOnly: express.RequestHandler = (_request, response, next) => {
    if (fullControlEnabled) return next();
    return response.status(403).json({
      error: "El operador debe habilitar App · Control total desde FL Proyector.",
    });
  };

  app.get("/", (_req, res) =>
    res.set("Cache-Control", "no-store").type("html").send(remoteHtml),
  );
  app.get("/api/discovery", (_req, res) =>
    res
      .set("X-FL-Proyector", "1")
      // The installed iOS web app uses this tiny public LAN endpoint to find
      // the projector again after DHCP gives the PC a different address.
      .set("Access-Control-Allow-Origin", "*")
      .json({ service: "fl-proyector", name: "FL Proyector", port: 3001, remoteVersion: remoteClientVersion }),
  );
  app.get("/api/remote/app-version", (_req, res) =>
    res.set("Cache-Control", "no-store").json({
      webVersion: remoteClientVersion,
      androidVersion: remoteClientVersion,
      apkPath: "/downloads/FL-Remoto.apk",
    }),
  );
  app.get("/colaborador", (_req, res) => res.type("html").send(collaboratorHtml));
  app.get("/live/:code", (_req, res) => res.type("html").send(liveAudienceHtml));
  app.get("/live-assets/:code/:hash.jpg", (req, res) => {
    if (
      !liveCode ||
      req.params.code !== liveCode ||
      !liveFrame ||
      req.params.hash !== liveFrame.hash
    )
      return res.status(404).end();
    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "image/jpeg",
      ETag: `"${liveFrame.hash}"`,
    });
    return res.send(liveFrame.jpeg);
  });
  app.get("/manifest.webmanifest", (_req, res) =>
    res.type("application/manifest+json").send({
      name: "FL Proyector Remoto",
      short_name: "FL Remoto",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      display_override: ["standalone", "minimal-ui"],
      orientation: "any",
      background_color: "#0c1018",
      theme_color: "#5b42ea",
      categories: ["utilities", "productivity"],
      prefer_related_applications: false,
      icons: [
        {
          src: "/remote-icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable",
        },
        {
          src: "/remote-icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    }),
  );
  app.get("/remote-icon.svg", (_req, res) =>
    res.type("image/svg+xml").send(remoteIcon),
  );
  app.get("/remote-icon-192.png", (_req, res) =>
    res.sendFile(remoteIcon192Path),
  );
  app.get("/remote-icon-512.png", (_req, res) =>
    res.sendFile(remoteIcon512Path),
  );
  app.get("/downloads/FL-Remoto.apk", (_req, res) => {
    if (!existsSync(remoteApkPath))
      return res.status(404).send("El instalador móvil no está disponible.");
    return res.download(remoteApkPath, "FL-Remoto.apk");
  });
  app.get("/sw.js", (_req, res) =>
    res
      .set("Cache-Control", "no-store")
      .type("application/javascript")
      .send(serviceWorker),
  );
  app.get("/api/state", (_req, res) => res.json(getState()));
  app.get("/api/collaborator/session", (request, response) =>
    response.json({ authenticated: collaboratorSession(request), configured: Boolean(collaborator.getCode()) }),
  );
  app.post("/api/collaborator/login", (request, response) => {
    const expected = collaborator.getCode();
    if (!expected) return response.status(409).json({ error: "El operador debe crear un código de acceso en Remoto." });
    if (String(request.body?.code ?? "") !== expected)
      return response.status(401).json({ error: "Código incorrecto" });
    const token = randomUUID();
    collaboratorTokens.add(token);
    response.cookie("fl_collaborator", token, { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 12 });
    return response.status(204).end();
  });
  app.post("/api/collaborator/logout", collaboratorOnly, (request, response) => {
    const token = request.headers.cookie?.match(/(?:^|;\s*)fl_collaborator=([^;]+)/)?.[1];
    if (token) collaboratorTokens.delete(token);
    response.clearCookie("fl_collaborator");
    response.status(204).end();
  });
  app.get("/api/collaborator/songs", collaboratorOnly, (_request, response) => response.json(collaborator.listSongs()));
  app.post("/api/collaborator/songs", collaboratorOnly, (request, response) => {
    const source = request.body ?? {};
    const title = String(source.title ?? "").trim();
    const content = String(source.content ?? "").trim();
    if (!title) return response.status(400).json({ error: "Indicá el título de la canción." });
    const existing = Number.isInteger(source.id)
      ? collaborator.listSongs().find((song) => song.id === source.id)
      : undefined;
    const id = collaborator.saveSong({
      ...existing,
      id: Number.isInteger(source.id) ? source.id : undefined,
      title,
      content,
      color:
        typeof source.color === "string"
          ? source.color
          : existing?.color || "#665cff",
      categoryId: existing?.categoryId ?? null,
      sectionTypes: normalizeSongSectionTypes(
        Array.isArray(source.sectionTypes)
          ? source.sectionTypes
          : existing?.sectionTypes,
        splitSongStanzas(content).length,
      ),
    });
    collaborator.songSaved?.(id);
    collaboratorChanged("songs");
    return response.json({ id });
  });
  app.get("/api/collaborator/meetings", collaboratorOnly, (_request, response) => response.json(collaborator.listMeetings()));
  app.post("/api/collaborator/meetings", collaboratorOnly, (request, response) => {
    const name = String(request.body?.name ?? "").trim();
    if (!name) return response.status(400).json({ error: "Indicá el nombre de la reunión." });
    const id = collaborator.createMeeting(name, typeof request.body?.date === "string" ? request.body.date : null);
    collaboratorChanged("meetings");
    return response.json({ id });
  });
  app.patch("/api/collaborator/meetings/:meetingId", collaboratorOnly, (request, response) => {
    const id = Number(request.params.meetingId), name = String(request.body?.name ?? "").trim();
    if (!Number.isInteger(id) || !name) return response.status(400).json({ error: "Indicá un nombre válido." });
    collaborator.updateMeeting(id, { name, color: typeof request.body?.color === "string" ? request.body.color : undefined });
    collaboratorChanged("meetings");
    return response.status(204).end();
  });
  app.delete("/api/collaborator/meetings/:meetingId", collaboratorOnly, (request, response) => {
    const id = Number(request.params.meetingId);
    if (!Number.isInteger(id)) return response.status(400).json({ error: "Reunión inválida." });
    collaborator.deleteMeeting(id);
    collaboratorChanged("meetings");
    return response.status(204).end();
  });
  app.get("/api/collaborator/meetings/:meetingId/items", collaboratorOnly, (request, response) => {
    const id = Number(request.params.meetingId);
    return response.json(Number.isInteger(id) ? collaborator.listMeetingItems(id) : []);
  });
  app.post("/api/collaborator/meetings/:meetingId/items", collaboratorOnly, (request, response) => {
    const meetingId = Number(request.params.meetingId), item = request.body ?? {};
    if (!Number.isInteger(meetingId) || !String(item.title ?? "").trim()) return response.status(400).json({ error: "Elemento inválido" });
    const type = ["announcement", "bible", "media", "presentation", "song"].includes(String(item.type))
      ? (String(item.type) as MeetingItem["type"])
      : "announcement";
    const id = collaborator.saveMeetingItem({ id: Number.isInteger(item.id) ? item.id : undefined, meetingId, type, title: String(item.title).trim(), color: typeof item.color === "string" ? item.color : "#665cff", payload: typeof item.payload === "object" && item.payload ? item.payload : {} });
    collaboratorChanged("meetings");
    return response.json({ id });
  });
  app.delete("/api/collaborator/meeting-items/:itemId", collaboratorOnly, (request, response) => {
    const id = Number(request.params.itemId);
    if (!Number.isInteger(id)) return response.status(400).json({ error: "Elemento inválido." });
    collaborator.deleteMeetingItem(id);
    collaboratorChanged("meetings");
    return response.status(204).end();
  });
  app.post("/api/collaborator/meetings/:meetingId/reorder", collaboratorOnly, (request, response) => {
    const meetingId = Number(request.params.meetingId);
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!Number.isInteger(meetingId) || !ids.length) return response.status(400).json({ error: "Orden inválido." });
    collaborator.reorderMeetingItems(meetingId, ids);
    collaboratorChanged("meetings");
    return response.status(204).end();
  });
  app.get("/api/bible/versions", (_req, res) => res.json(bible.listVersions()));
  app.get("/api/bible/books/:versionId", (req, res) => {
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId)) return res.status(400).json([]);
    return res.json(bible.listBooks(versionId));
  });
  app.get("/api/bible/verses/:versionId/:book/:chapter", (req, res) => {
    const versionId = Number(req.params.versionId);
    const chapter = Number(req.params.chapter);
    if (!Number.isInteger(versionId) || !Number.isInteger(chapter))
      return res.status(400).json([]);
    const verses = bible.listVerses(
      versionId,
      decodeURIComponent(req.params.book),
      chapter,
    );
    // The phone must show exactly the same selectable A/B pieces as the
    // desktop operator when that setting is enabled.
    const bibleStyle = getState().bibleStyle;
    if (bibleStyle.longVerseMode === "auto-fit")
      return res.json(verses);
    return res.json(
      verses.flatMap<unknown>((verse) => {
        if (!shouldSplitBibleVerse(verse.text, bibleStyle, getState().outputViewport))
          return [verse];
        const parts = splitBibleVerse(
          verse.text,
          bibleStyle,
          getState().outputViewport,
        );
        return parts.map((text, index) => ({
          ...verse,
          text,
          // The controller uses this label in the list and in the reference
          // sent to projection, e.g. Juan 3:16a / Juan 3:16b.
          verse: `${verse.verse}${parts.length > 1 ? String.fromCharCode(97 + Math.min(index, 25)) : ""}`,
        }));
      }),
    );
  });
  app.get("/api/remote/meetings", (_req, res) =>
    res.json(multimedia.listMeetings().map(({ id, name, itemCount }) => ({ id, name, itemCount }))),
  );
  app.get("/api/remote/capabilities", (_req, res) =>
    res.json({ fullControlEnabled }),
  );
  app.get("/api/remote/songs/:meetingId", fullControlOnly, (req, res) => {
    const meetingId = Number(req.params.meetingId);
    if (!Number.isInteger(meetingId)) return res.json([]);
    const songs = new Map(collaborator.listSongs().map((song) => [song.id, song]));
    return res.json(
      collaborator
        .listMeetingItems(meetingId)
        .filter((item) => item.type === "song")
        .flatMap((item) => {
          const song = songs.get(Number(item.payload?.songId));
          if (!song) return [];
          const sections = splitSongStanzas(song.content);
          const sectionTypes = normalizeSongSectionTypes(
            song.sectionTypes,
            sections.length,
          );
          return [{
            itemId: item.id,
            songId: song.id,
            title: song.title,
            sections: sections.map((html, index) => ({
              index,
              html,
              text: html
                .replace(/<br\s*\/?\s*>/gi, "\n")
                .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
                .replace(/<[^>]+>/g, "")
                .replace(/&nbsp;/gi, " ")
                .trim(),
              label: songSectionLabel(sectionTypes, index),
            })),
            active:
              getState().text.kind === "canto" &&
              getState().text.sourceSongId === song.id,
            activeSection:
              getState().text.kind === "canto" &&
              getState().text.sourceSongId === song.id
                ? Number(getState().text.sourceSectionIndex ?? 0)
                : null,
          }];
        }),
    );
  });
  app.get("/api/remote/multimedia/:meetingId", (req, res) => {
    const meetingId = Number(req.params.meetingId);
    const activeItemId = multimedia.activeItemId();
    return res.json(
      Number.isInteger(meetingId)
        ? multimedia
            .listItems(meetingId)
            .map((item) => ({ ...item, active: item.id === activeItemId }))
        : [],
    );
  });
  app.post("/api/remote/patch", (req, res) => {
    const patch = req.body as ProjectionPatch;
    // Bible replaces foreground multimedia, but preserves the church
    // background (including an animated background and its playback state).
    if (patch.text?.kind === "biblia") {
      const beforeClear = getState();
      multimedia.clear();
      applyPatch({
        ...patch,
        // The mobile client intentionally sends only the Bible foreground.
        // Re-attach the exact background captured before clearing multimedia
        // so a remote song/video can never blank the church background.
        background: { ...beforeClear.background },
        video: { ...beforeClear.video, loop: beforeClear.background.kind === "video" },
        presentation: { visible: false },
        lowerThird: { visible: false },
      });
    } else applyPatch(patch);
    res.status(204).end();
  });
  app.post("/api/remote/clear", (_req, res) => {
    multimedia.clear();
    res.status(204).end();
  });
  app.post("/api/remote/multimedia/:itemId", (req, res) => {
    const itemId = Number(req.params.itemId);
    if (Number.isInteger(itemId)) multimedia.project(itemId);
    res.status(204).end();
  });
  app.post("/api/remote/video", (req, res) => {
    applyPatch({ video: req.body as Partial<ProjectionState["video"]> });
    res.status(204).end();
  });
  app.post("/api/remote/presentation", (req, res) => {
    const direction = Number(req.body?.direction);
    const current = getState().presentation;
    if (current.visible && (direction === -1 || direction === 1)) {
      applyPatch({
        presentation: {
          navigationId: Number(current.navigationId || 0) + 1,
          navigationDirection: direction as -1 | 1,
        },
      });
    }
    res.status(204).end();
  });
  app.post("/api/remote/song-section", fullControlOnly, (req, res) => {
    const meetingId = Number(req.body?.meetingId);
    const itemId = Number(req.body?.itemId);
    const requestedIndex = Number(req.body?.sectionIndex);
    const meetingItem = Number.isInteger(meetingId)
      ? collaborator
          .listMeetingItems(meetingId)
          .find((item) => item.id === itemId && item.type === "song")
      : undefined;
    const song = meetingItem
      ? collaborator
          .listSongs()
          .find((entry) => entry.id === Number(meetingItem.payload?.songId))
      : undefined;
    if (!meetingItem || !song)
      return res.status(404).json({ error: "No se encontró la canción en esta reunión." });
    const sections = splitSongStanzas(song.content);
    if (!sections.length)
      return res.status(409).json({ error: "La canción no tiene estrofas para proyectar." });
    const sectionIndex = Math.max(
      0,
      Math.min(
        Number.isInteger(requestedIndex) ? requestedIndex : 0,
        sections.length - 1,
      ),
    );
    // A song replaces foreground multimedia while retaining the current
    // background, exactly like song projection from the desktop workspace.
    multimedia.clear();
    const state = getState();
    const style = state.songStyle;
    applyPatch({
      blackout: false,
      logo: false,
      presentation: { visible: false },
      lowerThird: { visible: false },
      text: {
        html: sections[sectionIndex],
        kind: "canto",
        sourceSongId: song.id,
        sourceSectionIndex: sectionIndex,
        sourceSongStanzas: sections,
        visible: true,
        position: style.position,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        color: style.textColor,
        backgroundColor: style.backgroundColor,
        align: style.align,
        borderRadius: style.borderRadius,
        template: style.template,
        animation: "fade",
        shadowEnabled: song.shadowEnabled,
        shadowColor: song.shadowColor,
        shadowBlur: song.shadowBlur,
        title: style.showTitle ? song.title : "",
        titlePosition: style.titlePosition,
        titleColor: style.titleColor,
        titleBackground: style.titleBackground,
        titleFontSize: style.titleFontSize,
        titleStyle: style.titleStyle,
      },
    });
    return res.status(204).end();
  });

  io.on("connection", (socket) => {
    const role = socket.handshake.query.role;
    const controller = role !== "live" && role !== "collaborator";
    if (controller) {
      socket.join("projection-controllers");
      socket.emit("projection:state", getState());
      socket.emit("remote:capabilities", { fullControlEnabled });
      socket.on("projection:patch", (patch: ProjectionPatch) => applyPatch(patch));
      socket.on("remote:project-multimedia", (itemId: number) => {
        if (Number.isInteger(itemId)) multimedia.project(itemId);
      });
      socket.on("remote:video", (video: Partial<ProjectionState["video"]>) =>
        applyPatch({ video }),
      );
      socket.on("remote:presentation", (direction: -1 | 1) => {
        const current = getState().presentation;
        if (!current.visible || ![-1, 1].includes(direction)) return;
        applyPatch({
          presentation: {
            navigationId: Number(current.navigationId || 0) + 1,
            navigationDirection: direction,
          },
        });
      });
    }
    socket.on("live:join", (code: string) => {
      if (!liveCode || String(code) !== liveCode) {
        socket.emit("live:error", "La transmisión no está disponible o el código venció.");
        return;
      }
      const room = `live:${liveCode}`;
      socket.join(room);
      socket.data.liveRoom = room;
      if (livePayload) socket.emit("live:update", livePayload);
      announceLiveViewerCount(room);
    });
    socket.on("disconnect", () => {
      const room = socket.data.liveRoom as string | undefined;
      if (!room) return;
      announceLiveViewerCount(room);
    });
  });

  const broadcast = (state: ProjectionState) => {
    io.to("projection-controllers").emit("projection:state", state);
    if (!liveCode) return;
    const payload = audiencePayloadForState(state);
    if (payload) emitLivePayload(payload);
  };
  let available = false;
  server.once("listening", () => {
    available = true;
    console.info("[remote-server] listo en puerto 3001");
  });
  server.on("error", (error) => {
    available = false;
    console.error("[remote-server]", error);
  });
  server.listen(3001, "0.0.0.0");
  return {
    close: () => {
      io.close();
      server.close();
    },
    broadcast,
    startLiveAudience: (state: ProjectionState) => {
      if (liveCode) io.to(`live:${liveCode}`).emit("live:ended");
      liveCode = String(randomInt(100000, 1000000));
      livePayload = null;
      liveFrame = null;
      const payload = audiencePayloadForState(state);
      if (payload) emitLivePayload(payload);
      return liveStatus();
    },
    stopLiveAudience: () => {
      if (liveCode) io.to(`live:${liveCode}`).emit("live:ended");
      if (liveViewerAnnouncementTimer) clearTimeout(liveViewerAnnouncementTimer);
      liveViewerAnnouncementTimer = null;
      liveCode = null;
      livePayload = null;
      liveFrame = null;
      return liveStatus();
    },
    getLiveAudienceStatus: liveStatus,
    needsLiveFrame: (state: ProjectionState) =>
      Boolean(
        liveCode &&
          !state.blackout &&
          !state.logo &&
          !state.text.visible &&
          (state.presentation.visible ||
            (state.background.kind === "image" &&
              state.background.url &&
              state.text.html.trim())),
      ),
    broadcastLiveFrame: (jpeg: Buffer) => {
      if (!liveCode) return;
      const hash = contentHash(jpeg);
      if (hash === liveFrame?.hash) return;
      liveFrame = { hash, jpeg };
      emitLivePayload({
        type: "image",
        hash,
        url: `/live-assets/${liveCode}/${hash}.jpg`,
      });
    },
    getFullControlStatus: () => ({ fullControlEnabled }),
    setFullControlEnabled: (enabled: boolean) => {
      fullControlEnabled = Boolean(enabled);
      io.to("projection-controllers").emit("remote:capabilities", {
        fullControlEnabled,
      });
      return { fullControlEnabled };
    },
    isAvailable: () => available,
  };
}

function escapeAudienceHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

const liveAudienceHtml = String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>FL Proyector · En vivo</title><style>
*{box-sizing:border-box}[hidden]{display:none!important}html,body{margin:0;min-height:100%;background:#090b12;color:#fff;font-family:Inter,"Segoe UI",Arial,sans-serif}body{min-height:100dvh;display:grid;grid-template-rows:auto 1fr;background:radial-gradient(circle at top,#211b52 0,#0c101b 38%,#080a10 100%)}body.blank{background:#000}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:max(14px,env(safe-area-inset-top)) 18px 12px;border-bottom:1px solid #ffffff18;background:#0d111dcc;backdrop-filter:blur(16px);position:sticky;top:0;z-index:2}.brand{display:flex;align-items:center;gap:10px;font-weight:800}.brand i{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#5b42ea;font-style:normal}.header-actions{display:flex;align-items:center;gap:10px}.connection{text-align:right}.capture{display:grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid #ffffff24;border-radius:10px;color:#e8eaff;background:#ffffff0d;touch-action:manipulation}.capture:active:not(:disabled){transform:scale(.94);background:#5b42ea}.capture:disabled{opacity:.28}.capture svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.status{display:flex;align-items:center;justify-content:flex-end;gap:7px;color:#aeb8cb;font-size:13px}.status:before{content:"";width:8px;height:8px;border-radius:50%;background:#f59e0b}.status.online:before{background:#22c55e}.viewer-count{font-size:12px;color:#8f9aaf}main{display:grid;place-items:center;min-height:0;padding:clamp(20px,5vw,64px)}.stage{width:min(100%,1100px);text-align:center}.waiting{display:grid;place-items:center;gap:18px;min-height:50dvh;color:#abb4c5}.waiting .pulse{width:64px;height:64px;border-radius:20px;background:#5b42ea;box-shadow:0 0 0 0 #7865ff66;animation:pulse 1.8s infinite}.content{font-size:clamp(30px,6.5vw,78px);font-weight:700;line-height:1.16;text-wrap:balance}.content p{margin:.18em 0}.content .bible-slide{display:flex;flex-direction:column;gap:.5em}.content .bible-reference-label{display:inline-block;font-size:.34em;padding:.28em .65em}.title{margin-top:26px;color:#a997ff;font-size:clamp(18px,3vw,32px);font-weight:800}.alert{display:none;margin:24px auto 0;width:max-content;max-width:100%;padding:10px 18px;border-radius:999px;background:#b91c1c;font-size:clamp(17px,2.5vw,26px);font-weight:800}.alert.visible{display:block}.slide{display:block;width:100%;max-height:76dvh;object-fit:contain;border-radius:12px;box-shadow:0 18px 60px #0008}.ended{color:#fca5a5}@keyframes pulse{70%{box-shadow:0 0 0 28px #7865ff00}100%{box-shadow:0 0 0 0 #7865ff00}}@media(max-width:600px){header{align-items:center}.viewer-count{display:none}main{padding:24px 18px}.content{font-size:clamp(28px,9vw,52px)}}
</style></head><body><header><div class="brand"><i>FL</i><span>Lectura en vivo</span></div><div class="header-actions"><button id="capture" class="capture" type="button" disabled aria-label="Guardar captura" title="Guardar captura"><svg viewBox="0 0 24 24"><path d="M14.5 5 13 3h-2L9.5 5H6.8A2.8 2.8 0 0 0 4 7.8v8.4A2.8 2.8 0 0 0 6.8 19h10.4a2.8 2.8 0 0 0 2.8-2.8V7.8A2.8 2.8 0 0 0 17.2 5Z"/><circle cx="12" cy="12" r="3.5"/></svg></button><div class="connection"><div id="status" class="status">Conectando…</div><div id="viewers" class="viewer-count"></div></div></div></header><main><section class="stage"><div id="waiting" class="waiting"><div class="pulse"></div><strong>Esperando contenido…</strong></div><div id="text-wrap" hidden><div id="content" class="content"></div><div id="title" class="title"></div><div id="alert" class="alert"></div></div><img id="slide" class="slide" hidden alt="Contenido proyectado" crossorigin="anonymous"></section></main><script src="/socket.io/socket.io.js"></script><script>
var code=location.pathname.split('/').filter(Boolean).pop(),socket=io({query:{role:'live'},timeout:5000,reconnection:true,reconnectionDelay:500,reconnectionDelayMax:3000}),lastHash='',currentMode='waiting',statusEl=document.getElementById('status'),waiting=document.getElementById('waiting'),textWrap=document.getElementById('text-wrap'),content=document.getElementById('content'),title=document.getElementById('title'),alertEl=document.getElementById('alert'),slide=document.getElementById('slide'),viewers=document.getElementById('viewers'),captureButton=document.getElementById('capture');
function showOnly(target){currentMode=target;document.body.classList.toggle('blank',target==='blank');waiting.hidden=target!=='waiting';textWrap.hidden=target!=='text';slide.hidden=target!=='image';captureButton.disabled=target!=='text'&&target!=='image'}
function wrapCanvasText(context,text,maxWidth){var lines=[];String(text||'').split(/\n+/).forEach(function(paragraph){var words=paragraph.trim().split(/\s+/).filter(Boolean),line='';words.forEach(function(word){var candidate=line?line+' '+word:word;if(line&&context.measureText(candidate).width>maxWidth){lines.push(line);line=word}else line=candidate});if(line)lines.push(line)});return lines}
function saveCanvas(canvas){canvas.toBlob(function(blob){if(!blob)return;var file=new File([blob],'fl-proyector-'+Date.now()+'.jpg',{type:'image/jpeg'}),share={files:[file],title:'FL Proyector'};if(navigator.share&&navigator.canShare&&navigator.canShare(share)){navigator.share(share).catch(function(){})}else{var link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=file.name;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(link.href)},1500)}},'image/jpeg',.92)}
function captureCurrent(){if(currentMode==='image'&&slide.complete&&slide.naturalWidth){var imageCanvas=document.createElement('canvas'),imageContext=imageCanvas.getContext('2d'),maxWidth=1600,scale=Math.min(1,maxWidth/slide.naturalWidth);imageCanvas.width=Math.max(1,Math.round(slide.naturalWidth*scale));imageCanvas.height=Math.max(1,Math.round(slide.naturalHeight*scale));imageContext.fillStyle='#090b12';imageContext.fillRect(0,0,imageCanvas.width,imageCanvas.height);imageContext.drawImage(slide,0,0,imageCanvas.width,imageCanvas.height);saveCanvas(imageCanvas);return}if(currentMode!=='text')return;var canvas=document.createElement('canvas'),context=canvas.getContext('2d'),width=1080,height=1350,padding=80,text=(content.innerText||'').trim(),footer=(title.innerText||'').trim(),fontFamily=content.style.fontFamily||'Inter';canvas.width=width;canvas.height=height;context.fillStyle='#090b12';context.fillRect(0,0,width,height);context.textAlign='center';context.textBaseline='middle';context.fillStyle=content.style.color||'#ffffff';var fontSize=text.length>280?50:text.length>180?60:text.length>100?72:88,lines,lineHeight;do{context.font='700 '+fontSize+'px '+fontFamily;lines=wrapCanvasText(context,text,width-padding*2);lineHeight=fontSize*1.18;if(lines.length*lineHeight>(footer?height-250:height-160))fontSize-=4;else break}while(fontSize>34);var footerSpace=footer?120:0,start=(height-footerSpace-lines.length*lineHeight)/2;lines.forEach(function(line,index){context.fillText(line,width/2,start+lineHeight*(index+.5))});if(footer){context.fillStyle='#a997ff';context.font='800 40px '+fontFamily;context.fillText(footer,width/2,height-85)}saveCanvas(canvas)}
captureButton.onclick=captureCurrent;
socket.on('connect',function(){statusEl.textContent='Conectado';statusEl.classList.add('online');socket.emit('live:join',code)});socket.on('disconnect',function(){statusEl.textContent='Reconectando…';statusEl.classList.remove('online')});socket.on('live:error',function(message){showOnly('waiting');waiting.classList.add('ended');waiting.querySelector('strong').textContent=message});socket.on('live:ended',function(){showOnly('waiting');waiting.classList.add('ended');waiting.querySelector('strong').textContent='La transmisión finalizó.';statusEl.textContent='Finalizada';statusEl.classList.remove('online')});socket.on('live:viewers',function(count){viewers.textContent=count+' dispositivo'+(count===1?'':'s')+' conectado'+(count===1?'':'s')});socket.on('live:update',function(data){if(!data||data.hash===lastHash)return;lastHash=data.hash;waiting.classList.remove('ended');if(data.type==='blank'){showOnly('blank');return}if(data.type==='waiting'){showOnly('waiting');waiting.querySelector('strong').textContent=data.message;return}if(data.type==='image'){if(slide.dataset.hash===data.hash)return;slide.onload=function(){slide.dataset.hash=data.hash;showOnly('image')};slide.src=data.url;return}content.innerHTML=data.html||'';content.style.fontFamily=data.fontFamily||'Inter';content.style.color=data.color||'#fff';content.style.textAlign=data.align||'center';title.textContent=data.title||'';title.hidden=!data.title;alertEl.textContent=data.alert||'';alertEl.classList.toggle('visible',Boolean(data.alert));showOnly('text')});
</script></body></html>`;

const remoteIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="118" fill="#5b42ea"/><path fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" d="M136 206h240M136 306h160M365 303h12"/><rect x="112" y="153" width="288" height="206" rx="30" fill="none" stroke="#fff" stroke-width="25"/></svg>`;

const serviceWorker = `const CACHE="fl-remoto-${remoteClientVersion}",APP="/",ASSETS=["/manifest.webmanifest","/remote-icon.svg","/remote-icon-192.png","/remote-icon-512.png"];const offline=()=>new Response("<!doctype html><meta name=viewport content='width=device-width'><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1018;color:#fff;font:16px system-ui;text-align:center;padding:30px}b{font-size:22px}</style><div><b>FL Proyector no está disponible</b><p>Abrí el programa en la PC y verificá que ambos equipos estén en la misma red Wi-Fi.</p></div>",{headers:{"Content-Type":"text/html;charset=utf-8"}});self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS).then(()=>fetch(APP,{cache:"no-store"}).then(response=>{if(response.ok)return cache.put(APP,response.clone())}).catch(()=>undefined))).then(()=>self.skipWaiting())));self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;const url=new URL(event.request.url);if(url.origin!==self.location.origin||url.pathname.startsWith("/api/")||url.pathname.startsWith("/socket.io/"))return;if(event.request.mode==="navigate"){event.respondWith(fetch(event.request,{cache:"no-store"}).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(APP,response.clone()));return response}).catch(()=>caches.match(APP).then(cached=>cached||offline())));return}event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));return response})))})`;

const remoteHtml = String.raw`<!doctype html>
<html lang="es"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#5b42ea"><meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="FL Remoto">
  <link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" sizes="192x192" href="/remote-icon-192.png">
  <title>FL Proyector Remoto</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0c1018;color:#f5f7ff}
    *{box-sizing:border-box}html,body{width:100%;height:100%;min-height:100%;overflow:hidden}body{margin:0;background:radial-gradient(circle at 50% -20%,#342378 0,#121522 42%,#0c1018 78%)}
    .app{position:fixed;inset:0;width:min(680px,100%);height:auto;min-height:0;margin:auto;padding:calc(12px + env(safe-area-inset-top)) 16px max(4px,env(safe-area-inset-bottom));display:flex;flex-direction:column;overflow:hidden}
    [hidden]{display:none!important}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}.brand{display:flex;align-items:center;gap:8px;font-weight:800;letter-spacing:.045em;font-size:13px}.logo{width:32px;height:32px;border-radius:10px;background:#6046ec url('/remote-icon.svg') center/80% no-repeat;box-shadow:0 6px 16px #5b42ea55}.header-actions{display:flex;align-items:center;gap:9px}.install-app{border:1px solid #8b7bff;border-radius:9px;padding:7px 10px;background:#332b68;color:#fff;font:800 11px inherit;white-space:nowrap}.status{font-size:12px;color:#aeb7cc;white-space:nowrap}.status:before{content:"";display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background:#f04d5d}.status.online:before{background:#37d67a;box-shadow:0 0 10px #37d67a}
    h1{font-size:26px;line-height:1.1;margin:0 0 6px}.sub{color:#aab3c7;font-size:14px;line-height:1.45;margin:0 0 16px}.picker{display:grid;grid-template-columns:1fr 1.15fr .6fr;gap:9px;padding:11px;background:#181d2a;border:1px solid #30394b;border-radius:16px;box-shadow:0 12px 30px #0002;z-index:2}.field{min-width:0}.field label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#939db3;margin:0 0 5px}select{width:100%;appearance:none;border:1px solid #3a455a;border-radius:10px;background:#111622;color:#f5f7ff;padding:10px 28px 10px 10px;font:600 14px inherit;background-image:linear-gradient(45deg,transparent 50%,#aeb7cc 50%),linear-gradient(135deg,#aeb7cc 50%,transparent 50%);background-position:calc(100% - 14px) 50%,calc(100% - 10px) 50%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}select:focus{outline:2px solid #7967ff;border-color:transparent}.hint{display:flex;align-items:center;justify-content:space-between;margin:16px 2px 9px;color:#aab3c7;font-size:13px}.hint strong{color:#f5f7ff}.hint span{font-size:11px;color:#8994aa}.verses{min-height:0;flex:1;display:grid;align-content:start;gap:9px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0 2px 8px}.verse{width:100%;text-align:left;color:#edf0f9;background:#171c28;border:1px solid #30394b;border-radius:14px;padding:15px 16px;touch-action:pan-y;font:inherit;transition:transform .14s,border-color .14s,background .14s;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default}.verse:active{transform:scale(.985)}.verse.selected{background:#27204a;border-color:#7560ff;box-shadow:0 0 0 1px #7560ff55}.ref{display:block;color:#a99cff;font-size:12px;font-weight:800;margin-bottom:7px;user-select:none}.text{display:block;font-size:16px;line-height:1.42;user-select:text;-webkit-user-select:text}.empty,.loading{padding:28px 16px;text-align:center;color:#aab3c7;background:#171c28;border:1px dashed #39445a;border-radius:14px}.toast{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translate(-50%,130px);background:#ecebff;color:#19152d;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:750;box-shadow:0 10px 30px #0005;transition:transform .22s;white-space:nowrap}.toast.show{transform:translate(-50%,0)}
    .home{display:grid;gap:13px;margin:auto 0}.home h1{font-size:30px;margin:0}.home .sub{margin:0 0 10px}.mode{display:flex;align-items:center;gap:15px;width:100%;padding:20px;text-align:left;color:#f5f7ff;background:#171c28;border:1px solid #30394b;border-radius:17px;font:inherit}.mode i{display:grid;place-items:center;width:44px;height:44px;border-radius:13px;font-style:normal;font-size:23px;background:#5b42ea}.mode b,.mode span{display:block}.mode span{margin-top:4px;color:#aab3c7;font-size:13px;font-weight:500}.view-toolbar{display:flex;align-items:center;gap:8px;flex:0 0 auto;min-height:42px;margin:0 0 10px}.view-toolbar-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f5f7ff;font-size:14px;font-weight:800}.back{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:86px;height:38px;padding:0 11px;color:#ded9ff;background:#191d2a;border:1px solid #343c50;border-radius:10px;font:750 14px inherit;touch-action:manipulation}.back:active,.clear-live:active{transform:scale(.95)}.clear-live{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;padding:0;color:#ffb8bf;background:#351c24;border:1px solid #73313d;border-radius:10px;touch-action:manipulation}.clear-live svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.media-picker{display:flex;gap:8px;margin:0 0 14px}.media-picker select{flex:1}.media-list{display:grid;align-content:start;grid-auto-rows:min-content;gap:9px;overflow:auto;min-height:0;flex:1;padding:0 2px}.media-item{overflow:hidden;text-align:left;color:#f5f7ff;background:#171c28;border:1px solid #30394b;border-radius:14px;font:inherit}.media-launch{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:68px;padding:14px 15px;text-align:left;color:inherit;background:transparent;border:0;font:inherit}.media-item b,.media-item span{display:block}.media-item span{color:#aab3c7;font-size:12px;margin-top:4px}.badge{padding:5px 7px;border-radius:7px;background:#2d2752;color:#c8c1ff;font-size:10px;font-weight:800}.media-item.live{background:#123526;border-color:#37d67a;box-shadow:0 0 0 1px #37d67a55}.media-item.live .badge{background:#1c6b43;color:#eafff1}.item-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 12px}.item-controls button{color:#fff;background:#2c6544;border:1px solid #4aa971;border-radius:9px;padding:10px;font:700 12px inherit}.item-video-controls{border-top:1px solid #37d67a44;padding-top:11px}.seek-label,.volume-label{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:0 12px 10px;color:#b8d6c4;font-size:11px;font-weight:700}.volume-label{grid-template-columns:auto 1fr}.seek-label input,.volume-label input{width:100%;accent-color:#37d67a}.transport{margin-top:14px;padding:13px;background:#171c28;border:1px solid #30394b;border-radius:14px}.transport-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#aab3c7;margin-bottom:11px}.transport-row{display:flex;gap:8px}.transport button{flex:1;color:#fff;background:#332b68;border:1px solid #5549a1;border-radius:10px;padding:11px;font:700 13px inherit}.transport input{width:100%;margin-top:5px}.song-list{display:grid;align-content:start;gap:9px;overflow:auto;min-height:0;flex:1;padding:0 2px 8px}.song-card{overflow:hidden;border:1px solid #30394b;border-radius:14px;background:#171c28}.song-card>button{display:flex;align-items:center;justify-content:space-between;width:100%;padding:15px;color:#f5f7ff;background:transparent;border:0;text-align:left;font:inherit}.song-card small{display:block;margin-top:4px;color:#aab3c7}.song-card.live{border-color:#37d67a}.song-sections{display:grid;gap:8px;padding:0 11px 11px}.song-section{display:block;width:100%;padding:12px;text-align:left;color:#edf0f9;background:#111622;border:1px solid #343e52;border-radius:10px;font:inherit}.song-section b{display:block;margin-bottom:6px;color:#a99cff;font-size:11px;text-transform:uppercase}.song-section span{display:-webkit-box;overflow:hidden;color:#c5ccda;font-size:13px;line-height:1.35;-webkit-line-clamp:3;-webkit-box-orient:vertical}.song-section.active{border-color:#37d67a;background:#123526}.highlight-menu{position:fixed;z-index:20;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:8px;padding:8px;background:#eef0f8;border:1px solid #fff;border-radius:999px;box-shadow:0 12px 32px #0008}.highlight-menu button{width:30px;height:30px;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 5px #0005}.highlight-menu .clear-highlight{width:auto;padding:0 11px;border:0;border-radius:999px;background:#252b38;color:#fff;font:700 12px inherit}body[data-view="bible"] header,body[data-view="media"] header,body[data-view="songs"] header{display:none}body[data-view="bible"] #bible-view>h1,body[data-view="bible"] #bible-view>.sub,body[data-view="media"] #media-view>h1,body[data-view="media"] #media-view>.sub,body[data-view="songs"] #songs-view>h1,body[data-view="songs"] #songs-view>.sub{display:none}
    .song-list{gap:11px;padding-bottom:14px}.song-sections{position:relative;z-index:1;gap:10px;padding-bottom:12px}.song-section{position:relative;z-index:2;min-height:76px;padding:13px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:#37d67a44}.song-section{touch-action:manipulation}.song-section b{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.song-section b:after{content:"PROYECTAR";color:#8893a8;font-size:9px;letter-spacing:.04em}.song-section.active{box-shadow:inset 3px 0 #37d67a}.song-section.active b{color:#63e99d}.song-section.active b:after{content:"EN VIVO";color:#63e99d}.song-nav{display:grid;grid-template-columns:1fr minmax(96px,auto) 1fr;gap:8px;align-items:center;flex:0 0 auto;margin-top:10px;padding:10px;border:1px solid #315341;border-radius:13px;background:#12251c;box-shadow:0 -10px 28px #080b1199}.song-nav button{min-width:0;height:42px;padding:0 10px;border:1px solid #4aa971;border-radius:10px;color:#effff5;background:#24583b;font:750 12px inherit;touch-action:manipulation}.song-nav button:disabled{opacity:.38}.song-nav-status{min-width:0;text-align:center}.song-nav-status b,.song-nav-status span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.song-nav-status b{color:#63e99d;font-size:11px;text-transform:uppercase}.song-nav-status span{margin-top:3px;color:#b8d6c4;font-size:10px}@media (pointer:coarse){.song-section{min-height:88px;padding:15px}}
    .song-picker-card{display:flex;align-items:center;gap:10px;width:100%;min-height:76px;padding:16px;text-align:left;color:#f5f7ff;background:#171c28;border:1px solid #30394b;border-radius:15px;font:inherit;cursor:pointer;touch-action:manipulation}.song-picker-card:active{transform:scale(.985)}.song-picker-card.live{border-color:#37d67a;background:#123526;box-shadow:0 0 0 1px #37d67a55}.song-picker-card>span{min-width:0;flex:1}.song-picker-card b,.song-picker-card small{display:block}.song-picker-card b{font-size:17px}.song-picker-card small{margin-top:5px;color:#aab3c7;font-size:12px;line-height:1.35}.song-picker-card em{color:#a99cff;font-style:normal;font-size:29px;font-weight:300}.song-context{min-width:0;margin:0 0 14px;padding:11px 13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid #3a455a;border-radius:10px;background:#111622;color:#f5f7ff;font-size:14px;font-weight:700}.item-video-controls .item-controls{grid-template-columns:repeat(3,minmax(0,1fr))}.song-detail{display:grid;gap:11px}.song-detail-header{display:block;min-width:0;padding:15px 16px;background:#171c28;border:1px solid #30394b;border-radius:14px}.song-detail-header b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:18px}.song-detail .song-sections{padding:0}.song-detail .song-section{min-height:94px;padding:15px}.song-detail .song-section span{-webkit-line-clamp:4;font-size:14px;line-height:1.42}.remote-update{position:fixed;z-index:30;left:12px;right:12px;bottom:max(14px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:10px;padding:11px 13px;background:#e8e4ff;color:#17132a;border-radius:13px;box-shadow:0 14px 32px #0008;font-size:12px;font-weight:750}.remote-update span{flex:1}.remote-update button{min-height:34px;padding:0 11px;border:0;border-radius:8px;background:#513cd4;color:#fff;font:800 12px inherit}#bible-view,#media-view,#songs-view{min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
    @media(max-width:430px){.app{padding-left:12px;padding-right:12px}.picker{grid-template-columns:1fr 1.1fr}.field.chapter{grid-column:1/-1}.verse{padding:14px}.text{font-size:15px}}
  </style>
</head><body><main class="app">
  <header><div class="brand"><span class="logo"></span><span>FL PROYECTOR</span></div><div class="header-actions"><button id="install-app" class="install-app" hidden>Instalar app</button><span id="status" class="status">Conectando</span></div></header>
  <section id="remote-home" class="home"><h1>Control remoto</h1><p class="sub">Elegí qué querés controlar.</p><button id="open-bible" class="mode"><i>▤</i><span><b>Biblia</b><span>Versión, libro, capítulo y versículos.</span></span></button><button id="open-media" class="mode"><i>▶</i><span><b>Multimedia</b><span>Videos, imágenes y PowerPoints de una reunión.</span></span></button><button id="open-songs" class="mode" hidden><i>♫</i><span><b>Canciones del culto</b><span>Elegí una canción y proyectá sus estrofas.</span></span></button></section>
  <section id="bible-view" hidden><div class="view-toolbar"><button class="back" aria-label="Volver al inicio">← Volver</button><span class="view-toolbar-title">Biblia</span><button id="clear-live" class="clear-live" aria-label="Quitar versículo del aire" title="Quitar del aire"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="m8 9 8 8M16 9l-8 8M9 21h6"/></svg></button></div><h1>Biblia</h1><p class="sub">Elegí el pasaje y tocá un versículo para proyectarlo.</p>
  <section class="picker" aria-label="Selector de pasaje">
    <div class="field"><label for="version">Versión</label><select id="version"></select></div>
    <div class="field"><label for="book">Libro</label><select id="book"></select></div>
    <div class="field chapter"><label for="chapter">Capítulo</label><select id="chapter"></select></div>
  </section>
  <div class="hint"><strong id="heading">Versículos</strong><span>Toque para proyectar</span></div><section id="verses" class="verses"><div class="loading">Cargando Biblia…</div></section></section>
  <section id="media-view" hidden><div class="view-toolbar"><button class="back" aria-label="Volver al inicio">← Volver</button><span class="view-toolbar-title">Multimedia</span></div><h1>Multimedia</h1><p class="sub">Videos, imágenes y PowerPoints de una reunión.</p><div class="media-picker"><select id="media-meeting"></select></div><section id="media-list" class="media-list"><div class="loading">Cargando reuniones…</div></section><div id="transport"></div></section>
  <section id="songs-view" hidden><div class="view-toolbar"><button class="back" aria-label="Volver al inicio">← Volver</button><span class="view-toolbar-title">Canciones del culto</span><button id="clear-song" class="clear-live" aria-label="Quitar canción del aire" title="Quitar del aire"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="m8 9 8 8M16 9l-8 8M9 21h6"/></svg></button></div><h1>Canciones</h1><p class="sub">Elegí la reunión, la canción y la estrofa.</p><div id="song-meeting-picker" class="media-picker"><select id="song-meeting"></select></div><div id="song-context" class="song-context" hidden></div><section id="song-list" class="song-list"><div class="loading">Cargando canciones…</div></section><div id="song-nav" class="song-nav" hidden><button data-song-step="-1">← Anterior</button><div class="song-nav-status"><b id="song-nav-label">En vivo</b><span id="song-nav-title">Canción</span></div><button data-song-step="1">Siguiente →</button></div></section>
</main><div id="highlight-menu" class="highlight-menu" hidden><button data-highlight="#fff176" style="background:#fff176" aria-label="Resaltador amarillo"></button><button data-highlight="#a7f3d0" style="background:#a7f3d0" aria-label="Resaltador verde"></button><button data-highlight="#bfdbfe" style="background:#bfdbfe" aria-label="Resaltador celeste"></button><button data-highlight="#fbcfe8" style="background:#fbcfe8" aria-label="Resaltador rosa"></button><button class="clear-highlight" data-highlight="">Quitar</button></div><div id="remote-update" class="remote-update" hidden><span>Nueva versión disponible.</span><button id="remote-update-reload" type="button">Actualizar</button></div><div id="toast" class="toast" role="status"></div><script src="/socket.io/socket.io.js"></script><script>
  (function(){
  var socket=io({timeout:5000,reconnection:true,reconnectionDelay:500,reconnectionDelayMax:2500}), projectionState=null, versions=[], books=[], verses=[], selectedVerse=-1, selectedHighlight=null, verseHighlights={}, activeMediaItemId=null, fullControlEnabled=false, songs=[], selectedSongItemId=null, deferredInstallPrompt=null, lastServerContact=0, status=document.getElementById("status"), installButton=document.getElementById("install-app"), versionSelect=document.getElementById("version"), bookSelect=document.getElementById("book"), chapterSelect=document.getElementById("chapter"), versesElement=document.getElementById("verses"), heading=document.getElementById("heading"), toast=document.getElementById("toast"), toastTimer, home=document.getElementById("remote-home"), bibleView=document.getElementById("bible-view"), mediaView=document.getElementById("media-view"), songsView=document.getElementById("songs-view"), mediaMeeting=document.getElementById("media-meeting"), mediaList=document.getElementById("media-list"), songMeeting=document.getElementById("song-meeting"), songMeetingPicker=document.getElementById("song-meeting-picker"), songContext=document.getElementById("song-context"), songList=document.getElementById("song-list"), songNav=document.getElementById("song-nav"), openSongs=document.getElementById("open-songs"), transport=document.getElementById("transport"), highlightMenu=document.getElementById("highlight-menu"), remoteUpdate=document.getElementById("remote-update"), remoteUpdateReload=document.getElementById("remote-update-reload");
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,function(character){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[character];});}
  function options(select,items,value,label){select.innerHTML=items.map(function(item){var itemValue=value(item), selected=String(itemValue)===String(select.dataset.value||"")?" selected":"";return "<option value=\""+escapeHtml(itemValue)+"\""+selected+">"+escapeHtml(label(item))+"</option>";}).join("");}
  function request(path){var separator=path.indexOf("?")>=0?"&":"?";return fetch(path+separator+"_="+Date.now(),{cache:"no-store",credentials:"same-origin"}).then(function(response){if(!response.ok)throw new Error("No se pudo cargar el contenido");connected();return response.json();});}function command(path,body){return fetch(path,{method:"POST",headers:{"Content-Type":"application/json","Cache-Control":"no-cache"},cache:"no-store",credentials:"same-origin",body:JSON.stringify(body||{})}).then(function(response){if(!response.ok)throw new Error("No se pudo enviar el comando");connected();});}
  function notify(message){toast.textContent=message;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(function(){toast.classList.remove("show");},1600);}
  function isInstalled(){return window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true||navigator.userAgent.indexOf("FlRemotoNative/")>=0;}
  function showInstallButton(){installButton.hidden=isInstalled()?true:false;}
  window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();deferredInstallPrompt=event;showInstallButton();});
  window.addEventListener("appinstalled",function(){deferredInstallPrompt=null;installButton.hidden=true;});
  installButton.onclick=function(){if(/android/i.test(navigator.userAgent)){window.location.href="/downloads/FL-Remoto.apk";return;}if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.then(function(){deferredInstallPrompt=null;showInstallButton();});return;}var ios=/iphone|ipad|ipod/i.test(navigator.userAgent);alert(ios?"Para instalar FL Remoto en iPhone o iPad:\\n\\n1. Tocá Compartir (□↑) en Safari.\\n2. Elegí ‘Agregar a pantalla de inicio’.\\n3. Confirmá con ‘Agregar’.":"Para instalar FL Remoto, abrí el menú del navegador y elegí ‘Instalar aplicación’ o ‘Agregar a pantalla principal’.");};
  showInstallButton();
  var wakeLock=null;function keepScreenAwake(){if(!("wakeLock" in navigator)||document.visibilityState!=="visible")return;navigator.wakeLock.request("screen").then(function(lock){wakeLock=lock;lock.addEventListener("release",function(){wakeLock=null;});}).catch(function(){});}document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")keepScreenAwake();});keepScreenAwake();
  function showView(view){if(view==="songs"&&!fullControlEnabled)view="home";document.body.dataset.view=view;home.hidden=view!=="home";bibleView.hidden=view!=="bible";mediaView.hidden=view!=="media";songsView.hidden=view!=="songs";if(view==="bible"&&!versions.length)loadVersions().catch(function(){versesElement.innerHTML="<div class=\"empty\">No se pudo cargar la Biblia.</div>";});if(view==="media")loadMeetings();if(view==="songs")loadSongMeetings();}
  window.flRemoteBack=function(){if((document.body.dataset.view||"home")!=="home"){showView("home");return true;}return false;};
  function loadMeetings(){return request("/api/remote/meetings").then(function(data){mediaMeeting.innerHTML=data.map(function(meeting){return "<option value=\""+meeting.id+"\">"+escapeHtml(meeting.name)+"</option>";}).join("");if(!data.length){mediaList.innerHTML="<div class=\"empty\">No hay reuniones creadas.</div>";return;}loadMedia();}).catch(function(){mediaList.innerHTML="<div class=\"empty\">No se pudieron cargar las reuniones.</div>";});}
  function itemControls(item){if(Number(item.id)!==Number(activeMediaItemId))return "";if(item.kind==="presentation")return "<div class=\"item-controls\"><button data-presentation=\"-1\" aria-label=\"Diapositiva anterior\">← Anterior</button><button data-presentation=\"1\" aria-label=\"Diapositiva siguiente\">Siguiente →</button></div>";if(item.kind!=="video")return "";var video=projectionState&&projectionState.video||{},duration=Math.max(0,Number(video.duration||0)),current=Math.min(Number(video.currentTime||video.seekTime||0),duration||Number(video.currentTime||video.seekTime||0)),max=Math.max(duration,1);return "<div class=\"item-video-controls\"><div class=\"item-controls\"><button data-video=\"play\">"+(video.playing?"❚❚ Pausar":"▶ Reproducir")+"</button><button data-video=\"stop\">■ Detener</button><button data-video=\"mute\">"+(video.muted?"🔊 Activar sonido":"🔇 Silenciar")+"</button></div><label class=\"seek-label\">"+formatTime(current)+" <input data-video=\"seek\" type=\"range\" min=\"0\" max=\""+max+"\" step=\"0.1\" value=\""+current+"\"> "+formatTime(duration)+"</label><label class=\"volume-label\">Volumen <input data-video=\"volume\" type=\"range\" min=\"0\" max=\"1\" step=\"0.05\" value=\""+(video.volume==null?1:video.volume)+"\"></label></div>";}
  function formatTime(value){value=Math.max(0,Math.floor(Number(value)||0));return Math.floor(value/60)+":"+String(value%60).padStart(2,"0");}
  function loadMedia(){var id=mediaMeeting.value;if(!id)return;mediaList.innerHTML="<div class=\"loading\">Cargando contenido…</div>";request("/api/remote/multimedia/"+encodeURIComponent(id)).then(function(items){var activeItem=items.find(function(item){return item.active;});activeMediaItemId=activeItem?activeItem.id:null;if(!items.length){mediaList.innerHTML="<div class=\"empty\">Esta reunión no tiene contenido.</div>";return;}mediaList.innerHTML=items.map(function(item){var label=item.kind==="presentation"?"PowerPoint":item.kind==="video"?"Video":item.kind==="announcement"?"Anuncio":"Imagen",live=Number(item.id)===Number(activeMediaItemId);return "<article class=\"media-item"+(live?" live":"")+"\" data-id=\""+item.id+"\"><button class=\"media-launch\" data-launch=\"1\"><span><b>"+escapeHtml(item.title)+"</b><span>"+(live?"En vivo · tocá para quitar":label)+"</span></span><i class=\"badge\">"+(live?"EN VIVO":label)+"</i></button>"+itemControls(item)+"</article>";}).join("");}).catch(function(){mediaList.innerHTML="<div class=\"empty\">No se pudo cargar el contenido.</div>";});}
  function loadSongMeetings(){if(!fullControlEnabled)return Promise.resolve();return request("/api/remote/meetings").then(function(data){var previous=songMeeting.value;songMeeting.innerHTML=data.map(function(meeting){return "<option value=\""+meeting.id+"\">"+escapeHtml(meeting.name)+"</option>";}).join("");if(data.some(function(meeting){return String(meeting.id)===previous;}))songMeeting.value=previous;if(!data.length){songList.innerHTML="<div class=\"empty\">No hay reuniones creadas.</div>";return;}return loadSongs();}).catch(function(){songList.innerHTML="<div class=\"empty\">No se pudieron cargar las reuniones.</div>";});}
  function renderSongList(){songNav.hidden=true;songMeetingPicker.hidden=false;songContext.hidden=true;songList.innerHTML=songs.map(function(song){return "<button type=\"button\" class=\"song-picker-card"+(song.active?" live":"")+"\" data-song-open=\""+song.itemId+"\"><span><b>"+escapeHtml(song.title)+"</b><small>"+song.sections.length+" parte"+(song.sections.length===1?"":"s")+" · Tocá para elegir una estrofa</small></span><i class=\"badge\">"+(song.active?"EN VIVO":"ABRIR")+"</i><em>›</em></button>";}).join("");}
  function revealActiveSongSection(){var active=songList.querySelector(".song-section.active");if(!active)return;var listBox=songList.getBoundingClientRect(),activeBox=active.getBoundingClientRect(),next=songList.scrollTop+activeBox.top-listBox.top-(songList.clientHeight-activeBox.height)/2;songList.scrollTop=Math.max(0,next);}
  function renderSongDetail(){var song=songs.find(function(item){return Number(item.itemId)===Number(selectedSongItemId);});if(!song){selectedSongItemId=null;renderSongList();return;}songNav.hidden=true;songMeetingPicker.hidden=true;songContext.hidden=false;songContext.textContent=song.title;songList.innerHTML="<section class=\"song-detail\"><div class=\"song-detail-header\"><b>"+escapeHtml(song.title)+"</b></div><div class=\"song-sections\">"+song.sections.map(function(section){var active=song.active&&Number(song.activeSection)===Number(section.index);return "<button type=\"button\" class=\"song-section"+(active?" active":"")+"\" data-song-section=\""+section.index+"\"><b>"+escapeHtml(section.label)+"</b><span>"+escapeHtml(section.text)+"</span></button>";}).join("")+"</div></section>";requestAnimationFrame(revealActiveSongSection);}
  function loadSongs(){var meetingId=songMeeting.value;if(!meetingId||!fullControlEnabled)return Promise.resolve();songList.innerHTML="<div class=\"loading\">Cargando canciones…</div>";return request("/api/remote/songs/"+encodeURIComponent(meetingId)).then(function(data){songs=data;if(!songs.length){songList.innerHTML="<div class=\"empty\">Esta reunión no tiene canciones.</div>";songNav.hidden=true;return;}if(selectedSongItemId!==null&&songs.some(function(song){return Number(song.itemId)===Number(selectedSongItemId);})){renderSongDetail();}else{selectedSongItemId=null;renderSongList();}}).catch(function(error){songList.innerHTML="<div class=\"empty\">"+escapeHtml(error.message||"No se pudieron cargar las canciones.")+"</div>";songNav.hidden=true;});}
  function projectSongSection(itemId,sectionIndex){return command("/api/remote/song-section",{meetingId:Number(songMeeting.value),itemId:Number(itemId),sectionIndex:Number(sectionIndex)}).then(function(){notify("Estrofa "+(Number(sectionIndex)+1)+" enviada a pantalla");return loadSongs();}).catch(function(){notify("No se pudo proyectar la estrofa");});}
  function setCapabilities(capabilities){fullControlEnabled=Boolean(capabilities&&capabilities.fullControlEnabled);openSongs.hidden=!fullControlEnabled;if(!fullControlEnabled&&document.body.dataset.view==="songs"){showView("home");notify("El operador desactivó Control total");}if(!fullControlEnabled)songNav.hidden=true;}
  function renderTransport(){transport.innerHTML="";}
  function selectedVersion(){return versions.find(function(item){return String(item.id)===versionSelect.value;});}
  function selectedBook(){return books.find(function(item){return item.book===bookSelect.value;});}
  function loadVersions(){return request("/api/bible/versions").then(function(data){versions=data;versionSelect.dataset.value=versionSelect.value;options(versionSelect,versions,function(item){return item.id;},function(item){return item.code||item.name;});if(!versionSelect.value&&versions[0])versionSelect.value=String(versions[0].id);return loadBooks();});}
  function loadBooks(){var id=versionSelect.value;if(!id)return Promise.resolve();return request("/api/bible/books/"+encodeURIComponent(id)).then(function(data){books=data;var previous=bookSelect.value;bookSelect.dataset.value=previous;options(bookSelect,books,function(item){return item.book;},function(item){return item.book;});var preferred=books.find(function(item){return item.book.toLowerCase()==="juan";});if(!books.some(function(item){return item.book===previous;}))bookSelect.value=(preferred||books[0]||{}).book||"";return loadChapters();});}
  function loadChapters(){var book=selectedBook(), chapters=[];if(!book)return Promise.resolve();for(var number=1;number<=book.chapters;number++)chapters.push(number);var previous=chapterSelect.value;chapterSelect.dataset.value=previous;options(chapterSelect,chapters,function(item){return item;},function(item){return item;});if(!chapters.some(function(item){return String(item)===previous;})){chapterSelect.value=book.book.toLowerCase()==="juan"&&chapters.indexOf(3)>=0?"3":"1";}return loadVerses();}
  function loadVerses(){var id=versionSelect.value, book=bookSelect.value, chapter=chapterSelect.value, projectedVerse=selectedVerse>=0&&verses[selectedVerse]?verses[selectedVerse].verse:null;if(!id||!book||!chapter)return Promise.resolve();versesElement.innerHTML="<div class=\"loading\">Cargando versículos…</div>";return request("/api/bible/verses/"+encodeURIComponent(id)+"/"+encodeURIComponent(book)+"/"+encodeURIComponent(chapter)).then(function(data){verses=data;selectedVerse=-1;heading.textContent=book+" "+chapter;renderVerses();if(projectedVerse!==null){var replacement=verses.findIndex(function(verse){return verse.verse===projectedVerse;});if(replacement>=0)sendVerse(replacement);}}).catch(function(){verses=[];versesElement.innerHTML="<div class=\"empty\">No se pudieron cargar los versículos.</div>";});}
  function verseKey(index){var verse=verses[index];return verse?[versionSelect.value,verse.book,verse.chapter,verse.verse].join("|"):"";}
  function highlightsFor(index){return verseHighlights[verseKey(index)]||[];}
  function renderVerses(){if(!verses.length){versesElement.innerHTML="<div class=\"empty\">No hay versículos en este capítulo.</div>";return;}versesElement.innerHTML=verses.map(function(verse,index){var marked=escapeHtml(verse.text), highlights=highlightsFor(index);highlights.forEach(function(highlight){if(highlight&&highlight.color)marked=marked.replace(escapeHtml(highlight.text),"<mark style=\"background:"+highlight.color+";color:#111827;padding:.04em .12em;border-radius:.12em\">"+escapeHtml(highlight.text)+"</mark>");});return "<article class=\"verse"+(index===selectedVerse?" selected":"")+"\" data-index=\""+index+"\" role=\"button\" tabindex=\"0\"><span class=\"ref\">"+escapeHtml(verse.book+" "+verse.chapter+":"+verse.verse)+"</span><span class=\"text\">"+marked+"</span></article>";}).join("");}
  function sendVerse(index,highlight){
    var verse=verses[index],version=selectedVersion();
    if(!verse||!projectionState)return;
    selectedVerse=index;renderVerses();
    var style=projectionState.bibleStyle||{},reference=verse.book+" "+verse.chapter+":"+verse.verse,refText=[];
    if(style.showReference!==false)refText.push(reference);
    if(style.showVersion!==false&&version)refText.push(version.code||version.name);
    var refStyle=style.referenceStyle||"pill",refColor=style.referenceColor||"#fff",refBackground=style.referenceBackground||"#4f46e5";
    var refCss="color:"+refColor+";font-family:"+escapeHtml(style.referenceFontFamily||"Inter")+";font-weight:750";
    if(refStyle==="pill")refCss+=";background:"+refBackground+";border-radius:999px";
    if(refStyle==="bar")refCss+=";background:"+refBackground+";border-left:.22em solid "+refColor;
    if(refStyle==="glass")refCss+=";background:"+refBackground+";border:1px solid "+refColor+";border-radius:.35em;backdrop-filter:blur(8px)";
    if(refStyle==="underline")refCss+=";border-bottom:.14em solid "+refBackground;
    if(refStyle==="ribbon")refCss+=";background:"+refBackground+";clip-path:polygon(0 0,100% 0,92% 50%,100% 100%,0 100%,.3em 50%)";
    if(refStyle==="lower-third")refCss+=";background:linear-gradient(90deg,"+refBackground+","+refBackground+" 72%,transparent);border-left:.28em solid "+refColor+";border-radius:.12em";
    if(refStyle==="broadcast")refCss+=";background:"+refBackground+";border-left:.28em solid "+refColor+";border-bottom:.12em solid "+refColor+";clip-path:polygon(0 0,94% 0,100% 100%,0 100%)";
    var refClass="bible-reference-label reference-style-"+refStyle+" reference-animation-"+(style.referenceAnimation||"fade");
    var referenceHtml=refText.length?"<div class=\"bible-reference-slot reference-"+(style.referencePosition||"after")+"\" style=\"text-shadow:none\"><span class=\""+refClass+"\" style=\""+refCss+"\">"+escapeHtml(refText.join(" · "))+"</span></div>":"";
    var verseText=escapeHtml(verse.text),highlights=Array.isArray(highlight)?highlight:(highlight?[highlight]:highlightsFor(index));
    highlights.forEach(function(value){if(value&&value.text&&value.color)verseText=verseText.replace(escapeHtml(value.text),"<mark style=\"background:"+value.color+";color:#111827;padding:.04em .12em;border-radius:.12em\">"+escapeHtml(value.text)+"</mark>");});
    var verseHtml="<div class=\"bible-verse-slot\"><p class=\"bible-verse-text\" style=\"font-family:"+escapeHtml(style.textFontFamily||"Inter")+";color:"+(style.textColor||"#fff")+"\">"+verseText+"</p></div>";
    var content=style.referencePosition==="before"?referenceHtml+verseHtml:verseHtml+referenceHtml;
    command("/api/remote/patch",{blackout:false,logo:false,presentation:{visible:false},lowerThird:{visible:false},text:{html:"<div class=\"bible-slide bible-reference-"+(style.referencePosition||"after")+"\">"+content+"</div>",sourceBibleText:verse.text,sourceBibleReference:reference,sourceBibleVersion:version?(version.code||version.name):"",visible:true,kind:"biblia",fontSize:Number(style.textFontSize||60),fontFamily:style.textFontFamily||"Inter",align:"center",color:style.textColor||"#ffffff",backgroundColor:"rgba(0,0,0,0)",position:"center",borderRadius:0,template:"plain",animation:"none",shadowEnabled:style.textShadowEnabled!==false,shadowColor:style.textShadowColor||"#000000",shadowBlur:Number(style.textShadowBlur||14),title:"",titlePosition:"bottom",titleColor:"#ffffff",titleBackground:"#4f46e5",titleFontSize:30,titleStyle:"none"}});
    notify(reference+" en pantalla");
  }
  function showHighlightMenu(){var selection=window.getSelection(), text=(selection&&selection.toString()||"").replace(/\s+/g," ").trim(), range=selection&&selection.rangeCount?selection.getRangeAt(0):null, target=range&&range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range&&range.commonAncestorContainer.parentElement, verseButton=target&&target.closest?target.closest(".verse"):null;if(!text||!verseButton||!versesElement.contains(verseButton))return;var index=Number(verseButton.dataset.index), verse=verses[index];if(!verse||verse.text.indexOf(text)<0)return;selectedHighlight={index:index,text:text};highlightMenu.hidden=false;}
  function clearHighlightMenu(){highlightMenu.hidden=true;selectedHighlight=null;window.getSelection&&window.getSelection().removeAllRanges();}
  versionSelect.onchange=function(){loadBooks();};bookSelect.onchange=function(){loadChapters();};chapterSelect.onchange=loadVerses;versesElement.onclick=function(event){if(selectedHighlight||(window.getSelection&&window.getSelection().toString().trim()))return;var button=event.target.closest(".verse");if(button)sendVerse(Number(button.dataset.index));};versesElement.addEventListener("mouseup",function(){setTimeout(showHighlightMenu,0);});versesElement.addEventListener("touchend",function(){setTimeout(showHighlightMenu,120);},{passive:true});versesElement.addEventListener("contextmenu",function(event){event.preventDefault();setTimeout(showHighlightMenu,0);});document.addEventListener("selectionchange",function(){var selection=window.getSelection();if(selection&&selection.toString().trim())setTimeout(showHighlightMenu,120);});highlightMenu.onclick=function(event){var button=event.target.closest("button");if(!button||!selectedHighlight)return;sendVerse(selectedHighlight.index,{text:selectedHighlight.text,color:button.dataset.highlight||""});clearHighlightMenu();};var discoveryRunning=false,discoveryTimer=null;function candidateOrigins(){var result=[],seen={};function add(value){try{var origin=new URL(value).origin;if(!seen[origin]){seen[origin]=true;result.push(origin)}}catch(error){}}add(localStorage.getItem("fl-remote-server")||"");add(location.origin);var match=location.hostname.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.\\d{1,3}$/);if(match)for(var last=1;last<255;last++)add("http://"+match[1]+"."+match[2]+"."+match[3]+"."+last+":3001");return result;}function discover(origin){return Promise.race([fetch(origin+"/api/discovery?_="+Date.now(),{mode:"cors",cache:"no-store"}).then(function(response){if(!response.ok)throw new Error("No disponible");return response.json()}).then(function(data){return data&&data.service==="fl-proyector"?origin:"";}).catch(function(){return "";}),new Promise(function(resolve){setTimeout(function(){resolve("");},850);})]);}function findProjector(){if(discoveryRunning)return;var candidates=candidateOrigins();if(!candidates.length)return;discoveryRunning=true;status.textContent="Buscando sistema…";status.classList.remove("online");var next=0,found="",workers=[];function worker(){if(found||next>=candidates.length)return Promise.resolve();var origin=candidates[next++];return discover(origin).then(function(value){if(value)found=value;return worker();});}for(var i=0;i<12;i++)workers.push(worker());Promise.all(workers).then(function(){if(found){localStorage.setItem("fl-remote-server",found);location.replace(found);return;}discoveryRunning=false;status.textContent="Sin conexión";status.classList.remove("online");discoveryTimer=setTimeout(findProjector,12000);});}function scheduleDiscovery(){if(discoveryRunning||discoveryTimer!==null)return;discoveryTimer=setTimeout(function(){discoveryTimer=null;findProjector();},1200);}function connected(){lastServerContact=Date.now();discoveryRunning=false;if(discoveryTimer!==null){clearTimeout(discoveryTimer);discoveryTimer=null;}localStorage.setItem("fl-remote-server",location.origin);status.textContent="Conectado";status.classList.add("online");}function connectionWarning(){if(Date.now()-lastServerContact<12000)return;status.textContent="Reconectando…";status.classList.remove("online");scheduleDiscovery();}function refreshAfterResume(){if(socket.disconnected)socket.connect();Promise.all([request("/api/state").then(function(next){projectionState=next;connected();}),request("/api/remote/capabilities").then(setCapabilities)]).then(function(){var view=document.body.dataset.view||"home";if(view==="songs"&&fullControlEnabled)loadSongMeetings();if(view==="media")loadMeetings();if(view==="bible"&&versions.length)loadVerses();}).catch(connectionWarning);}window.addEventListener("flremote:resume",refreshAfterResume);window.addEventListener("pageshow",function(event){if(event.persisted||socket.disconnected)refreshAfterResume();});socket.on("connect",connected);socket.on("connect_error",function(){if(!projectionState){status.textContent="Buscando sistema…";status.classList.remove("online");scheduleDiscovery();}});socket.on("disconnect",connectionWarning);socket.on("projection:state",function(next){projectionState=next;connected();if(document.body.dataset.view==="songs"&&fullControlEnabled)loadSongs();});socket.on("remote:capabilities",setCapabilities);request("/api/state").then(function(next){projectionState=next;connected();renderTransport();}).catch(function(){status.textContent="Buscando sistema…";status.classList.remove("online");scheduleDiscovery();});request("/api/remote/capabilities").then(setCapabilities).catch(function(){setCapabilities({fullControlEnabled:false});});window.setInterval(function(){request("/api/state").then(function(next){projectionState=next;}).catch(connectionWarning);},8000);if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).catch(function(){});
  document.getElementById("open-bible").onclick=function(){showView("bible");};document.getElementById("open-media").onclick=function(){showView("media");};openSongs.onclick=function(){selectedSongItemId=null;showView("songs");};document.querySelectorAll(".back").forEach(function(button){button.onclick=function(){showView("home");};});mediaMeeting.onchange=loadMedia;songMeeting.onchange=function(){selectedSongItemId=null;loadSongs();};songList.onclick=function(event){var target=event.target;if(!target||typeof target.closest!=="function")return;var open=target.closest("[data-song-open]");if(open){selectedSongItemId=Number(open.dataset.songOpen);renderSongDetail();songList.scrollTop=0;return;}var button=target.closest(".song-section");if(!button)return;event.preventDefault();event.stopPropagation();projectSongSection(selectedSongItemId,button.dataset.songSection);};songNav.onclick=function(event){var button=event.target.closest("[data-song-step]");if(!button||button.disabled)return;projectSongSection(songNav.dataset.item,Number(songNav.dataset.section)+Number(button.dataset.songStep));};document.getElementById("clear-song").onclick=function(){command("/api/remote/clear").then(function(){notify("Canción quitada del aire");loadSongs();});};mediaList.onclick=function(event){var button=event.target.closest("button");if(!button)return;if(button.dataset.presentation){command("/api/remote/presentation",{direction:Number(button.dataset.presentation)});return;}if(button.dataset.video==="play"){var playing=!(projectionState.video||{}).playing;projectionState=Object.assign({},projectionState,{video:Object.assign({},projectionState.video,{playing:playing})});command("/api/remote/video",{playing:playing}).then(loadMedia);return;}if(button.dataset.video==="stop"){var commandId=Number((projectionState.video||{}).commandId||0)+1;projectionState=Object.assign({},projectionState,{video:Object.assign({},projectionState.video,{playing:false,seekTime:0,currentTime:0,commandId:commandId})});command("/api/remote/video",{playing:false,seekTime:0,currentTime:0,commandId:commandId}).then(loadMedia);return;}if(button.dataset.video==="mute"){var muted=!(projectionState.video||{}).muted;projectionState=Object.assign({},projectionState,{video:Object.assign({},projectionState.video,{muted:muted})});command("/api/remote/video",{muted:muted}).then(loadMedia);return;}if(!button.dataset.launch)return;var item=button.closest(".media-item"),itemId=Number(item&&item.dataset.id);if(itemId===Number(activeMediaItemId)){command("/api/remote/clear").then(function(){activeMediaItemId=null;loadMedia();notify("Solo fondo en pantalla");});return;}command("/api/remote/multimedia/"+itemId).then(function(){activeMediaItemId=itemId;loadMedia();notify("Contenido enviado a pantalla");});};function seekRemoteVideo(input){var value=Number(input.value),commandId=Number((projectionState.video||{}).commandId||0)+1;projectionState.video=Object.assign({},projectionState.video,{seekTime:value,commandId:commandId,currentTime:value});command("/api/remote/video",{seekTime:value,commandId:commandId,currentTime:value});}mediaList.oninput=function(event){var input=event.target;if(!input.dataset.video)return;var value=Number(input.value);if(input.dataset.video==="volume")command("/api/remote/video",{volume:value,muted:false});};mediaList.onchange=function(event){var input=event.target;if(input.dataset.video==="seek")seekRemoteVideo(input);};socket.on("projection:state",function(next){projectionState=next;renderTransport();});
  versesElement.style.scrollBehavior="smooth";highlightMenu.addEventListener("click",function(event){var button=event.target.closest("button");if(button&&selectedHighlight){var key=verseKey(selectedHighlight.index),list=highlightsFor(selectedHighlight.index);if(button.dataset.highlight){list.push({text:selectedHighlight.text,color:button.dataset.highlight});verseHighlights[key]=list;}else{verseHighlights[key]=list.filter(function(value){return value.text!==selectedHighlight.text;});}renderVerses();}},true);
  highlightMenu.onclick=function(event){var button=event.target.closest("button");if(!button||!selectedHighlight)return;sendVerse(selectedHighlight.index,highlightsFor(selectedHighlight.index));clearHighlightMenu();};
  var initialShowView=showView;showView=function(view){initialShowView(view);if(view==="bible")setTimeout(function(){renderVerses();var active=versesElement.querySelector(".verse.selected");if(active)active.scrollIntoView({block:"center",behavior:"smooth"});},0);};
  // A remote can remain open for hours. Refresh its chapter whenever the
  // operator changes the A/B rule, so it never keeps a stale split list.
  var remoteBibleLayoutKey="";
  socket.on("projection:state",function(next){var style=next.bibleStyle||{},viewport=next.outputViewport||{},key=[style.longVerseMode,style.textFontSize,style.textFontFamily,style.referenceFontSize,style.referencePosition,style.showReference,style.showVersion,style.horizontalMargin,style.verticalMargin,style.uppercase,viewport.width,viewport.height,viewport.scaleFactor].join("|");if(remoteBibleLayoutKey&&key!==remoteBibleLayoutKey&&document.body.dataset.view==="bible"&&versions.length)setTimeout(loadVerses,0);remoteBibleLayoutKey=key;});
  var remoteViewWithFreshVerses=showView;showView=function(view){remoteViewWithFreshVerses(view);if(view==="bible"&&versions.length)loadVerses();};
  // The iPhone/iPad installed web app checks its service worker whenever it
  // opens. The update is served by the connected projector on the local Wi-Fi,
  // so this does not depend on Internet access.
  function showRemoteUpdate(){remoteUpdate.hidden=false;}
  remoteUpdateReload.onclick=function(){location.reload();};
  if("serviceWorker" in navigator)navigator.serviceWorker.getRegistration().then(function(registration){if(!registration)return;navigator.serviceWorker.addEventListener("controllerchange",showRemoteUpdate);registration.update().catch(function(){});if(registration.waiting)showRemoteUpdate();registration.addEventListener("updatefound",function(){var worker=registration.installing;if(!worker)return;worker.addEventListener("statechange",function(){if(worker.state==="installed"&&navigator.serviceWorker.controller)showRemoteUpdate();});});});
  document.getElementById("clear-live").onclick=function(){command("/api/remote/clear").then(function(){selectedVerse=-1;renderVerses();notify("Versículo quitado del aire");});};
  })();
</script></body></html>`;
