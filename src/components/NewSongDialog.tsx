import { useState } from "react";
import {
  ArrowLeft,
  FilePenLine,
  Globe2,
  LoaderCircle,
  Music2,
  Search,
  X,
} from "lucide-react";
import type { LyricsSearchResult } from "../../shared/types";

type Props = {
  onClose: () => void;
  onManual: (title: string) => void;
  onImport: (result: LyricsSearchResult) => void;
};

const formatDuration = (seconds: number) => {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
};

export function NewSongDialog({ onClose, onManual, onImport }: Props) {
  const [mode, setMode] = useState<"choose" | "manual" | "web">("choose");
  const [manualTitle, setManualTitle] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [results, setResults] = useState<LyricsSearchResult[]>([]);
  const [selected, setSelected] = useState<LyricsSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    if (!title.trim() || searching) return;
    setSearching(true);
    setError("");
    setSelected(null);
    try {
      const found = await window.flProyector.searchLyrics(
        title.trim(),
        artist.trim(),
      );
      setResults(found);
      setSearched(true);
    } catch (reason) {
      setResults([]);
      setSearched(true);
      setError(
        reason instanceof Error
          ? reason.message.replace(
              /^Error invoking remote method '[^']+': Error:\s*/,
              "",
            )
          : "No se pudo completar la búsqueda.",
      );
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className={`song-create-dialog new-song-dialog ${mode === "web" ? "lyrics-search-dialog" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-song-dialog-title"
      >
        <button
          type="button"
          className="dialog-close"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <X />
        </button>

        {mode === "choose" && (
          <>
            <span className="eyebrow">NUEVO CANTO</span>
            <h2 id="new-song-dialog-title">¿Cómo querés crearlo?</h2>
            <p>Elegí cómo cargar la letra. En ambos casos podrás editarla antes de guardar.</p>
            <div className="new-song-mode-grid">
              <button type="button" onClick={() => setMode("manual")}>
                <FilePenLine />
                <strong>Crear manualmente</strong>
                <span>Escribir o pegar la letra en el editor.</span>
              </button>
              <button type="button" onClick={() => setMode("web")}>
                <Globe2 />
                <strong>Buscar letra en Internet</strong>
                <span>Buscar por título y artista en LRCLIB.</span>
              </button>
            </div>
          </>
        )}

        {mode === "manual" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (manualTitle.trim()) onManual(manualTitle.trim());
            }}
          >
            <button type="button" className="song-dialog-back" onClick={() => setMode("choose")}>
              <ArrowLeft /> Volver
            </button>
            <span className="eyebrow">CREACIÓN MANUAL</span>
            <h2 id="new-song-dialog-title">Crear canción</h2>
            <p>Ingresá el título y luego escribí o pegá la letra en el editor.</p>
            <label>
              Título de la canción
              <input
                autoFocus
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                placeholder="Ej. Cuán grande es Él"
              />
            </label>
            <div className="song-create-actions">
              <button type="button" onClick={onClose}>Cancelar</button>
              <button className="primary" disabled={!manualTitle.trim()}>Continuar</button>
            </div>
          </form>
        )}

        {mode === "web" && (
          <>
            <button type="button" className="song-dialog-back" onClick={() => setMode("choose")}>
              <ArrowLeft /> Volver
            </button>
            <span className="eyebrow">BÚSQUEDA EN INTERNET</span>
            <h2 id="new-song-dialog-title">Buscar letra</h2>
            <p>Indicá el título y, si lo conocés, el artista para mejorar los resultados.</p>
            <form
              className="lyrics-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <label>
                Título
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ej. Eres Todopoderoso"
                />
              </label>
              <label>
                Artista
                <input
                  value={artist}
                  onChange={(event) => setArtist(event.target.value)}
                  placeholder="Ej. Danilo Montero"
                />
              </label>
              <button className="primary lyrics-search-submit" disabled={!title.trim() || searching}>
                {searching ? <LoaderCircle className="spin" /> : <Search />}
                {searching ? "Buscando…" : "Buscar"}
              </button>
            </form>

            {error && <div className="lyrics-search-error">{error}</div>}
            <div className="lyrics-results-layout">
              <div className="lyrics-results-list" aria-label="Resultados de letras">
                {results.map((result) => (
                  <button
                    type="button"
                    className={selected?.externalId === result.externalId ? "selected" : ""}
                    onClick={() => setSelected(result)}
                    key={`${result.externalId}-${result.title}-${result.artist}`}
                  >
                    <Music2 />
                    <span>
                      <strong>{result.title}</strong>
                      <small>{result.artist}{result.album ? ` · ${result.album}` : ""}</small>
                    </span>
                    {result.duration > 0 && <time>{formatDuration(result.duration)}</time>}
                  </button>
                ))}
                {searched && !searching && !results.length && !error && (
                  <div className="lyrics-results-empty">
                    No encontramos coincidencias. Probá variando el título o el artista.
                  </div>
                )}
                {!searched && (
                  <div className="lyrics-results-empty">
                    Los resultados aparecerán aquí.
                  </div>
                )}
              </div>
              <div className="lyrics-result-preview">
                {selected ? (
                  <>
                    <div>
                      <strong>{selected.title}</strong>
                      <span>{selected.artist}</span>
                    </div>
                    <pre>{selected.lyrics}</pre>
                  </>
                ) : (
                  <div className="lyrics-preview-empty">Seleccioná un resultado para revisar su letra.</div>
                )}
              </div>
            </div>
            <div className="lyrics-search-footer">
              <small>Fuente: LRCLIB. Revisá la letra antes de guardarla.</small>
              <button type="button" onClick={onClose}>Cancelar</button>
              <button
                type="button"
                className="primary"
                disabled={!selected}
                onClick={() => selected && onImport(selected)}
              >
                Cargar en el editor
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
