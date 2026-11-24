import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BookOpenText,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Edit3,
  GripVertical,
  Image,
  ListPlus,
  Megaphone,
  MonitorPlay,
  Music2,
  Minus,
  Palette,
  Plus,
  Presentation,
  Repeat2,
  AppWindow,
  MousePointer2,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  BibleBook,
  BibleDisplaySettings,
  BibleVerse,
  BibleVersion,
  CaptureSource,
  MediaItem,
  Meeting,
  MeetingItem,
  MeetingItemType,
  ProjectionPatch,
  ProjectionState,
  Song,
} from "../../shared/types";
import { ProjectionPreview } from "./ProjectionStage";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { RichTextToolbar } from "./RichTextToolbar";
import { Win11ContextMenu } from "./Win11ContextMenu";
import { EmptyState } from "./EmptyState";
import { withSaveNotification } from "./SaveNotification";
import { buildBibleSlides } from "../bibleDisplay";
import {
  normalizeSongSectionTypes,
  songSectionLabel,
  splitSongStanzas,
} from "../../shared/songSections";
import {
  clampColumnWidth,
  ColumnResizer,
  storedColumnWidth,
} from "./ColumnResizer";
import {
  emptyRichText,
  withoutLegacyEditorPrompt,
} from "../editorPlaceholders";

const itemIcons = {
  announcement: Megaphone,
  song: Music2,
  bible: BookOpenText,
  media: Image,
  presentation: Presentation,
  capture: AppWindow,
};
const itemLabels = {
  announcement: "Anuncio",
  song: "Canción",
  bible: "Cita bíblica",
  media: "Fondo / video",
  presentation: "PowerPoint",
  capture: "Ventana",
};
const defaultColors = {
  announcement: "#f59e0b",
  song: "#8b5cf6",
  bible: "#3b82f6",
  media: "#10b981",
  presentation: "#ef4444",
  capture: "#0ea5e9",
};
const itemColors = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#64748b",
];

function splitAnnouncementPages(html: string, limit = 240) {
  const root = document.createElement("div");
  root.innerHTML = html;
  const source = Array.from(root.children).map((node) => node.outerHTML);
  const blocks = source.length ? source : [html];
  const pages: string[] = [];
  let page = "";
  const textLength = (value: string) => {
    const holder = document.createElement("div");
    holder.innerHTML = value;
    return (holder.textContent || "").trim().length;
  };
  const push = () => {
    if (page.trim()) pages.push(page);
    page = "";
  };
  for (const block of blocks) {
    if (textLength(block) > limit) {
      push();
      const holder = document.createElement("div");
      holder.innerHTML = block;
      const words = (holder.textContent || "").trim().split(/\s+/);
      let chunk = "";
      for (const word of words) {
        if (chunk && `${chunk} ${word}`.length > limit) {
          pages.push(`<p>${chunk}</p>`);
          chunk = word;
        } else chunk = chunk ? `${chunk} ${word}` : word;
      }
      if (chunk) pages.push(`<p>${chunk}</p>`);
      continue;
    }
    if (page && textLength(`${page}${block}`) > limit) push();
    page += block;
  }
  push();
  return pages.length ? pages : ["<p></p>"];
}

function announcementPages(payload: Record<string, unknown>) {
  const saved = payload.announcementPages;
  if (Array.isArray(saved) && saved.every((page) => typeof page === "string"))
    return (saved as string[]).map((page) =>
      withoutLegacyEditorPrompt(page, "announcement"),
    );
  return splitAnnouncementPages(
    withoutLegacyEditorPrompt(String(payload.html || ""), "announcement"),
  );
}

function announcementListTitle(pages: string[]) {
  const holder = document.createElement("div");
  // Cada renglón (p, br, div, h…) se separa con un espacio: antes
  // "Bienvenidos" + "Enseguida comenzamos" quedaba "BienvenidosEnseguida".
  holder.innerHTML = pages
    .join(" ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "</$1> ");
  const text = (holder.textContent || "").replace(/\s+/g, " ").trim();
  if (!text) return "Nuevo anuncio";
  if (text.length <= 58) return text;
  const shortened = text.slice(0, 58).replace(/\s+\S*$/, "").trim();
  return `${shortened || text.slice(0, 55).trim()}…`;
}

/** Título para mostrar: los anuncios con título automático se recalculan. */
function displayItemTitle(item: MeetingItem) {
  if (item.type !== "announcement") return item.title;
  const pages = announcementPages(item.payload as Record<string, unknown>);
  if (announcementHasAutomaticTitle(item)) return announcementListTitle(pages);
  // Títulos automáticos guardados antes, con los renglones pegados.
  const holder = document.createElement("div");
  holder.innerHTML = pages.join(" ");
  const glued = (holder.textContent || "").replace(/\s+/g, " ").trim();
  const title = item.title.replace(/…$/, "").trim();
  if (title && glued.startsWith(title) && !announcementListTitle(pages).startsWith(title))
    return announcementListTitle(pages);
  return item.title;
}

function announcementHasAutomaticTitle(item: MeetingItem) {
  const mode = String(item.payload.announcementTitleMode || "");
  if (mode === "manual") return false;
  return mode === "auto" || !item.title.trim() || /^nuevo anuncio$/i.test(item.title.trim());
}

function legacyBibleText(html: string) {
  const withoutReference = html
    .replace(/<p[^>]*>\s*<small[\s\S]*?<\/small>\s*<\/p>/gi, "")
    .replace(/<small[\s\S]*?<\/small>/gi, "");
  const container = document.createElement("div");
  container.innerHTML = withoutReference;
  return (container.textContent || "").replace(/\s+/g, " ").trim();
}

function bibleSections(
  payload: Record<string, unknown>,
  settings: BibleDisplaySettings,
  fallbackReference = "",
  viewport?: ProjectionState["outputViewport"],
) {
  if (Array.isArray(payload.bibleEntries))
    return (
      payload.bibleEntries as Array<{
        text: string;
        reference: string;
        version: string;
      }>
    ).flatMap((entry) =>
      buildBibleSlides(
        entry.text,
        entry.reference,
        entry.version,
        settings,
        viewport,
      ),
    );
  const saved = Array.isArray(payload.sections)
    ? (payload.sections.filter(
        (value) => typeof value === "string" && value.trim(),
      ) as string[])
    : [];
  const source = saved.length
    ? saved
    : [String(payload.html || "")].filter(Boolean);
  const labels = Array.isArray(payload.sectionLabels)
    ? (payload.sectionLabels as string[])
    : [];
  return source.flatMap((html, index) =>
    buildBibleSlides(
      legacyBibleText(html),
      labels[index] || fallbackReference || `Texto ${index + 1}`,
      String(payload.version || ""),
      settings,
      viewport,
    ),
  );
}

export function MeetingBuilder({
  state,
  update,
  previewAspectRatio,
  meetingId,
  setMeetingId,
  focusedItemId,
  onFocusedItem,
}: {
  state: ProjectionState;
  update: (patch: ProjectionPatch) => void;
  previewAspectRatio: string;
  meetingId: number | null;
  setMeetingId: (id: number | null) => void;
  focusedItemId: number | null;
  onFocusedItem: () => void;
}) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [items, setItems] = useState<MeetingItem[]>([]);
  const [selected, setSelected] = useState<MeetingItem | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [dragId, setDragId] = useState<number | null>(null);
  const [newMeeting, setNewMeeting] = useState<{
    name: string;
    date: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    item: MeetingItem;
    x: number;
    y: number;
    palette: boolean;
  } | null>(null);
  const [meetingContextMenu, setMeetingContextMenu] = useState<{
    meeting: Meeting;
    x: number;
    y: number;
    palette: boolean;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  // Selector de ventana/pantalla para un elemento "Ventana" (nuevo o existente).
  const [capturePicker, setCapturePicker] = useState<{ itemId: number | null } | null>(null);
  const [draftItemId, setDraftItemId] = useState<number | null>(null);
  const [picker, setPicker] = useState<"song" | "media" | "bible" | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [activeStanza, setActiveStanza] = useState(0);
  // This only changes the density of the operator cards. It deliberately does
  // not affect the text sent to the projector.
  const [stanzaCardScale, setStanzaCardScale] = useState(1);
  const [onAirItemId, setOnAirItemId] = useState<number | null>(null);
  const [stanzaContextMenu, setStanzaContextMenu] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [editingStanza, setEditingStanza] = useState<{
    index: number;
    label: string;
    html: string;
  } | null>(null);
  const [pendingStanzaDelete, setPendingStanzaDelete] = useState<number | null>(
    null,
  );
  // A media item in a meeting is temporary content, not the application's
  // global background. Keep the latter so a song/Bible item can restore it.
  const globalBackground = useRef(state.background);
  const meetingVideoReturnBackground = useRef<
    ProjectionState["background"] | null
  >(null);
  const previousVideoPlayback = useRef({
    playing: state.video.playing,
    loop: state.video.loop,
  });
  const [addingMedia, setAddingMedia] = useState(false);
  const [songDraft, setSongDraft] = useState<{
    title: string;
    content: string;
    shadowEnabled: boolean;
    shadowColor: string;
    shadowBlur: number;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MeetingItem | null>(null);
  const [backgroundTarget, setBackgroundTarget] = useState<MeetingItem | null>(
    null,
  );
  const [pendingMeetingDelete, setPendingMeetingDelete] =
    useState<Meeting | null>(null);
  const [previewDraft, setPreviewDraft] = useState<ProjectionState | null>(null);
  const [renamingMeeting, setRenamingMeeting] = useState<Meeting | null>(null);
  // Make the newest rich-editor payload available to Guardar immediately,
  // even when blur and click occur in the same Windows event cycle.
  const selectedRef = useRef<MeetingItem | null>(selected);
  selectedRef.current = selected;
  const [meetingListWidth, setMeetingListWidth] = useState(() =>
    clampColumnWidth(
      storedColumnWidth("fl-layout-meeting-list", 220),
      180,
      520,
    ),
  );
  const [itemPanelWidth, setItemPanelWidth] = useState(() =>
    clampColumnWidth(storedColumnWidth("fl-layout-item-panel", 300), 220, 720),
  );
  const meetingPageRef = useRef<HTMLElement | null>(null);
  const [meetingPageWidth, setMeetingPageWidth] = useState(0);

  const meetingListMaximum = Math.min(
    520,
    Math.max(180, meetingPageWidth - itemPanelWidth - 348),
  );
  const itemPanelMaximum = Math.min(
    720,
    Math.max(220, meetingPageWidth - meetingListWidth - 348),
  );

  const reloadMeetings = async () => {
    const list = await window.flProyector.listMeetings();
    setMeetings(list);
    if (!meetingId && list[0]) setMeetingId(list[0].id);
  };
  const reloadItems = async () => {
    if (!meetingId) return setItems([]);
    const list = await window.flProyector.listMeetingItems(meetingId);
    setItems(list);
    if (focusedItemId) {
      const focused = list.find((item) => item.id === focusedItemId);
      if (focused) {
        setSelected(focused);
        setActiveStanza(0);
        onFocusedItem();
        return;
      }
    }
    if (selected?.id)
      setSelected(list.find((item) => item.id === selected.id) ?? null);
  };

  useEffect(() => {
    reloadMeetings();
    window.flProyector.listSongs().then(setSongs);
    window.flProyector.listMedia().then(setMedia);
  }, []);
  useEffect(() => {
    reloadItems();
  }, [meetingId, focusedItemId]);
  useEffect(
    () => window.flProyector.onLibraryChanged((scope) => {
      if (scope === "songs") window.flProyector.listSongs().then(setSongs);
      if (scope === "meetings") {
        reloadMeetings();
        reloadItems();
      }
    }),
    [meetingId, focusedItemId, selected?.id],
  );
  useEffect(() => {
    setActiveStanza(0);
  }, [selected?.id]);
  useEffect(() => {
    const onAir = items.find((item) => item.id === onAirItemId);
    if (onAir?.type !== "song") return;
    const songId = Number((onAir.payload as any).songId);
    if (
      state.text.kind === "canto" &&
      state.text.sourceSongId === songId &&
      Number.isInteger(state.text.sourceSectionIndex)
    )
      setActiveStanza(Number(state.text.sourceSectionIndex));
  }, [items, onAirItemId, state.text.sourceSongId, state.text.sourceSectionIndex]);
  useEffect(() => {
    if (!editing || selected?.type !== "song") return setSongDraft(null);
    const song = songs.find(
      (value) => value.id === Number((selected.payload as any).songId),
    );
    setSongDraft(
      song
        ? {
            title: selected.title || song.title,
            content: withoutLegacyEditorPrompt(song.content, "song"),
            shadowEnabled: song.shadowEnabled,
            shadowColor: song.shadowColor,
            shadowBlur: song.shadowBlur,
          }
        : {
            title: selected.title,
            content: "",
            shadowEnabled: true,
            shadowColor: "#000000",
            shadowBlur: 14,
          },
    );
  }, [editing, selected?.id]);
  useEffect(() => {
    const close = () => {
      setContextMenu(null);
      setMeetingContextMenu(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  useEffect(() => {
    localStorage.setItem("fl-layout-meeting-list", String(meetingListWidth));
  }, [meetingListWidth]);
  useEffect(() => {
    localStorage.setItem("fl-layout-item-panel", String(itemPanelWidth));
  }, [itemPanelWidth]);
  useEffect(() => {
    const page = meetingPageRef.current;
    if (!page) return;
    const measure = () => setMeetingPageWidth(page.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!meetingPageWidth) return;
    setMeetingListWidth((current) =>
      clampColumnWidth(current, 180, meetingListMaximum),
    );
    setItemPanelWidth((current) =>
      clampColumnWidth(current, 220, itemPanelMaximum),
    );
  }, [meetingPageWidth, meetingListMaximum, itemPanelMaximum]);

  const createMeeting = async () => {
    if (!newMeeting?.name.trim()) return;
    await withSaveNotification(async () => {
      const id = await window.flProyector.createMeeting(
        newMeeting.name,
        newMeeting.date || null,
      );
      setNewMeeting(null);
      await reloadMeetings();
      setMeetingId(id);
      setSelected(null);
    }, "La reunión fue guardada.");
  };

  const addItem = async (type: MeetingItemType) => {
    if (!meetingId) return;
    if (type === "song" || type === "bible") {
      setPickerSearch("");
      setPicker(type);
      return;
    }
    if (type === "media") {
      setAddingMedia(true);
      try {
        const imported = await window.flProyector.chooseMeetingMedia();
        let lastId: number | null = null;
        for (const entry of imported)
          lastId = await window.flProyector.saveMeetingItem({
            meetingId,
            type: "media",
            title: entry.name,
            color: defaultColors.media,
            payload: { meetingMedia: entry },
          });
        const [list, allMedia] = await Promise.all([
          window.flProyector.listMeetingItems(meetingId),
          window.flProyector.listMedia(),
        ]);
        setMedia(allMedia);
        setItems(list);
        if (lastId)
          setSelected(list.find((item) => item.id === lastId) ?? null);
        reloadMeetings();
      } catch {
        alert(
          "No se pudo procesar el archivo seleccionado. Verificá que no esté dañado e intentá nuevamente.",
        );
      } finally {
        setAddingMedia(false);
      }
      return;
    }
    if (type === "capture") {
      setCapturePicker({ itemId: null });
      return;
    }
    if (type === "presentation") {
      const file = await window.flProyector.importPresentation();
      if (!file) return;
      const id = await window.flProyector.saveMeetingItem({
        meetingId,
        type,
        title: file.name,
        color: defaultColors[type],
        payload: file,
      });
      const list = await window.flProyector.listMeetingItems(meetingId);
      setItems(list);
      setSelected(list.find((item) => item.id === id) ?? null);
      return;
    }
    const payload: Record<string, unknown> =
      type === "announcement"
        ? {
            html: emptyRichText,
            position: "center",
            fontSize: 64,
            color: "#ffffff",
            backgroundColor: "#00000099",
            align: "center",
            // Antes arrancaba en "Centro" con el diseño "Lower third", que es
            // solo para zócalos: una combinación que se veía rota.
            borderRadius: 14,
            template: "glass",
            animation: "fade",
            shadowEnabled: true,
            shadowColor: "#000000",
            shadowBlur: 14,
            backgroundId: null,
            announcementTitleMode: "auto",
          }
        : {};
    const id = await window.flProyector.saveMeetingItem({
      meetingId,
      type,
      title: `Nuevo ${itemLabels[type].toLowerCase()}`,
      color: defaultColors[type],
      payload,
    });
    const list = await window.flProyector.listMeetingItems(meetingId);
    setItems(list);
    setSelected(list.find((item) => item.id === id) ?? null);
    // El anuncio recién creado es un borrador hasta que el operador guarde.
    // Cerrar el editor lo descarta, por eso no corresponde mostrar Eliminar.
    if (type === "announcement") setDraftItemId(id);
    setEditing(true);
    reloadMeetings();
  };

  const addLibraryItem = async (entry: Song | MediaItem) => {
    if (!meetingId || !picker) return;
    const isSong = picker === "song";
    const type: MeetingItemType = isSong ? "song" : "media";
    const payload = isSong
      ? { songId: entry.id, backgroundId: null }
      : { mediaId: entry.id };
    const title = isSong ? (entry as Song).title : (entry as MediaItem).name;
    const id = await window.flProyector.saveMeetingItem({
      meetingId,
      type,
      title,
      color: defaultColors[type],
      payload,
    });
    const list = await window.flProyector.listMeetingItems(meetingId);
    setItems(list);
    setSelected(list.find((item) => item.id === id) ?? null);
    setPicker(null);
    reloadMeetings();
  };

  const addBibleItem = async (selection: {
    title: string;
    html: string;
    version: string;
    bibleEntries: Array<{ text: string; reference: string; version: string }>;
  }) => {
    if (!meetingId) return;
    const payload = {
      html: selection.html,
      version: selection.version,
      bibleEntries: selection.bibleEntries,
      position: "center",
      backgroundColor: "#00000055",
      align: "center",
      borderRadius: 12,
      template: "plain",
      backgroundId: null,
    };
    const id = await window.flProyector.saveMeetingItem({
      meetingId,
      type: "bible",
      title: selection.title,
      color: defaultColors.bible,
      payload,
    });
    const list = await window.flProyector.listMeetingItems(meetingId);
    setItems(list);
    setSelected(list.find((item) => item.id === id) ?? null);
    setPicker(null);
    reloadMeetings();
  };

  const save = async () => {
    if (selected) {
      await window.flProyector.saveMeetingItem(selected);
      reloadItems();
    }
  };
  const saveEditor = async () => {
    const editorItem = selectedRef.current;
    if (!editorItem) return;
    await withSaveNotification(async () => {
      if (editorItem.type === "song" && songDraft) {
        const song = songs.find(
          (value) => value.id === Number((editorItem.payload as any).songId),
        );
        const title = songDraft.title.trim() || "Canción sin título";
        if (song)
          await window.flProyector.saveSong({
            ...song,
            title,
            content: songDraft.content,
            shadowEnabled: songDraft.shadowEnabled,
            shadowColor: songDraft.shadowColor,
            shadowBlur: songDraft.shadowBlur,
          });
        const changed = { ...editorItem, title };
        await window.flProyector.saveMeetingItem(changed);
        setSelected(changed);
        selectedRef.current = changed;
        setSongs(await window.flProyector.listSongs());
        await reloadItems();
      } else if (editorItem.type === "announcement") {
        // Keep the rich editor fully uncontrolled while the operator types.
        // Normalizing/paginating on every keystroke removes trailing spaces
        // and can reset Chromium's composition/caret on Windows.
        const pages = announcementPages(editorItem.payload).flatMap((page) =>
          splitAnnouncementPages(page),
        );
        const announcementPage = Math.max(
          0,
          Math.min(
            Number(editorItem.payload.announcementPage || 0),
            pages.length - 1,
          ),
        );
        const changed = {
          ...editorItem,
          title: announcementHasAutomaticTitle(editorItem)
            ? announcementListTitle(pages)
            : editorItem.title,
          payload: {
            ...editorItem.payload,
            html: pages[0],
            announcementPages: pages,
            announcementPage,
            announcementTitleMode: announcementHasAutomaticTitle(editorItem)
              ? "auto"
              : "manual",
          },
        };
        await window.flProyector.saveMeetingItem(changed);
        setSelected(changed);
        selectedRef.current = changed;
        await reloadItems();
      } else {
        await window.flProyector.saveMeetingItem(editorItem);
        await reloadItems();
      }
      setDraftItemId(null);
      setEditing(false);
    }, "El elemento de la reunión fue guardado.");
  };
  const closeEditor = async () => {
    if (selected && selected.id === draftItemId) {
      await window.flProyector.deleteMeetingItem(selected.id);
      setItems((current) => current.filter((item) => item.id !== selected.id));
      setSelected(null);
      setDraftItemId(null);
      await reloadMeetings();
    }
    setEditing(false);
  };
  const confirmRemoveItem = async () => {
    if (!pendingDelete) return;
    await window.flProyector.deleteMeetingItem(pendingDelete.id);
    if (selected?.id === pendingDelete.id) {
      setSelected(null);
      setEditing(false);
    }
    setPendingDelete(null);
    reloadItems();
    reloadMeetings();
  };
  const updateMeeting = async (
    meeting: Meeting,
    patch: Partial<Pick<Meeting, "name" | "color">>,
  ) => {
    await window.flProyector.updateMeeting(meeting.id, patch);
    setMeetings((current) =>
      current.map((entry) =>
        entry.id === meeting.id ? { ...entry, ...patch } : entry,
      ),
    );
  };
  const renameMeeting = async () => {
    if (!renamingMeeting?.name.trim()) return;
    await withSaveNotification(async () => {
      await updateMeeting(renamingMeeting, { name: renamingMeeting.name });
      setRenamingMeeting(null);
    }, "El nombre de la reunión fue guardado.");
  };
  const changeMeetingColor = async (meeting: Meeting, color: string) => {
    await updateMeeting(meeting, { color });
    setMeetingContextMenu(null);
  };
  const confirmRemoveMeeting = async () => {
    if (!pendingMeetingDelete) return;
    const deleting = pendingMeetingDelete;
    await window.flProyector.deleteMeeting(deleting.id);
    const remaining = await window.flProyector.listMeetings();
    setMeetings(remaining);
    if (meetingId === deleting.id) {
      setMeetingId(remaining[0]?.id ?? null);
      setItems([]);
      setSelected(null);
      setOnAirItemId(null);
      setEditing(false);
    }
    setPendingMeetingDelete(null);
  };
  const changeColor = async (item: MeetingItem, color: string) => {
    const changed = { ...item, color };
    await window.flProyector.saveMeetingItem(changed);
    setItems((value) =>
      value.map((current) => (current.id === item.id ? changed : current)),
    );
    if (selected?.id === item.id) setSelected(changed);
    setContextMenu(null);
  };
  const assignBackground = async (
    item: MeetingItem,
    backgroundId: number | null,
  ) => {
    const changed = {
      ...item,
      payload: { ...item.payload, backgroundId },
    };
    await window.flProyector.saveMeetingItem(changed);
    setItems((value) =>
      value.map((current) => (current.id === item.id ? changed : current)),
    );
    if (selected?.id === item.id) setSelected(changed);
    setBackgroundTarget(null);
  };
  const setPayload = (patch: Record<string, unknown>) => {
    setSelected((current) => {
      if (!current) return current;
      const changed = {
        ...current,
        payload: { ...current.payload, ...patch },
      };
      selectedRef.current = changed;
      return changed;
    });
  };
  const mediaById = (id: unknown) =>
    media.find((item) => item.id === Number(id));
  const meetingMediaForItem = (item: MeetingItem) => {
    if (item.type !== "media") return null;
    const payload = item.payload as Record<string, unknown>;
    return (
      (payload.meetingMedia as MediaItem | undefined) ??
      mediaById(payload.mediaId)
    );
  };
  const isLoopableMeetingItem = (item: MeetingItem) =>
    meetingMediaForItem(item)?.kind === "video";
  const setMeetingItemLoop = async (item: MeetingItem, loop: boolean) => {
    const changed = {
      ...item,
      payload: { ...item.payload, loop },
    };
    await window.flProyector.saveMeetingItem(changed);
    setItems((current) =>
      current.map((entry) => (entry.id === changed.id ? changed : entry)),
    );
    if (selected?.id === changed.id) setSelected(changed);
    setContextMenu(null);
    // Si el video ya está en el aire, el cambio se aplica en el momento.
    if (isItemOnAir(item)) update({ video: { loop } });
  };
  const backgroundVideoState = (background?: MediaItem) =>
    background?.kind === "video"
      ? {
          playing: true,
          loop: true,
          seekTime: 0,
          currentTime: 0,
          duration: 0,
          commandId: state.video.commandId + 1,
        }
      : { playing: false, loop: true };
  const releaseMeetingVideoBackground = () => {
    const background =
      meetingVideoReturnBackground.current ?? globalBackground.current;
    meetingVideoReturnBackground.current = null;
    return background;
  };
  const isItemOnAir = (item: MeetingItem) => {
    if (onAirItemId === item.id) return true;
    const payload = item.payload as Record<string, unknown>;
    if (item.type === "presentation")
      return (
        state.presentation.visible &&
        state.presentation.path === String(payload.path || "")
      );
    if (item.type === "capture")
      return (
        !!state.capture?.visible &&
        (state.capture.sourceId === payload.sourceId || state.capture.name === payload.sourceName)
      );
    if (item.type === "media") {
      const source = meetingMediaForItem(item);
      if (!source) return false;
      if (source.kind === "image")
        return (
          state.presentation.visible &&
          state.presentation.url === source.url
        );
      return (
        state.background.kind === "video" &&
        state.background.url === source.url &&
        state.video.playing
      );
    }
    // A collaborator can put a song on air without changing this window's
    // local onAirItemId.  The projection state still carries the canonical
    // song id, so use it to keep the meeting list's AL AIRE state consistent.
    if (item.type === "song") {
      const songId = Number(payload.songId);
      return (
        Number.isInteger(songId) &&
        state.text.visible &&
        state.text.kind === "canto" &&
        state.text.sourceSongId === songId
      );
    }
    return false;
  };

  useEffect(() => {
    // A non-looping video is temporary meeting content. When it is removed,
    // React can clear onAirItemId one render before the restored projection
    // state arrives. Never capture that transient video as the global
    // background, otherwise the next song restores the video itself.
    if (!state.video.loop) return;
    if (onAirItemId === null) globalBackground.current = state.background;
  }, [state.background, state.video.loop, items, onAirItemId]);
  useEffect(() => {
    const onAir = items.find((item) => item.id === onAirItemId);
    const previous = previousVideoPlayback.current;
    previousVideoPlayback.current = {
      playing: state.video.playing,
      loop: state.video.loop,
    };
    // Only clear the meeting button after a video that was genuinely playing
    // has finished. Looking only at the current idle state races with the first
    // click and used to clear “QUITAR” before playback had even started.
    if (
      onAir?.type !== "media" ||
      !previous.playing ||
      previous.loop ||
      state.video.playing ||
      !state.video.loop
    )
      return;
    const payload = onAir.payload as Record<string, unknown>;
    const source =
      (payload.meetingMedia as MediaItem | undefined) ??
      mediaById(payload.mediaId);
    if (source?.kind === "video") {
      meetingVideoReturnBackground.current = null;
      setOnAirItemId(null);
    }
  }, [items, media, onAirItemId, state.video.playing, state.video.loop]);
  useEffect(() => {
    if (onAirItemId === null) return;
    const hasForegroundContent =
      state.text.visible ||
      state.lowerThird.visible ||
      state.presentation.visible ||
      (state.background.kind === "video" && !state.video.loop);
    if (hasForegroundContent) return;
    meetingVideoReturnBackground.current = null;
    setOnAirItemId(null);
  }, [
    onAirItemId,
    state.text.visible,
    state.lowerThird.visible,
    state.presentation.visible,
    state.background.kind,
    state.video.loop,
  ]);

  const fireSongStanza = (item: MeetingItem, index: number) => {
    const payload = item.payload as any;
    const song = songs.find((value) => value.id === Number(payload.songId));
    if (!song) return;
    const stanzas = splitSongStanzas(song.content);
    const safeIndex = Math.max(
      0,
      Math.min(index, Math.max(stanzas.length - 1, 0)),
    );
    const background = mediaById(payload.backgroundId);
    const restoredBackground = releaseMeetingVideoBackground();
    const theme = state.songStyle;
    const stanza = stanzas[safeIndex] || song.content;
    setActiveStanza(safeIndex);
    setOnAirItemId(item.id);
    update({
      blackout: false,
      logo: false,
      presentation: { visible: false },
      lowerThird: { visible: false },
      video: backgroundVideoState(background),
      background: background
        ? {
            id: background.id,
            url: background.url,
            name: background.name,
            kind: background.kind,
          }
        : restoredBackground,
      text: {
        html: stanza,
        kind: "canto",
        sourceSongId: song.id,
        sourceSectionIndex: safeIndex,
        sourceSongStanzas: stanzas,
        visible: true,
        position: theme.position,
        fontSize: theme.fontSize,
        fontFamily: theme.fontFamily,
        color: theme.textColor,
        backgroundColor: theme.backgroundColor,
        align: theme.align,
        borderRadius: theme.borderRadius,
        template: theme.template,
        shadowEnabled: song.shadowEnabled,
        shadowColor: song.shadowColor,
        shadowBlur: song.shadowBlur,
        title: theme.showTitle ? song.title : "",
        titlePosition: theme.titlePosition,
        titleColor: theme.titleColor,
        titleBackground: theme.titleBackground,
        titleFontSize: theme.titleFontSize,
        titleStyle: theme.titleStyle,
      },
    });
  };

  const fireBibleSection = (item: MeetingItem, index: number) => {
    const payload = item.payload as any;
    const sections = bibleSections(
      payload,
      state.bibleStyle,
      item.title,
      state.outputViewport,
    );
    if (!sections.length) return;
    const safeIndex = Math.max(0, Math.min(index, sections.length - 1));
    const background = mediaById(payload.backgroundId);
    const restoredBackground = releaseMeetingVideoBackground();
    setActiveStanza(safeIndex);
    setOnAirItemId(item.id);
    update({
      blackout: false,
      logo: false,
      presentation: { visible: false },
      lowerThird: { visible: false },
      video: backgroundVideoState(background),
      background: background
        ? {
            id: background.id,
            url: background.url,
            name: background.name,
            kind: background.kind,
          }
        : restoredBackground,
      text: {
        html: sections[safeIndex].html,
        sourceBibleText: sections[safeIndex].sourceText,
        sourceBibleReference: sections[safeIndex].reference,
        sourceBibleVersion: sections[safeIndex].version,
        kind: "biblia",
        visible: true,
        position: payload.position || "center",
        fontSize:
          state.bibleStyle.longVerseMode === "auto-fit"
            ? state.bibleStyle.textFontSize
            : sections[safeIndex].fontSize,
        fontFamily: state.bibleStyle.textFontFamily,
        color: state.bibleStyle.textColor,
        backgroundColor: payload.backgroundColor || "rgba(0,0,0,.33)",
        align: payload.align || "center",
        borderRadius: Number(payload.borderRadius || 12),
        template: payload.template || "plain",
        shadowEnabled: state.bibleStyle.textShadowEnabled,
        shadowColor: state.bibleStyle.textShadowColor,
        shadowBlur: state.bibleStyle.textShadowBlur,
      },
    });
  };

  const firePresentation = (item: MeetingItem, requestedIndex = 0) => {
    const payload = item.payload as any;
    const slideCount =
      state.presentation.path === String(payload.path)
        ? state.presentation.slideCount
        : Number(payload.slideCount || payload.previewSlides?.length || 0);
    // The viewer reports its total asynchronously. Do not turn an early
    // Siguiente command into a no-op while that count is still loading.
    const maximumIndex = slideCount > 0
      ? Math.max(slideCount - 1, 0)
      : Math.max(requestedIndex, 0);
    const slideIndex = Math.max(
      0,
      Math.min(requestedIndex, maximumIndex),
    );
    const restoredBackground = releaseMeetingVideoBackground();
    setOnAirItemId(item.id);
    update({
      blackout: false,
      logo: false,
      text: { visible: false },
      lowerThird: { visible: false },
      background: restoredBackground,
      video: { playing: false, loop: true },
      presentation: {
        path: String(payload.path),
        url: String(payload.url || ""),
        name: String(payload.name || item.title),
        previewSlides: payload.previewSlides,
        slideIndex,
        slideCount,
        navigationId: state.presentation.navigationId,
        navigationDirection: 1,
        visible: true,
      },
    });
  };

  const movePresentation = (item: MeetingItem, direction: -1 | 1) => {
    const payload = item.payload as any;
    const isActive =
      state.presentation.visible &&
      state.presentation.path === String(payload.path);
    if (!isActive) {
      firePresentation(item, 0);
      return;
    }
    update({
      presentation: {
        navigationId: state.presentation.navigationId + 1,
        navigationDirection: direction,
      },
    });
  };

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if (
        !event.isTrusted ||
        !selected ||
        editing ||
        picker ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement)?.tagName,
        )
      )
        return;
      if (!["song", "bible"].includes(selected.type)) return;
      const song =
        selected.type === "song"
          ? songs.find(
              (value) => value.id === Number((selected.payload as any).songId),
            )
          : null;
      const count =
        selected.type === "song"
          ? song
            ? splitSongStanzas(song.content).length
            : 0
          : bibleSections(
              selected.payload,
              state.bibleStyle,
              selected.title,
              state.outputViewport,
            )
              .length;
      if (!count || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? Math.min(activeStanza + 1, count - 1)
          : Math.max(activeStanza - 1, 0);
      selected.type === "song"
        ? fireSongStanza(selected, next)
        : fireBibleSection(selected, next);
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [selected, editing, picker, songs, activeStanza, state.presentation]);

  /** Proyecta la ventana guardada; si ya no existe, pide elegirla de nuevo. */
  const fireCapture = async (item: MeetingItem) => {
    const payload = item.payload as Record<string, unknown>;
    const sources = await window.flProyector.listCaptureSources();
    const source =
      sources.find((value) => value.id === payload.sourceId) ??
      sources.find((value) => value.name === payload.sourceName);
    if (!source) {
      setSelected(item);
      setCapturePicker({ itemId: item.id });
      return;
    }
    const restoredBackground = releaseMeetingVideoBackground();
    setOnAirItemId(item.id);
    update({
      blackout: false,
      logo: false,
      text: { visible: false },
      lowerThird: { visible: false },
      presentation: { visible: false },
      background: restoredBackground,
      capture: {
        visible: true,
        sourceId: source.id,
        name: source.name,
        kind: source.kind,
        cursor: payload.cursor !== false,
        fit: payload.fit === "cover" ? "cover" : "contain",
        sessionId: (state.capture?.sessionId ?? 0) + 1,
      },
    });
  };

  const saveCaptureItem = async (
    choice: { source: CaptureSource; cursor: boolean; fit: "contain" | "cover" },
    itemId: number | null,
  ) => {
    if (!meetingId) return;
    const payload = {
      sourceId: choice.source.id,
      sourceName: choice.source.name,
      kind: choice.source.kind,
      cursor: choice.cursor,
      fit: choice.fit,
    };
    const existing = itemId ? items.find((entry) => entry.id === itemId) : undefined;
    const id = await window.flProyector.saveMeetingItem(
      existing
        ? { ...existing, title: choice.source.name, payload: { ...existing.payload, ...payload } }
        : {
            meetingId,
            type: "capture",
            title: choice.source.name,
            color: defaultColors.capture,
            payload,
          },
    );
    const list = await window.flProyector.listMeetingItems(meetingId);
    setItems(list);
    const saved = list.find((entry) => entry.id === (existing?.id ?? id)) ?? null;
    setSelected(saved);
    setCapturePicker(null);
    reloadMeetings();
    // Si esa ventana ya está en el aire, aplica los cambios en el momento.
    if (saved && existing && isItemOnAir(existing)) void fireCapture(saved);
  };

  const fire = async (item: MeetingItem) => {
    if (isItemOnAir(item)) {
      const restoredBackground = releaseMeetingVideoBackground();
      setOnAirItemId(null);
      update({
        text: { visible: false },
        lowerThird: { visible: false },
        presentation: { visible: false },
        capture: { visible: false },
        background: restoredBackground,
        video: { playing: false, loop: true },
      });
      return;
    }
    const payload = item.payload as any;
    const attachment = payload.meetingMedia as MediaItem | undefined;
    const background = attachment ?? mediaById(payload.backgroundId ?? payload.mediaId);
    if (item.type === "presentation") return firePresentation(item, 0);
    if (item.type === "capture") return fireCapture(item);
    if (item.type === "media" && background) {
      const activeItem = items.find((entry) => entry.id === onAirItemId);
      setOnAirItemId(item.id);
      if (background.kind === "image") {
        const restoredBackground = releaseMeetingVideoBackground();
        return update({
          blackout: false,
          logo: false,
          text: { visible: false },
          lowerThird: { visible: false },
          background: restoredBackground,
          video: { playing: false, loop: true },
          presentation: {
            path: null,
            url: background.url,
            name: background.name,
            previewSlides: [background.url],
            slideIndex: 0,
            slideCount: 1,
            navigationId: state.presentation.navigationId,
            navigationDirection: 1,
            visible: true,
          },
        });
      }
      if (activeItem?.type !== "media")
        meetingVideoReturnBackground.current = { ...state.background };
      return update({
        blackout: false,
        logo: false,
        presentation: { visible: false },
        text: { visible: false },
        lowerThird: { visible: false },
        background: {
          id: background.id,
          url: background.url,
          name: background.name,
          kind: background.kind,
        },
        video:
          background.kind === "video"
            ? {
                playing: true,
                // A meeting video is a one-time clip by default. The operator
                // can turn it into a repeating background from its contextual
                // menu without changing the global Fondos library.
                loop: payload.loop === true,
                seekTime: 0,
                currentTime: 0,
                duration: 0,
                commandId: state.video.commandId + 1,
              }
            : undefined,
      });
    }
    if (item.type === "song") return fireSongStanza(item, 0);
    if (item.type === "bible") return fireBibleSection(item, 0);
    const pages = item.type === "announcement" ? announcementPages(payload) : [];
    const pageIndex = Math.max(
      0,
      Math.min(Number(payload.announcementPage || 0), pages.length - 1),
    );
    const restoredBackground = releaseMeetingVideoBackground();
    setOnAirItemId(item.id);
    update({
      blackout: false,
      logo: false,
      presentation: { visible: false },
      lowerThird: { visible: false },
      video: backgroundVideoState(background),
      background: background
        ? {
            id: background.id,
            url: background.url,
            name: background.name,
            kind: background.kind,
          }
        : restoredBackground,
      text: {
        html:
          item.type === "announcement"
            ? pages[pageIndex]
            : String(payload.html || ""),
        kind: "anuncio",
        visible: true,
        position: payload.position || "center",
        fontSize: Number(payload.fontSize || 64),
        color: payload.color || "#ffffff",
        backgroundColor: payload.backgroundColor || "rgba(0,0,0,0)",
        align: payload.align || "center",
        borderRadius: Number(payload.borderRadius || 0),
        template: payload.template || "plain",
        animation: payload.animation || "fade",
        fontFamily: payload.fontFamily || "Inter",
        shadowEnabled: payload.shadowEnabled !== false,
        shadowColor: payload.shadowColor || "#000000",
        shadowBlur: Number(payload.shadowBlur ?? 14),
      },
    });
  };

  const previewItem = (item: MeetingItem) => {
    const payload = item.payload as Record<string, any>;
    const source = (payload.meetingMedia as MediaItem | undefined) ?? mediaById(payload.backgroundId ?? payload.mediaId);
    const next: ProjectionState = {
      ...state,
      blackout: false,
      // The preview represents the item being prepared. The projector keeps
      // its own live state (including a logo that may currently be on air).
      logo: false,
      presentation: { ...state.presentation, visible: false },
      lowerThird: { ...state.lowerThird, visible: false },
      background: source ? { ...state.background, id: source.id, url: source.url, name: source.name, kind: source.kind } : state.background,
    };
    if (item.type === "song") {
      const song = songs.find((value) => value.id === Number(payload.songId));
      const stanza = song ? splitSongStanzas(song.content)[0] || song.content : "<p>Vista previa de canción</p>";
      next.text = { ...state.text, html: stanza, kind: "canto", visible: true, sourceSongStanzas: song ? splitSongStanzas(song.content) : null, title: state.songStyle.showTitle ? song?.title || item.title : "", fontSize: state.songStyle.fontSize, fontFamily: state.songStyle.fontFamily, color: state.songStyle.textColor, backgroundColor: state.songStyle.backgroundColor, position: state.songStyle.position, align: state.songStyle.align, borderRadius: state.songStyle.borderRadius, template: state.songStyle.template, titlePosition: state.songStyle.titlePosition, titleColor: state.songStyle.titleColor, titleBackground: state.songStyle.titleBackground, titleFontSize: state.songStyle.titleFontSize, titleStyle: state.songStyle.titleStyle };
    } else if (item.type === "announcement") {
      const pages = announcementPages(payload);
      next.text = { ...state.text, html: pages[Number(payload.announcementPage || 0)] || pages[0], kind: "anuncio", visible: true, position: payload.position || "center", fontSize: Number(payload.fontSize || 64), fontFamily: payload.fontFamily || "Inter", color: payload.color || "#ffffff", backgroundColor: payload.backgroundColor || "rgba(0,0,0,.55)", align: payload.align || "center", borderRadius: Number(payload.borderRadius || 0), template: payload.template || "plain", animation: payload.animation || "fade", shadowEnabled: payload.shadowEnabled !== false, shadowColor: payload.shadowColor || "#000000", shadowBlur: Number(payload.shadowBlur ?? 14) };
    } else if (item.type === "capture") {
      next.text = { ...state.text, visible: false };
      next.capture = { visible: true, sourceId: String(payload.sourceId || ""), name: String(payload.sourceName || item.title), kind: payload.kind === "screen" ? "screen" : "window", cursor: payload.cursor !== false, fit: payload.fit === "cover" ? "cover" : "contain", sessionId: (state.capture?.sessionId ?? 0) + 1 };
    } else if (item.type === "presentation") {
      next.presentation = { path: String(payload.path || ""), url: String(payload.url || ""), name: String(payload.name || item.title), previewSlides: payload.previewSlides as string[] | undefined, slideIndex: 0, slideCount: Number(payload.slideCount || 0), navigationId: state.presentation.navigationId, navigationDirection: 1, visible: true };
      next.text = { ...state.text, visible: false };
    } else if (source?.kind === "image") {
      next.presentation = { path: null, url: source.url, name: source.name, previewSlides: [source.url], slideIndex: 0, slideCount: 1, navigationId: state.presentation.navigationId, navigationDirection: 1, visible: true };
      next.text = { ...state.text, visible: false };
    }
    setPreviewDraft(next);
    void window.flProyector.setPreviewState(next);
  };

  const reorder = async (targetId: number) => {
    if (!dragId || !meetingId || dragId === targetId) return;
    const next = [...items],
      from = next.findIndex((item) => item.id === dragId),
      to = next.findIndex((item) => item.id === targetId);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    setDragId(null);
    await window.flProyector.reorderMeetingItems(
      meetingId,
      next.map((item) => item.id),
    );
  };

  const updateSongStanza = async (
    index: number,
    replacement: string | null,
  ) => {
    if (selected?.type !== "song") return;
    const song = songs.find(
      (entry) => entry.id === Number((selected.payload as any).songId),
    );
    if (!song) return;
    const stanzas = splitSongStanzas(song.content);
    if (!stanzas[index]) return;
    const sectionTypes = normalizeSongSectionTypes(
      song.sectionTypes,
      stanzas.length,
    );
    let sectionDelta = 0;
    if (replacement === null) {
      stanzas.splice(index, 1);
      sectionTypes.splice(index, 1);
      sectionDelta = -1;
    } else {
      const replacements = splitSongStanzas(replacement);
      const nextStanzas = replacements.length ? replacements : ["<p></p>"];
      sectionDelta = nextStanzas.length - 1;
      const originalType = sectionTypes[index] || "verse";
      stanzas.splice(index, 1, ...nextStanzas);
      sectionTypes.splice(
        index,
        1,
        ...nextStanzas.map((_, offset) =>
          offset === 0 ? originalType : "verse",
        ),
      );
    }
    const content = stanzas.length ? stanzas.join("<hr>") : "<p></p>";
    await withSaveNotification(async () => {
      await window.flProyector.saveSong({ ...song, content, sectionTypes });
      const refreshed = await window.flProyector.listSongs();
      setSongs(refreshed);
      const projectedIndex = Number(state.text.sourceSectionIndex || 0);
      if (
        state.text.kind === "canto" &&
        state.text.sourceSongId === song.id &&
        projectedIndex === index
      ) {
        const safeIndex = Math.min(index, Math.max(stanzas.length - 1, 0));
        update({
          text: {
            html: stanzas[safeIndex] || "<p></p>",
            sourceSectionIndex: safeIndex,
          },
        });
        setActiveStanza(safeIndex);
      } else if (
        state.text.kind === "canto" &&
        state.text.sourceSongId === song.id &&
        index < projectedIndex &&
        sectionDelta !== 0
      ) {
        const shiftedIndex = Math.max(
          0,
          Math.min(projectedIndex + sectionDelta, stanzas.length - 1),
        );
        update({ text: { sourceSectionIndex: shiftedIndex } });
        setActiveStanza(shiftedIndex);
      } else if (activeStanza >= stanzas.length) {
        setActiveStanza(Math.max(stanzas.length - 1, 0));
      }
    }, replacement === null ? "La estrofa fue eliminada." : "La estrofa fue actualizada.");
    setEditingStanza(null);
    setPendingStanzaDelete(null);
  };

  return (
    <section
      ref={meetingPageRef}
      className="meeting-page"
      style={
        {
          "--meeting-list-width": `${meetingListWidth}px`,
          "--item-panel-width": `${itemPanelWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="meeting-list">
        <button
          className="create-meeting"
          onClick={() =>
            setNewMeeting({
              name: "",
              date: new Date().toISOString().slice(0, 10),
            })
          }
        >
          <Plus />
          Nueva reunión
        </button>
        <span className="eyebrow">Reuniones guardadas</span>
        {meetings.map((meeting) => (
          <button
            className={meetingId === meeting.id ? "active" : ""}
            style={
              { "--meeting-color": meeting.color || "#665cff" } as CSSProperties
            }
            onClick={() => {
              setMeetingId(meeting.id);
              setSelected(null);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMeetingContextMenu({
                meeting,
                x: event.clientX,
                y: event.clientY,
                palette: false,
              });
            }}
            key={meeting.id}
          >
            <CalendarDays />
            <div>
              <strong>{meeting.name}</strong>
              <span>
                {meeting.date ? `${meeting.date} · ` : ""}
                {meeting.itemCount} {meeting.itemCount === 1 ? "elemento" : "elementos"}
              </span>
            </div>
          </button>
        ))}
        {!meetings.length && (
          <EmptyState
            compact
            icon={<CalendarDays />}
            title="No hay reuniones guardadas"
          />
        )}
      </aside>

      <ColumnResizer
        label="Cambiar ancho de reuniones guardadas"
        onResize={(delta) =>
          setMeetingListWidth((current) =>
            clampColumnWidth(current + delta, 180, meetingListMaximum),
          )
        }
      />

      <div className="rundown">
        <div className="section-title">
          <div>
            <span className="eyebrow">Orden del culto</span>
            <h2>
              {meetings.find((meeting) => meeting.id === meetingId)?.name ||
                "Reuniones"}
            </h2>
          </div>
        </div>
        {meetingId && (
          <div className="add-item-row">
            {(Object.keys(itemLabels) as MeetingItemType[]).map((type) => {
              const Icon = itemIcons[type];
              return (
                <button
                  disabled={type === "media" && addingMedia}
                  onClick={() => addItem(type)}
                  key={type}
                >
                  <Icon />
                  {type === "media" && addingMedia
                    ? "Procesando…"
                    : type === "media"
                      ? "Archivos"
                      : itemLabels[type]}
                </button>
              );
            })}
          </div>
        )}
        {!meetingId ? (
          <EmptyState
            icon={<CalendarDays />}
            title="No hay reunión seleccionada"
            detail="Creá una reunión para comenzar a preparar el orden del culto."
            action={(
              <button
                className="primary win11-empty-action"
                onClick={() =>
                  setNewMeeting({
                    name: "",
                    date: new Date().toISOString().slice(0, 10),
                  })
                }
              >
                <Plus />
                Nueva reunión
              </button>
            )}
          />
        ) : (
        <div className="rundown-list">
          {items.map((item, index) => {
            const Icon = itemIcons[item.type];
            const itemOnAir = isItemOnAir(item);
            return (
              <article
                style={
                  { "--item-color": item.color || "#665cff" } as CSSProperties
                }
                draggable
                onDragStart={() => setDragId(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorder(item.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({
                    item,
                    x: event.clientX,
                    y: event.clientY,
                    palette: false,
                  });
                }}
                className={[
                  selected?.id === item.id ? "selected" : "",
                  itemOnAir ? "on-air-item" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setSelected(item);
                  void fire(item);
                }}
                key={item.id}
              >
                <GripVertical className="grip" />
                <i style={{ background: item.color }} />
                <b>{index + 1}</b>
                <Icon />
                <div>
                  <strong>{displayItemTitle(item)}</strong>
                  <span>{itemLabels[item.type]}</span>
                </div>
              </article>
            );
          })}
          {!items.length && (
            <EmptyState
              icon={<ListPlus />}
              title="El orden está vacío"
              detail="Usá los botones superiores para agregar el primer elemento."
            />
          )}
        </div>
        )}
      </div>

      <ColumnResizer
        label="Cambiar ancho del contenido del elemento"
        onResize={(delta) =>
          setItemPanelWidth((current) =>
            clampColumnWidth(current - delta, 220, itemPanelMaximum),
          )
        }
      />

      <aside className="item-inspector">
        {selected ? (
          <ItemSummary
            item={selected}
            songs={songs}
            media={media}
            projection={state}
            activeStanza={activeStanza}
            isOnAir={isItemOnAir(selected)}
            stanzaCardScale={stanzaCardScale}
            onStanzaCardScaleChange={setStanzaCardScale}
            onStanza={(index) =>
              selected.type === "bible"
                ? fireBibleSection(selected, index)
                : fireSongStanza(selected, index)
            }
            onStanzaContextMenu={(index, x, y) =>
              setStanzaContextMenu({ index, x, y })
            }
            onEdit={() =>
              selected.type === "capture"
                ? setCapturePicker({ itemId: selected.id })
                : setEditing(true)
            }
            loopable={isLoopableMeetingItem(selected)}
            onToggleLoop={() =>
              void setMeetingItemLoop(selected, (selected.payload as Record<string, unknown>).loop !== true)
            }
          />
        ) : (
          <div className="inspector-empty">
            <Megaphone />
            <strong>Seleccioná un elemento</strong>
            <span>Aquí verás su texto o contenido.</span>
          </div>
        )}
      </aside>

      {newMeeting && (
        <div className="modal-backdrop">
          <form
            className="meeting-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              createMeeting();
            }}
          >
            <button
              type="button"
              className="fl-close dialog-close"
              aria-label="Cerrar"
              onClick={() => setNewMeeting(null)}
            >
              <X />
            </button>
            <span className="eyebrow">Nueva reunión</span>
            <h2>Crear una reunión</h2>
            <p>
              Primero guardá el nombre. Después podrás armar el orden del culto.
            </p>
            <label>
              Nombre de la reunión
              <input
                autoFocus
                value={newMeeting.name}
                onChange={(event) =>
                  setNewMeeting({ ...newMeeting, name: event.target.value })
                }
                placeholder="Ej. Culto domingo por la mañana"
              />
            </label>
            <label>
              Fecha
              <input
                type="date"
                value={newMeeting.date}
                onChange={(event) =>
                  setNewMeeting({ ...newMeeting, date: event.target.value })
                }
              />
            </label>
            <div>
              <button type="button" onClick={() => setNewMeeting(null)}>
                Cancelar
              </button>
              <button className="primary" disabled={!newMeeting.name.trim()}>
                Guardar reunión
              </button>
            </div>
          </form>
        </div>
      )}

      {contextMenu && (
        <Win11ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          ariaLabel="Acciones del elemento"
          items={!contextMenu.palette ? [
            {
              label:
                contextMenu.item.type === "announcement"
                  ? "Sobrescribir anuncio"
                  : "Editar elemento",
              icon: <Edit3 />,
              onClick: () => {
                setSelected(contextMenu.item);
                if (contextMenu.item.type === "capture")
                  setCapturePicker({ itemId: contextMenu.item.id });
                else setEditing(true);
              },
            },
            ...(!["media", "presentation", "capture"].includes(contextMenu.item.type) ? [{
              label: "Asignar fondo",
              icon: <Image />,
              onClick: () => setBackgroundTarget(contextMenu.item),
            }] : []),
            ...(isLoopableMeetingItem(contextMenu.item) ? [{
              label:
                (contextMenu.item.payload as Record<string, unknown>).loop === true
                  ? "Quitar reproducción en bucle"
                  : "Reproducir en bucle",
              icon: <Repeat2 />,
              onClick: () =>
                void setMeetingItemLoop(
                  contextMenu.item,
                  (contextMenu.item.payload as Record<string, unknown>).loop !== true,
                ),
            }] : []),
            {
              label: "Cambiar color",
              icon: <Palette />,
              keepOpen: true,
              onClick: () => setContextMenu({ ...contextMenu, palette: true }),
            },
            {
              label: "Quitar de la lista",
              icon: <Trash2 />,
              danger: true,
              onClick: () => setPendingDelete(contextMenu.item),
            },
          ] : [{
            label: "Volver",
            icon: <Edit3 />,
            keepOpen: true,
            onClick: () => setContextMenu({ ...contextMenu, palette: false }),
          }]}
        >
          {contextMenu.palette && (
            <div className="win11-context-palette-panel">
              <strong>Elegí un color</strong>
              <div className="context-palette">
                {itemColors.map((color) => (
                  <button
                    type="button"
                    aria-label={`Usar color ${color}`}
                    style={{ background: color }}
                    onClick={() => changeColor(contextMenu.item, color)}
                    key={color}
                  />
                ))}
              </div>
            </div>
          )}
        </Win11ContextMenu>
      )}

      {meetingContextMenu && (
        <Win11ContextMenu
          x={meetingContextMenu.x}
          y={meetingContextMenu.y}
          onClose={() => setMeetingContextMenu(null)}
          ariaLabel={`Acciones de ${meetingContextMenu.meeting.name}`}
          items={!meetingContextMenu.palette ? [
            {
              label: "Renombrar reunión",
              icon: <Edit3 />,
              onClick: () => setRenamingMeeting({ ...meetingContextMenu.meeting }),
            },
            {
              label: "Cambiar color",
              icon: <Palette />,
              keepOpen: true,
              onClick: () => setMeetingContextMenu({ ...meetingContextMenu, palette: true }),
            },
            {
              label: "Eliminar reunión",
              icon: <Trash2 />,
              danger: true,
              onClick: () => setPendingMeetingDelete(meetingContextMenu.meeting),
            },
          ] : [{
            label: "Volver",
            icon: <Edit3 />,
            keepOpen: true,
            onClick: () => setMeetingContextMenu({ ...meetingContextMenu, palette: false }),
          }]}
        >
          {meetingContextMenu.palette && (
            <div className="win11-context-palette-panel">
              <strong>Elegí un color</strong>
              <div className="context-palette">
                {itemColors.map((color) => (
                  <button
                    type="button"
                    aria-label={`Usar color ${color}`}
                    style={{ background: color }}
                    onClick={() => changeMeetingColor(meetingContextMenu.meeting, color)}
                    key={color}
                  />
                ))}
              </div>
            </div>
          )}
        </Win11ContextMenu>
      )}

      {stanzaContextMenu && selected?.type === "song" && (() => {
        const song = songs.find(
          (entry) => entry.id === Number((selected.payload as any).songId),
        );
        const stanzas = song ? splitSongStanzas(song.content) : [];
        const types = song
          ? normalizeSongSectionTypes(song.sectionTypes, stanzas.length)
          : [];
        return (
          <Win11ContextMenu
            x={stanzaContextMenu.x}
            y={stanzaContextMenu.y}
            onClose={() => setStanzaContextMenu(null)}
            ariaLabel="Acciones de la estrofa"
            items={[
              {
                label: "Editar esta estrofa",
                icon: <Edit3 />,
                onClick: () =>
                  setEditingStanza({
                    index: stanzaContextMenu.index,
                    label: songSectionLabel(types, stanzaContextMenu.index),
                    html: stanzas[stanzaContextMenu.index] || "<p></p>",
                  }),
              },
              {
                label: "Eliminar esta estrofa",
                icon: <Trash2 />,
                danger: true,
                onClick: () => setPendingStanzaDelete(stanzaContextMenu.index),
              },
            ]}
          />
        );
      })()}

      {renamingMeeting && (
        <div className="modal-backdrop">
          <form
            className="meeting-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              renameMeeting();
            }}
          >
            <button
              type="button"
              className="fl-close dialog-close"
              aria-label="Cerrar"
              onClick={() => setRenamingMeeting(null)}
            >
              <X />
            </button>
            <span className="eyebrow">Renombrar reunión</span>
            <h2>Editar nombre</h2>
            <p>Este cambio se verá en la lista de reuniones guardadas.</p>
            <label>
              Nombre de la reunión
              <input
                autoFocus
                value={renamingMeeting.name}
                onChange={(event) =>
                  setRenamingMeeting({
                    ...renamingMeeting,
                    name: event.target.value,
                  })
                }
              />
            </label>
            <div>
              <button type="button" onClick={() => setRenamingMeeting(null)}>
                Cancelar
              </button>
              <button
                className="primary"
                disabled={!renamingMeeting.name.trim()}
              >
                Guardar nombre
              </button>
            </div>
          </form>
        </div>
      )}

      {capturePicker && (
        <CaptureSourcePicker
          initial={
            capturePicker.itemId
              ? (items.find((entry) => entry.id === capturePicker.itemId)?.payload as Record<string, unknown> | undefined)
              : undefined
          }
          onCancel={() => setCapturePicker(null)}
          onChoose={(choice) => void saveCaptureItem(choice, capturePicker.itemId)}
        />
      )}
      {editing && selected && (
        <div className="modal-backdrop">
          <div
            className={`item-edit-dialog ${["announcement", "bible"].includes(selected.type) ? "visual-dialog" : ""} ${selected.type === "announcement" ? "announcement-visual-dialog" : ""} ${selected.type === "song" ? "song-edit-dialog" : ""}`}
          >
            <button type="button" className="fl-close dialog-close" aria-label="Cerrar" onClick={closeEditor}>
              <X />
            </button>
            <ItemEditor
              item={selected}
              songs={songs}
              media={media}
              projectionState={state}
              previewAspectRatio={previewAspectRatio}
              songDraft={songDraft}
              setSongDraft={setSongDraft}
              setItem={setSelected}
              setPayload={setPayload}
              onSave={saveEditor}
              onDelete={() => setPendingDelete(selected)}
              onPreview={() => previewItem(selected)}
              onAnnouncementPage={(html, payload) => {
                if (onAirItemId !== selected.id) return;
                update({
                  text: {
                    html,
                    visible: true,
                    kind: "anuncio",
                    position: (payload.position as ProjectionState["text"]["position"]) || "center",
                    fontSize: Number(payload.fontSize || 64),
                    color: String(payload.color || "#ffffff"),
                    backgroundColor: String(
                      payload.backgroundColor || "rgba(0,0,0,0)",
                    ),
                    align: (payload.align as ProjectionState["text"]["align"]) || "center",
                    borderRadius: Number(payload.borderRadius || 0),
                    template: (payload.template as ProjectionState["text"]["template"]) || "plain",
                    // Antes no se enviaban: al corregir un anuncio en el aire
                    // se perdían la tipografía, la animación y la sombra.
                    fontFamily: String(payload.fontFamily || "Inter"),
                    animation: (payload.animation as ProjectionState["text"]["animation"]) || "fade",
                    shadowEnabled: payload.shadowEnabled !== false,
                    shadowColor: String(payload.shadowColor || "#000000"),
                    shadowBlur: Number(payload.shadowBlur ?? 14),
                  },
                });
              }}
              onCancel={closeEditor}
              isDraft={selected.id === draftItemId}
            />
          </div>
        </div>
      )}

      {editingStanza && (
        <MeetingStanzaEditDialog
          label={editingStanza.label}
          html={editingStanza.html}
          onCancel={() => setEditingStanza(null)}
          onSave={(html) => updateSongStanza(editingStanza.index, html)}
        />
      )}

      {pendingStanzaDelete !== null && (
        <ConfirmDeleteDialog
          title="¿Eliminar esta estrofa?"
          detail="Se quitará solamente esta parte de la canción. El resto de la letra se conservará."
          onCancel={() => setPendingStanzaDelete(null)}
          onConfirm={() => updateSongStanza(pendingStanzaDelete, null)}
        />
      )}

      {backgroundTarget && (
        <div className="modal-backdrop">
          <div className="background-assignment-dialog">
            <button
              type="button"
              className="fl-close dialog-close"
              aria-label="Cerrar"
              onClick={() => setBackgroundTarget(null)}
            >
              <X />
            </button>
            <span className="eyebrow">Fondo del elemento</span>
            <h2>{backgroundTarget.title}</h2>
            <p>
              Elegí un fondo exclusivo para este ítem, o dejalo sin asignar para
              usar siempre el fondo seleccionado en el menú Fondos.
            </p>
            <BackgroundChoice
              media={media}
              backgroundId={(backgroundTarget.payload as any).backgroundId}
              onChange={(backgroundId) =>
                assignBackground(backgroundTarget, backgroundId)
              }
            />
            <button
              className="background-assignment-cancel"
              onClick={() => setBackgroundTarget(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {previewDraft && (
        <div className="modal-backdrop preview-only-backdrop" onMouseDown={() => { setPreviewDraft(null); void window.flProyector.clearPreviewState(); }}>
          <div className="preview-only-dialog" role="dialog" aria-modal="true" aria-label="Vista previa sin proyectar" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <span className="eyebrow">Vista previa</span>
              <button type="button" className="fl-close dialog-close" aria-label="Cerrar" onClick={() => { setPreviewDraft(null); void window.flProyector.clearPreviewState(); }}><X /></button>
            </header>
            <p>Así se vería en la pantalla. Todavía no se envió al proyector.</p>
            <div className="preview-only-frame" style={{ aspectRatio: previewAspectRatio }}><ProjectionPreview state={previewDraft} /></div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDeleteDialog
          title={`¿Quitar “${pendingDelete.title}”?`}
          detail="El elemento se quitará del orden de esta reunión. El archivo o contenido original permanecerá en su biblioteca."
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmRemoveItem}
        />
      )}

      {pendingMeetingDelete && (
        <ConfirmDeleteDialog
          title={`¿Eliminar “${pendingMeetingDelete.name}”?`}
          detail="Se eliminará la reunión y todo su orden de culto. Esta acción no se puede deshacer."
          onCancel={() => setPendingMeetingDelete(null)}
          onConfirm={confirmRemoveMeeting}
        />
      )}

      {(picker === "song" || picker === "media") && (
        <LibraryPicker
          type={picker}
          songs={songs}
          media={media}
          search={pickerSearch}
          setSearch={setPickerSearch}
          onChoose={addLibraryItem}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "bible" && (
        <BiblePicker
          settings={state.bibleStyle}
          onChoose={addBibleItem}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}

function MeetingStanzaEditDialog({
  label,
  html,
  onCancel,
  onSave,
}: {
  label: string;
  html: string;
  onCancel: () => void;
  onSave: (html: string) => void | Promise<void>;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
    ],
    content: html,
  });

  return (
    <div className="modal-backdrop">
      <section
        className="song-create-dialog stanza-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-stanza-edit-title"
      >
        <button
          type="button"
          className="fl-close dialog-close"
          aria-label="Cerrar"
          onClick={onCancel}
        >
          <X />
        </button>
        <span className="eyebrow">Editar solo esta parte</span>
        <h2 id="meeting-stanza-edit-title">{label}</h2>
        <p>
          Enter crea una nueva estrofa al guardar. Shift + Enter agrega una
          línea dentro de la misma estrofa.
        </p>
        <RichTextToolbar editor={editor} />
        <EditorContent
          editor={editor}
          className="rich-editor stanza-edit-content"
        />
        <div className="song-create-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void onSave(editor?.getHTML() ?? html)}
          >
            Guardar estrofa
          </button>
        </div>
      </section>
    </div>
  );
}

function ItemSummary({
  item,
  songs,
  media,
  projection,
  activeStanza,
  isOnAir,
  stanzaCardScale,
  onStanzaCardScaleChange,
  onStanza,
  onStanzaContextMenu,
  onEdit,
  loopable = false,
  onToggleLoop,
}: {
  item: MeetingItem;
  songs: Song[];
  media: MediaItem[];
  projection: ProjectionState;
  activeStanza: number;
  isOnAir: boolean;
  stanzaCardScale: number;
  onStanzaCardScaleChange: (value: number) => void;
  onStanza: (index: number) => void;
  onStanzaContextMenu: (index: number, x: number, y: number) => void;
  onEdit: () => void;
  loopable?: boolean;
  onToggleLoop?: () => void;
}) {
  const payload = item.payload as any;
  const song = songs.find((value) => value.id === Number(payload.songId));
  // La estrofa activa siempre queda a la vista al avanzar con el teclado.
  const rowsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowsRef.current?.querySelector<HTMLElement>(".stanza-row.is-active");
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeStanza, item.id]);
  // Los videos e imágenes agregados solo a la reunión viajan dentro del
  // elemento (meetingMedia); antes el panel no los mostraba.
  const medium =
    (payload.meetingMedia?.url ? (payload.meetingMedia as MediaItem) : undefined) ??
    media.find((value) => value.id === Number(payload.mediaId ?? payload.backgroundId));
  const html =
    item.type === "song" ? song?.content : String(payload.html || "");
  const stanzas = song ? splitSongStanzas(song.content) : [];
  const sectionTypes = song
    ? normalizeSongSectionTypes(song.sectionTypes, stanzas.length)
    : [];
  const scriptureSections =
    item.type === "bible"
      ? bibleSections(
          payload,
          projection.bibleStyle,
          item.title,
          projection.outputViewport,
        )
      : [];
  return (
    <div className="item-summary">
      <div className="summary-heading">
        <span style={{ background: item.color }} />
        <div>
          <small>{itemLabels[item.type]}</small>
          <h3 title={displayItemTitle(item)}>{displayItemTitle(item)}</h3>
        </div>
      </div>
      {song ? (
        <>
          <div className="stanza-toolbar">
            <span>
              {activeStanza + 1} de {stanzas.length || 1}
            </span>
            <small>↑ ↓ para cambiar</small>
            <div className="stanza-density-controls" aria-label="Tamaño de las estrofas en la lista">
              <button
                type="button"
                title="Achicar estrofas en la lista"
                aria-label="Achicar estrofas en la lista"
                disabled={stanzaCardScale <= 0.38}
                onClick={() =>
                  onStanzaCardScaleChange(
                    Math.max(0.38, Number((stanzaCardScale - 0.14).toFixed(2))),
                  )
                }
              >
                <Minus />
              </button>
              <button
                type="button"
                title="Agrandar estrofas en la lista"
                aria-label="Agrandar estrofas en la lista"
                disabled={stanzaCardScale >= 1.42}
                onClick={() =>
                  onStanzaCardScaleChange(
                    Math.min(1.42, Number((stanzaCardScale + 0.14).toFixed(2))),
                  )
                }
              >
                <Plus />
              </button>
            </div>
            <button
              disabled={activeStanza === 0}
              onClick={() => onStanza(activeStanza - 1)}
            >
              <ChevronUp />
            </button>
            <button
              disabled={activeStanza >= stanzas.length - 1}
              onClick={() => onStanza(activeStanza + 1)}
            >
              <ChevronDown />
            </button>
          </div>
          <div
            ref={rowsRef}
            className="stanza-rows"
            style={{ "--stanza-card-scale": stanzaCardScale } as CSSProperties}
          >
            {(stanzas.length ? stanzas : [song.content]).map((stanza, index) => (
              <StanzaRow
                key={index}
                index={index}
                label={songSectionLabel(sectionTypes, index)}
                sectionType={sectionTypes[index] || "verse"}
                html={stanza}
                active={activeStanza === index}
                live={isOnAir && activeStanza === index}
                next={isOnAir && activeStanza + 1 === index}
                onClick={() => onStanza(index)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onStanzaContextMenu(index, event.clientX, event.clientY);
                }}
              />
            ))}
          </div>
        </>
      ) : item.type === "bible" && scriptureSections.length ? (
        <>
          <div className="stanza-toolbar">
            <span>
              {activeStanza + 1} de {scriptureSections.length}
            </span>
            <small>↑ ↓ para cambiar</small>
            <button
              disabled={activeStanza === 0}
              onClick={() => onStanza(activeStanza - 1)}
            >
              <ChevronUp />
            </button>
            <button
              disabled={activeStanza >= scriptureSections.length - 1}
              onClick={() => onStanza(activeStanza + 1)}
            >
              <ChevronDown />
            </button>
          </div>
          <div ref={rowsRef} className="stanza-rows bible-section-list">
            {scriptureSections.map((section, index) => (
              <StanzaRow
                key={index}
                index={index}
                label={section.label}
                sectionType="scripture"
                html={section.html}
                active={activeStanza === index}
                live={isOnAir && activeStanza === index}
                next={isOnAir && activeStanza + 1 === index}
                onClick={() => onStanza(index)}
              />
            ))}
          </div>
        </>
      ) : html ? (
        <div
          className="summary-copy"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : medium ? (
        <div className="summary-media">
          {medium.kind === "image" ? (
            <img src={medium.url} />
          ) : (
            <video src={medium.url} muted />
          )}
          <strong>{medium.name}</strong>
        </div>
      ) : item.type === "presentation" ? (
        <PresentationSummary item={item} projection={projection} />
      ) : item.type === "capture" ? (
        <div className="summary-capture">
          <AppWindow aria-hidden="true" />
          <strong>{String(payload.sourceName || item.title)}</strong>
          <span>
            {payload.kind === "screen" ? "Pantalla completa" : "Ventana"} ·{" "}
            {payload.cursor === false ? "sin puntero" : "con puntero"} ·{" "}
            {payload.fit === "cover" ? "llenar pantalla" : "ajustar"}
          </span>
          <small>El sonido sale del programa original, como siempre.</small>
        </div>
      ) : (
        <p className="summary-empty">
          Este elemento todavía no tiene contenido.
        </p>
      )}
      {loopable && (
        <label className="summary-loop">
          <Repeat2 aria-hidden="true" />
          <span>
            <b>Reproducir en bucle</b>
            <small>{payload.loop === true ? "Se repite hasta que lo quites del aire." : "Se reproduce una vez y vuelve el fondo."}</small>
          </span>
          <input type="checkbox" role="switch" checked={payload.loop === true} onChange={() => onToggleLoop?.()} aria-label="Reproducir en bucle" />
          <i aria-hidden="true" />
        </label>
      )}
      <button className="summary-edit" onClick={onEdit}>
        <Edit3 />
        Editar elemento
      </button>
    </div>
  );
}

function PresentationSummary({
  item,
  projection,
}: {
  item: MeetingItem;
  projection: ProjectionState;
}) {
  const payload = item.payload as any;
  const active =
    projection.presentation.visible &&
    projection.presentation.path === String(payload.path);
  const count = active
    ? projection.presentation.slideCount
    : Number(payload.slideCount || payload.previewSlides?.length || 0);
  const index = active ? projection.presentation.slideIndex : 0;
  return (
    <div className="presentation-summary">
      <div className="summary-file">
        <Presentation />
        <div>
          <strong>{String(payload.name || item.title)}</strong>
          <span>{String(payload.path || "")}</span>
        </div>
      </div>
      <div className="presentation-status">
        <i className={active ? "live" : ""} />
        <div>
          <strong>
            {active ? "Presentación al aire" : "Lista para presentar"}
          </strong>
          <span>
            {count
              ? `Diapositiva ${index + 1} de ${count}`
              : "El total aparecerá al abrirla"}
          </span>
        </div>
      </div>
      <small>
        La presentación se reproduce dentro de FL Proyector, respetando el orden
        de sus animaciones y transiciones compatibles.
      </small>
    </div>
  );
}

function LibraryPicker({
  type,
  songs,
  media,
  search,
  setSearch,
  onChoose,
  onClose,
}: {
  type: "song" | "media";
  songs: Song[];
  media: MediaItem[];
  search: string;
  setSearch: (value: string) => void;
  onChoose: (entry: Song | MediaItem) => void;
  onClose: () => void;
}) {
  const normalized = search.toLowerCase();
  const filteredSongs = songs.filter((song) =>
    `${song.title} ${song.categoryName || ""} ${song.content.replace(/<[^>]+>/g, " ")}`
      .toLowerCase()
      .includes(normalized),
  );
  const filteredMedia = media.filter((item) =>
    `${item.name} ${item.tags.join(" ")}`.toLowerCase().includes(normalized),
  );
  const isEmpty =
    type === "song" ? !filteredSongs.length : !filteredMedia.length;
  return (
    <div className="modal-backdrop">
      <div className="library-picker">
        <button type="button" className="fl-close dialog-close" aria-label="Cerrar" onClick={onClose}>
          <X />
        </button>
        <span className="eyebrow">Agregar a la reunión</span>
        <h2>
          {type === "song"
            ? "Seleccionar canción"
            : "Seleccionar imagen o video"}
        </h2>
        <div className="picker-search">
          <Search />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              type === "song"
                ? "Buscar por nombre, categoría o letra"
                : "Buscar archivo o etiqueta"
            }
          />
        </div>
        <div
          className={`picker-results ${type === "media" ? "media-results" : ""}`}
        >
          {type === "song"
            ? filteredSongs.map((song) => (
                <button key={song.id} onClick={() => onChoose(song)}>
                  <Music2 />
                  <div>
                    <strong>{song.title}</strong>
                    <span>{song.categoryName || "Sin categoría"}</span>
                    <p>{song.content.replace(/<[^>]+>/g, " ").slice(0, 110)}</p>
                  </div>
                </button>
              ))
            : filteredMedia.map((item) => (
                <button key={item.id} onClick={() => onChoose(item)}>
                  {item.kind === "image" ? (
                    <img src={item.url} />
                  ) : (
                    <video src={item.url} muted />
                  )}
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.kind === "image" ? "Imagen" : "Video"}</span>
                  </div>
                </button>
              ))}
        </div>
        {isEmpty && (
          <div className="picker-empty">No se encontraron elementos.</div>
        )}
      </div>
    </div>
  );
}

function BiblePicker({
  settings,
  onChoose,
  onClose,
}: {
  settings: BibleDisplaySettings;
  onChoose: (selection: {
    title: string;
    html: string;
    version: string;
    bibleEntries: Array<{ text: string; reference: string; version: string }>;
  }) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<BibleVersion[]>([]);
  const [versionId, setVersionId] = useState(0);
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [book, setBook] = useState("");
  const [chapter, setChapter] = useState(1);
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [preloadedPassage, setPreloadedPassage] = useState(false);
  useEffect(() => {
    window.flProyector.listBibleVersions().then((list) => {
      setVersions(list);
      if (list[0]) setVersionId(list[0].id);
    });
  }, []);
  useEffect(() => {
    if (versionId)
      window.flProyector.listBibleBooks(versionId).then((list) => {
        setBooks(list);
        if (!preloadedPassage && list.some((item) => item.book === "Juan")) {
          setBook("Juan");
          setChapter(3);
          setPreloadedPassage(true);
        } else {
          setBook((current) =>
            list.some((item) => item.book === current)
              ? current
              : list[0]?.book || "",
          );
        }
      });
  }, [versionId]);
  useEffect(() => {
    if (versionId && book)
      window.flProyector
        .listBibleVerses(versionId, book, chapter)
        .then((list) => {
          setVerses(list);
          setSelected(
            book === "Juan" && chapter === 3 && list.some((v) => v.verse === 16)
              ? [16]
              : [],
          );
        });
  }, [versionId, book, chapter]);
  const maxChapters = books.find((item) => item.book === book)?.chapters || 1;
  const confirmSelection = () => {
    const chosen = verses.filter((verse) => selected.includes(verse.verse));
    if (!chosen.length) return;
    const range =
      chosen.length === 1
        ? `${chosen[0].verse}`
        : `${chosen[0].verse}-${chosen.at(-1)?.verse}`;
    const title = `${book} ${chapter}:${range}`,
      version = versions.find((item) => item.id === versionId)?.code || "";
    const bibleEntries = chosen.map((verse) => ({
      text: verse.text,
      reference: `${book} ${chapter}:${verse.verse}`,
      version,
    }));
    onChoose({
      title,
      version,
      bibleEntries,
      html: buildBibleSlides(
        chosen.map((verse) => verse.text).join(" "),
        title,
        version,
        settings,
      )[0].html,
    });
  };
  return (
    <div className="modal-backdrop">
      <div className="bible-picker">
        <button type="button" className="fl-close dialog-close" aria-label="Cerrar" onClick={onClose}>
          <X />
        </button>
        <span className="eyebrow">Agregar cita a la reunión</span>
        <h2>Seleccionar pasaje bíblico</h2>
        <div className="bible-picker-controls">
          <label>
            Versión
            <select
              value={versionId}
              onChange={(event) => setVersionId(Number(event.target.value))}
            >
              {versions.map((version) => (
                <option value={version.id} key={version.id}>
                  {version.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Libro
            <select
              value={book}
              onChange={(event) => {
                setBook(event.target.value);
                setChapter(1);
              }}
            >
              {books.map((item) => (
                <option value={item.book} key={item.book}>
                  {item.book}
                </option>
              ))}
            </select>
          </label>
          <label>
            Capítulo
            <select
              value={chapter}
              onChange={(event) => setChapter(Number(event.target.value))}
            >
              {Array.from({ length: maxChapters }, (_, index) => (
                <option value={index + 1} key={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="bible-picker-verses">
          {verses.map((verse) => (
            <button
              className={selected.includes(verse.verse) ? "active" : ""}
              onClick={() =>
                setSelected((value) =>
                  value.includes(verse.verse)
                    ? value.filter((number) => number !== verse.verse)
                    : [...value, verse.verse].sort((a, b) => a - b),
                )
              }
              key={verse.verse}
            >
              <b>{verse.verse}</b>
              <span>{verse.text}</span>
            </button>
          ))}
        </div>
        <div className="bible-picker-footer">
          <span>
            {selected.length
              ? `${selected.length} versículo(s) seleccionado(s)`
              : "Elegí uno o varios versículos"}
          </span>
          <button
            className="primary"
            disabled={!selected.length}
            onClick={confirmSelection}
          >
            Agregar pasaje
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  songs,
  media,
  projectionState,
  previewAspectRatio,
  songDraft,
  setSongDraft,
  setItem,
  setPayload,
  onSave,
  onDelete,
  onPreview,
  onAnnouncementPage,
  onCancel,
  isDraft,
}: {
  item: MeetingItem;
  songs: Song[];
  media: MediaItem[];
  projectionState: ProjectionState;
  previewAspectRatio: string;
  songDraft: {
    title: string;
    content: string;
    shadowEnabled: boolean;
    shadowColor: string;
    shadowBlur: number;
  } | null;
  setSongDraft: (
    draft: {
      title: string;
      content: string;
      shadowEnabled: boolean;
      shadowColor: string;
      shadowBlur: number;
    } | null,
  ) => void;
  setItem: (item: MeetingItem) => void;
  setPayload: (patch: Record<string, unknown>) => void;
  onSave: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onAnnouncementPage: (html: string, payload: Record<string, unknown>) => void;
  onCancel: () => void;
  isDraft: boolean;
}) {
  const p = item.payload as any;
  const visual = ["announcement", "bible"].includes(item.type);
  const ItemIcon = itemIcons[item.type];
  return (
    <div className={`item-editor ${visual ? "visual-item-editor pro-editor" : ""}`}>
      <div className="item-editor-controls">
        {visual ? (
          <header className="pro-editor-header">
            <span className="pro-editor-kicker">
              <ItemIcon aria-hidden="true" />
              {itemLabels[item.type]} · orden del culto
            </span>
            <input
              className="pro-editor-title"
              aria-label={`Nombre del ${itemLabels[item.type].toLowerCase()} en la reunión`}
              placeholder={`Nombre del ${itemLabels[item.type].toLowerCase()}`}
              value={item.title}
              onChange={(event) =>
                setItem({
                  ...item,
                  title: event.target.value,
                  payload:
                    item.type === "announcement"
                      ? { ...item.payload, announcementTitleMode: "manual" }
                      : item.payload,
                })
              }
            />
            <small>Así aparece en el orden del culto.</small>
          </header>
        ) : (
          <>
            <div className="item-editor-heading">
              <span className="eyebrow">
                Editar {itemLabels[item.type].toLowerCase()}
              </span>
            </div>
            {item.type !== "song" && (
              <label>
                Nombre del ítem
                <input
                  value={item.title}
                  onChange={(event) => setItem({ ...item, title: event.target.value })}
                />
              </label>
            )}
          </>
        )}
        {item.type === "song" && songDraft && (
          <RichSongEditor draft={songDraft} onChange={setSongDraft} />
        )}
        {item.type === "media" && (
          <label>
            Imagen o video
            <select
              value={p.mediaId || ""}
              onChange={(event) =>
                setPayload({ mediaId: Number(event.target.value) })
              }
            >
              {media.map((value) => (
                <option value={value.id} key={value.id}>
                  {value.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {item.type === "announcement" && (
          <section className="pro-section pro-content-section">
            <AnnouncementPagesEditor
              payload={p}
              setPayload={setPayload}
              onPreview={onAnnouncementPage}
            />
          </section>
        )}
        {item.type === "bible" && (
          <div className="bible-readonly">
            <BookOpenText />
            <div>
              <b>{item.title}</b>
              <div dangerouslySetInnerHTML={{ __html: String(p.html || "") }} />
            </div>
          </div>
        )}
        {["announcement", "bible"].includes(item.type) && (
          <DesignControls
            payload={p}
            setPayload={setPayload}
            showSize={item.type !== "announcement"}
          />
        )}
        {item.type === "presentation" && (
          <>
            <div className="file-path">{String(p.path || "")}</div>
          </>
        )}
        {!visual && (
          <div className="inspector-actions">
            {!isDraft && (
              <button className="danger" onClick={onDelete}>
                <Trash2 />
                Eliminar
              </button>
            )}
            <button className="secondary" onClick={onCancel}>
              Cancelar
            </button>
            <button className="primary" onClick={onSave}>
              <Save />
              Guardar
            </button>
          </div>
        )}
      </div>
      {visual && (
        <AnnouncementPreview
          item={item}
          media={media}
          state={projectionState}
          previewAspectRatio={previewAspectRatio}
          onOpenPreview={onPreview}
        />
      )}
      {visual && (
        <footer className="pro-editor-footer">
          {!isDraft && (
            <button type="button" className="pro-button danger" onClick={onDelete}>
              <Trash2 aria-hidden="true" />
              Eliminar
            </button>
          )}
          <span className="pro-editor-footer-note">
            {isDraft ? "Se agrega a la reunión al guardar." : "Los cambios se aplican al guardar."}
          </span>
          <button type="button" className="pro-button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="pro-button accent" onClick={onSave}>
            <Save aria-hidden="true" />
            {isDraft ? "Agregar a la reunión" : "Guardar cambios"}
          </button>
        </footer>
      )}
    </div>
  );
}

const panelColors = [
  "#000000",
  "#111827",
  "#172554",
  "#312e81",
  "#4c1d95",
  "#701a75",
  "#7f1d1d",
  "#713f12",
  "#14532d",
  "#164e63",
];
function AnnouncementPagesEditor({
  payload,
  setPayload,
  onPreview,
}: {
  payload: Record<string, unknown>;
  setPayload: (patch: Record<string, unknown>) => void;
  onPreview: (html: string, payload: Record<string, unknown>) => void;
}) {
  const pages = announcementPages(payload);
  const current = Math.max(
    0,
    Math.min(Number(payload.announcementPage || 0), pages.length - 1),
  );
  const changePage = (index: number) => {
    const next = { ...payload, announcementPage: index };
    setPayload({ announcementPage: index, announcementPages: pages, html: pages[index] });
    onPreview(pages[index], next);
  };
  const changePageContent = (html: string) => {
    const nextPages = [...pages];
    // Preserve the exact HTML emitted by TipTap while typing. In particular,
    // do not trim a trailing space or split the active paragraph mid-input:
    // both operations can interrupt the Windows text composition session.
    nextPages[current] = html;
    const next = {
      ...payload,
      html: nextPages[0],
      announcementPages: nextPages,
      announcementPage: current,
    };
    setPayload(next);
    onPreview(nextPages[current], next);
  };
  return (
    <div className="announcement-pages-editor">
      {pages.length > 1 && (
        <div className="announcement-page-tabs" aria-label="Partes del anuncio">
          {pages.map((_, index) => (
            <button
              type="button"
              className={index === current ? "active" : ""}
              onClick={() => changePage(index)}
              key={index}
            >
              Parte {index + 1}
            </button>
          ))}
        </div>
      )}
      <RichAnnouncementEditor
        key={`announcement-page-${current}`}
        html={pages[current]}
        fontSize={Number(payload.fontSize || 64)}
        onFontSize={(fontSize) => setPayload({ fontSize })}
        fontFamily={String(payload.fontFamily || "Inter")}
        onFontFamily={(fontFamily) => setPayload({ fontFamily })}
        onTextColor={(color) => setPayload({ color })}
        shadow={{
          enabled: payload.shadowEnabled !== false,
          color: String(payload.shadowColor || "#000000"),
          blur: Number(payload.shadowBlur ?? 14),
        }}
        onShadowChange={(shadow) =>
          setPayload({
            shadowEnabled: shadow.enabled,
            shadowColor: shadow.color,
            shadowBlur: shadow.blur,
          })
        }
        onChange={changePageContent}
      />
      {pages.length > 1 && (
        <small className="announcement-page-note">
          El anuncio se proyecta por partes. Elegí una parte para editarla o enviarla.
        </small>
      )}
    </div>
  );
}

function RichAnnouncementEditor({
  html,
  fontSize,
  onFontSize,
  fontFamily,
  onFontFamily,
  onTextColor,
  shadow,
  onShadowChange,
  onChange,
}: {
  html: string;
  fontSize: number;
  onFontSize: (value: number) => void;
  fontFamily: string;
  onFontFamily: (value: string) => void;
  onTextColor: (value: string) => void;
  shadow: { enabled: boolean; color: string; blur: number };
  onShadowChange: (shadow: {
    enabled: boolean;
    color: string;
    blur: number;
  }) => void;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      FontSize,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
    ],
    content: withoutLegacyEditorPrompt(html, "announcement"),
    editorProps: {
      attributes: {
        "data-placeholder": "Escribí el anuncio aquí…",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  return (
    <div className="announcement-rich">
      <h3 className="pro-section-title">Texto del anuncio</h3>
      <RichTextToolbar
        editor={editor}
        fontSize={fontSize}
        onFontSize={onFontSize}
        fontFamily={fontFamily}
        onFontFamily={onFontFamily}
        onTextColor={onTextColor}
        shadow={shadow}
        onShadowChange={onShadowChange}
      />
      <EditorContent
        editor={editor}
        className="announcement-editor"
        onBlur={() => {
          if (editor) onChange(editor.getHTML());
        }}
        style={{
          textShadow: shadow.enabled
            ? `0 3px ${shadow.blur}px ${shadow.color}`
            : "none",
        }}
      />
      <small>
        Seleccioná una palabra o frase para darle formato solo a esa parte. Sin
        selección, el tamaño y el color se aplican a todo el anuncio.
      </small>
    </div>
  );
}

function RichSongEditor({
  draft,
  onChange,
}: {
  draft: {
    title: string;
    content: string;
    shadowEnabled: boolean;
    shadowColor: string;
    shadowBlur: number;
  };
  onChange: (draft: {
    title: string;
    content: string;
    shadowEnabled: boolean;
    shadowColor: string;
    shadowBlur: number;
  }) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
    ],
    content: withoutLegacyEditorPrompt(draft.content, "song"),
    editorProps: {
      attributes: { "data-placeholder": "Escribí aquí la letra de la canción…" },
    },
    onUpdate: ({ editor }) => onChange({ ...draft, content: editor.getHTML() }),
  });
  const stanzaCount = Math.max(1, splitSongStanzas(draft.content).length);
  return (
    <div className="meeting-song-editor">
      <label>
        Título de la canción
        <input
          autoFocus
          value={draft.title}
          onChange={(event) =>
            onChange({ ...draft, title: event.target.value })
          }
        />
      </label>
      <div className="song-editor-heading">
        <span className="field-label">Letra y estrofas</span>
        <b>
          {stanzaCount} {stanzaCount === 1 ? "estrofa" : "estrofas"}
        </b>
      </div>
      <RichTextToolbar
        editor={editor}
        className="song-format-toolbar"
        shadow={{
          enabled: draft.shadowEnabled,
          color: draft.shadowColor,
          blur: draft.shadowBlur,
        }}
        onShadowChange={(shadow) =>
          onChange({
            ...draft,
            shadowEnabled: shadow.enabled,
            shadowColor: shadow.color,
            shadowBlur: shadow.blur,
          })
        }
      />
      <EditorContent
        editor={editor}
        className="announcement-editor meeting-song-content"
        onPasteCapture={(event) => {
          if (!editor) return;
          const plainText = event.clipboardData.getData("text/plain");
          if (!plainText) return;
          event.preventDefault();
          const escaped = plainText
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const html = escaped
            .split(/\r?\n\s*\r?\n/)
            .filter(Boolean)
            .map(
              (paragraph) => `<p>${paragraph.replace(/\r?\n/g, "<br>")}</p>`,
            )
            .join("<hr>");
          editor.chain().focus().insertContent(html || "<p></p>").run();
        }}
        style={{
          textShadow: draft.shadowEnabled
            ? `0 3px ${draft.shadowBlur}px ${draft.shadowColor}`
            : "none",
        }}
      />
      <div className="song-editor-help">
        <span>
          Dejá una línea vacía entre cada estrofa para que aparezcan separadas
          al proyectar.
        </span>
        <button
          type="button"
          onClick={() => editor?.chain().focus().insertContent("<p></p>").run()}
          title="Crear una nueva estrofa"
        >
          <Plus />
          Separar estrofa
        </button>
      </div>
    </div>
  );
}

/** Estilos que solo tienen sentido como zócalo en la parte inferior. */
const lowerOnlyTemplates = ["lower-third", "broadcast", "glass-accent"];

function DesignControls({
  payload: p,
  setPayload,
  showSize = true,
}: {
  payload: any;
  setPayload: (patch: Record<string, unknown>) => void;
  showSize?: boolean;
}) {
  const position = p.position || "center";
  const template = p.template || "plain";
  const positions = [
    { value: "center", label: "Centro", detail: "Caja en el medio", icon: "position-center" },
    { value: "lower", label: "Zócalo", detail: "Caja sobre el borde inferior", icon: "position-lower" },
    { value: "top", label: "Franja arriba", detail: "Ancho completo", icon: "position-top" },
    { value: "bottom", label: "Franja abajo", detail: "Ancho completo", icon: "position-bottom" },
  ];
  const templates = [
    { value: "plain", label: "Solo texto", icon: "design-minimal", radius: 0 },
    { value: "classic", label: "Clásico", icon: "design-classic", radius: 4 },
    { value: "accent", label: "Acento", icon: "design-accent", radius: 6 },
    { value: "glass", label: "Vidrio", icon: "design-glass", radius: 14 },
    { value: "solid", label: "Sólido", icon: "design-solid", radius: 8 },
    { value: "gradient", label: "Degradado", icon: "design-gradient", radius: 10 },
    { value: "lower-third", label: "Lower third", icon: "design-lower-third", radius: 6 },
    { value: "broadcast", label: "TV en vivo", icon: "design-broadcast", radius: 2 },
    { value: "glass-accent", label: "Cristal animado", icon: "design-glass-accent", radius: 12 },
  ];
  const animations = [
    { value: "none", label: "Ninguno" },
    { value: "fade", label: "Suave" },
    { value: "slide-left", label: "Desde la izquierda" },
    { value: "slide-up", label: "Desde abajo" },
    { value: "zoom", label: "Zoom" },
  ];
  const alignments = [
    { value: "left", label: "Izquierda", icon: <AlignLeft /> },
    { value: "center", label: "Centrado", icon: <AlignCenter /> },
    { value: "right", label: "Derecha", icon: <AlignRight /> },
  ];
  const backgroundColor = String(p.backgroundColor || "#000000");
  return (
    <>
      <section className="pro-section">
        <h3>Ubicación en la pantalla</h3>
        <div className="announcement-position-grid pro-choice-grid four">
          {positions.map((option) => (
            <button
              type="button"
              className={position === option.value ? "active" : ""}
              aria-pressed={position === option.value}
              onClick={() =>
                setPayload({
                  position: option.value,
                  // Los diseños de zócalo no funcionan fuera de la parte
                  // inferior: se cambia a uno compatible en lugar de dejar
                  // una combinación que se ve rota.
                  ...(option.value !== "lower" && lowerOnlyTemplates.includes(template)
                    ? { template: "solid", borderRadius: 8 }
                    : {}),
                })
              }
              key={option.value}
            >
              <i className={option.icon} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="pro-section">
        <h3>Estilo del fondo</h3>
        <div className="lower-third-gallery announcement-design-gallery pro-choice-grid">
          {templates.map((option) => {
            const lowerOnly = lowerOnlyTemplates.includes(option.value);
            return (
              <button
                type="button"
                className={template === option.value ? "active" : ""}
                aria-pressed={template === option.value}
                title={lowerOnly && position !== "lower" ? "Al elegirlo, el anuncio pasa a la ubicación Zócalo" : undefined}
                onClick={() =>
                  setPayload({
                    template: option.value,
                    borderRadius: option.radius,
                    ...(lowerOnly ? { position: "lower" } : {}),
                  })
                }
                key={option.value}
              >
                <i className={option.icon} />
                <span>{option.label}</span>
                {lowerOnly && <em>Zócalo</em>}
              </button>
            );
          })}
        </div>
        {template !== "plain" && (
          <div className="pro-color-row">
            <span>Color del fondo</span>
            <PresetPalette
              label="Color del fondo"
              colors={panelColors}
              value={backgroundColor.slice(0, 7)}
              onChange={(color) => setPayload({ backgroundColor: color })}
            />
            <label className="pro-custom-color" title="Elegir otro color">
              <input
                type="color"
                value={/^#[0-9a-f]{6}/i.test(backgroundColor) ? backgroundColor.slice(0, 7) : "#000000"}
                onChange={(event) => setPayload({ backgroundColor: event.target.value })}
              />
              Otro
            </label>
          </div>
        )}
      </section>

      <section className="pro-section pro-section-row">
        <div>
          <h3>Alineación del texto</h3>
          <div className="pro-segmented" role="radiogroup" aria-label="Alineación del texto">
            {alignments.map((option) => (
              <button
                type="button"
                role="radio"
                aria-checked={(p.align || "center") === option.value}
                aria-label={option.label}
                title={option.label}
                className={(p.align || "center") === option.value ? "active" : ""}
                onClick={() => setPayload({ align: option.value })}
                key={option.value}
              >
                {option.icon}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3>Animación de entrada</h3>
          <div className="pro-segmented wrap" role="radiogroup" aria-label="Animación de entrada">
            {animations.map((option) => (
              <button
                type="button"
                role="radio"
                aria-checked={(p.animation || "fade") === option.value}
                className={(p.animation || "fade") === option.value ? "active" : ""}
                onClick={() => setPayload({ animation: option.value })}
                key={option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {showSize && (
          <div>
            <h3>Tamaño del texto</h3>
            <input
              className="pro-number"
              type="number"
              min="18"
              max="140"
              aria-label="Tamaño del texto"
              value={p.fontSize || 64}
              onChange={(event) =>
                setPayload({
                  fontSize: Math.max(18, Math.min(140, Number(event.target.value) || 18)),
                })
              }
            />
          </div>
        )}
      </section>
    </>
  );
}

function PresetPalette({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: string[];
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="preset-palette" role="group" aria-label={label}>
      <div>
        {colors.map((color) => (
          <button
            className={
              value.toLowerCase() === color.toLowerCase() ? "active" : ""
            }
            style={{ background: color }}
            title={color}
            aria-label={`${label} ${color}`}
            type="button"
            onClick={() => onChange(color)}
            key={color}
          />
        ))}
      </div>
    </div>
  );
}

function BackgroundChoice({
  media,
  backgroundId,
  onChange,
}: {
  media: MediaItem[];
  backgroundId: unknown;
  onChange: (id: number | null) => void;
}) {
  return (
    <div className="background-choice">
      <span className="field-label">Elegí un fondo</span>
      <div className="background-gallery">
        <button
          className={!backgroundId ? "active" : ""}
          onClick={() => onChange(null)}
        >
          <span className="keep-background">
            <Image />
          </span>
          <strong>Usar fondo global</strong>
        </button>
        {media.map((item) => (
          <button
            className={Number(backgroundId) === item.id ? "active" : ""}
            onClick={() => onChange(item.id)}
            key={item.id}
          >
            {item.kind === "image" ? (
              <img src={item.url} />
            ) : (
              <video src={item.url} muted loop autoPlay playsInline />
            )}
            <strong>{item.name}</strong>
          </button>
        ))}
      </div>
      <p>
        El fondo global se elige desde el menú Fondos y se conservará para este
        ítem mientras no le asignes uno personalizado.
      </p>
    </div>
  );
}

function AnnouncementPreview({
  item,
  media,
  state,
  previewAspectRatio,
  onOpenPreview,
}: {
  item: MeetingItem;
  media: MediaItem[];
  state: ProjectionState;
  previewAspectRatio: string;
  onOpenPreview: () => void;
}) {
  const previewState = announcementPreviewState(item.type, item.payload as any, media, state);
  return (
    <aside className="announcement-preview">
      <div className="preview-heading">
        <div>
          <span className="live-dot" />
          Vista previa
        </div>
        <div className="preview-heading-actions">
          <small>{previewAspectRatio.replace(/\s*\/\s*/, ":")} · cambios en vivo</small>
          <button
            type="button"
            className="secondary preview-editor-button"
            onClick={onOpenPreview}
            aria-label="Ampliar vista previa"
            title="Ampliar vista previa sin enviar al proyector"
          >
            <MonitorPlay />
          </button>
        </div>
      </div>
      <div className="designer-preview" style={{ aspectRatio: previewAspectRatio }}>
        <ProjectionPreview state={previewState} />
      </div>
      <p>Así se verá en el proyector, con el fondo y el formato reales.</p>
    </aside>
  );
}

/** Estado de proyección para previsualizar un anuncio (o cita) con su diseño y fondo. */
function announcementPreviewState(
  type: MeetingItem["type"],
  p: any,
  media: MediaItem[],
  state: ProjectionState,
  sampleText = "Escribí tu anuncio",
): ProjectionState {
  const previewPages = announcementPages(p);
  const previewPage = Math.max(0, Math.min(Number(p.announcementPage || 0), previewPages.length - 1));
  const selectedBackground = media.find(
    (value) => value.id === Number(p.backgroundId),
  );
  return {
    ...state,
    blackout: false,
    logo: false,
    background: selectedBackground
      ? {
          ...state.background,
          id: selectedBackground.id,
          url: selectedBackground.url,
          name: selectedBackground.name,
          kind: selectedBackground.kind,
        }
      : state.background,
    lowerThird: { ...state.lowerThird, visible: false },
    text: {
      ...state.text,
      html: (() => {
        const html = previewPages[previewPage] || String(p.html || "");
        // Con el anuncio vacío se muestra un texto de ejemplo, para poder
        // elegir ubicación y estilo antes de escribir.
        return html.replace(/<[^>]+>/g, "").trim()
          ? html
          : `<p>${sampleText}</p>`;
      })(),
      visible: true,
      kind: type === "bible" ? "biblia" : "anuncio",
      position: p.position || "center",
      fontSize: Number(p.fontSize || 64),
      fontFamily: p.fontFamily || "Inter",
      color: p.color || "#ffffff",
      backgroundColor: p.backgroundColor || "rgba(0,0,0,0)",
      align: p.align || "center",
      borderRadius: Number(p.borderRadius || 0),
      template: p.template || "plain",
      animation: p.animation || "fade",
      shadowEnabled: p.shadowEnabled !== false,
      shadowColor: p.shadowColor || "#000000",
      shadowBlur: Number(p.shadowBlur ?? 14),
    },
  };
}

/**
 * Selector de ventana o pantalla para proyectar en vivo (Chrome, Zoom,
 * otro programa), con miniaturas actualizables.
 */
function CaptureSourcePicker({
  initial,
  onCancel,
  onChoose,
}: {
  initial?: Record<string, unknown>;
  onCancel: () => void;
  onChoose: (choice: { source: CaptureSource; cursor: boolean; fit: "contain" | "cover" }) => void;
}) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<"window" | "screen">(initial?.kind === "screen" ? "screen" : "window");
  const [selectedId, setSelectedId] = useState<string | null>((initial?.sourceId as string) ?? null);
  const [cursor, setCursor] = useState(initial?.cursor !== false);
  const [fit, setFit] = useState<"contain" | "cover">(initial?.fit === "cover" ? "cover" : "contain");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      setError("");
      const list = await window.flProyector.listCaptureSources();
      setSources(list);
      // Si la ventana guardada cambió de identificador, se reconoce por nombre.
      setSelectedId((current) => {
        if (current && list.some((value) => value.id === current)) return current;
        const byName = list.find((value) => value.name === initial?.sourceName);
        return byName?.id ?? null;
      });
    } catch {
      setSources([]);
      setError(
        "No se pudo obtener la lista de ventanas. En Mac, habilitá FL Proyector en Configuración del Sistema > Privacidad y seguridad > Grabación de pantalla.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const counts = {
    window: (sources ?? []).filter((value) => value.kind === "window").length,
    screen: (sources ?? []).filter((value) => value.kind === "screen").length,
  };
  const needle = query.trim().toLowerCase();
  const visible = (sources ?? []).filter(
    (value) => value.kind === kind && (!needle || value.name.toLowerCase().includes(needle)),
  );
  const chosen = sources?.find((value) => value.id === selectedId) ?? null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="cap-dialog" role="dialog" aria-modal="true" aria-labelledby="cap-title">
        <header className="cap-header">
          <div>
            <h2 id="cap-title">Proyectar una ventana</h2>
            <p>Mostrá en vivo un navegador, una reunión de Zoom u otro programa.</p>
          </div>
          <button className="fl-close cap-icon-button" onClick={onCancel} aria-label="Cerrar" title="Cerrar">
            <X />
          </button>
        </header>

        <div className="cap-toolbar">
          <div className="cap-tabs" role="tablist" aria-label="Tipo de fuente">
            <button role="tab" aria-selected={kind === "window"} className={kind === "window" ? "active" : ""} onClick={() => setKind("window")}>
              <AppWindow aria-hidden="true" />
              Ventanas
              {sources && <span className="cap-count">{counts.window}</span>}
            </button>
            <button role="tab" aria-selected={kind === "screen"} className={kind === "screen" ? "active" : ""} onClick={() => setKind("screen")}>
              <MonitorPlay aria-hidden="true" />
              Pantallas
              {sources && <span className="cap-count">{counts.screen}</span>}
            </button>
          </div>
          <label className="cap-search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar ventana"
              aria-label="Buscar ventana"
            />
          </label>
          <button className="cap-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw aria-hidden="true" className={loading ? "spinning" : ""} />
            Actualizar
          </button>
        </div>

        <div className="cap-grid" role="listbox" aria-label={kind === "window" ? "Ventanas" : "Pantallas"}>
          {sources === null ? (
            <div className="cap-empty">
              <RefreshCw className="spinning" aria-hidden="true" />
              <strong>Buscando ventanas…</strong>
            </div>
          ) : visible.length === 0 ? (
            <div className="cap-empty">
              <AppWindow aria-hidden="true" />
              <strong>
                {error
                  ? "No se pudo leer la lista"
                  : needle
                    ? "Ninguna ventana coincide con la búsqueda"
                    : kind === "window"
                      ? "No hay ventanas para proyectar"
                      : "No hay otra pantalla disponible"}
              </strong>
              <span>
                {error ||
                  (needle
                    ? "Probá con otra palabra."
                    : kind === "window"
                      ? "Abrí el programa (Chrome, Zoom…), asegurate de que no esté minimizado y tocá Actualizar."
                      : "El monitor del proyector no aparece porque se capturaría a sí mismo.")}
              </span>
            </div>
          ) : (
            visible.map((source) => (
              <button
                key={source.id}
                role="option"
                aria-selected={selectedId === source.id}
                className={`cap-source ${selectedId === source.id ? "selected" : ""}`}
                onClick={() => setSelectedId(source.id)}
                onDoubleClick={() => onChoose({ source, cursor, fit })}
                title={source.name}
              >
                <span className="cap-thumb">
                  {source.thumbnail ? <img src={source.thumbnail} alt="" /> : <AppWindow aria-hidden="true" />}
                </span>
                <span className="cap-name">
                  {source.icon ? <img src={source.icon} alt="" /> : <AppWindow aria-hidden="true" />}
                  <span>{source.name}</span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="cap-options">
          <div className="cap-option">
            <MousePointer2 aria-hidden="true" />
            <div>
              <strong>Mostrar el puntero</strong>
              <span>Útil para señalar en una página o programa.</span>
            </div>
            <label className="w11-toggle">
              <span className="w11-toggle-state">{cursor ? "Activado" : "Desactivado"}</span>
              <input type="checkbox" role="switch" aria-label="Mostrar el puntero" checked={cursor} onChange={(event) => setCursor(event.target.checked)} />
              <i aria-hidden="true" />
            </label>
          </div>
          <div className="cap-option">
            <Image aria-hidden="true" />
            <div>
              <strong>Encuadre</strong>
              <span>{fit === "contain" ? "Se ve completa, con bordes negros si hace falta." : "Ocupa toda la pantalla y puede recortar los bordes."}</span>
            </div>
            <div className="dlg-segmented cap-fit" role="radiogroup" aria-label="Encuadre">
              <button role="radio" aria-checked={fit === "contain"} className={fit === "contain" ? "active" : ""} onClick={() => setFit("contain")}>
                Ajustar
              </button>
              <button role="radio" aria-checked={fit === "cover"} className={fit === "cover" ? "active" : ""} onClick={() => setFit("cover")}>
                Llenar
              </button>
            </div>
          </div>
        </div>

        <footer className="cap-footer">
          <span>El sonido sale del programa original. Si minimizás la ventana, la imagen se congela.</span>
          <button className="cap-button" onClick={onCancel}>
            Cancelar
          </button>
          <button className="cap-button cap-primary" disabled={!chosen} onClick={() => chosen && onChoose({ source: chosen, cursor, fit })}>
            Usar esta ventana
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Fila de estrofa o pasaje: número, etiqueta, estado y texto. */
function StanzaRow({
  index,
  label,
  sectionType,
  html,
  active,
  live,
  next,
  onClick,
  onContextMenu,
}: {
  index: number;
  label: string;
  sectionType: string;
  html: string;
  active: boolean;
  live: boolean;
  next: boolean;
  onClick: () => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
}) {
  const tag = label
    ? label.charAt(0).toLocaleUpperCase("es-AR") + label.slice(1).toLocaleLowerCase("es-AR")
    : "";
  return (
    <button
      type="button"
      className={`stanza-row ${active ? "is-active" : ""} ${live ? "is-live" : ""} ${next ? "is-next" : ""}`}
      data-section-type={sectionType}
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-current={live ? "true" : undefined}
    >
      <span className="stanza-num">{index + 1}</span>
      <span className="stanza-body">
        <span className="stanza-head">
          <span className="stanza-tag">{tag}</span>
          {live ? null : next ? (
            <em className="stanza-state is-next">Siguiente</em>
          ) : active ? (
            <em className="stanza-state">Seleccionada</em>
          ) : null}
        </span>
        <div className="stanza-text" dangerouslySetInnerHTML={{ __html: html }} />
      </span>
    </button>
  );
}
