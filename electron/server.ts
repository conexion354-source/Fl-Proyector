import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collaboratorHtml } from "./collaboratorPage.js";
import {
  isLongBibleVerse,
  splitBibleVerse,
} from "../shared/bibleLayout.js";
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

type LiveAudiencePayload =
  | {
      type: "waiting";
      hash: string;
      message: string;
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
  const audiencePayloadForState = (
    state: ProjectionState,
  ): LiveAudiencePayload | null => {
    if (state.blackout) return waitingPayload("La proyección está momentáneamente en pausa.");
    if (state.logo) return waitingPayload("La transmisión continúa en breve.");
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
    // Images and PowerPoint slides are supplied by capturePage after the
    // projector has rendered the final frame. Videos are deliberately not
    // streamed over Wi-Fi to keep audience mode lightweight.
    if (
      state.presentation.visible ||
      (state.background.kind === "image" && Boolean(state.background.url))
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

  app.get("/", (_req, res) => res.type("html").send(remoteHtml));
  app.get("/api/discovery", (_req, res) =>
    res
      .set("X-FL-Proyector", "1")
      .json({ service: "fl-proyector", name: "FL Proyector", port: 3001 }),
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
      start_url: "/",
      display: "standalone",
      background_color: "#0c1018",
      theme_color: "#5b42ea",
      icons: [
        {
          src: "/remote-icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable",
        },
      ],
    }),
  );
  app.get("/remote-icon.svg", (_req, res) =>
    res.type("image/svg+xml").send(remoteIcon),
  );
  app.get("/downloads/FL-Remoto.apk", (_req, res) => {
    if (!existsSync(remoteApkPath))
      return res.status(404).send("El instalador móvil no está disponible.");
    return res.download(remoteApkPath, "FL-Remoto.apk");
  });
  app.get("/sw.js", (_req, res) =>
    res.type("application/javascript").send(serviceWorker),
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
      sectionTypes: existing?.sectionTypes || [],
    });
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
        if (!isLongBibleVerse(verse.text, bibleStyle, getState().outputViewport))
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
      multimedia.clear();
      applyPatch({
        ...patch,
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
    if (current.visible && (direction === -1 || direction === 1))
      applyPatch({
        presentation: {
          slideIndex: Math.max(
            0,
            Math.min(current.slideIndex + direction, Math.max(0, current.slideCount - 1)),
          ),
        },
      });
    res.status(204).end();
  });

  io.on("connection", (socket) => {
    const role = socket.handshake.query.role;
    const controller = role !== "live" && role !== "collaborator";
    if (controller) {
      socket.join("projection-controllers");
      socket.emit("projection:state", getState());
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
        const slideIndex = Math.max(0, Math.min(current.slideIndex + direction, Math.max(0, current.slideCount - 1)));
        applyPatch({ presentation: { slideIndex } });
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
            (state.background.kind === "image" && state.background.url)),
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
*{box-sizing:border-box}[hidden]{display:none!important}html,body{margin:0;min-height:100%;background:#090b12;color:#fff;font-family:Inter,"Segoe UI",Arial,sans-serif}body{min-height:100dvh;display:grid;grid-template-rows:auto 1fr;background:radial-gradient(circle at top,#211b52 0,#0c101b 38%,#080a10 100%)}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:max(14px,env(safe-area-inset-top)) 18px 12px;border-bottom:1px solid #ffffff18;background:#0d111dcc;backdrop-filter:blur(16px);position:sticky;top:0;z-index:2}.brand{display:flex;align-items:center;gap:10px;font-weight:800}.brand i{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#5b42ea;font-style:normal}.status{display:flex;align-items:center;gap:7px;color:#aeb8cb;font-size:13px}.status:before{content:"";width:8px;height:8px;border-radius:50%;background:#f59e0b}.status.online:before{background:#22c55e}.viewer-count{font-size:12px;color:#8f9aaf}main{display:grid;place-items:center;min-height:0;padding:clamp(20px,5vw,64px)}.stage{width:min(100%,1100px);text-align:center}.waiting{display:grid;place-items:center;gap:18px;min-height:50dvh;color:#abb4c5}.waiting .pulse{width:64px;height:64px;border-radius:20px;background:#5b42ea;box-shadow:0 0 0 0 #7865ff66;animation:pulse 1.8s infinite}.content{font-size:clamp(30px,6.5vw,78px);font-weight:700;line-height:1.16;text-wrap:balance}.content p{margin:.18em 0}.content .bible-slide{display:flex;flex-direction:column;gap:.5em}.content .bible-reference-label{display:inline-block;font-size:.34em;padding:.28em .65em}.title{margin-top:26px;color:#a997ff;font-size:clamp(18px,3vw,32px);font-weight:800}.alert{display:none;margin:24px auto 0;width:max-content;max-width:100%;padding:10px 18px;border-radius:999px;background:#b91c1c;font-size:clamp(17px,2.5vw,26px);font-weight:800}.alert.visible{display:block}.slide{display:block;width:100%;max-height:76dvh;object-fit:contain;border-radius:12px;box-shadow:0 18px 60px #0008}.ended{color:#fca5a5}@keyframes pulse{70%{box-shadow:0 0 0 28px #7865ff00}100%{box-shadow:0 0 0 0 #7865ff00}}@media(max-width:600px){header{align-items:flex-start}.viewer-count{display:none}main{padding:24px 18px}.content{font-size:clamp(28px,9vw,52px)}}
</style></head><body><header><div class="brand"><i>FL</i><span>Lectura en vivo</span></div><div><div id="status" class="status">Conectando…</div><div id="viewers" class="viewer-count"></div></div></header><main><section class="stage"><div id="waiting" class="waiting"><div class="pulse"></div><strong>Esperando contenido…</strong></div><div id="text-wrap" hidden><div id="content" class="content"></div><div id="title" class="title"></div><div id="alert" class="alert"></div></div><img id="slide" class="slide" hidden alt="Contenido proyectado"></section></main><script src="/socket.io/socket.io.js"></script><script>
var code=location.pathname.split('/').filter(Boolean).pop(),socket=io({query:{role:'live'},timeout:5000,reconnection:true,reconnectionDelay:500,reconnectionDelayMax:3000}),lastHash='',statusEl=document.getElementById('status'),waiting=document.getElementById('waiting'),textWrap=document.getElementById('text-wrap'),content=document.getElementById('content'),title=document.getElementById('title'),alertEl=document.getElementById('alert'),slide=document.getElementById('slide'),viewers=document.getElementById('viewers');
function showOnly(target){waiting.hidden=target!=='waiting';textWrap.hidden=target!=='text';slide.hidden=target!=='image'}
socket.on('connect',function(){statusEl.textContent='Conectado';statusEl.classList.add('online');socket.emit('live:join',code)});socket.on('disconnect',function(){statusEl.textContent='Reconectando…';statusEl.classList.remove('online')});socket.on('live:error',function(message){showOnly('waiting');waiting.classList.add('ended');waiting.querySelector('strong').textContent=message});socket.on('live:ended',function(){showOnly('waiting');waiting.classList.add('ended');waiting.querySelector('strong').textContent='La transmisión finalizó.';statusEl.textContent='Finalizada';statusEl.classList.remove('online')});socket.on('live:viewers',function(count){viewers.textContent=count+' dispositivo'+(count===1?'':'s')+' conectado'+(count===1?'':'s')});socket.on('live:update',function(data){if(!data||data.hash===lastHash)return;lastHash=data.hash;waiting.classList.remove('ended');if(data.type==='waiting'){showOnly('waiting');waiting.querySelector('strong').textContent=data.message;return}if(data.type==='image'){if(slide.dataset.hash===data.hash)return;slide.onload=function(){slide.dataset.hash=data.hash;showOnly('image')};slide.src=data.url;return}content.innerHTML=data.html||'';content.style.fontFamily=data.fontFamily||'Inter';content.style.color=data.color||'#fff';content.style.textAlign=data.align||'center';title.textContent=data.title||'';title.hidden=!data.title;alertEl.textContent=data.alert||'';alertEl.classList.toggle('visible',Boolean(data.alert));showOnly('text')});
</script></body></html>`;

const remoteIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="118" fill="#5b42ea"/><path fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" d="M136 206h240M136 306h160M365 303h12"/><rect x="112" y="153" width="288" height="206" rx="30" fill="none" stroke="#fff" stroke-width="25"/></svg>`;

const serviceWorker = `self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));`;

const remoteHtml = String.raw`<!doctype html>
<html lang="es"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#5b42ea"><meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="FL Remoto">
  <link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/remote-icon.svg">
  <title>FL Proyector Remoto</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0c1018;color:#f5f7ff}
    *{box-sizing:border-box}html,body{width:100%;height:100%;min-height:100%;overflow:hidden}body{margin:0;background:radial-gradient(circle at 50% -20%,#342378 0,#121522 42%,#0c1018 78%)}
    .app{position:fixed;inset:0;width:min(680px,100%);height:auto;min-height:0;margin:auto;padding:calc(12px + env(safe-area-inset-top)) 16px max(4px,env(safe-area-inset-bottom));display:flex;flex-direction:column;overflow:hidden}
    [hidden]{display:none!important}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}.brand{display:flex;align-items:center;gap:8px;font-weight:800;letter-spacing:.045em;font-size:13px}.logo{width:32px;height:32px;border-radius:10px;background:#6046ec url('/remote-icon.svg') center/80% no-repeat;box-shadow:0 6px 16px #5b42ea55}.header-actions{display:flex;align-items:center;gap:9px}.install-app{border:1px solid #8b7bff;border-radius:9px;padding:7px 10px;background:#332b68;color:#fff;font:800 11px inherit;white-space:nowrap}.status{font-size:12px;color:#aeb7cc;white-space:nowrap}.status:before{content:"";display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background:#f04d5d}.status.online:before{background:#37d67a;box-shadow:0 0 10px #37d67a}
    h1{font-size:26px;line-height:1.1;margin:0 0 6px}.sub{color:#aab3c7;font-size:14px;line-height:1.45;margin:0 0 16px}.picker{display:grid;grid-template-columns:1fr 1.15fr .6fr;gap:9px;padding:11px;background:#181d2a;border:1px solid #30394b;border-radius:16px;box-shadow:0 12px 30px #0002;z-index:2}.field{min-width:0}.field label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#939db3;margin:0 0 5px}select{width:100%;appearance:none;border:1px solid #3a455a;border-radius:10px;background:#111622;color:#f5f7ff;padding:10px 28px 10px 10px;font:600 14px inherit;background-image:linear-gradient(45deg,transparent 50%,#aeb7cc 50%),linear-gradient(135deg,#aeb7cc 50%,transparent 50%);background-position:calc(100% - 14px) 50%,calc(100% - 10px) 50%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}select:focus{outline:2px solid #7967ff;border-color:transparent}.hint{display:flex;align-items:center;justify-content:space-between;margin:16px 2px 9px;color:#aab3c7;font-size:13px}.hint strong{color:#f5f7ff}.hint span{font-size:11px;color:#8994aa}.verses{min-height:0;flex:1;display:grid;align-content:start;gap:9px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0 2px 8px}.verse{width:100%;text-align:left;color:#edf0f9;background:#171c28;border:1px solid #30394b;border-radius:14px;padding:15px 16px;touch-action:pan-y;font:inherit;transition:transform .14s,border-color .14s,background .14s;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default}.verse:active{transform:scale(.985)}.verse.selected{background:#27204a;border-color:#7560ff;box-shadow:0 0 0 1px #7560ff55}.ref{display:block;color:#a99cff;font-size:12px;font-weight:800;margin-bottom:7px;user-select:none}.text{display:block;font-size:16px;line-height:1.42;user-select:text;-webkit-user-select:text}.empty,.loading{padding:28px 16px;text-align:center;color:#aab3c7;background:#171c28;border:1px dashed #39445a;border-radius:14px}.toast{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translate(-50%,130px);background:#ecebff;color:#19152d;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:750;box-shadow:0 10px 30px #0005;transition:transform .22s;white-space:nowrap}.toast.show{transform:translate(-50%,0)}
    .home{display:grid;gap:13px;margin:auto 0}.home h1{font-size:30px;margin:0}.home .sub{margin:0 0 10px}.mode{display:flex;align-items:center;gap:15px;width:100%;padding:20px;text-align:left;color:#f5f7ff;background:#171c28;border:1px solid #30394b;border-radius:17px;font:inherit}.mode i{display:grid;place-items:center;width:44px;height:44px;border-radius:13px;font-style:normal;font-size:23px;background:#5b42ea}.mode b,.mode span{display:block}.mode span{margin-top:4px;color:#aab3c7;font-size:13px;font-weight:500}.view-toolbar{display:flex;align-items:center;gap:8px;flex:0 0 auto;min-height:42px;margin:0 0 10px}.view-toolbar-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f5f7ff;font-size:14px;font-weight:800}.back{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:86px;height:38px;padding:0 11px;color:#ded9ff;background:#191d2a;border:1px solid #343c50;border-radius:10px;font:750 14px inherit;touch-action:manipulation}.back:active,.clear-live:active{transform:scale(.95)}.clear-live{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;padding:0;color:#ffb8bf;background:#351c24;border:1px solid #73313d;border-radius:10px;touch-action:manipulation}.clear-live svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.media-picker{display:flex;gap:8px;margin:0 0 14px}.media-picker select{flex:1}.media-list{display:grid;align-content:start;grid-auto-rows:min-content;gap:9px;overflow:auto;min-height:0;flex:1;padding:0 2px}.media-item{overflow:hidden;text-align:left;color:#f5f7ff;background:#171c28;border:1px solid #30394b;border-radius:14px;font:inherit}.media-launch{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:68px;padding:14px 15px;text-align:left;color:inherit;background:transparent;border:0;font:inherit}.media-item b,.media-item span{display:block}.media-item span{color:#aab3c7;font-size:12px;margin-top:4px}.badge{padding:5px 7px;border-radius:7px;background:#2d2752;color:#c8c1ff;font-size:10px;font-weight:800}.media-item.live{background:#123526;border-color:#37d67a;box-shadow:0 0 0 1px #37d67a55}.media-item.live .badge{background:#1c6b43;color:#eafff1}.item-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 12px}.item-controls button{color:#fff;background:#2c6544;border:1px solid #4aa971;border-radius:9px;padding:10px;font:700 12px inherit}.item-video-controls{border-top:1px solid #37d67a44;padding-top:11px}.seek-label,.volume-label{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:0 12px 10px;color:#b8d6c4;font-size:11px;font-weight:700}.volume-label{grid-template-columns:auto 1fr}.seek-label input,.volume-label input{width:100%;accent-color:#37d67a}.transport{margin-top:14px;padding:13px;background:#171c28;border:1px solid #30394b;border-radius:14px}.transport-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#aab3c7;margin-bottom:11px}.transport-row{display:flex;gap:8px}.transport button{flex:1;color:#fff;background:#332b68;border:1px solid #5549a1;border-radius:10px;padding:11px;font:700 13px inherit}.transport input{width:100%;margin-top:5px}.highlight-menu{position:fixed;z-index:20;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:8px;padding:8px;background:#eef0f8;border:1px solid #fff;border-radius:999px;box-shadow:0 12px 32px #0008}.highlight-menu button{width:30px;height:30px;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 5px #0005}.highlight-menu .clear-highlight{width:auto;padding:0 11px;border:0;border-radius:999px;background:#252b38;color:#fff;font:700 12px inherit}body[data-view="bible"] header,body[data-view="media"] header{display:none}body[data-view="bible"] #bible-view>h1,body[data-view="bible"] #bible-view>.sub,body[data-view="media"] #media-view>h1,body[data-view="media"] #media-view>.sub{display:none}
    #bible-view,#media-view{min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
    @media(max-width:430px){.app{padding-left:12px;padding-right:12px}.picker{grid-template-columns:1fr 1.1fr}.field.chapter{grid-column:1/-1}.verse{padding:14px}.text{font-size:15px}}
  </style>
</head><body><main class="app">
  <header><div class="brand"><span class="logo"></span><span>FL PROYECTOR</span></div><div class="header-actions"><button id="install-app" class="install-app" hidden>Instalar app</button><span id="status" class="status">Conectando</span></div></header>
  <section id="remote-home" class="home"><h1>Control remoto</h1><p class="sub">Elegí qué querés controlar.</p><button id="open-bible" class="mode"><i>▤</i><span><b>Biblia</b><span>Versión, libro, capítulo y versículos.</span></span></button><button id="open-media" class="mode"><i>▶</i><span><b>Multimedia</b><span>Videos, imágenes y PowerPoints de una reunión.</span></span></button></section>
  <section id="bible-view" hidden><div class="view-toolbar"><button class="back" aria-label="Volver al inicio">← Volver</button><span class="view-toolbar-title">Biblia</span><button id="clear-live" class="clear-live" aria-label="Quitar versículo del aire" title="Quitar del aire"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="m8 9 8 8M16 9l-8 8M9 21h6"/></svg></button></div><h1>Biblia</h1><p class="sub">Elegí el pasaje y tocá un versículo para proyectarlo.</p>
  <section class="picker" aria-label="Selector de pasaje">
    <div class="field"><label for="version">Versión</label><select id="version"></select></div>
    <div class="field"><label for="book">Libro</label><select id="book"></select></div>
    <div class="field chapter"><label for="chapter">Capítulo</label><select id="chapter"></select></div>
  </section>
  <div class="hint"><strong id="heading">Versículos</strong><span>Toque para proyectar</span></div><section id="verses" class="verses"><div class="loading">Cargando Biblia…</div></section></section>
  <section id="media-view" hidden><div class="view-toolbar"><button class="back" aria-label="Volver al inicio">← Volver</button><span class="view-toolbar-title">Multimedia</span></div><h1>Multimedia</h1><p class="sub">Videos, imágenes y PowerPoints de una reunión.</p><div class="media-picker"><select id="media-meeting"></select></div><section id="media-list" class="media-list"><div class="loading">Cargando reuniones…</div></section><div id="transport"></div></section>
</main><div id="highlight-menu" class="highlight-menu" hidden><button data-highlight="#fff176" style="background:#fff176" aria-label="Resaltador amarillo"></button><button data-highlight="#a7f3d0" style="background:#a7f3d0" aria-label="Resaltador verde"></button><button data-highlight="#bfdbfe" style="background:#bfdbfe" aria-label="Resaltador celeste"></button><button data-highlight="#fbcfe8" style="background:#fbcfe8" aria-label="Resaltador rosa"></button><button class="clear-highlight" data-highlight="">Quitar</button></div><div id="toast" class="toast" role="status"></div><script src="/socket.io/socket.io.js"></script><script>
  var socket=io({timeout:5000,reconnectionDelay:500,reconnectionDelayMax:2500}), projectionState=null, versions=[], books=[], verses=[], selectedVerse=-1, selectedHighlight=null, verseHighlights={}, activeMediaItemId=null, deferredInstallPrompt=null, status=document.getElementById("status"), installButton=document.getElementById("install-app"), versionSelect=document.getElementById("version"), bookSelect=document.getElementById("book"), chapterSelect=document.getElementById("chapter"), versesElement=document.getElementById("verses"), heading=document.getElementById("heading"), toast=document.getElementById("toast"), toastTimer, home=document.getElementById("remote-home"), bibleView=document.getElementById("bible-view"), mediaView=document.getElementById("media-view"), mediaMeeting=document.getElementById("media-meeting"), mediaList=document.getElementById("media-list"), transport=document.getElementById("transport"), highlightMenu=document.getElementById("highlight-menu");
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,function(character){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[character];});}
  function options(select,items,value,label){select.innerHTML=items.map(function(item){var itemValue=value(item), selected=String(itemValue)===String(select.dataset.value||"")?" selected":"";return "<option value=\""+escapeHtml(itemValue)+"\""+selected+">"+escapeHtml(label(item))+"</option>";}).join("");}
  function request(path){return fetch(path).then(function(response){if(!response.ok)throw new Error("No se pudo cargar el contenido");return response.json();});}function command(path,body){return fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}).then(function(response){if(!response.ok)throw new Error("No se pudo enviar el comando");});}
  function notify(message){toast.textContent=message;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(function(){toast.classList.remove("show");},1600);}
  function isInstalled(){return window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true||navigator.userAgent.indexOf("FlRemotoNative/")>=0;}
  function showInstallButton(){installButton.hidden=isInstalled()?true:false;}
  window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();deferredInstallPrompt=event;showInstallButton();});
  window.addEventListener("appinstalled",function(){deferredInstallPrompt=null;installButton.hidden=true;});
  installButton.onclick=function(){if(/android/i.test(navigator.userAgent)){window.location.href="/downloads/FL-Remoto.apk";return;}if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.then(function(){deferredInstallPrompt=null;showInstallButton();});return;}var ios=/iphone|ipad|ipod/i.test(navigator.userAgent);alert(ios?"Para instalar FL Remoto en iPhone o iPad:\\n\\n1. Tocá Compartir (□↑) en Safari.\\n2. Elegí ‘Agregar a pantalla de inicio’.\\n3. Confirmá con ‘Agregar’.":"Para instalar FL Remoto, abrí el menú del navegador y elegí ‘Instalar aplicación’ o ‘Agregar a pantalla principal’.");};
  // Web app only: Android and iPhone use the browser's normal install flow.
  installButton.onclick=function(){if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.then(function(){deferredInstallPrompt=null;showInstallButton();});return;}var ios=/iphone|ipad|ipod/i.test(navigator.userAgent);alert(ios?"Para instalar FL Remoto en iPhone o iPad:\n\n1. Tocá Compartir (□↑) en Safari.\n2. Elegí ‘Agregar a pantalla de inicio’.\n3. Confirmá con ‘Agregar’.":"Para instalar FL Remoto, abrí el menú del navegador y elegí ‘Instalar aplicación’ o ‘Agregar a pantalla principal’.");};
  showInstallButton();
  var wakeLock=null;function keepScreenAwake(){if(!("wakeLock" in navigator)||document.visibilityState!=="visible")return;navigator.wakeLock.request("screen").then(function(lock){wakeLock=lock;lock.addEventListener("release",function(){wakeLock=null;});}).catch(function(){});}document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")keepScreenAwake();});keepScreenAwake();
  function showView(view){document.body.dataset.view=view;home.hidden=view!=="home";bibleView.hidden=view!=="bible";mediaView.hidden=view!=="media";if(view==="bible"&&!versions.length)loadVersions().catch(function(){versesElement.innerHTML="<div class=\"empty\">No se pudo cargar la Biblia.</div>";});if(view==="media")loadMeetings();}
  function loadMeetings(){return request("/api/remote/meetings").then(function(data){mediaMeeting.innerHTML=data.map(function(meeting){return "<option value=\""+meeting.id+"\">"+escapeHtml(meeting.name)+"</option>";}).join("");if(!data.length){mediaList.innerHTML="<div class=\"empty\">No hay reuniones creadas.</div>";return;}loadMedia();}).catch(function(){mediaList.innerHTML="<div class=\"empty\">No se pudieron cargar las reuniones.</div>";});}
  function itemControls(item){if(Number(item.id)!==Number(activeMediaItemId))return "";if(item.kind==="presentation")return "<div class=\"item-controls\"><button data-presentation=\"-1\" aria-label=\"Diapositiva anterior\">← Anterior</button><button data-presentation=\"1\" aria-label=\"Diapositiva siguiente\">Siguiente →</button></div>";if(item.kind!=="video")return "";var video=projectionState&&projectionState.video||{},duration=Math.max(0,Number(video.duration||0)),current=Math.min(Number(video.currentTime||video.seekTime||0),duration||Number(video.currentTime||video.seekTime||0)),max=Math.max(duration,1);return "<div class=\"item-video-controls\"><div class=\"item-controls\"><button data-video=\"play\">"+(video.playing?"❚❚ Pausar":"▶ Reproducir")+"</button><button data-video=\"mute\">"+(video.muted?"🔊 Activar sonido":"🔇 Silenciar")+"</button></div><label class=\"seek-label\">"+formatTime(current)+" <input data-video=\"seek\" type=\"range\" min=\"0\" max=\""+max+"\" step=\"0.1\" value=\""+current+"\"> "+formatTime(duration)+"</label><label class=\"volume-label\">Volumen <input data-video=\"volume\" type=\"range\" min=\"0\" max=\"1\" step=\"0.05\" value=\""+(video.volume==null?1:video.volume)+"\"></label></div>";}
  function formatTime(value){value=Math.max(0,Math.floor(Number(value)||0));return Math.floor(value/60)+":"+String(value%60).padStart(2,"0");}
  function loadMedia(){var id=mediaMeeting.value;if(!id)return;mediaList.innerHTML="<div class=\"loading\">Cargando contenido…</div>";request("/api/remote/multimedia/"+encodeURIComponent(id)).then(function(items){var activeItem=items.find(function(item){return item.active;});activeMediaItemId=activeItem?activeItem.id:null;if(!items.length){mediaList.innerHTML="<div class=\"empty\">Esta reunión no tiene contenido.</div>";return;}mediaList.innerHTML=items.map(function(item){var label=item.kind==="presentation"?"PowerPoint":item.kind==="video"?"Video":item.kind==="announcement"?"Anuncio":"Imagen",live=Number(item.id)===Number(activeMediaItemId);return "<article class=\"media-item"+(live?" live":"")+"\" data-id=\""+item.id+"\"><button class=\"media-launch\" data-launch=\"1\"><span><b>"+escapeHtml(item.title)+"</b><span>"+(live?"En vivo · tocá para quitar":label)+"</span></span><i class=\"badge\">"+(live?"EN VIVO":label)+"</i></button>"+itemControls(item)+"</article>";}).join("");}).catch(function(){mediaList.innerHTML="<div class=\"empty\">No se pudo cargar el contenido.</div>";});}
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
    command("/api/remote/patch",{blackout:false,logo:false,presentation:{visible:false},lowerThird:{visible:false},text:{html:"<div class=\"bible-slide bible-reference-"+(style.referencePosition||"after")+"\">"+content+"</div>",visible:true,kind:"biblia",fontSize:Number(style.textFontSize||60),fontFamily:style.textFontFamily||"Inter",align:"center",color:style.textColor||"#ffffff",backgroundColor:"rgba(0,0,0,0)",position:"center",borderRadius:0,template:"plain",animation:"none",shadowEnabled:style.textShadowEnabled!==false,shadowColor:style.textShadowColor||"#000000",shadowBlur:Number(style.textShadowBlur||14),title:"",titlePosition:"bottom",titleColor:"#ffffff",titleBackground:"#4f46e5",titleFontSize:30,titleStyle:"none"}});
    notify(reference+" en pantalla");
  }
  function showHighlightMenu(){var selection=window.getSelection(), text=(selection&&selection.toString()||"").replace(/\s+/g," ").trim(), range=selection&&selection.rangeCount?selection.getRangeAt(0):null, target=range&&range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range&&range.commonAncestorContainer.parentElement, verseButton=target&&target.closest?target.closest(".verse"):null;if(!text||!verseButton||!versesElement.contains(verseButton))return;var index=Number(verseButton.dataset.index), verse=verses[index];if(!verse||verse.text.indexOf(text)<0)return;selectedHighlight={index:index,text:text};highlightMenu.hidden=false;}
  function clearHighlightMenu(){highlightMenu.hidden=true;selectedHighlight=null;window.getSelection&&window.getSelection().removeAllRanges();}
  versionSelect.onchange=function(){loadBooks();};bookSelect.onchange=function(){loadChapters();};chapterSelect.onchange=loadVerses;versesElement.onclick=function(event){if(selectedHighlight||(window.getSelection&&window.getSelection().toString().trim()))return;var button=event.target.closest(".verse");if(button)sendVerse(Number(button.dataset.index));};versesElement.addEventListener("mouseup",function(){setTimeout(showHighlightMenu,0);});versesElement.addEventListener("touchend",function(){setTimeout(showHighlightMenu,120);},{passive:true});versesElement.addEventListener("contextmenu",function(event){event.preventDefault();setTimeout(showHighlightMenu,0);});document.addEventListener("selectionchange",function(){var selection=window.getSelection();if(selection&&selection.toString().trim())setTimeout(showHighlightMenu,120);});highlightMenu.onclick=function(event){var button=event.target.closest("button");if(!button||!selectedHighlight)return;sendVerse(selectedHighlight.index,{text:selectedHighlight.text,color:button.dataset.highlight||""});clearHighlightMenu();};function connected(){localStorage.setItem("fl-remote-server",location.origin);status.textContent="Conectado";status.classList.add("online");}socket.on("connect",connected);socket.on("connect_error",function(){if(!projectionState){status.textContent="Buscando PC…";status.classList.remove("online");}});socket.on("disconnect",function(){if(!projectionState){status.textContent="Reconectando…";status.classList.remove("online");}});socket.on("projection:state",function(next){projectionState=next;connected();});request("/api/state").then(function(next){projectionState=next;connected();renderTransport();}).catch(function(){status.textContent="Sin conexión";});if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});
  document.getElementById("open-bible").onclick=function(){showView("bible");};document.getElementById("open-media").onclick=function(){showView("media");};document.querySelectorAll(".back").forEach(function(button){button.onclick=function(){showView("home");};});mediaMeeting.onchange=loadMedia;mediaList.onclick=function(event){var button=event.target.closest("button");if(!button)return;if(button.dataset.presentation){command("/api/remote/presentation",{direction:Number(button.dataset.presentation)});return;}if(button.dataset.video==="play"){command("/api/remote/video",{playing:!(projectionState.video||{}).playing}).then(loadMedia);return;}if(button.dataset.video==="mute"){command("/api/remote/video",{muted:!(projectionState.video||{}).muted}).then(loadMedia);return;}if(!button.dataset.launch)return;var item=button.closest(".media-item"),itemId=Number(item&&item.dataset.id);if(itemId===Number(activeMediaItemId)){command("/api/remote/clear").then(function(){activeMediaItemId=null;loadMedia();notify("Solo fondo en pantalla");});return;}command("/api/remote/multimedia/"+itemId).then(function(){activeMediaItemId=itemId;loadMedia();notify("Contenido enviado a pantalla");});};mediaList.oninput=function(event){var input=event.target;if(!input.dataset.video)return;var value=Number(input.value);if(input.dataset.video==="volume")command("/api/remote/video",{volume:value,muted:false});if(input.dataset.video==="seek"){var commandId=Number((projectionState.video||{}).commandId||0)+1;projectionState.video=Object.assign({},projectionState.video,{seekTime:value,currentTime:value,commandId:commandId});renderTransport();command("/api/remote/video",{seekTime:value,commandId:commandId,currentTime:value});}};socket.on("projection:state",function(next){projectionState=next;renderTransport();});
  versesElement.style.scrollBehavior="smooth";highlightMenu.addEventListener("click",function(event){var button=event.target.closest("button");if(button&&selectedHighlight){var key=verseKey(selectedHighlight.index),list=highlightsFor(selectedHighlight.index);if(button.dataset.highlight){list.push({text:selectedHighlight.text,color:button.dataset.highlight});verseHighlights[key]=list;}else{verseHighlights[key]=list.filter(function(value){return value.text!==selectedHighlight.text;});}renderVerses();}},true);
  highlightMenu.onclick=function(event){var button=event.target.closest("button");if(!button||!selectedHighlight)return;sendVerse(selectedHighlight.index,highlightsFor(selectedHighlight.index));clearHighlightMenu();};
  var initialShowView=showView;showView=function(view){initialShowView(view);if(view==="bible")setTimeout(function(){renderVerses();var active=versesElement.querySelector(".verse.selected");if(active)active.scrollIntoView({block:"center",behavior:"smooth"});},0);};
  // A remote can remain open for hours. Refresh its chapter whenever the
  // operator changes the A/B rule, so it never keeps a stale split list.
  var remoteBibleLayoutKey="";
  socket.on("projection:state",function(next){var style=next.bibleStyle||{},viewport=next.outputViewport||{},key=[style.longVerseMode,style.textFontSize,style.textFontFamily,style.referenceFontSize,style.referencePosition,style.showReference,style.showVersion,style.horizontalMargin,style.verticalMargin,style.uppercase,viewport.width,viewport.height,viewport.scaleFactor].join("|");if(remoteBibleLayoutKey&&key!==remoteBibleLayoutKey&&document.body.dataset.view==="bible"&&versions.length)setTimeout(loadVerses,0);remoteBibleLayoutKey=key;});
  var remoteViewWithFreshVerses=showView;showView=function(view){remoteViewWithFreshVerses(view);if(view==="bible"&&versions.length)loadVerses();};
  document.getElementById("clear-live").onclick=function(){command("/api/remote/clear").then(function(){selectedVerse=-1;renderVerses();notify("Versículo quitado del aire");});};
</script></body></html>`;
