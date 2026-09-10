import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLongBibleVerse } from "../shared/bibleLayout.js";
import type {
  BibleBook,
  BibleVerse,
  BibleVersion,
  Meeting,
  MeetingItem,
  ProjectionPatch,
  ProjectionState,
  Song,
} from "../shared/types.js";

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
};

type CollaboratorSource = {
  getCode: () => string;
  listSongs: () => Song[];
  saveSong: (song: Partial<Song> & { title: string; content: string }) => number;
  listMeetings: () => Meeting[];
  createMeeting: (name: string, date?: string | null) => number;
  listMeetingItems: (meetingId: number) => MeetingItem[];
  saveMeetingItem: (item: Partial<MeetingItem> & { meetingId: number; type: string; title: string; color: string; payload: Record<string, unknown> }) => number;
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
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const remoteApkPath = path.resolve(
    moduleDirectory,
    "../../assets/FL-Remoto.apk",
  );
  app.use(express.json({ limit: "256kb" }));

  const collaboratorTokens = new Set<string>();
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
    const id = collaborator.saveSong({ id: Number.isInteger(source.id) ? source.id : undefined, title, content, color: typeof source.color === "string" ? source.color : "#665cff", categoryId: null });
    return response.json({ id });
  });
  app.get("/api/collaborator/meetings", collaboratorOnly, (_request, response) => response.json(collaborator.listMeetings()));
  app.post("/api/collaborator/meetings", collaboratorOnly, (request, response) => {
    const name = String(request.body?.name ?? "").trim();
    if (!name) return response.status(400).json({ error: "Indicá el nombre de la reunión." });
    return response.json({ id: collaborator.createMeeting(name, typeof request.body?.date === "string" ? request.body.date : null) });
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
    const id = collaborator.saveMeetingItem({ meetingId, type, title: String(item.title).trim(), color: typeof item.color === "string" ? item.color : "#665cff", payload: typeof item.payload === "object" && item.payload ? item.payload : {} });
    return response.json({ id });
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
        if (!isLongBibleVerse(verse.text, bibleStyle))
          return [verse];
        const parts = splitVerseForRemote(verse.text);
        return parts.map((text, index) => ({
          ...verse,
          text,
          // The controller uses this label in the list and in the reference
          // sent to projection, e.g. Juan 3:16a / Juan 3:16b.
          verse: `${verse.verse}${parts.length > 1 ? (index === 0 ? "a" : "b") : ""}`,
        }));
      }),
    );
  });
  app.get("/api/remote/meetings", (_req, res) =>
    res.json(multimedia.listMeetings().map(({ id, name, itemCount }) => ({ id, name, itemCount }))),
  );
  app.get("/api/remote/multimedia/:meetingId", (req, res) => {
    const meetingId = Number(req.params.meetingId);
    return res.json(Number.isInteger(meetingId) ? multimedia.listItems(meetingId) : []);
  });
  app.post("/api/remote/patch", (req, res) => {
    const patch = req.body as ProjectionPatch;
    // A Bible selection is always exclusive: it replaces any media or slide
    // that the remote previously sent to the live output.
    if (patch.text?.kind === "biblia")
      applyPatch({
        ...patch,
        presentation: { visible: false },
        lowerThird: { visible: false },
        video: { playing: false },
        background: { id: null, url: null, name: "", kind: null },
      });
    else applyPatch(patch);
    res.status(204).end();
  });
  app.post("/api/remote/clear", (_req, res) => {
    applyPatch({
      blackout: false, logo: false, text: { visible: false },
      lowerThird: { visible: false }, presentation: { visible: false },
      background: { id: null, url: null, name: "", kind: null },
      video: { playing: false },
    });
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
  });

  const broadcast = (state: ProjectionState) => io.emit("projection:state", state);
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
    isAvailable: () => available,
  };
}

function splitVerseForRemote(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text];
  const target = text.length / 2;
  let total = 0;
  let splitAt = 1;
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < words.length - 1; index += 1) {
    total += words[index].length + (index ? 1 : 0);
    const distance = Math.abs(target - total);
    if (distance < closest) {
      closest = distance;
      splitAt = index + 1;
    }
  }
  return [words.slice(0, splitAt).join(" "), words.slice(splitAt).join(" ")];
}

const collaboratorHtml = String.raw`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FL Proyector · Colaborador</title><style>
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#edf0f8;background:#f3f5f9}*{box-sizing:border-box}body{margin:0}.top{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:#171a22;color:#fff;border-bottom:1px solid #303746}.brand{font-weight:800;letter-spacing:.04em}.brand i{display:inline-grid;place-items:center;width:28px;height:28px;margin-right:8px;border-radius:8px;background:#6046ec;font-style:normal}.mode{font-size:12px;color:#b9c2d6}.shell{display:grid;grid-template-columns:235px minmax(0,1fr);min-height:calc(100vh - 58px)}aside{padding:18px 12px;background:#20242e;color:#dbe0ec;border-right:1px solid #dce1ea}aside h3{font-size:11px;letter-spacing:.1em;color:#9da7ba;margin:8px 10px 10px}nav button{display:block;width:100%;border:0;border-radius:8px;padding:11px 12px;text-align:left;background:transparent;color:inherit;font:650 14px inherit}nav button.active{background:#e9e5ff;color:#432cb7}main{padding:28px;max-width:1200px;width:100%;margin:auto}.page-title{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:20px}.page-title h1{margin:0;font-size:25px;color:#202532}.page-title p{margin:5px 0 0;color:#667188;font-size:14px}.panel{background:#fff;border:1px solid #dce1ea;border-radius:12px;box-shadow:0 3px 16px #2630480a}.toolbar{display:flex;gap:9px;align-items:center;padding:12px;border-bottom:1px solid #e7eaf0}.toolbar input{flex:1}.list{display:grid;gap:1px}.song,.meeting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid #edf0f4}.song:last-child,.meeting:last-child{border-bottom:0}.song b,.meeting b{display:block;color:#202532}.song span,.meeting span{color:#717b90;font-size:12px}.button,button{border:1px solid #c9d0df;border-radius:8px;padding:9px 12px;background:#fff;color:#252b38;font:700 13px inherit;cursor:pointer}.button.primary,button.primary{background:#5b42ea;border-color:#5b42ea;color:#fff}.button:disabled,button:disabled{opacity:.5;cursor:default}.edit{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px}.form{padding:17px}.form label{display:grid;gap:6px;margin-bottom:14px;color:#586379;font-size:12px;font-weight:700}input,textarea{width:100%;border:1px solid #cbd2df;border-radius:8px;padding:10px;font:15px inherit;color:#202532;background:#fff}textarea{min-height:330px;resize:vertical;line-height:1.5}.side-panel{padding:17px}.side-panel h3{margin:0 0 12px;font-size:15px}.item{padding:9px 0;border-bottom:1px solid #edf0f4;font-size:13px}.item:last-child{border:0}.row-actions{display:flex;gap:8px;flex-wrap:wrap}.empty{padding:30px;color:#788297;text-align:center}.login{display:grid;place-items:center;min-height:100vh;background:linear-gradient(135deg,#17182d,#0d1018)}.login-card{width:min(400px,calc(100% - 32px));padding:28px;background:#fff;border-radius:16px;box-shadow:0 20px 60px #0005}.login-card h1{margin:0 0 7px;color:#202532}.login-card p{margin:0 0 20px;color:#687389}.error{min-height:18px;color:#c5303f;font-size:13px;margin:8px 0}.hidden{display:none!important}@media(max-width:760px){.shell{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid #dce1ea;padding:8px;overflow:auto}aside h3{display:none}nav{display:flex;gap:5px}nav button{white-space:nowrap;width:auto}.edit{grid-template-columns:1fr}main{padding:16px}.top{padding:0 15px}}
</style></head><body><section id="login" class="login"><form id="login-form" class="login-card"><h1>FL Proyector</h1><p>Acceso de colaborador. Podés preparar reuniones y editar canciones, sin controlar la pantalla de proyección.</p><label>Código de acceso<input id="access-code" type="password" autocomplete="current-password" required autofocus></label><div id="login-error" class="error"></div><button class="primary" type="submit">Ingresar</button></form></section><section id="app" class="hidden"><header class="top"><div class="brand"><i>▤</i>FL PROYECTOR</div><div class="mode">MODO COLABORADOR · sin acceso al proyector</div><button id="logout">Salir</button></header><div class="shell"><aside><h3>PREPARACIÓN</h3><nav><button class="active" data-page="songs">Canciones</button><button data-page="meetings">Reuniones</button></nav></aside><main><section id="songs-page"><div class="page-title"><div><h1>Canciones</h1><p>Creá y corregí los cánticos de la biblioteca.</p></div><button id="new-song" class="primary">+ Nueva canción</button></div><div class="edit"><div class="panel"><div class="toolbar"><input id="song-search" placeholder="Buscar canción"></div><div id="song-list" class="list"></div></div><form id="song-form" class="panel form"><input id="song-id" type="hidden"><label>Título<input id="song-title" required placeholder="Título de la canción"></label><label>Letra<textarea id="song-content" placeholder="Pegá la letra aquí. Cada párrafo es una estrofa."></textarea></label><div class="row-actions"><button class="primary" type="submit">Guardar canción</button></div></form></div></section><section id="meetings-page" class="hidden"><div class="page-title"><div><h1>Reuniones</h1><p>Armá el orden del culto mientras otro operador proyecta.</p></div><button id="new-meeting" class="primary">+ Nueva reunión</button></div><div class="edit"><div class="panel"><div id="meeting-list" class="list"></div></div><div class="panel side-panel"><h3 id="meeting-title">Elegí una reunión</h3><div id="meeting-items" class="empty">Seleccioná una reunión para ver su orden.</div><div id="add-song-row" class="hidden"><h3>Agregar canción</h3><select id="add-song-select"></select><button id="add-song" class="primary">Agregar al culto</button></div></div></div></section></main></div></section><script>
var selectedSong=null,selectedMeeting=null,songs=[];function api(path,options){return fetch(path,options).then(function(r){if(r.status===401){showLogin();throw new Error("Sesión vencida");}if(!r.ok)return r.json().catch(function(){return {error:"No se pudo guardar"};}).then(function(x){throw new Error(x.error);});return r.status===204?null:r.json();});}function showLogin(){document.getElementById('app').classList.add('hidden');document.getElementById('login').classList.remove('hidden')}function showApp(){document.getElementById('login').classList.add('hidden');document.getElementById('app').classList.remove('hidden');loadSongs();loadMeetings()}function esc(v){return String(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]})}function loadSongs(){api('/api/collaborator/songs').then(function(data){songs=data;renderSongs();document.getElementById('add-song-select').innerHTML=songs.map(function(s){return '<option value="'+s.id+'">'+esc(s.title)+'</option>'}).join('');});}function renderSongs(){var query=document.getElementById('song-search').value.toLowerCase();var filtered=songs.filter(function(s){return (s.title+' '+s.content).toLowerCase().includes(query)});document.getElementById('song-list').innerHTML=filtered.length?filtered.map(function(s){return '<button class="song" data-id="'+s.id+'"><span><b>'+esc(s.title)+'</b><span>'+esc(s.categoryName||'Sin categoría')+'</span></span><span>Editar</span></button>'}).join(''):'<div class="empty">No se encontraron canciones.</div>';document.querySelectorAll('.song').forEach(function(b){b.onclick=function(){var song=songs.find(function(s){return s.id===Number(b.dataset.id)});selectSong(song)}})}function selectSong(song){selectedSong=song;document.getElementById('song-id').value=song.id;document.getElementById('song-title').value=song.title;document.getElementById('song-content').value=(song.content||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ')}function newSong(){selectedSong=null;document.getElementById('song-form').reset();document.getElementById('song-id').value='';document.getElementById('song-title').focus()}function loadMeetings(){api('/api/collaborator/meetings').then(function(data){document.getElementById('meeting-list').innerHTML=data.length?data.map(function(m){return '<button class="meeting" data-id="'+m.id+'"><span><b>'+esc(m.name)+'</b><span>'+m.itemCount+' ítems</span></span><span>›</span></button>'}).join(''):'<div class="empty">Todavía no hay reuniones.</div>';document.querySelectorAll('.meeting').forEach(function(b){b.onclick=function(){selectMeeting(Number(b.dataset.id),data)}});});}function selectMeeting(id,meetings){selectedMeeting=meetings.find(function(m){return m.id===id});document.getElementById('meeting-title').textContent=selectedMeeting.name;document.getElementById('add-song-row').classList.remove('hidden');loadItems();}function loadItems(){if(!selectedMeeting)return;api('/api/collaborator/meetings/'+selectedMeeting.id+'/items').then(function(items){document.getElementById('meeting-items').innerHTML=items.length?items.map(function(i){return '<div class="item"><b>'+esc(i.title)+'</b><br><span>'+esc(i.type)+'</span></div>'}).join(''):'<div class="empty">Sin ítems todavía.</div>';});}document.getElementById('login-form').onsubmit=function(e){e.preventDefault();var error=document.getElementById('login-error');error.textContent='';api('/api/collaborator/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('access-code').value})}).then(showApp).catch(function(e){error.textContent=e.message})};document.getElementById('logout').onclick=function(){api('/api/collaborator/logout',{method:'POST'}).finally(showLogin)};document.querySelectorAll('nav button').forEach(function(b){b.onclick=function(){document.querySelectorAll('nav button').forEach(function(x){x.classList.remove('active')});b.classList.add('active');document.getElementById('songs-page').classList.toggle('hidden',b.dataset.page!=='songs');document.getElementById('meetings-page').classList.toggle('hidden',b.dataset.page!=='meetings')}});document.getElementById('new-song').onclick=newSong;document.getElementById('song-search').oninput=renderSongs;document.getElementById('song-form').onsubmit=function(e){e.preventDefault();var id=Number(document.getElementById('song-id').value)||undefined;api('/api/collaborator/songs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,title:document.getElementById('song-title').value,content:document.getElementById('song-content').value})}).then(function(){newSong();loadSongs();})};document.getElementById('new-meeting').onclick=function(){var name=prompt('Nombre de la reunión');if(name)api('/api/collaborator/meetings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})}).then(loadMeetings)};document.getElementById('add-song').onclick=function(){if(!selectedMeeting)return;var song=songs.find(function(s){return s.id===Number(document.getElementById('add-song-select').value)});if(!song)return;api('/api/collaborator/meetings/'+selectedMeeting.id+'/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'song',title:song.title,color:song.color,payload:{songId:song.id,content:song.content}})}).then(function(){loadItems();loadMeetings();})};api('/api/collaborator/session').then(function(s){if(s.authenticated)showApp();else showLogin()});
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
  function loadMedia(){var id=mediaMeeting.value;if(!id)return;mediaList.innerHTML="<div class=\"loading\">Cargando contenido…</div>";request("/api/remote/multimedia/"+encodeURIComponent(id)).then(function(items){if(!items.length){mediaList.innerHTML="<div class=\"empty\">Esta reunión no tiene contenido.</div>";return;}mediaList.innerHTML=items.map(function(item){var label=item.kind==="presentation"?"PowerPoint":item.kind==="video"?"Video":item.kind==="announcement"?"Anuncio":"Imagen",live=Number(item.id)===Number(activeMediaItemId);return "<article class=\"media-item"+(live?" live":"")+"\" data-id=\""+item.id+"\"><button class=\"media-launch\" data-launch=\"1\"><span><b>"+escapeHtml(item.title)+"</b><span>"+(live?"En vivo · tocá para quitar":label)+"</span></span><i class=\"badge\">"+(live?"EN VIVO":label)+"</i></button>"+itemControls(item)+"</article>";}).join("");}).catch(function(){mediaList.innerHTML="<div class=\"empty\">No se pudo cargar el contenido.</div>";});}
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
  function sendVerse(index,highlight){var verse=verses[index], version=selectedVersion();if(!verse||!projectionState)return;selectedVerse=index;renderVerses();var style=projectionState.bibleStyle||{}, reference=verse.book+" "+verse.chapter+":"+verse.verse, refText=[];if(style.showReference!==false)refText.push(reference);if(style.showVersion!==false&&version)refText.push(version.code||version.name);var referenceHtml=refText.length?"<p style=\"margin:"+(style.referencePosition==="before"?"0 0 .7em":".7em 0 0")+";text-shadow:none\"><span style=\"display:inline-block;color:"+(style.referenceColor||"#fff")+";font-family:"+escapeHtml(style.referenceFontFamily||"Inter")+";font-size:"+Math.max(.2,Math.min(1.5,Number(style.referenceFontSize||24)/Number(style.textFontSize||60)))+"em;font-weight:750;background:"+(style.referenceBackground||"#4f46e5")+";padding:.35em .75em;border-radius:999px\">"+escapeHtml(refText.join(" · "))+"</span></p>":"", verseText=escapeHtml(verse.text), highlights=Array.isArray(highlight)?highlight:(highlight?[highlight]:highlightsFor(index));highlights.forEach(function(value){if(value&&value.text&&value.color)verseText=verseText.replace(escapeHtml(value.text),"<mark style=\"background:"+value.color+";color:#111827;padding:.04em .12em;border-radius:.12em\">"+escapeHtml(value.text)+"</mark>");});var verseHtml="<p style=\"font-family:"+escapeHtml(style.textFontFamily||"Inter")+";color:"+(style.textColor||"#fff")+"\">"+verseText+"</p>";command("/api/remote/patch",{blackout:false,logo:false,presentation:{visible:false},lowerThird:{visible:false},text:{html:style.referencePosition==="before"?referenceHtml+verseHtml:verseHtml+referenceHtml,visible:true,kind:"biblia",fontSize:Number(style.textFontSize||60),fontFamily:style.textFontFamily||"Inter",align:"center",color:style.textColor||"#ffffff",backgroundColor:"rgba(0,0,0,0)",position:"center",borderRadius:0,template:"plain",shadowEnabled:style.textShadowEnabled!==false,shadowColor:style.textShadowColor||"#000000",shadowBlur:Number(style.textShadowBlur||14),title:"",titlePosition:"bottom",titleColor:"#ffffff",titleBackground:"#4f46e5",titleFontSize:30,titleStyle:"none"}});notify(reference+" en pantalla");}
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
  socket.on("projection:state",function(next){var style=next.bibleStyle||{},key=[style.longVerseMode,style.maxLinesPerSlide,style.textFontSize,style.horizontalMargin,style.verticalMargin].join("|");if(remoteBibleLayoutKey&&key!==remoteBibleLayoutKey&&document.body.dataset.view==="bible"&&versions.length)setTimeout(loadVerses,0);remoteBibleLayoutKey=key;});
  var remoteViewWithFreshVerses=showView;showView=function(view){remoteViewWithFreshVerses(view);if(view==="bible"&&versions.length)loadVerses();};
  document.getElementById("clear-live").onclick=function(){command("/api/remote/clear").then(function(){selectedVerse=-1;renderVerses();notify("Versículo quitado del aire");});};
</script></body></html>`;
