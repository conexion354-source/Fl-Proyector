import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Music2, Search } from "lucide-react";
import type { Song } from "../../shared/types";

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void | Promise<void>;
};

type Entry = {
  id: string;
  group: string;
  label: string;
  detail?: string;
  hint?: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
};

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Búsqueda global (Ctrl+K): acciones en vivo, canciones y Biblia desde
 * cualquier pantalla. Flechas para elegir, Enter para ejecutar, Esc cierra.
 */
export function CommandPalette({
  open,
  onClose,
  actions,
  onOpenSong,
  onBibleSearch,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  onOpenSong: (song: Song) => void;
  onBibleSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    window.setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const found = await window.flProyector.listSongs(query.trim(), null);
        if (active) setSongs(found.slice(0, 6));
      } catch {
        if (active) setSongs([]);
      }
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const entries = useMemo<Entry[]>(() => {
    const needle = normalize(query.trim());
    const matchedActions = actions
      .filter((action) => !needle || normalize(`${action.label} ${action.keywords ?? ""}`).includes(needle))
      .map((action) => ({ ...action, group: "Acciones" }));
    const songEntries: Entry[] = songs.map((song) => ({
      id: `song-${song.id}`,
      group: "Canciones",
      label: song.title,
      detail: song.categoryName || "Sin categoría",
      icon: <Music2 />,
      run: () => onOpenSong(song),
    }));
    const bible: Entry[] = query.trim()
      ? [
          {
            id: "bible",
            group: "Biblia",
            label: `Buscar «${query.trim()}» en la Biblia`,
            detail: "Referencia (Juan 3:16) o palabras",
            icon: <BookOpen />,
            run: () => onBibleSearch(query.trim()),
          },
        ]
      : [];
    return needle
      ? [...songEntries, ...bible, ...matchedActions]
      : [...matchedActions, ...songEntries];
  }, [actions, songs, query, onOpenSong, onBibleSearch]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  const run = async (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    await entry.run();
  };

  let lastGroup = "";
  return (
    <div
      className="modal-backdrop command-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Buscar">
        <label className="command-input">
          <Search aria-hidden="true" />
          <input
            ref={input}
            value={query}
            placeholder="Buscar canción, versículo o acción"
            aria-label="Buscar canción, versículo o acción"
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => Math.min(current + 1, entries.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                void run(entries[index]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="command-results" ref={list} role="listbox">
          {entries.length === 0 ? (
            <p className="command-empty">Sin resultados para «{query}».</p>
          ) : (
            entries.map((entry, position) => {
              const header = entry.group !== lastGroup ? entry.group : null;
              lastGroup = entry.group;
              return (
                <div key={entry.id}>
                  {header && <div className="command-group">{header}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={position === index}
                    data-index={position}
                    className={position === index ? "active" : ""}
                    onMouseMove={() => setIndex(position)}
                    onClick={() => void run(entry)}
                  >
                    <span className="command-icon">{entry.icon ?? <Search />}</span>
                    <span className="command-label">
                      {entry.label}
                      {entry.detail && <small>{entry.detail}</small>}
                    </span>
                    {entry.hint && <kbd>{entry.hint}</kbd>}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <footer className="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> elegir</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> cerrar</span>
        </footer>
      </div>
    </div>
  );
}
