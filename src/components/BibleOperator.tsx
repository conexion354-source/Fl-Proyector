import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Highlighter, Pencil, Search, Trash2, X } from "lucide-react";
import type {
  BibleBook,
  BibleVerse,
  BibleVersion,
  ProjectionPatch,
  ProjectionState,
} from "../../shared/types";
import { buildBibleSlides, type BibleSlide } from "../bibleDisplay";
import {
  bibleSplitOverrideKey,
  shouldSplitBibleVerse,
  splitBibleVerse,
} from "../../shared/bibleLayout";

const bibleOperatorStorageKey = "fl-bible-operator-position";
const highlightColors = ["#fff176", "#a7f3d0", "#bfdbfe", "#fbcfe8", "#fed7aa"];

type BibleOperatorPosition = {
  versionId: number;
  book: string;
  chapter: number;
  activeVerse: string;
  activeSlide: number;
};

type BibleHistoryEntry = {
  id: number;
  verse: BibleVerse;
  slides: BibleSlide[];
  slideIndex: number;
};

// Deliberately in memory only: this survives moving to another app tab during
// the service, but disappears as soon as FL Proyector is closed or reloaded.
let sessionBibleHistory: BibleHistoryEntry[] = [];
let sessionBibleHistorySequence = 0;

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

export function BibleOperator({
  state,
  update,
  projectionFrozen,
}: {
  state: ProjectionState;
  update: (patch: ProjectionPatch) => void;
  projectionFrozen: boolean;
}) {
  const savedPosition = useRef(loadBiblePosition());
  const suppressVerseClick = useRef(false);
  const restorePending = useRef(Boolean(savedPosition.current.activeVerse));
  const versionSelectRef = useRef<HTMLSelectElement>(null);
  const bookSelectRef = useRef<HTMLSelectElement>(null);
  const chapterSelectRef = useRef<HTMLSelectElement>(null);
  const verseSelectRef = useRef<HTMLSelectElement>(null);
  const verseListRef = useRef<HTMLDivElement>(null);
  const pendingFrozenHistory = useRef<BibleHistoryEntry | null>(null);
  const previousFrozen = useRef(projectionFrozen);
  const [versions, setVersions] = useState<BibleVersion[]>([]),
    [versionId, setVersionId] = useState(savedPosition.current.versionId);
  const [books, setBooks] = useState<BibleBook[]>([]),
    [book, setBook] = useState(savedPosition.current.book),
    [chapter, setChapter] = useState(savedPosition.current.chapter);
  const [verses, setVerses] = useState<BibleVerse[]>([]),
    [activeVerse, setActiveVerse] = useState(savedPosition.current.activeVerse),
    [query, setQuery] = useState(""),
    [focusedVerse, setFocusedVerse] = useState("");
  const [activeSlides, setActiveSlides] = useState<BibleSlide[]>([]),
    [activeSlide, setActiveSlide] = useState(savedPosition.current.activeSlide);
  const [history, setHistory] = useState<BibleHistoryEntry[]>(
    () => sessionBibleHistory,
  );
  const [splitOverrides, setSplitOverrides] = useState<Record<string, number>>({});
  const [splitEditor, setSplitEditor] = useState<{
    verse: BibleVerse;
    splitAt: number;
    automaticSplitAt: number;
  } | null>(null);
  const [highlightSelection, setHighlightSelection] = useState<{
    source: "verse" | "slide";
    verse?: BibleVerse;
    slideIndex?: number;
    text: string;
    left: number;
    top: number;
  } | null>(null);
  // Entering the Bible tab starts the keyboard route at Version, so arrows
  // can be used immediately without an extra mouse click.
  useEffect(() => {
    const frame = requestAnimationFrame(() => versionSelectRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
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
    window.flProyector.getBibleSplitOverrides().then(setSplitOverrides);
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
              { mode: "full" },
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
  // Choosing a verse is navigation, not a filter. Keep the complete chapter
  // visible so the operator retains surrounding context.
  const displayedVerses = verses;
  const versionCode = versions.find((value) => value.id === versionId)?.code || "";
  const slidesFor = useCallback((verse: BibleVerse, mode: "full" | "split" = "full") => {
    const splitAtWord = splitOverrides[
      bibleSplitOverrideKey(versionCode, verse.book, verse.chapter, verse.verse)
    ];
    return buildBibleSlides(
      verse.text,
      `${verse.book} ${verse.chapter}:${verse.verse}`,
      versionCode,
      state.bibleStyle,
      state.outputViewport,
      { mode, splitAtWord },
    );
  }, [splitOverrides, state.bibleStyle, state.outputViewport, versionCode]);
  // The complete verse is always the main action. A/B appears only as an
  // optional, deliberate choice when the configured projection needs it.
  const verseChoices = useMemo(
    () =>
      displayedVerses.map((verse) => {
        const recommendedSplit =
          state.bibleStyle.longVerseMode !== "auto-fit" &&
          shouldSplitBibleVerse(verse.text, state.bibleStyle, state.outputViewport);
        return {
          verse,
          fullSlide: slidesFor(verse, "full")[0],
          splitSlides: recommendedSplit ? slidesFor(verse, "split") : [],
        };
      }),
    [displayedVerses, slidesFor, state.bibleStyle, state.outputViewport],
  );
  const addToHistory = useCallback((entry: Omit<BibleHistoryEntry, "id">) => {
    setHistory((entries) => {
      const next = [
        { id: ++sessionBibleHistorySequence, ...entry },
        ...entries,
      ].slice(0, 40);
      sessionBibleHistory = next;
      return next;
    });
  }, []);
  const rememberProjection = useCallback((entry: Omit<BibleHistoryEntry, "id">) => {
    if (projectionFrozen) {
      // The screen remains frozen; only the final prepared passage matters.
      pendingFrozenHistory.current = { id: 0, ...entry };
      return;
    }
    addToHistory(entry);
  }, [addToHistory, projectionFrozen]);
  useEffect(() => {
    if (previousFrozen.current && !projectionFrozen && pendingFrozenHistory.current) {
      const { id: _id, ...entry } = pendingFrozenHistory.current;
      pendingFrozenHistory.current = null;
      addToHistory(entry);
    }
    previousFrozen.current = projectionFrozen;
  }, [addToHistory, projectionFrozen]);
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
        sourceBibleText: slide.sourceText,
        sourceBibleReference: slide.reference,
        sourceBibleVersion: slide.version,
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
  const send = (verse: BibleVerse, mode: "full" | "split" = "full", requestedSlide = 0) => {
    const slides = slidesFor(verse, mode);
    const safeSlide = Math.max(0, Math.min(requestedSlide, slides.length - 1));
    setActiveVerse(verseKey(verse));
    setActiveSlides(slides);
    projectSlide(slides, safeSlide);
    rememberProjection({ verse, slides, slideIndex: safeSlide });
    // Once projected, the arrows belong to verse/slide navigation rather than
    // to the native selector, so an operator can continue without the mouse.
    requestAnimationFrame(() => verseListRef.current?.focus());
  };
  useEffect(() => {
    if (!activeVerse) return;
    const verse = verses.find((candidate) => verseKey(candidate) === activeVerse);
    if (!verse) return;
    const slides = slidesFor(verse, activeSlides.length > 1 ? "split" : "full");
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
    splitOverrides,
    slidesFor,
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
    // Keep the configured Bible text colour. The old hard-coded dark colour
    // made highlighted words black even on a white projection design.
    const markedText = `<mark style="background:${color};color:inherit;text-shadow:inherit;padding:.04em .12em;border-radius:.12em">${escapedText}</mark>`;
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
    const slides = slidesFor(selected.verse, "full").map((slide) => ({
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
  const openSplitEditor = (verse: BibleVerse) => {
    const automaticParts = splitBibleVerse(
      verse.text,
      state.bibleStyle,
      state.outputViewport,
    );
    const automaticSplitAt = automaticParts[0]?.trim().split(/\s+/).filter(Boolean).length ||
      Math.ceil(verse.text.trim().split(/\s+/).length / 2);
    const saved = splitOverrides[
      bibleSplitOverrideKey(versionCode, verse.book, verse.chapter, verse.verse)
    ];
    setSplitEditor({ verse, splitAt: saved || automaticSplitAt, automaticSplitAt });
  };
  const saveSplitEditor = async () => {
    if (!splitEditor) return;
    const key = bibleSplitOverrideKey(
      versionCode,
      splitEditor.verse.book,
      splitEditor.verse.chapter,
      splitEditor.verse.verse,
    );
    const next = { ...splitOverrides, [key]: splitEditor.splitAt };
    setSplitOverrides(next);
    await window.flProyector.saveBibleSplitOverrides(next);
    setSplitEditor(null);
  };
  useEffect(() => {
    const focusedKey = focusedVerse || activeVerse;
    if (!focusedKey) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          ".verse-list > button.focused, .verse-list > button.selected",
        )
        ?.scrollIntoView({ block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [activeVerse, focusedVerse, verses]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !event.isTrusted ||
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
        const currentVerse = displayedVerses.find(
          (verse) => verseKey(verse) === activeVerse,
        );
        if (currentVerse)
          rememberProjection({
            verse: currentVerse,
            slides: activeSlides,
            slideIndex: nextSlide,
          });
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

      const previousSlides = slidesFor(nextVerse, "full");
      setActiveVerse(verseKey(nextVerse));
      setActiveSlides(previousSlides);
      projectSlide(previousSlides, previousSlides.length - 1);
      rememberProjection({
        verse: nextVerse,
        slides: previousSlides,
        slideIndex: previousSlides.length - 1,
      });
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
    rememberProjection,
    slidesFor,
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
            ref={versionSelectRef}
            value={versionId}
            onChange={(event) => setVersionId(Number(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                bookSelectRef.current?.focus();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              bookSelectRef.current?.focus();
            }}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Libro
          <select
            ref={bookSelectRef}
            value={book}
            onChange={(event) => {
              setBook(event.target.value);
              setChapter(1);
              setQuery("");
              setFocusedVerse("");
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                versionSelectRef.current?.focus();
                return;
              }
              if (event.key === "ArrowRight" || event.key === "Enter") {
                event.preventDefault();
                chapterSelectRef.current?.focus();
              }
            }}
          >
            {books.map((item) => (
              <option key={item.book} value={item.book}>
                {item.book}
              </option>
            ))}
          </select>
        </label>
        <label>
          Capítulo
          <select
            ref={chapterSelectRef}
            value={chapter}
            onChange={(e) => {
              setChapter(Number(e.target.value));
              setQuery("");
              setFocusedVerse("");
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                bookSelectRef.current?.focus();
                return;
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                verseSelectRef.current?.focus();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              verseSelectRef.current?.focus();
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
            ref={verseSelectRef}
            value={focusedVerse}
            onChange={(e) => {
              const value = e.target.value;
              const verse = verses.find(
                (candidate) => verseKey(candidate) === value,
              );
              setFocusedVerse(verse ? verseKey(verse) : "");
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                chapterSelectRef.current?.focus();
                return;
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                verseListRef.current?.focus();
                return;
              }
              if (event.key !== "Enter") return;
              const verse = verses.find(
                (candidate) => verseKey(candidate) === focusedVerse,
              );
              if (!verse) return;
              event.preventDefault();
              send(verse);
            }}
          >
            <option value="">Ir al versículo…</option>
            {verses.map((verse) => (
              <option value={verseKey(verse)} key={verseKey(verse)}>
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
              <span>VERSÍCULOS</span>
              <strong>{displayedVerses.length}</strong>
            </div>
            <small>
              Un clic proyecta el versículo completo
            </small>
          </div>
          <div className="verse-list" ref={verseListRef} tabIndex={-1}>
            {verseChoices.map(({ verse, fullSlide, splitSlides }) => {
              const key = verseKey(verse);
              const fullSelected =
                activeVerse === key && activeSlides.length === 1;
              return (
                <article
                  className={`verse-entry ${fullSelected ? "selected" : ""} ${
                    focusedVerse === key && activeVerse !== key ? "focused" : ""
                  }`.trim()}
                  key={key}
                >
                  <button
                    className="verse-full"
                    onMouseUp={(event) => selectPhrase(verse, event.currentTarget)}
                    onTouchEnd={(event) =>
                      window.setTimeout(() => selectPhrase(verse, event.currentTarget), 0)
                    }
                    onClick={() => {
                      if (suppressVerseClick.current) {
                        suppressVerseClick.current = false;
                        return;
                      }
                      send(verse);
                    }}
                  >
                    <b>{fullSlide?.label} <small>Completo</small></b>
                    <span dangerouslySetInnerHTML={{ __html: fullSlide?.contentHtml || "" }} />
                  </button>
                  {splitSlides.length > 1 && (
                    <div className="verse-split-actions" aria-label={`Dividir ${fullSlide?.label}`}>
                      {splitSlides.map((slide, index) => (
                        <button
                          type="button"
                          className={activeVerse === key && activeSlides.length > 1 && activeSlide === index ? "selected" : ""}
                          onClick={() => send(verse, "split", index)}
                          key={slide.label}
                        >
                          {index === 0 ? "A" : "B"}
                        </button>
                      ))}
                      <button type="button" className="verse-split-edit" onClick={() => openSplitEditor(verse)} title="Editar división">
                        <Pencil aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            {!verseChoices.length && (
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
              <span>HISTORIAL DE PROYECCIÓN</span>
              <strong>{history.length || "—"}</strong>
            </div>
            <button
              type="button"
              className="bible-history-clear"
              onClick={() => {
                sessionBibleHistory = [];
                pendingFrozenHistory.current = null;
                setHistory([]);
              }}
              disabled={!history.length}
              title="Limpiar historial bíblico"
            >
              <Trash2 aria-hidden="true" /> Limpiar
            </button>
          </div>
          <div className="bible-slide-list">
            {history.map((entry) => {
              const slide = entry.slides[entry.slideIndex];
              if (!slide) return null;
              const selected =
                activeVerse === verseKey(entry.verse) &&
                activeSlide === entry.slideIndex;
              return (
              <button
                className={selected ? "selected" : ""}
                onClick={() => {
                  if (suppressVerseClick.current) {
                    suppressVerseClick.current = false;
                    return;
                  }
                  setActiveVerse(verseKey(entry.verse));
                  setFocusedVerse(verseKey(entry.verse));
                  setActiveSlides(entry.slides);
                  projectSlide(entry.slides, entry.slideIndex);
                }}
                key={entry.id}
              >
                <b>{slide.label}</b>
                <div
                  className="bible-slide-content"
                  dangerouslySetInnerHTML={{ __html: slide.contentHtml }}
                />
              </button>
              );
            })}
            {!history.length && (
              <div className="bible-slide-empty">
                <BookOpen />
                <strong>Aún no proyectaste versículos</strong>
                <span>
                  Tocá un versículo de la columna principal para enviarlo y
                  conservarlo aquí.
                </span>
              </div>
            )}
          </div>
        </section>
      </div>
      {splitEditor && (
        <div className="bible-split-dialog-backdrop" role="presentation">
          <section className="bible-split-dialog" role="dialog" aria-modal="true" aria-label="Editar división del versículo">
            <header>
              <div>
                <span>DIVISIÓN A/B</span>
                <h3>{splitEditor.verse.book} {splitEditor.verse.chapter}:{splitEditor.verse.verse}</h3>
              </div>
              <button type="button" onClick={() => setSplitEditor(null)} aria-label="Cerrar"><X /></button>
            </header>
            <p className="bible-split-help">Elegí la última palabra de la parte A. La parte B comienza en la palabra siguiente.</p>
            <div className="bible-split-preview">
              <div><b>A</b><p>{splitEditor.verse.text.trim().split(/\s+/).slice(0, splitEditor.splitAt).join(" ")}</p></div>
              <div><b>B</b><p>{splitEditor.verse.text.trim().split(/\s+/).slice(splitEditor.splitAt).join(" ")}</p></div>
            </div>
            <div className="bible-split-words" aria-label="Elegir punto de división">
              {splitEditor.verse.text.trim().split(/\s+/).map((word, index) => (
                <button
                  type="button"
                  className={index < splitEditor.splitAt ? "before" : "after"}
                  onClick={() => setSplitEditor((current) => current ? {
                    ...current,
                    splitAt: Math.max(1, Math.min(index + 1, current.verse.text.trim().split(/\s+/).length - 1)),
                  } : current)}
                  key={`${word}-${index}`}
                >
                  {word}
                </button>
              ))}
            </div>
            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setSplitEditor((current) => current ? { ...current, splitAt: current.automaticSplitAt } : current)}
              >Restablecer automática</button>
              <button type="button" className="primary" onClick={saveSplitEditor}>Guardar división</button>
            </footer>
          </section>
        </div>
      )}
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
