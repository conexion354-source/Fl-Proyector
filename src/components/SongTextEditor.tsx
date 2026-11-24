import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  CaseUpper,
  FileUp,
  GripVertical,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Type,
  Undo2,
  X,
} from "lucide-react";
import type { Song, SongCategory, SongDisplaySettings } from "../../shared/types";
import {
  buildSongFromText,
  contentHasFormatting,
  parseSongText,
  resolveArrangement,
  songToText,
} from "../../shared/songText";

type Draft = {
  title: string;
  text: string;
  arrangement: string[];
  maxLines: number;
  categoryId: number | null;
  author: string;
  songKey: string;
  tags: string;
  copyright: string;
};

/** Texto inicial: la letra guardada si sigue igual a la canción, o la canción convertida. */
function initialDraft(song: Partial<Song>): Draft {
  let text = "";
  let arrangement: string[] = [];
  const maxLines = Number(song.maxLines ?? 0) || 0;
  const saved = song.lyrics?.trim();
  if (saved && buildSongFromText(saved, song.arrangement, maxLines).content === song.content) {
    text = saved;
    arrangement = song.arrangement ?? [];
  } else if (song.content && song.content.replace(/<[^>]+>/g, "").trim()) {
    ({ text, arrangement } = songToText(song.content, song.sectionTypes));
  }
  return {
    title: song.title || "",
    text,
    arrangement,
    maxLines: saved ? maxLines : 0,
    categoryId: song.categoryId ?? null,
    author: song.author ?? "",
    songKey: song.songKey ?? "",
    tags: song.tags ?? "",
    copyright: song.copyright ?? "",
  };
}

const sectionButtons = [
  { label: "Estrofa", tone: "verse" },
  { label: "Estribillo", tone: "chorus" },
  { label: "Pre-estribillo", tone: "bridge" },
  { label: "Puente", tone: "bridge" },
  { label: "Final", tone: "other" },
];

/**
 * Editor de canciones profesional: letra en texto con marcas de sección,
 * diapositivas generadas en vivo, orden de presentación y datos.
 */
export function SongTextEditor({
  song,
  categories,
  onSave,
  onCancel,
  onRichMode,
}: {
  song: Partial<Song>;
  categories: SongCategory[];
  onSave: (song: Partial<Song> & { title: string; content: string }) => Promise<void>;
  onCancel: () => void;
  onRichMode: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(song));
  const [style, setStyle] = useState<SongDisplaySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [focusedSlide, setFocusedSlide] = useState<number | null>(null);
  const [metaOpen, setMetaOpen] = useState(() => localStorage.getItem("fl-song-meta-open") !== "0");
  useEffect(() => {
    localStorage.setItem("fl-song-meta-open", metaOpen ? "1" : "0");
  }, [metaOpen]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const original = useRef(JSON.stringify(initialDraft(song)));
  const hadFormatting = useMemo(() => contentHasFormatting(song.content ?? ""), [song.content]);

  useEffect(() => {
    void window.flProyector.getSongDisplaySettings?.().then(setStyle).catch(() => {});
  }, []);

  const sections = useMemo(() => parseSongText(draft.text), [draft.text]);
  const order = useMemo(() => resolveArrangement(sections, draft.arrangement), [sections, draft.arrangement]);
  const built = useMemo(
    () => buildSongFromText(draft.text, draft.arrangement, draft.maxLines),
    [draft.text, draft.arrangement, draft.maxLines],
  );
  const dirty = JSON.stringify(draft) !== original.current;

  const set = (patch: Partial<Draft>) => setDraft((value) => ({ ...value, ...patch }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({
        ...song,
        title: draft.title.trim() || "Sin título",
        content: built.content || "<p></p>",
        sectionTypes: built.sectionTypes,
        lyrics: draft.text,
        arrangement: draft.arrangement.length ? order : [],
        maxLines: draft.maxLines,
        categoryId: draft.categoryId,
        author: draft.author.trim(),
        songKey: draft.songKey.trim(),
        tags: draft.tags.trim(),
        copyright: draft.copyright.trim(),
      });
      original.current = JSON.stringify(draft);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Reemplaza la selección del área de texto (conserva Ctrl+Z del sistema). */
  const insertText = (value: string, selectInserted = false) => {
    const area = textarea.current;
    if (!area) return;
    area.focus();
    const start = area.selectionStart;
    // execCommand mantiene el historial de deshacer del área de texto.
    const ok = document.execCommand?.("insertText", false, value);
    if (!ok) {
      const next = area.value.slice(0, start) + value + area.value.slice(area.selectionEnd);
      set({ text: next });
    }
    if (selectInserted)
      window.requestAnimationFrame(() => area.setSelectionRange(start, start + value.length));
  };

  const insertSection = (label: string) => {
    const area = textarea.current;
    if (!area) return;
    const before = area.value.slice(0, area.selectionStart);
    const existing = sections.filter((section) => section.name.toLowerCase().startsWith(label.toLowerCase())).length;
    const name = label === "Estrofa" ? `Estrofa ${existing + 1}` : existing ? `${label} ${existing + 1}` : label;
    const prefix = before.length && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    insertText(`${prefix}[${name}]\n`);
  };

  const splitHere = () => insertText("\n\n");

  const joinAround = () => {
    const area = textarea.current;
    if (!area) return;
    const value = area.value;
    const cursor = area.selectionStart;
    // Une la diapositiva actual con la siguiente: quita el próximo renglón en blanco.
    const rest = value.slice(cursor);
    const match = /\n[ \t]*\n+(?!\s*\[)/.exec(rest);
    if (!match) return;
    const start = cursor + match.index;
    area.setSelectionRange(start, start + match[0].length);
    insertText("\n");
  };

  const toUpper = () => {
    const area = textarea.current;
    if (!area) return;
    const { selectionStart, selectionEnd, value } = area;
    if (selectionStart === selectionEnd) {
      set({ text: value.toLocaleUpperCase("es-AR").replace(/\[([^\]]+)\]/g, (_m, name: string) => `[${name.charAt(0) + name.slice(1).toLocaleLowerCase("es-AR")}]`) });
      return;
    }
    insertText(value.slice(selectionStart, selectionEnd).toLocaleUpperCase("es-AR"), true);
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    set({ text: text.replace(/\r\n?/g, "\n").trim(), arrangement: [] });
    if (!draft.title.trim()) set({ title: file.name.replace(/\.[^.]+$/, "") });
  };

  /** Marca la diapositiva donde está el cursor. */
  const syncFocus = () => {
    const area = textarea.current;
    if (!area) return;
    const before = area.value.slice(0, area.selectionStart);
    const lineIndex = before.split("\n").length - 1;
    const lines = area.value.split("\n");
    let section = "";
    let slideInSection = -1;
    let inSlide = false;
    for (let index = 0; index <= lineIndex && index < lines.length; index += 1) {
      const heading = /^\s*\[([^\]]+)\]\s*$/.exec(lines[index]);
      if (heading) {
        section = heading[1].trim();
        slideInSection = -1;
        inSlide = false;
        continue;
      }
      if (lines[index].trim()) {
        if (!inSlide) slideInSection += 1;
        inSlide = true;
      } else inSlide = false;
    }
    const target = built.slides.findIndex((slide, index) => {
      if (slide.section !== section) return false;
      const position = built.slides.slice(0, index + 1).filter((value) => value.section === section).length - 1;
      return position === Math.max(0, slideInSection);
    });
    setFocusedSlide(target >= 0 ? target : null);
  };

  const warnings = useMemo(() => {
    const list: Array<{ slide: number; text: string }> = [];
    const multiLine = built.slides.some((slide) => slide.lines.length > 1);
    built.slides.forEach((slide, index) => {
      if (multiLine && slide.lines.length === 1)
        list.push({ slide: index, text: `La diapositiva ${index + 1} tiene un solo renglón.` });
      const longest = Math.max(...slide.lines.map((line) => line.length));
      if (longest > 44)
        list.push({ slide: index, text: `La diapositiva ${index + 1} tiene un renglón largo: se verá más chica.` });
      if (slide.lines.length > 6)
        list.push({ slide: index, text: `La diapositiva ${index + 1} tiene ${slide.lines.length} renglones: usá un máximo por diapositiva.` });
    });
    return list;
  }, [built.slides]);

  const moveChip = (from: number, to: number) => {
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    set({ arrangement: next });
  };

  const highlighted = useMemo(
    () =>
      draft.text
        .split("\n")
        .map((line) => {
          const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const heading = /^\s*\[([^\]]+)\]\s*$/.exec(line);
          if (!heading) return escaped;
          const type = parseSongText(`${line}\nx`)[0]?.type ?? "other";
          return `<span class="ste-mark ste-mark-${type}">${escaped}</span>`;
        })
        .join("\n") + "\n",
    [draft.text],
  );

  const slideFont = style?.fontFamily || "Segoe UI";
  const uppercase = style?.uppercase === true;

  return (
    <div className="ste">
      <div className="ste-header">
        <input
          className="ste-title"
          value={draft.title}
          placeholder="Título de la canción"
          aria-label="Título de la canción"
          onChange={(event) => set({ title: event.target.value })}
        />
        <button type="button" className="ste-link" onClick={onRichMode} title="Editar con negrita, colores y fuentes">
          Formato avanzado
        </button>
        <button type="button" onClick={onCancel}>
          <X aria-hidden="true" /> {dirty ? "Cancelar" : "Cerrar"}
        </button>
        <button type="button" className="ste-primary" onClick={() => void save()} disabled={saving || !dirty} title="Guardar (Ctrl+S)">
          <Save aria-hidden="true" /> {saving ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
        </button>
      </div>
      <div className="ste-toolbar" role="toolbar" aria-label="Herramientas de la letra">
        <button type="button" onClick={() => fileInput.current?.click()} title="Importar un archivo de texto (.txt)">
          <FileUp aria-hidden="true" /> Importar
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = "";
          }}
        />
        <span className="ste-sep" />
        {sectionButtons.map((button) => (
          <button
            type="button"
            key={button.label}
            className={`ste-section ste-tone-${button.tone}`}
            onClick={() => insertSection(button.label)}
            title={`Insertar [${button.label}] donde está el cursor`}
          >
            [{button.label}]
          </button>
        ))}
        <span className="ste-sep" />
        <button type="button" onClick={splitHere} title="Nueva diapositiva donde está el cursor">
          <Scissors aria-hidden="true" /> Dividir
        </button>
        <button type="button" onClick={joinAround} title="Unir con la diapositiva siguiente">
          <Type aria-hidden="true" /> Unir
        </button>
        <button type="button" onClick={toUpper} title="Pasar a mayúsculas (la selección o toda la letra)">
          <CaseUpper aria-hidden="true" /> Mayúsculas
        </button>
        <button type="button" onClick={() => { textarea.current?.focus(); document.execCommand?.("undo"); }} title="Deshacer (Ctrl+Z)">
          <Undo2 aria-hidden="true" />
        </button>
      </div>

      {hadFormatting && (
        <div className="ste-notice">
          <AlertTriangle aria-hidden="true" />
          Esta canción tiene formato (negrita, colores o fuentes). Si la guardás desde este editor queda solo el texto; para conservarlo usá "Formato avanzado".
        </div>
      )}

      <div className="ste-columns">
        <section className="ste-pane ste-lyrics" aria-label="Letra">
          <header>
            <b>Letra</b>
            <small>[Sección] abre una parte · línea en blanco = nueva diapositiva</small>
          </header>
          <div className="ste-code">
            <pre ref={highlight} aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlighted }} />
            <textarea
              ref={textarea}
              value={draft.text}
              spellCheck
              lang="es"
              placeholder={"[Estrofa 1]\nEscribí o pegá la letra acá…\n\n[Estribillo]\n…"}
              onChange={(event) => set({ text: event.target.value })}
              onScroll={(event) => {
                if (highlight.current) {
                  highlight.current.scrollTop = event.currentTarget.scrollTop;
                  highlight.current.scrollLeft = event.currentTarget.scrollLeft;
                }
              }}
              onKeyUp={syncFocus}
              onClick={syncFocus}
              aria-label="Letra de la canción"
            />
          </div>
        </section>

        <section className="ste-pane ste-slides" aria-label="Diapositivas">
          <header>
            <b>Diapositivas</b>
            <small>{built.slides.length} {built.slides.length === 1 ? "diapositiva" : "diapositivas"} · como se verán</small>
          </header>
          <div className="ste-slide-grid">
            {built.slides.length === 0 && <p className="ste-empty">Escribí la letra a la izquierda y las diapositivas aparecen acá.</p>}
            {built.slides.map((slide, index) => {
              const longest = Math.max(1, ...slide.lines.map((line) => line.length));
              const size = Math.min(90 / (longest * 0.55), 50 / (slide.lines.length * 1.3), 9);
              const warned = warnings.some((warning) => warning.slide === index);
              return (
                <figure
                  key={index}
                  className={`ste-slide ${focusedSlide === index ? "is-focused" : ""} ${warned ? "is-warned" : ""}`}
                  data-type={slide.type}
                >
                  <div className="ste-screen" style={{ "--ste-size": `${size}cqw`, fontFamily: slideFont } as CSSProperties}>
                    <span style={{ textTransform: uppercase ? "uppercase" : "none" }}>
                      {slide.lines.map((line, lineIndex) => (
                        <span key={lineIndex}>{line}</span>
                      ))}
                    </span>
                  </div>
                  <figcaption>
                    <span>{index + 1}</span>
                    <b>{slide.section}</b>
                  </figcaption>
                </figure>
              );
            })}
          </div>
          {warnings.length > 0 && (
            <ul className="ste-warnings">
              {warnings.slice(0, 4).map((warning, index) => (
                <li key={index}>
                  <AlertTriangle aria-hidden="true" /> {warning.text}
                </li>
              ))}
            </ul>
          )}
          <div className="ste-order">
            <header>
              <b>Orden de presentación</b>
              <small>Arrastrá para reordenar · repetí partes sin escribirlas de nuevo</small>
              {draft.arrangement.length > 0 && (
                <button type="button" className="ste-link" onClick={() => set({ arrangement: [] })}>
                  <RotateCcw aria-hidden="true" /> Orden original
                </button>
              )}
            </header>
            <div className="ste-chips">
              {order.map((name, index) => {
                const type = sections.find((section) => section.name === name)?.type ?? "other";
                return (
                  <span
                    key={`${name}-${index}`}
                    className={`ste-chip ste-tone-${type} ${dragIndex === index ? "is-dragging" : ""}`}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragEnd={() => setDragIndex(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== index) moveChip(dragIndex, index);
                      setDragIndex(null);
                    }}
                  >
                    <GripVertical aria-hidden="true" />
                    {name}
                    <button
                      type="button"
                      aria-label={`Quitar ${name} del orden`}
                      disabled={order.length <= 1}
                      onClick={() => set({ arrangement: order.filter((_, position) => position !== index) })}
                    >
                      <X />
                    </button>
                  </span>
                );
              })}
              {sections.length > 0 && (
                <label className="ste-chip-add">
                  <Plus aria-hidden="true" />
                  <select
                    aria-label="Agregar una parte al orden"
                    value=""
                    onChange={(event) => {
                      if (event.target.value) set({ arrangement: [...order, event.target.value] });
                    }}
                  >
                    <option value="">Agregar parte</option>
                    {sections.map((section) => (
                      <option key={section.name} value={section.name}>
                        {section.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </section>

        <aside className={`ste-pane ste-meta ${metaOpen ? "is-open" : ""}`} aria-label="Datos de la canción">
          <header>
            <button type="button" className="ste-meta-toggle" aria-expanded={metaOpen} onClick={() => setMetaOpen((value) => !value)}>
              <b>Datos de la canción</b>
              <small>{[draft.author, draft.songKey && `Tono ${draft.songKey}`, draft.tags].filter(Boolean).join(" · ") || "Autor, tono, etiquetas…"}</small>
            </button>
          </header>
          <label>
            <span>Categoría</span>
            <select
              value={draft.categoryId ?? ""}
              onChange={(event) => set({ categoryId: event.target.value ? Number(event.target.value) : null })}
            >
              <option value="">Sin categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Autor</span>
            <input value={draft.author} onChange={(event) => set({ author: event.target.value })} />
          </label>
          <label>
            <span>Tono</span>
            <input value={draft.songKey} placeholder="Sol, Re, La…" onChange={(event) => set({ songKey: event.target.value })} />
          </label>
          <label>
            <span>Etiquetas</span>
            <input value={draft.tags} placeholder="lenta, cena, navidad" onChange={(event) => set({ tags: event.target.value })} />
            <small>Sirven para buscar la canción.</small>
          </label>
          <label>
            <span>Copyright / CCLI</span>
            <input value={draft.copyright} onChange={(event) => set({ copyright: event.target.value })} />
          </label>
          <label>
            <span title="Máximo de renglones por diapositiva">Renglones por diapositiva</span>
            <select value={draft.maxLines} onChange={(event) => set({ maxLines: Number(event.target.value) })}>
              <option value={0}>Sin límite</option>
              {[2, 3, 4, 5, 6, 8].map((value) => (
                <option key={value} value={value}>
                  {value} renglones
                </option>
              ))}
            </select>
            <small>Las partes más largas se dividen solas, en partes parejas.</small>
          </label>
        </aside>
      </div>
    </div>
  );
}
