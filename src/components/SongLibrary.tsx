import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import {
  CalendarPlus,
  Check,
  FolderPlus,
  Music2,
  Palette,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  Song,
  SongCategory,
  SongSectionType,
} from "../../shared/types";
import {
  normalizeSongSectionTypes,
  songSectionLabel,
  songSectionOptions,
  splitSongStanzas,
} from "../../shared/songSections";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { RichTextToolbar } from "./RichTextToolbar";
import { Win11ContextMenu } from "./Win11ContextMenu";
import { EmptyState } from "./EmptyState";
import { notifySaved, withSaveNotification } from "./SaveNotification";
import {
  clampColumnWidth,
  ColumnResizer,
  storedColumnWidth,
} from "./ColumnResizer";

const songColors = [
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

export function SongLibrary({
  meetingId,
  onAddToMeeting,
}: {
  meetingId: number | null;
  onAddToMeeting: (itemId: number) => void;
}) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [totalSongs, setTotalSongs] = useState(0);
  const [categories, setCategories] = useState<SongCategory[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Partial<Song>>({
    title: "",
    categoryId: null,
    content: "<p>Escribí aquí la letra del canto…</p>",
    sectionTypes: ["verse"],
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowBlur: 14,
  });
  const [pendingDeleteSong, setPendingDeleteSong] = useState<Song | null>(null);
  const [songContextMenu, setSongContextMenu] = useState<{
    song: Song;
    x: number;
    y: number;
    palette: boolean;
  } | null>(null);
  const [renamingSong, setRenamingSong] = useState<Song | null>(null);
  const [newSongDialog, setNewSongDialog] = useState(false);
  const [newSongTitle, setNewSongTitle] = useState("");
  const [newCategoryDialog, setNewCategoryDialog] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editing, setEditing] = useState(false);
  const [addingToMeeting, setAddingToMeeting] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [sectionContextMenu, setSectionContextMenu] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [categoriesWidth, setCategoriesWidth] = useState(() =>
    clampColumnWidth(
      storedColumnWidth("fl-layout-songs-categories", 170),
      100,
      900,
    ),
  );
  const [songListWidth, setSongListWidth] = useState(() =>
    clampColumnWidth(storedColumnWidth("fl-layout-songs-list", 220), 150, 1200),
  );
  const songsPageRef = useRef<HTMLElement | null>(null);
  const [songsPageWidth, setSongsPageWidth] = useState(0);
  const editorMinimum = 300;
  const categoriesMaximum = Math.max(
    100,
    songsPageWidth - songListWidth - editorMinimum - 8,
  );
  const songListMaximum = Math.max(
    150,
    songsPageWidth - categoriesWidth - editorMinimum - 8,
  );
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
    ],
    content: selected.content,
    editable: false,
    onUpdate: () => setEditorRevision((value) => value + 1),
  });

  const reload = async () => {
    const [filteredSongs, allSongs, songCategories] = await Promise.all([
      window.flProyector.listSongs(query, categoryId),
      window.flProyector.listSongs(),
      window.flProyector.listSongCategories(),
    ]);
    setSongs(filteredSongs);
    setTotalSongs(allSongs.length);
    setCategories(songCategories);
  };
  useEffect(() => {
    reload();
  }, [query, categoryId]);
  useEffect(
    () => window.flProyector.onLibraryChanged((scope) => {
      if (scope === "songs") reload();
    }),
    [query, categoryId],
  );
  useEffect(() => {
    editor?.setEditable(editing);
  }, [editor, editing]);
  useEffect(() => {
    const close = () => setSongContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  useEffect(() => {
    localStorage.setItem("fl-layout-songs-categories", String(categoriesWidth));
  }, [categoriesWidth]);
  useEffect(() => {
    localStorage.setItem("fl-layout-songs-list", String(songListWidth));
  }, [songListWidth]);
  useEffect(() => {
    const page = songsPageRef.current;
    if (!page) return;
    const measure = () => setSongsPageWidth(page.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!songsPageWidth) return;
    setCategoriesWidth((current) =>
      clampColumnWidth(current, 100, categoriesMaximum),
    );
    setSongListWidth((current) =>
      clampColumnWidth(current, 150, songListMaximum),
    );
  }, [songsPageWidth, categoriesMaximum, songListMaximum]);
  const choose = (song: Song) => {
    setSelected(song);
    setEditing(false);
    editor?.commands.setContent(song.content);
  };
  const create = (title = "Nuevo canto") => {
    const fresh = {
      title,
      categoryId,
      content: "<p>Escribí aquí la letra del canto…</p>",
      sectionTypes: ["verse"] as SongSectionType[],
      color: "#8b5cf6",
      shadowEnabled: true,
      shadowColor: "#000000",
      shadowBlur: 14,
    };
    setSelected(fresh);
    setEditing(true);
    editor?.commands.setContent(fresh.content);
  };
  const openNewSong = () => {
    setNewSongTitle("");
    setNewSongDialog(true);
  };
  const confirmNewSong = () => {
    const title = newSongTitle.trim();
    if (!title) return;
    setNewSongDialog(false);
    create(title);
  };
  const save = async () => {
    await withSaveNotification(async () => {
      const content = editor?.getHTML() ?? "";
      const stanzaCount = splitSongStanzas(content).length;
      const id = await window.flProyector.saveSong({
        ...selected,
        title: selected.title?.trim() || "Sin título",
        content,
        sectionTypes: normalizeSongSectionTypes(
          selected.sectionTypes,
          stanzaCount,
        ),
      });
      const saved = (await window.flProyector.listSongs()).find(
        (song) => song.id === id,
      );
      if (saved) choose(saved);
      else setEditing(false);
      reload();
    }, "La canción fue guardada.");
  };
  const cancelEdit = () => {
    const original = songs.find((song) => song.id === selected.id);
    if (original) choose(original);
    else {
      setEditing(false);
      setSelected({
        title: "",
        categoryId: null,
        content: "",
        sectionTypes: [],
        shadowEnabled: true,
        shadowColor: "#000000",
        shadowBlur: 14,
      });
      editor?.commands.setContent("");
    }
  };
  const remove = async () => {
    if (!pendingDeleteSong) return;
    await window.flProyector.deleteSong(pendingDeleteSong.id);
    if (selected.id === pendingDeleteSong.id) {
      setSelected({
        title: "",
        categoryId: null,
        content: "",
        sectionTypes: [],
        color: "#8b5cf6",
        shadowEnabled: true,
        shadowColor: "#000000",
        shadowBlur: 14,
      });
      setEditing(false);
      editor?.commands.setContent("");
    }
    setPendingDeleteSong(null);
    reload();
  };
  const updateSong = async (song: Song, patch: Partial<Song>) => {
    const changed = { ...song, ...patch };
    await window.flProyector.saveSong(changed);
    setSongs((current) =>
      current.map((entry) => (entry.id === song.id ? changed : entry)),
    );
    if (selected.id === song.id)
      setSelected((current) => ({ ...current, ...patch }));
    reload();
  };
  const renameSong = async () => {
    if (!renamingSong?.title.trim()) return;
    await withSaveNotification(async () => {
      await updateSong(renamingSong, { title: renamingSong.title.trim() });
      setRenamingSong(null);
    }, "El nombre de la canción fue guardado.");
  };
  const changeSongColor = async (song: Song, color: string) => {
    await updateSong(song, { color });
    setSongContextMenu(null);
  };
  const openNewCategory = () => {
    setNewCategoryName("");
    setNewCategoryDialog(true);
  };
  const addCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const id = await withSaveNotification(
      () => window.flProyector.createSongCategory(name),
      `La categoría “${name}” fue creada.`,
    );
    if (!id) return;
    setNewCategoryDialog(false);
    setCategoryId(null);
    await reload();
  };
  const assignCategory = async (nextCategoryId: number | null) => {
    setSelected((current) => ({ ...current, categoryId: nextCategoryId }));
    if (!selected.id) return;
    const storedSong = (await window.flProyector.listSongs()).find(
      (song) => song.id === selected.id,
    );
    if (!storedSong) return;
    await window.flProyector.saveSong({
      ...storedSong,
      categoryId: nextCategoryId,
    });
    notifySaved("La categoría de la canción fue guardada.");
    await reload();
  };
  const changeSectionType = async (index: number, type: SongSectionType) => {
    const content = editor?.getHTML() ?? selected.content ?? "";
    const next = normalizeSongSectionTypes(
      selected.sectionTypes,
      splitSongStanzas(content).length,
    );
    next[index] = type;
    const changed = { ...selected, content, sectionTypes: next };
    setSelected(changed);
    if (selected.id && !editing) {
      await window.flProyector.saveSong({
        ...changed,
        title: changed.title?.trim() || "Sin título",
        content,
      });
      notifySaved("La estructura de la canción fue guardada.");
      await reload();
    }
  };
  const send = async () => {
    if (!selected.id) return;
    let targetMeetingId = meetingId;
    if (!targetMeetingId) {
      const meetings = await window.flProyector.listMeetings();
      targetMeetingId = meetings[0]?.id ?? null;
    }
    if (!targetMeetingId) {
      alert("Primero creá una reunión para agregar esta canción.");
      return;
    }
    setAddingToMeeting(true);
    try {
      const itemId = await window.flProyector.saveMeetingItem({
        meetingId: targetMeetingId,
        type: "song",
        title: selected.title?.trim() || "Canción",
        color: "#8b5cf6",
        payload: { songId: selected.id, backgroundId: null },
      });
      onAddToMeeting(itemId);
    } finally {
      setAddingToMeeting(false);
    }
  };

  const visibleStanzas = splitSongStanzas(
    editor?.getHTML() ?? selected.content ?? "",
  );
  const visibleSectionTypes = normalizeSongSectionTypes(
    selected.sectionTypes,
    visibleStanzas.length,
  );
  useEffect(() => {
    const root = editor?.view.dom as HTMLElement | undefined;
    if (!root) return;
    const paragraphs = Array.from(root.children).filter(
      (element): element is HTMLParagraphElement =>
        element instanceof HTMLParagraphElement &&
        Boolean(element.textContent?.replace(/\u00a0/g, " ").trim()),
    );
    paragraphs.forEach((paragraph, index) => {
      paragraph.dataset.songSectionLabel = songSectionLabel(
        visibleSectionTypes,
        index,
      );
      paragraph.dataset.songSectionType =
        visibleSectionTypes[index] || "verse";
      paragraph.title = "Clic derecho para cambiar el tipo de esta parte";
    });
  }, [editor, editorRevision, selected.content, selected.sectionTypes]);

  return (
    <section
      ref={songsPageRef}
      className="songs-page"
      style={
        {
          "--song-categories-width": `${categoriesWidth}px`,
          "--song-list-width": `${songListWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="song-categories">
        <div className="pane-title">
          <b>CATEGORÍAS</b>
          <button onClick={openNewCategory} aria-label="Nueva categoría" title="Nueva categoría">
            <FolderPlus size={16} />
          </button>
        </div>
        <button
          className={categoryId === null ? "active" : ""}
          onClick={() => setCategoryId(null)}
        >
          Todos los cantos <span>{totalSongs}</span>
        </button>
        {categories.map((category) => (
          <button
            className={categoryId === category.id ? "active" : ""}
            onClick={() => setCategoryId(category.id)}
            key={category.id}
          >
            {category.name}
            <span>{category.songCount}</span>
          </button>
        ))}
      </aside>
      <ColumnResizer
        label="Cambiar ancho de categorías"
        onResize={(delta) =>
          setCategoriesWidth((current) =>
            clampColumnWidth(current + delta, 100, categoriesMaximum),
          )
        }
      />
      <div className="song-list">
        <div className="song-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o letra"
          />
        </div>
        <button className="new-song" onClick={openNewSong}>
          <Plus size={16} /> Nuevo canto
        </button>
        {songs.map((song) => (
          <button
            className={selected.id === song.id ? "active" : ""}
            style={{ "--song-color": song.color || "#8b5cf6" } as CSSProperties}
            onClick={() => choose(song)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSongContextMenu({
                song,
                x: event.clientX,
                y: event.clientY,
                palette: false,
              });
            }}
            key={song.id}
          >
            <strong>{song.title}</strong>
            <span>{song.categoryName || "Sin categoría"}</span>
          </button>
        ))}
        {!songs.length && (
          <EmptyState
            compact
            icon={<Music2 />}
            title={query ? "No encontramos canciones" : "No hay canciones guardadas"}
            detail={query ? "Probá con otra búsqueda." : "Creá una canción para comenzar."}
          />
        )}
      </div>
      <ColumnResizer
        label="Cambiar ancho de la lista de canciones"
        onResize={(delta) =>
          setSongListWidth((current) =>
            clampColumnWidth(current + delta, 150, songListMaximum),
          )
        }
      />
      <div className={`song-editor ${editing ? "is-editing" : "is-reading"}`}>
        {!selected.id && !editing ? (
          <EmptyState
            icon={<Music2 />}
            title="No hay canción seleccionada"
            detail="Seleccioná una canción o creá una nueva para comenzar."
            action={(
              <button className="primary win11-empty-action" onClick={openNewSong}>
                <Plus />
                Nueva canción
              </button>
            )}
          />
        ) : (
        <>
        <div className="section-title">
          <div>
            <span className="eyebrow">
              {editing ? "EDITAR CANCIÓN" : "CANCIÓN"}
            </span>
            <input
              className="title-input"
              readOnly={!editing}
              value={selected.title || ""}
              onChange={(e) =>
                setSelected((value) => ({ ...value, title: e.target.value }))
              }
            />
          </div>
          <select
            disabled={!selected.id && !editing}
            value={selected.categoryId ?? ""}
            onChange={(e) =>
              assignCategory(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">Sin categoría</option>
            {categories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        {editing && (
          <RichTextToolbar
            editor={editor}
            className="song-library-toolbar"
            shadow={{
              enabled: selected.shadowEnabled !== false,
              color: selected.shadowColor || "#000000",
              blur: Number(selected.shadowBlur ?? 14),
            }}
            onShadowChange={(shadow) =>
              setSelected((value) => ({
                ...value,
                shadowEnabled: shadow.enabled,
                shadowColor: shadow.color,
                shadowBlur: shadow.blur,
              }))
            }
          />
        )}
        <EditorContent
          editor={editor}
          className="rich-editor song-rich-editor"
          onContextMenuCapture={(event) => {
            const root = editor?.view.dom as HTMLElement | undefined;
            const target = event.target as HTMLElement;
            const paragraph = target.closest("p");
            if (!root || !paragraph || paragraph.parentElement !== root) return;
            const paragraphs = Array.from(root.children).filter(
              (element) =>
                element instanceof HTMLParagraphElement &&
                Boolean(element.textContent?.replace(/\u00a0/g, " ").trim()),
            );
            const index = paragraphs.indexOf(paragraph);
            if (index < 0) return;
            event.preventDefault();
            event.stopPropagation();
            setSectionContextMenu({
              index,
              x: event.clientX,
              y: event.clientY,
            });
          }}
          onPasteCapture={(event) => {
            if (!editing || !editor) return;
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
              // Horizontal rules are invisible in projection and give the
              // meeting editor a durable stanza boundary after saving.
              .join("<hr>");
            editor
              .chain()
              .focus()
              .insertContent(html || "<p></p>")
              .run();
          }}
          style={{
            textShadow:
              selected.shadowEnabled !== false
                ? `0 3px ${Number(selected.shadowBlur ?? 14)}px ${selected.shadowColor || "#000000"}`
                : "none",
          }}
        />
        <div className="editor-actions">
          <button
            className="danger"
            disabled={!selected.id}
            onClick={() => {
              const song = songs.find((entry) => entry.id === selected.id);
              if (song) setPendingDeleteSong(song);
            }}
          >
            <Trash2 size={16} />
            Eliminar
          </button>
          {editing ? (
            <>
              <button className="secondary" onClick={cancelEdit}>
                <X size={16} />
                Cancelar
              </button>
              <button className="secondary save-song" onClick={save}>
                <Save size={16} />
                Guardar
              </button>
            </>
          ) : (
            <button
              className="secondary edit-song"
              disabled={!selected.id}
              onClick={() => setEditing(true)}
            >
              <Pencil size={16} />
              Editar
            </button>
          )}
          <button
            className="primary add-song-to-meeting"
            disabled={!selected.id || addingToMeeting}
            onClick={send}
          >
            <CalendarPlus size={16} />
            {addingToMeeting ? "Agregando…" : "Agregar a reunión"}
          </button>
        </div>
        </>
        )}
      </div>
      {sectionContextMenu && (
        <Win11ContextMenu
          x={sectionContextMenu.x}
          y={sectionContextMenu.y}
          onClose={() => setSectionContextMenu(null)}
          ariaLabel={`Tipo de ${songSectionLabel(visibleSectionTypes, sectionContextMenu.index)}`}
          items={songSectionOptions.map((option) => ({
            label: `Asignar como ${option.label}`,
            icon:
              visibleSectionTypes[sectionContextMenu.index] === option.value ? (
                <Check />
              ) : (
                <Music2 />
              ),
            onClick: () =>
              void changeSectionType(sectionContextMenu.index, option.value),
          }))}
        />
      )}
      {songContextMenu && (
        <Win11ContextMenu
          x={songContextMenu.x}
          y={songContextMenu.y}
          onClose={() => setSongContextMenu(null)}
          ariaLabel={`Acciones de ${songContextMenu.song.title}`}
          items={!songContextMenu.palette ? [
            {
              label: "Renombrar título",
              icon: <Pencil />,
              onClick: () => {
                  setRenamingSong({ ...songContextMenu.song });
              },
            },
            {
              label: "Editar canción",
              icon: <Pencil />,
              onClick: () => {
                  choose(songContextMenu.song);
                  setEditing(true);
              },
            },
            {
              label: "Cambiar color",
              icon: <Palette />,
              keepOpen: true,
              onClick: () => setSongContextMenu({ ...songContextMenu, palette: true }),
            },
            {
              label: "Eliminar canción",
              icon: <Trash2 />,
              danger: true,
              onClick: () => {
                  setPendingDeleteSong(songContextMenu.song);
              },
            },
          ] : [{
            label: "Volver",
            icon: <Pencil />,
            keepOpen: true,
            onClick: () => setSongContextMenu({ ...songContextMenu, palette: false }),
          }]}
        >
          {songContextMenu.palette && (
            <div className="win11-context-palette-panel">
              <strong>Elegí un color</strong>
              <div className="context-palette">
                {songColors.map((color) => (
                  <button
                    style={{ background: color }}
                    onClick={() => changeSongColor(songContextMenu.song, color)}
                    key={color}
                  />
                ))}
              </div>
            </div>
          )}
        </Win11ContextMenu>
      )}
      {renamingSong && (
        <div className="modal-backdrop">
          <form
            className="song-create-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              renameSong();
            }}
          >
            <button
              type="button"
              className="dialog-close"
              aria-label="Cerrar"
              onClick={() => setRenamingSong(null)}
            >
              <X />
            </button>
            <span className="eyebrow">RENOMBRAR CANCIÓN</span>
            <h2>Editar título</h2>
            <p>El nuevo nombre se verá en la biblioteca y en las reuniones.</p>
            <label>
              Título de la canción
              <input
                autoFocus
                value={renamingSong.title}
                onChange={(event) =>
                  setRenamingSong({
                    ...renamingSong,
                    title: event.target.value,
                  })
                }
              />
            </label>
            <div className="song-create-actions">
              <button type="button" onClick={() => setRenamingSong(null)}>
                Cancelar
              </button>
              <button className="primary" disabled={!renamingSong.title.trim()}>
                Guardar título
              </button>
            </div>
          </form>
        </div>
      )}
      {pendingDeleteSong && (
        <ConfirmDeleteDialog
          title={`¿Eliminar “${pendingDeleteSong.title}”?`}
          detail="La canción se quitará definitivamente de la biblioteca. Esta acción no se puede deshacer."
          onCancel={() => setPendingDeleteSong(null)}
          onConfirm={remove}
        />
      )}
      {newSongDialog && (
        <div className="modal-backdrop">
          <form
            className="song-create-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              confirmNewSong();
            }}
          >
            <button
              type="button"
              className="dialog-close"
              aria-label="Cerrar"
              onClick={() => setNewSongDialog(false)}
            >
              <X />
            </button>
            <span className="eyebrow">NUEVO CANTO</span>
            <h2>Crear canción</h2>
            <p>
              Escribí el título para comenzar a cargar la letra y sus estrofas.
            </p>
            <label>
              Título de la canción
              <input
                autoFocus
                value={newSongTitle}
                onChange={(event) => setNewSongTitle(event.target.value)}
                placeholder="Ej. Cuán grande es Él"
              />
            </label>
            <div className="song-create-actions">
              <button type="button" onClick={() => setNewSongDialog(false)}>
                Cancelar
              </button>
              <button className="primary" disabled={!newSongTitle.trim()}>
                Crear canción
              </button>
            </div>
          </form>
        </div>
      )}
      {newCategoryDialog && (
        <div className="modal-backdrop">
          <form
            className="song-create-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              addCategory();
            }}
          >
            <button
              type="button"
              className="dialog-close"
              aria-label="Cerrar"
              onClick={() => setNewCategoryDialog(false)}
            >
              <X />
            </button>
            <span className="eyebrow">NUEVA CATEGORÍA</span>
            <h2>Crear categoría</h2>
            <p>Después podrás asignarla a cualquier canción desde el editor.</p>
            <label>
              Nombre de la categoría
              <input
                autoFocus
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Ej. Alabanza"
              />
            </label>
            <div className="song-create-actions">
              <button type="button" onClick={() => setNewCategoryDialog(false)}>
                Cancelar
              </button>
              <button className="primary" disabled={!newCategoryName.trim()}>
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
