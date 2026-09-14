import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, Highlighter, Search, X } from "lucide-react";
import type {
  BibleBook,
  BibleVerse,
  BibleVersion,
  ProjectionPatch,
  ProjectionState,
} from "../../shared/types";
import { buildBibleSlides, type BibleSlide } from "../bibleDisplay";

const bibleOperatorStorageKey = "fl-bible-operator-position";
const highlightColors = ["#fff176", "#a7f3d0", "#bfdbfe", "#fbcfe8", "#fed7aa"];

type BibleOperatorPosition = {
  versionId: number;
  book: string;
  chapter: number;
  activeVerse: string;
  activeSlide: number;
};

function loadBiblePosition(): BibleOperatorPosition {
  try {
    const saved = JSON.parse(
      localStorage.getItem(bibleOperatorStorageKey) || "{}",
    ) as Partial<BibleOperatorPosition>;
    return {
      versionId: Number(saved.versionId) || 0,
      book: typeof saved.book === "string" ? saved.book : "",
      chapter: Math.max(1, Number(saved.chapter) || 1),
      activeVerse:
        typeof saved.activeVerse === "string" ? saved.activeVerse : "",
      activeSlide: Math.max(0, Number(saved.activeSlide) || 0),
    };
  } catch {
    return { versionId: 0, book: "", chapter: 1, activeVerse: "", activeSlide: 0 };
  }
}

function normalizeBookSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function BibleBookPicker({
  books,
  value,
  onChange,
}: {
  books: BibleBook[];
  value: string;
  onChange: (book: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filteredBooks = books.filter((item) =>
    normalizeBookSearch(item.book).includes(normalizeBookSearch(search.trim())),
  );

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (nextBook: string) => {
    onChange(nextBook);
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="bible-book-picker" ref={root}>
      <button
        type="button"
        className={`bible-book-trigger ${open ? "open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value || "Elegir libro"}</span>
        <Search className="book-search-icon" aria-hidden="true" />
        <ChevronDown className="book-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="bible-book-popover">
          <div className="bible-book-search">
            <Search aria-hidden="true" />
            <input
              ref={input}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key === "Enter" && filteredBooks[0])
                  choose(filteredBooks[0].book);
              }}
              placeholder="Buscar libro..."
              aria-label="Buscar libro de la Biblia"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpiar búsqueda"
              >
                <X aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="bible-book-options" role="listbox">
            {filteredBooks.map((item) => (
              <button
                type="button"
                role="option"
                aria-selected={item.book === value}
                className={item.book === value ? "selected" : ""}
                key={item.book}
                onClick={() => choose(item.book)}
              >
                {item.book}
              </button>
            ))}
            {!filteredBooks.length && (
              <span className="bible-book-empty">No encontramos ese libro</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function BibleOperator({
  state,
  update,
}: {
  state: ProjectionState;
  update: (patch: ProjectionPatch) => void;
}) {
  const savedPosition = useRef(loadBiblePosition());
  const suppressVerseClick = useRef(false);
  const restorePending = useRef(Boolean(savedPosition.current.activeVerse));
  const [versions, setVersions] = useState<BibleVersion[]>([]),
    [versionId, setVersionId] = useState(savedPosition.current.versionId);
  const [books, setBooks] = useState<BibleBook[]>([]),
    [book, setBook] = useState(savedPosition.current.book),
    [chapter, setChapter] = useState(savedPosition.current.chapter);
  const [verses, setVerses] = useState<BibleVerse[]>([]),
    [activeVerse, setActiveVerse] = useState(savedPosition.current.activeVerse),
    [query, setQuery] = useState(""),
    [verseFilter, setVerseFilter] = useState("");
  const [activeSlides, setActiveSlides] = useState<BibleSlide[]>([]),
    [activeSlide, setActiveSlide] = useState(savedPosition.current.activeSlide);
  const [highlightSelection, setHighlightSelection] = useState<{
    source: "verse" | "slide";
    verse?: BibleVerse;
    slideIndex?: number;
    text: string;
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    window.flProyector.listBibleVersions().then((items) => {
      const enabled = items.filter((item) => item.enabled !== false);
      setVersions(enabled);
      setVersionId((current) =>
        enabled.some((item) => item.id === current) ? current : (enabled[0]?.id ?? 0),
      );
    });
  }, []);
  useEffect(() => {
    if (versionId)
      window.flProyector.listBibleBooks(versionId).then((items) => {
        setBooks(items);
        const currentBook = items.find((item) => item.book === book);
        const fallback =
          items.find((item) => item.book === "Juan") ?? items[0];
        const nextBook = currentBook ?? fallback;
        setBook(nextBook?.book ?? "");
        setChapter((current) =>
          Math.min(
            Math.max(1, currentBook ? current : nextBook?.book === "Juan" ? 3 : 1),
            nextBook?.chapters ?? 1,
          ),
        );
      });
  }, [versionId]);
  useEffect(() => {
    if (versionId && book)
      window.flProyector
        .listBibleVerses(versionId, book, chapter)
        .then((items) => {
          setVerses(items);
          const restoredVerse = restorePending.current
            ? items.find((verse) => verseKey(verse) === activeVerse)
            : undefined;
          if (restoredVerse) {
            const version = versions.find((value) => value.id === versionId)?.code || "";
            const slides = buildBibleSlides(
              restoredVerse.text,
              `${restoredVerse.book} ${restoredVerse.chapter}:${restoredVerse.verse}`,
              version,
              state.bibleStyle,
              state.outputViewport,
            );
            const slide = Math.min(savedPosition.current.activeSlide, slides.length - 1);
            setActiveSlides(slides);
            setActiveSlide(Math.max(0, slide));
          } else {
            setActiveVerse("");
            setActiveSlides([]);
            setActiveSlide(0);
          }
          restorePending.current = false;
        });
  }, [versionId, book, chapter]);
  useEffect(() => {
    if (!query.trim()) {
      if (versionId && book)
        window.flProyector
          .listBibleVerses(versionId, book, chapter)
          .then(setVerses);
      return;
    }
    const timer = setTimeout(
      () => window.flProyector.searchBible(versionId, query).then(setVerses),
      180,
    );
    return () => clearTimeout(timer);
  }, [query, versionId, book, chapter]);
  const maxChapters = books.find((value) => value.book === book)?.chapters ?? 1;
  const verseKey = (verse: BibleVerse) =>
    `${verse.book}-${verse.chapter}-${verse.verse}`;
  const displayedVerses = verseFilter
    ? verses.filter((verse) => String(verse.verse) === verseFilter)
    : verses;
  const projectSlide = (slides: BibleSlide[], index: number) => {
    const safe = Math.max(0, Math.min(index, slides.length - 1)),
      slide = slides[safe];
    if (!slide) return;
    setActiveSlide(safe);
    update({
      blackout: false,
      logo: false,
      presentation: { visible: false },
      lowerThird: { visible: false },
      text: {
        html: slide.html,
        fontSize:
          state.bibleStyle.longVerseMode === "auto-fit"
            ? state.bibleStyle.textFontSize
            : slide.fontSize,
        fontFamily: state.bibleStyle.textFontFamily,
        color: state.bibleStyle.textColor,
        shadowEnabled: state.bibleStyle.textShadowEnabled,
        shadowColor: state.bibleStyle.textShadowColor,
        shadowBlur: state.bibleStyle.textShadowBlur,
        kind: "biblia",
        visible: true,
        position: "center",
        align: "center",
        backgroundColor: "rgba(0,0,0,0)",
        borderRadius: 0,
        template: "plain",
      },
    });
  };
  const send = (verse: BibleVerse) => {
    const reference = `${verse.book} ${verse.chapter}:${verse.verse}`,
      version = versions.find((value) => value.id === versionId)?.code || "";
    const slides = buildBibleSlides(
      verse.text,
      reference,
      version,
      state.bibleStyle,
      state.outputViewport,
    );
    setActiveVerse(verseKey(verse));
    setActiveSlides(slides);
    projectSlide(slides, 0);
  };
  useEffect(() => {
    if (!activeVerse) return;
    const verse = verses.find((candidate) => verseKey(candidate) === activeVerse);
    if (!verse) return;
    const version = versions.find((value) => value.id === versionId)?.code || "";
    const slides = buildBibleSlides(
      verse.text,
      `${verse.book} ${verse.chapter}:${verse.verse}`,
      version,
      state.bibleStyle,
      state.outputViewport,
    );
    const nextSlide = Math.min(activeSlide, Math.max(0, slides.length - 1));
    setActiveSlides(slides);
    projectSlide(slides, nextSlide);
  }, [
    state.outputViewport.width,
    state.outputViewport.height,
    state.bibleStyle.textFontSize,
    state.bibleStyle.textFontFamily,
    state.bibleStyle.uppercase,
    state.bibleStyle.referenceFontSize,
    state.bibleStyle.showReference,
    state.bibleStyle.showVersion,
    state.bibleStyle.referencePosition,
    state.bibleStyle.horizontalMargin,
    state.bibleStyle.verticalMargin,
    state.bibleStyle.maxLinesPerSlide,
    state.bibleStyle.longVerseMode,
  ]);
  const selectPhrase = (verse: BibleVerse, host: HTMLElement) => {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, " ").trim() || "";
    if (!text || !verse.text.includes(text)) return;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !host.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    suppressVerseClick.current = true;
    setHighlightSelection({
      source: "verse",
      verse,
      text,
      left: Math.max(12, Math.min(window.innerWidth - 250, rect.left)),
      top: Math.min(window.innerHeight - 74, rect.bottom + 8),
    });
  };
  const selectSlidePhrase = (slideIndex: number, host: HTMLElement) => {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, " ").trim() || "";
    if (!text) return;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !host.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    suppressVerseClick.current = true;
    setHighlightSelection({
      source: "slide",
      slideIndex,
      text,
      left: Math.max(12, Math.min(window.innerWidth - 250, rect.left)),
      top: Math.min(window.innerHeight - 74, rect.bottom + 8),
    });
  };
  const highlightPhrase = (color: string) => {
    const selected = highlightSelection;
    if (!selected) return;
    const escapedText = selected.text.replace(/[&<>'"]/g, (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character]!,
    );
    const markedText = `<mark style="background:${color};color:#111827;padding:.04em .12em;border-radius:.12em">${escapedText}</mark>`;
    if (selected.source === "slide" && selected.slideIndex !== undefined) {
      const slides = activeSlides.map((slide, index) =>
        index === selected.slideIndex
          ? {
              ...slide,
              html: slide.html.replace(escapedText, markedText),
              contentHtml: slide.contentHtml.replace(escapedText, markedText),
            }
          : slide,
      );
      setActiveSlides(slides);
      projectSlide(slides, selected.slideIndex);
      window.getSelection()?.removeAllRanges();
      setHighlightSelection(null);
      return;
    }
    if (!selected.verse) return;
    const version = versions.find((value) => value.id === versionId)?.code || "";
    const slides = buildBibleSlides(
      selected.verse.text,
      `${selected.verse.book} ${selected.verse.chapter}:${selected.verse.verse}`,
      version,
      state.bibleStyle,
      state.outputViewport,
    ).map((slide) => ({
      ...slide,
      html: slide.html.replace(escapedText, markedText),
      contentHtml: slide.contentHtml.replace(escapedText, markedText),
    }));
    setActiveVerse(verseKey(selected.verse));
    setActiveSlides(slides);
    projectSlide(slides, 0);
    window.getSelection()?.removeAllRanges();
    setHighlightSelection(null);
  };
  useEffect(() => {
    localStorage.setItem(
      bibleOperatorStorageKey,
      JSON.stringify({ versionId, book, chapter, activeVerse, activeSlide }),
    );
  }, [versionId, book, chapter, activeVerse, activeSlide]);
  useEffect(() => {
    if (!activeVerse) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(".verse-list > button.selected")
        ?.scrollIntoView({ block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [activeVerse, verses]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          event.key,
        ) ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName || "") ||
        target?.isContentEditable
      )
        return;

      const direction = ["ArrowDown", "ArrowRight"].includes(event.key)
        ? 1
        : -1;
      event.preventDefault();

      if (!activeSlides.length) {
        const firstVerse = direction > 0
          ? displayedVerses[0]
          : displayedVerses[displayedVerses.length - 1];
        if (firstVerse) send(firstVerse);
        return;
      }

      const nextSlide = activeSlide + direction;
      if (nextSlide >= 0 && nextSlide < activeSlides.length) {
        projectSlide(activeSlides, nextSlide);
        return;
      }

      const verseIndex = displayedVerses.findIndex(
        (verse) => verseKey(verse) === activeVerse,
      );
      const nextVerse = displayedVerses[verseIndex + direction];
      if (!nextVerse) return;

      if (direction > 0) {
        send(nextVerse);
        return;
      }

      const version =
        versions.find((value) => value.id === versionId)?.code || "";
      const previousSlides = buildBibleSlides(
        nextVerse.text,
        `${nextVerse.book} ${nextVerse.chapter}:${nextVerse.verse}`,
        version,
        state.bibleStyle,
        state.outputViewport,
      );
      setActiveVerse(verseKey(nextVerse));
      setActiveSlides(previousSlides);
      projectSlide(previousSlides, previousSlides.length - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeSlides,
    activeSlide,
    activeVerse,
    displayedVerses,
    state.bibleStyle,
    state.outputViewport,
    versionId,
    versions,
  ]);

  return (
    <section className="bible-page">
      <div className="section-title">
        <div>
          <span className="eyebrow">OPERADOR BÍBLICO OFFLINE</span>
          <h2>Biblia</h2>
        </div>
      </div>
      <div className="bible-toolbar">
        <label>
          Versión
          <select
            value={versionId}
            onChange={(e) => setVersionId(Number(e.target.value))}
          >
            {versions.map((version) => (
              <option value={version.id} key={version.id}>
                {version.name}
              </option>
            ))}
          </select>
        </label>
        <div className="bible-book-field">
          <span>Libro</span>
          <BibleBookPicker
            books={books}
            value={book}
            onChange={(nextBook) => {
              setBook(nextBook);
              setChapter(1);
              setQuery("");
              setVerseFilter("");
            }}
          />
        </div>
        <label>
          Capítulo
          <select
            value={chapter}
            onChange={(e) => {
              setChapter(Number(e.target.value));
              setQuery("");
              setVerseFilter("");
            }}
          >
            {Array.from({ length: maxChapters }, (_, index) => (
              <option key={index + 1}>{index + 1}</option>
            ))}
          </select>
        </label>
        <label>
          Versículo
          <select
            value={verseFilter}
            onChange={(e) => setVerseFilter(e.target.value)}
          >
            <option value="">Todos</option>
            {verses.map((verse) => (
              <option value={verse.verse} key={verseKey(verse)}>
                {verse.verse}
              </option>
            ))}
          </select>
        </label>
        <div className="bible-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar palabras o una frase..."
          />
        </div>
      </div>
      <div className="bible-workspace">
        <section className="bible-verse-column">
          <div className="bible-column-heading">
            <div>
              <span>VERSÍCULOS CARGADOS</span>
              <strong>{displayedVerses.length}</strong>
            </div>
            <small>Un clic envía el primero</small>
          </div>
          <div className="verse-list">
            {displayedVerses.map((verse) => {
              const key = verseKey(verse);
              return (
                <button
                  className={activeVerse === key ? "selected" : ""}
                  onMouseUp={(event) => selectPhrase(verse, event.currentTarget)}
                  onTouchEnd={(event) =>
                    window.setTimeout(
                      () => selectPhrase(verse, event.currentTarget),
                      0,
                    )
                  }
                  onClick={() => {
                    if (suppressVerseClick.current) {
                      suppressVerseClick.current = false;
                      return;
                    }
                    send(verse);
                  }}
                  key={key}
                >
                  <b>
                    {verse.book} {verse.chapter}:{verse.verse}
                  </b>
                  <span>{verse.text}</span>
                </button>
              );
            })}
            {!displayedVerses.length && (
              <div className="empty-state">
                <BookOpen />
                <strong>Sin resultados</strong>
              </div>
            )}
          </div>
        </section>
        <section className="bible-slide-column">
          <div className="bible-column-heading">
            <div>
              <span>CONTENIDO A PROYECTAR</span>
              <strong>{activeSlides.length || "—"}</strong>
            </div>
            <small>
              {state.bibleStyle.longVerseMode === "auto-fit"
                ? "Tamaño automático"
                : "División A / B activa"}
            </small>
          </div>
          <div className="bible-slide-list">
            {activeSlides.map((slide, index) => (
              <button
                className={activeSlide === index ? "selected" : ""}
                onClick={() => {
                  if (suppressVerseClick.current) {
                    suppressVerseClick.current = false;
                    return;
                  }
                  projectSlide(activeSlides, index);
                }}
                key={slide.label}
              >
                <b>{slide.label}</b>
                <div
                  className="bible-slide-content"
                  onMouseUp={(event) =>
                    selectSlidePhrase(index, event.currentTarget)
                  }
                  onTouchEnd={(event) =>
                    window.setTimeout(
                      () => selectSlidePhrase(index, event.currentTarget),
                      0,
                    )
                  }
                  dangerouslySetInnerHTML={{ __html: slide.contentHtml }}
                />
              </button>
            ))}
            {!activeSlides.length && (
              <div className="bible-slide-empty">
                <BookOpen />
                <strong>Elegí un versículo</strong>
                <span>
                  Aquí podrás elegir cada parte A/B cuando el versículo se
                  divida.
                </span>
              </div>
            )}
          </div>
        </section>
      </div>
      {highlightSelection && (
        <div
          className="bible-highlight-picker"
          style={{ left: highlightSelection.left, top: highlightSelection.top }}
          role="dialog"
          aria-label="Resaltar texto bíblico"
        >
          <Highlighter size={15} />
          <span>Resaltar</span>
          {highlightColors.map((color) => (
            <button
              key={color}
              aria-label={`Resaltar con ${color}`}
              style={{ background: color }}
              onClick={() => highlightPhrase(color)}
            />
          ))}
          <button className="highlight-close" onClick={() => setHighlightSelection(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </section>
  );
}
