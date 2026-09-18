import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  Film,
  Globe2,
  HardDrive,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  Search,
  Server,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  MediaItem,
  OpenverseMediaResult,
  ProjectionPatch,
  ProjectionState,
} from "../../shared/types";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

type Props = {
  state: ProjectionState;
  update: (patch: ProjectionPatch) => void;
};

const readableError = (error: unknown, fallback: string) =>
  error instanceof Error
    ? error.message
        .replace(/^(?:Error:\s*)+/, "")
        .replace(/^Error invoking remote method '[^']+':\s*/, "")
        .replace(/^(?:Error:\s*)+/, "")
    : fallback;

export function MediaLibrary({ state, update }: Props) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addMode, setAddMode] = useState<"disk" | "server">("disk");
  const [openverseQuery, setOpenverseQuery] = useState("");
  const [openverseOrientation, setOpenverseOrientation] = useState<
    "all" | "landscape" | "portrait" | "square"
  >("landscape");
  const [openverseResults, setOpenverseResults] = useState<OpenverseMediaResult[]>([]);
  const [openversePage, setOpenversePage] = useState(1);
  const [openverseHasMore, setOpenverseHasMore] = useState(false);
  const [openverseLoading, setOpenverseLoading] = useState(false);
  const [openverseError, setOpenverseError] = useState("");
  const [importingOpenverseId, setImportingOpenverseId] = useState<string | null>(null);
  const [importedOpenverseIds, setImportedOpenverseIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  const [editingTags, setEditingTags] = useState<MediaItem | null>(null);
  const [mediaNameDraft, setMediaNameDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const reload = () => window.flProyector.listMedia().then(setMedia);

  useEffect(() => {
    reload();
    return window.flProyector.onMediaChanged(reload);
  }, []);

  const filtered = useMemo(
    () =>
      media.filter((item) =>
        `${item.name} ${item.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [media, query],
  );
  const select = (item: MediaItem) =>
    update({
      background: {
        id: item.id,
        url: item.url,
        name: item.name,
        kind: item.kind,
      },
      video:
        item.kind === "video"
          ? {
              playing: true,
              loop: true,
              seekTime: 0,
              currentTime: 0,
              duration: 0,
              commandId: state.video.commandId + 1,
            }
          : undefined,
    });
  const chooseFiles = async () => {
    setImporting(true);
    setImportError("");
    try {
      setMedia(await window.flProyector.chooseMediaFiles());
      setAddDialogOpen(false);
    } catch {
      setImportError(
        "No se pudo procesar uno de los archivos. Verificá que el video no esté dañado.",
      );
    } finally {
      setImporting(false);
    }
  };
  const openAddDialog = () => {
    setAddDialogOpen(true);
    setAddMode("disk");
    setOpenverseError("");
  };
  const searchOpenverse = async (page = 1, append = false) => {
    if (!openverseQuery.trim()) return;
    setOpenverseLoading(true);
    setOpenverseError("");
    try {
      const result = await window.flProyector.searchOpenverse(
        openverseQuery,
        openverseOrientation,
        page,
      );
      setOpenverseResults((current) => append ? [...current, ...result.items] : result.items);
      setOpenversePage(result.page);
      setOpenverseHasMore(result.hasMore);
    } catch (error) {
      setOpenverseError(readableError(error, "No se pudo buscar en Openverse."));
    } finally {
      setOpenverseLoading(false);
    }
  };
  const importFromOpenverse = async (item: OpenverseMediaResult) => {
    setImportingOpenverseId(item.externalId);
    setOpenverseError("");
    try {
      setMedia(await window.flProyector.importOpenverseMedia(item));
      setImportedOpenverseIds((current) => new Set(current).add(item.externalId));
    } catch (error) {
      setOpenverseError(readableError(error, "No se pudo guardar el fondo."));
    } finally {
      setImportingOpenverseId(null);
    }
  };
  const importDropped = async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    setImportError("");
    try {
      setMedia(await window.flProyector.importDroppedFiles(files));
    } catch {
      setImportError(
        "No se pudo procesar uno de los archivos. Verificá que el video no esté dañado.",
      );
    } finally {
      setImporting(false);
    }
  };
  const openTagEditor = (item: MediaItem) => {
    setEditingTags(item);
    setMediaNameDraft(item.name.replace(/\.[^.]+$/, ""));
    setTagDraft(item.tags.join(", "));
  };
  const saveTags = async () => {
    if (!editingTags) return;
    const name = mediaNameDraft.trim();
    if (!name) return;
    const seen = new Set<string>();
    const tags = tagDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => {
        const key = tag.toLocaleLowerCase();
        if (!tag || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    try {
      await window.flProyector.updateMediaDetails(editingTags.id, name, tags);
      setMedia((current) =>
        current.map((item) =>
          item.id === editingTags.id ? { ...item, name, tags } : item,
        ),
      );
      setEditingTags(null);
      setMediaNameDraft("");
      setTagDraft("");
    } catch {
      setImportError(
        "No se pudieron guardar los cambios del fondo. Intentá nuevamente.",
      );
    }
  };
  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await window.flProyector.deleteMedia(pendingDelete.id);
      if (state.background.id === pendingDelete.id)
        update({
          background: { id: null, url: null, name: "", kind: null },
          video: { playing: false, loop: true },
        });
      setPendingDelete(null);
      reload();
    } catch {
      setImportError(
        "No se pudo enviar el archivo a la papelera. Cerrá cualquier programa que lo esté usando e intentá nuevamente.",
      );
      setPendingDelete(null);
    }
  };

  return (
    <section
      className="library-panel media-library"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        await importDropped([...event.dataTransfer.files]);
      }}
    >
      <div className="section-title media-library-toolbar" aria-label="Herramientas de fondos">
        <div className="library-tools">
          <button
            className="add-backgrounds primary"
            disabled={importing}
            onClick={() => void openAddDialog()}
          >
            {importing ? <LoaderCircle className="spin" /> : <Plus />}
            {importing ? "Procesando y guardando…" : "Agregar fondos"}
          </button>
          <div className="search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar fondo o etiqueta"
            />
          </div>
        </div>
      </div>
      {importError && <div className="media-import-error">{importError}</div>}
      {(dragging || importing) && (
        <div className="drop-overlay">
          <Upload size={38} />
          <strong>
            {importing
              ? "Procesando archivos…"
              : "Soltá las imágenes o videos aquí"}
          </strong>
          <span>
            {importing
              ? "La conversión de videos grandes puede tardar unos minutos."
              : "Se copiarán y guardarán en la biblioteca de Fondos."}
          </span>
        </div>
      )}
      <div className="media-grid">
        {filtered.map((item) => (
          <article
            key={item.id}
            className={`media-card ${state.background.id === item.id ? "selected" : ""}`}
            onClick={() => select(item)}
          >
            <div className="media-thumb">
              {item.kind === "image" ? (
                <img src={item.url} />
              ) : (
                <video
                  src={item.url}
                  muted
                  loop
                  preload="metadata"
                  onMouseEnter={(event) => event.currentTarget.play()}
                  onMouseLeave={(event) => {
                    event.currentTarget.pause();
                    event.currentTarget.currentTime = 0;
                  }}
                />
              )}
              <div className="playing-indicator">AL AIRE</div>
            </div>
            <div className="media-meta">
              <div>
                <strong>{item.name.replace(/\.[^.]+$/, "")}</strong>
                <span>
                  {item.tags.join(" · ") ||
                    (item.kind === "image" ? "Imagen" : "Video")}
                </span>
              </div>
              <div className="card-actions">
                <button
                  title="Editar etiquetas"
                  onClick={(event) => {
                    event.stopPropagation();
                    openTagEditor(item);
                  }}
                >
                  <Tag size={14} />
                </button>
                <button
                  className="delete-media"
                  title="Eliminar fondo"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDelete(item);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </article>
        ))}
        {!filtered.length && (
          <div className="empty-state">
            <Film size={42} />
            <strong>
              {query
                ? "No encontramos resultados"
                : "Todavía no cargaste fondos"}
            </strong>
            <span>
              {query
                ? "Probá con otro nombre o etiqueta."
                : "Usá “Agregar fondos” o arrastrá archivos a esta zona."}
            </span>
          </div>
        )}
      </div>
      {addDialogOpen && (
        <div
          className="modal-backdrop media-source-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAddDialogOpen(false);
          }}
        >
          <section
            className="media-source-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-source-title"
          >
            <div className="media-tags-header">
              <div>
                <span className="eyebrow">AGREGAR FONDOS</span>
                <h2 id="media-source-title">Elegí el origen</h2>
              </div>
              <button
                type="button"
                className="media-tags-close"
                aria-label="Cerrar"
                onClick={() => setAddDialogOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="media-source-tabs" role="tablist">
              <button
                type="button"
                className={addMode === "disk" ? "active" : ""}
                onClick={() => setAddMode("disk")}
              >
                <HardDrive />
                Disco
              </button>
              <button
                type="button"
                className={addMode === "server" ? "active" : ""}
                onClick={() => setAddMode("server")}
              >
                <Server />
                Servidor
              </button>
            </div>
            {addMode === "disk" ? (
              <div className="media-disk-source">
                <span className="media-source-icon"><HardDrive /></span>
                <h3>Archivos de esta computadora</h3>
                <p>Elegí imágenes o videos. Se copiarán a la biblioteca local de FL Proyector.</p>
                <button
                  type="button"
                  className="primary"
                  disabled={importing}
                  onClick={() => void chooseFiles()}
                >
                  {importing ? <LoaderCircle className="spin" /> : <Upload />}
                  {importing ? "Procesando…" : "Elegir archivos"}
                </button>
              </div>
            ) : (
              <div className="openverse-source">
                <div className="openverse-connected-row">
                  <span><Globe2 /> Openverse · sin cuenta ni clave</span>
                  <small>Imágenes grandes con licencia libre</small>
                </div>
                <form
                  className="openverse-search-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchOpenverse(1, false);
                  }}
                >
                  <label className="openverse-search-input">
                    <Search />
                    <input
                      autoFocus
                      value={openverseQuery}
                      onChange={(event) => setOpenverseQuery(event.target.value)}
                      placeholder="Ej. cielo, iglesia, naturaleza…"
                    />
                  </label>
                  <select
                    value={openverseOrientation}
                    onChange={(event) => setOpenverseOrientation(event.target.value as typeof openverseOrientation)}
                  >
                    <option value="all">Cualquier formato</option>
                    <option value="landscape">Horizontal</option>
                    <option value="portrait">Vertical</option>
                    <option value="square">Cuadrado</option>
                  </select>
                  <button className="primary" disabled={!openverseQuery.trim() || openverseLoading}>
                    {openverseLoading ? <LoaderCircle className="spin" /> : <Search />}
                    Buscar
                  </button>
                </form>
                {openverseError && <div className="openverse-error">{openverseError}</div>}
                <div className="openverse-results">
                  {openverseResults.map((item) => {
                    const saved = importedOpenverseIds.has(item.externalId);
                    const downloading = importingOpenverseId === item.externalId;
                    return (
                      <article key={item.externalId} className="openverse-card">
                        <div className="openverse-preview">
                          <img src={item.previewUrl} alt="" />
                          <span><ImageIcon /></span>
                        </div>
                        <div className="openverse-card-copy">
                          <button
                            type="button"
                            className="openverse-author"
                            onClick={() => void window.flProyector.openExternal(item.sourceUrl)}
                            title="Abrir ficha en Openverse"
                          >
                            {item.creator} <ExternalLink />
                          </button>
                          <small>
                            {item.width}×{item.height} · {item.license || "Licencia libre"}
                          </small>
                          <button
                            type="button"
                            className={saved ? "saved" : "primary"}
                            disabled={saved || importingOpenverseId !== null}
                            onClick={() => void importFromOpenverse(item)}
                          >
                            {downloading ? <LoaderCircle className="spin" /> : saved ? <Check /> : <Download />}
                            {downloading ? "Guardando…" : saved ? "Guardado" : "Guardar original"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {!openverseLoading && openverseQuery && !openverseResults.length && !openverseError && (
                    <div className="openverse-empty">No se encontraron fondos grandes con esa búsqueda.</div>
                  )}
                </div>
                {openverseHasMore && openverseResults.length > 0 && (
                  <button
                    type="button"
                    className="openverse-more"
                    disabled={openverseLoading}
                    onClick={() => void searchOpenverse(openversePage + 1, true)}
                  >
                    {openverseLoading ? "Cargando…" : "Ver más resultados"}
                  </button>
                )}
                <p className="openverse-credit">
                  Openverse reúne imágenes con licencias abiertas. FL Proyector conserva autor,
                  licencia y procedencia como etiquetas del fondo.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
      {pendingDelete && (
        <ConfirmDeleteDialog
          title={`¿Eliminar “${pendingDelete.name}”?`}
          detail="El fondo se quitará de la biblioteca y el archivo se enviará a la papelera del sistema, desde donde podrás recuperarlo."
          onCancel={() => setPendingDelete(null)}
          onConfirm={remove}
        />
      )}
      {editingTags && (
        <div
          className="modal-backdrop media-tags-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingTags(null);
          }}
        >
          <form
            className="media-tags-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-tags-title"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTags();
            }}
          >
            <div className="media-tags-header">
              <div>
                <span className="eyebrow">ORGANIZAR FONDO</span>
                <h2 id="media-tags-title">Editar fondo</h2>
              </div>
              <button
                type="button"
                className="media-tags-close"
                aria-label="Cerrar"
                onClick={() => setEditingTags(null)}
              >
                <X size={16} />
              </button>
            </div>
            <label htmlFor="media-name-input">Nombre del fondo</label>
            <input
              id="media-name-input"
              autoFocus
              value={mediaNameDraft}
              onChange={(event) => setMediaNameDraft(event.target.value)}
              placeholder="Nombre visible del fondo"
            />
            <label htmlFor="media-tags-input">Etiquetas separadas por coma</label>
            <input
              id="media-tags-input"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="Ej. naturaleza, azul, celebración"
            />
            <p className="media-tags-help">
              Después podés encontrarlas desde el buscador de Fondos.
            </p>
            <div className="media-tags-actions">
              <button type="button" onClick={() => setEditingTags(null)}>
                Cancelar
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!mediaNameDraft.trim()}
              >
                Guardar cambios
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
