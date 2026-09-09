import { useEffect, useMemo, useState } from "react";
import {
  Film,
  LoaderCircle,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  MediaItem,
  ProjectionPatch,
  ProjectionState,
} from "../../shared/types";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

type Props = {
  state: ProjectionState;
  update: (patch: ProjectionPatch) => void;
};

export function MediaLibrary({ state, update }: Props) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
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
          ? { playing: true, seekTime: 0, commandId: state.video.commandId + 1 }
          : undefined,
    });
  const chooseFiles = async () => {
    setImporting(true);
    setImportError("");
    try {
      setMedia(await window.flProyector.chooseMediaFiles());
    } catch {
      setImportError(
        "No se pudo procesar uno de los archivos. Verificá que el video no esté dañado.",
      );
    } finally {
      setImporting(false);
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
  const editTags = async (item: MediaItem) => {
    const tags = await window.flProyector.editMediaTags(item.id, item.tags);
    if (tags) await window.flProyector.setTags(item.id, tags);
  };
  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await window.flProyector.deleteMedia(pendingDelete.id);
      if (state.background.id === pendingDelete.id)
        update({
          background: { id: null, url: null, name: "", kind: null },
          video: { playing: false },
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
      <div className="section-title">
        <div>
          <span className="eyebrow">BIBLIOTECA MULTIMEDIA</span>
          <h2>Fondos</h2>
        </div>
        <div className="library-tools">
          <button
            className="add-backgrounds primary"
            disabled={importing}
            onClick={chooseFiles}
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
                    editTags(item);
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
      {pendingDelete && (
        <ConfirmDeleteDialog
          title={`¿Eliminar “${pendingDelete.name}”?`}
          detail="El fondo se quitará de la biblioteca y el archivo se enviará a la papelera del sistema, desde donde podrás recuperarlo."
          onCancel={() => setPendingDelete(null)}
          onConfirm={remove}
        />
      )}
    </section>
  );
}
