import {
  Component,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  PowerPointViewer,
  type PowerPointViewerHandle,
} from "pptx-react-viewer";
import type { ProjectionState } from "../../shared/types";

type Props = {
  state: ProjectionState;
  preview?: boolean;
  onPresentationSlideCount?: (count: number) => void;
  onVideoMetadata?: (duration: number) => void;
  onVideoTime?: (time: number) => void;
  onVideoEnded?: () => void;
};

class PresentationErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("No se pudo representar la presentación", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const forceUppercaseHtml = (html: string) =>
  html.replace(/(^|>)([^<]+)(?=<|$)/g, (_match, prefix: string, text: string) =>
    `${prefix}${text.toLocaleUpperCase("es-AR")}`,
  );

// "Rellenar pantalla" may enlarge a short passage, but keeping that growth
// close to the preferred size avoids a jarring type-size jump when the next
// verse needs the automatic safety reduction.
const MAX_BALANCED_FILL_SCALE = 1.12;

export function ProjectionStage({
  state,
  preview = false,
  onPresentationSlideCount,
  onVideoMetadata,
  onVideoTime,
  onVideoEnded,
}: Props) {
  const outputViewport = state.outputViewport ?? {
    width: 1920,
    height: 1080,
    scaleFactor: 1,
  };
  const [now, setNow] = useState(Date.now());
  const [previousUrl, setPreviousUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(
    state.background.url,
  );
  const requestedMediaFit =
    state.background.kind === "video" && !state.video.loop
      ? "contain"
      : "cover";
  const [previousMediaFit, setPreviousMediaFit] = useState<
    "cover" | "contain"
  >("cover");
  const oldUrl = useRef(state.background.url);
  const oldMediaFit = useRef<"cover" | "contain">(requestedMediaFit);
  const textRef = useRef<HTMLDivElement>(null);
  const [fitTextSize, setFitTextSize] = useState(state.text.fontSize);
  const [contentScale, setContentScale] = useState(preview ? 0.2 : 1);
  const [bibleFit, setBibleFit] = useState({
    referenceScale: 1,
    horizontalMargin: state.bibleStyle.horizontalMargin,
    verticalMargin: state.bibleStyle.verticalMargin,
  });
  const fontFamily =
    state.text.fontFamily === "Inter"
      ? "Inter, ui-sans-serif, system-ui, sans-serif"
      : state.text.fontFamily;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, state.timer.remaining - (state.timer.running ? Math.floor((now - state.timer.startedAt) / 1000) : 0));
  const clock = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    if (state.background.url === oldUrl.current) return;
    setPreviousUrl(oldUrl.current);
    setPreviousMediaFit(oldMediaFit.current);
    setCurrentUrl(state.background.url);
    oldUrl.current = state.background.url;
    oldMediaFit.current = requestedMediaFit;
    const timer = window.setTimeout(() => setPreviousUrl(null), 550);
    return () => window.clearTimeout(timer);
  }, [state.background.url, requestedMediaFit]);

  useEffect(() => {
    const element = textRef.current;
    const isProjectableText =
      state.text.kind === "biblia" || state.text.kind === "canto";
    if (!element || !isProjectableText) {
      setFitTextSize(state.text.fontSize);
      return;
    }
    const measure = () => {
      const host = element.parentElement;
      const scale = preview && host
        ? Math.max(
            0.01,
            Math.min(
              host.clientWidth / outputViewport.width,
              host.clientHeight / outputViewport.height,
            ),
          )
        : 1;
      const requestedSize = Math.max(4 * scale, state.text.fontSize * scale);
      setContentScale((current) =>
        Math.abs(current - scale) > 0.002 ? scale : current,
      );
      const shouldFillBible =
        state.text.kind === "biblia" && state.bibleStyle.fillScreen;
      const configuredHorizontal = state.bibleStyle.horizontalMargin;
      const configuredVertical = state.bibleStyle.verticalMargin;
      const evaluate = (horizontalMargin: number, verticalMargin: number) => {
        if (state.text.kind === "biblia") {
          element.style.left = `${horizontalMargin}%`;
          element.style.right = `${horizontalMargin}%`;
          element.style.top = `${verticalMargin}%`;
          element.style.bottom = `${verticalMargin}%`;
        }
        // In fill mode the configured size is the visual anchor. A short verse
        // may grow subtly, but never enough to look like a different design
        // from the following (longer) verse.
        const responsiveCeiling = Math.max(
          requestedSize,
          Math.min(element.clientWidth * 0.24, element.clientHeight * 0.58),
        );
        const balancedFillCeiling = Math.min(
          responsiveCeiling,
          requestedSize * MAX_BALANCED_FILL_SCALE,
        );
        let low = Math.min(requestedSize, Math.max(2, 7 * scale)),
          high = shouldFillBible ? balancedFillCeiling : requestedSize,
          best = low;
        const applyCandidate = (fontSize: number) => {
          const referenceScale = Math.min(1, fontSize / requestedSize);
          element.style.fontSize = `${fontSize}px`;
          element.style.setProperty("--fit-text-size", `${fontSize}px`);
          if (state.text.kind === "biblia") {
            element.style.setProperty(
              "--bible-reference-size",
              `${Math.max(8 * scale, state.bibleStyle.referenceFontSize * scale * referenceScale)}px`,
            );
            element.style.setProperty(
              "--bible-reference-height",
              `${Math.max(14 * scale, state.bibleStyle.referenceFontSize * 1.65 * scale * referenceScale)}px`,
            );
            element.style.setProperty(
              "--bible-reference-gap",
              `${Math.max(4 * scale, state.bibleStyle.referenceFontSize * 0.45 * scale * referenceScale)}px`,
            );
          }
        };
        const contentFits = (fontSize: number) => {
          // A centered flex item can be clipped on both sides while its live
          // scrollHeight still reports the constrained box. Measure an
          // invisible, unconstrained copy instead so preview and real output
          // use the complete natural height of every song or Bible passage.
          const verticalGuard = Math.max(2 * scale, fontSize * 0.075);
          const horizontalGuard = Math.max(1 * scale, fontSize * 0.025);
          const availableWidth = Math.max(
            1,
            element.clientWidth - horizontalGuard * 2,
          );
          const availableHeight = Math.max(
            1,
            element.clientHeight - verticalGuard * 2,
          );
          const measurement = element.cloneNode(true) as HTMLElement;
          measurement.removeAttribute("id");
          Object.assign(measurement.style, {
            position: "fixed",
            visibility: "hidden",
            pointerEvents: "none",
            left: "-100000px",
            right: "auto",
            top: "0",
            bottom: "auto",
            width: `${availableWidth}px`,
            minWidth: "0",
            maxWidth: "none",
            height: "auto",
            minHeight: "0",
            maxHeight: "none",
            overflow: "visible",
            display: "block",
            transform: "none",
            transition: "none",
            animation: "none",
            fontSize: `${fontSize}px`,
          });
          const bibleSlide =
            measurement.querySelector<HTMLElement>(".bible-slide");
          const bibleVerseSlot =
            measurement.querySelector<HTMLElement>(".bible-verse-slot");
          if (bibleSlide) {
            Object.assign(bibleSlide.style, {
              height: "auto",
              minHeight: "0",
              overflow: "visible",
            });
          }
          if (bibleVerseSlot) {
            Object.assign(bibleVerseSlot.style, {
              display: "block",
              height: "auto",
              minHeight: "0",
              overflow: "visible",
              flex: "none",
            });
          }
          document.body.appendChild(measurement);
          const fits =
            measurement.scrollHeight <= availableHeight + 1 &&
            measurement.scrollWidth <= availableWidth + 1;
          measurement.remove();
          return fits;
        };
        for (let step = 0; step < 12; step++) {
          const middle = (low + high) / 2;
          applyCandidate(middle);
          if (contentFits(middle)) {
            best = middle;
            low = middle;
          } else high = middle;
        }
        // Leave the DOM at the accepted value even when React can reuse the
        // previous state value and therefore skip a render.
        applyCandidate(best);
        return {
          fontSize: best,
          referenceScale: Math.min(1, best / requestedSize),
          horizontalMargin,
          verticalMargin,
        };
      };

      let result = evaluate(configuredHorizontal, configuredVertical);
      // “Rellenar pantalla” first respects the chosen safe area. If that would
      // force the preferred font size down, it recovers otherwise unused space
      // down to a small 2% safety edge before reducing the type.
      if (
        shouldFillBible &&
        result.fontSize < requestedSize - 0.5 &&
        (configuredHorizontal > 2 || configuredVertical > 2)
      ) {
        const expanded = evaluate(
          Math.min(configuredHorizontal, 2),
          Math.min(configuredVertical, 2),
        );
        if (expanded.fontSize >= result.fontSize) result = expanded;
        else result = evaluate(configuredHorizontal, configuredVertical);
      }
      setFitTextSize(result.fontSize);
      if (state.text.kind === "biblia")
        setBibleFit((current) =>
          Math.abs(current.referenceScale - result.referenceScale) > 0.002 ||
          current.horizontalMargin !== result.horizontalMargin ||
          current.verticalMargin !== result.verticalMargin
            ? {
                referenceScale: result.referenceScale,
                horizontalMargin: result.horizontalMargin,
                verticalMargin: result.verticalMargin,
              }
            : current,
        );
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    if (element.parentElement) observer.observe(element.parentElement);
    document.fonts?.ready.then(measure).catch(() => undefined);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [
    state.text.html,
    state.text.kind,
    state.text.visible,
    state.text.fontSize,
    state.text.fontFamily,
    state.text.position,
    state.text.title,
    state.text.titlePosition,
    state.bibleStyle.longVerseMode,
    state.bibleStyle.uppercase,
    state.bibleStyle.horizontalMargin,
    state.bibleStyle.verticalMargin,
    state.bibleStyle.fillScreen,
    state.bibleStyle.autoFit,
    state.bibleStyle.referenceFontSize,
    state.bibleStyle.referencePosition,
    state.bibleStyle.referenceStyle,
    state.songStyle.uppercase,
    state.songStyle.autoFit,
    outputViewport.width,
    outputViewport.height,
    preview,
  ]);

  const bibleSafeArea = state.text.kind === "biblia";
  const songSafeArea = state.text.kind === "canto";
  const projectionSafeArea = bibleSafeArea || songSafeArea;
  const bibleFill = bibleSafeArea && state.bibleStyle.fillScreen;
  // Bible passages and song stanzas must never be allowed to escape their
  // physical projection area. Keep the configured size as the ceiling and
  // apply the safety fit in both preview and output, including installations
  // whose older saved preferences have autoFit disabled.
  const fitText = projectionSafeArea;
  const uppercase =
    (state.text.kind === "biblia" && state.bibleStyle.uppercase) ||
    (state.text.kind === "canto" && state.songStyle.uppercase);
  const projectedHtml = uppercase
    ? forceUppercaseHtml(state.text.html)
    : state.text.html;
  const textStyle = {
    fontSize: (fitText ? fitTextSize : state.text.fontSize) + "px",
    fontFamily,
    textAlign: state.text.align,
    color: state.text.color,
    backgroundColor: state.text.backgroundColor,
    "--projection-panel-color": state.text.backgroundColor,
    borderRadius: `${state.text.borderRadius}px`,
    textShadow: state.text.shadowEnabled
      ? `0 3px ${state.text.shadowBlur}px ${state.text.shadowColor}`
      : "none",
    textTransform: uppercase ? "uppercase" : "none",
    ...(projectionSafeArea
      ? {
          left: bibleSafeArea
            ? `${bibleFit.horizontalMargin}%`
            : "8%",
          right: bibleSafeArea
            ? `${bibleFit.horizontalMargin}%`
            : "8%",
          top: bibleSafeArea
            ? `${bibleFit.verticalMargin}%`
            : state.text.title && state.text.titlePosition === "top"
              ? "17%"
              : "8%",
          bottom: bibleSafeArea
            ? `${bibleFit.verticalMargin}%`
            : state.text.title && state.text.titlePosition === "bottom"
              ? "17%"
              : "8%",
          height: "auto",
          maxWidth: "none",
          transform: "none",
        }
      : {}),
    ...(fitText
      ? {
          // A fixed box lets us calculate the largest readable type size
          // instead of allowing the element to grow with its contents.
          height: "auto",
          overflow: "hidden",
          "--fit-text-size": fitTextSize + "px",
        }
      : {}),
    ...(bibleSafeArea
      ? {
          "--bible-reference-size": `${Math.max(8, state.bibleStyle.referenceFontSize * contentScale * bibleFit.referenceScale)}px`,
          "--bible-reference-height": `${Math.max(14, state.bibleStyle.referenceFontSize * 1.65 * contentScale * bibleFit.referenceScale)}px`,
          "--bible-reference-gap": `${Math.max(4, state.bibleStyle.referenceFontSize * 0.45 * contentScale * bibleFit.referenceScale)}px`,
        }
      : {}),
  } as CSSProperties;

  return (
    <div
      className={`projection-stage ${preview ? "preview-stage" : ""}`}
      style={
        preview
          ? ({
              "--preview-text-size": `${Math.max(8, state.text.fontSize * 0.28)}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <div className="projection-background">
        {previousUrl && (
          <MediaLayer
            key={`old-${previousUrl}`}
            url={previousUrl}
            speed={state.background.speed}
            className="fade-out"
            playback={state.video}
            preview={preview}
            fit={previousMediaFit}
          />
        )}
        {currentUrl && (
          <MediaLayer
            key={`new-${currentUrl}`}
            url={currentUrl}
            speed={state.background.speed}
            className="fade-in"
            playback={state.video}
            preview={preview}
            fit={requestedMediaFit}
            onMetadata={onVideoMetadata}
            onTime={onVideoTime}
            onEnded={onVideoEnded}
          />
        )}
        <div
          className="background-filters"
          style={{
            backgroundColor: `rgba(0,0,0,${state.background.dim / 100})`,
            backdropFilter: `blur(${state.background.blur}px)`,
          }}
        />
      </div>

      <div
        key={`${state.text.kind}-${state.text.visible}-${state.text.html}-${state.text.animation}`}
        ref={textRef}
        className={`projection-text position-${state.text.position} template-${state.text.template} projection-animation-${state.text.kind === "anuncio" ? state.text.animation : "none"} ${projectionSafeArea ? "projection-safe-area" : ""} ${bibleSafeArea ? "bible-safe-area" : ""} ${bibleFill ? "bible-fill" : ""} ${fitText ? "auto-fit-text" : ""} ${state.text.visible ? "layer-visible" : "layer-hidden"}`}
        style={textStyle}
        dangerouslySetInnerHTML={{ __html: projectedHtml }}
      />
      {state.text.kind === "canto" && state.text.title && (
        <div
          className={`song-title-banner title-position-${state.text.titlePosition} title-style-${state.text.titleStyle}`}
          style={{
            color: state.text.titleColor,
            fontFamily: state.songStyle.titleFontFamily || state.text.fontFamily,
            backgroundColor:
              state.text.titleStyle === "none"
                ? "transparent"
                : state.text.titleBackground,
            fontSize: `${state.text.titleFontSize * (preview ? 0.28 : 1)}px`,
            textTransform: state.songStyle.uppercase ? "uppercase" : "none",
            textShadow: state.text.shadowEnabled
              ? `0 3px ${state.text.shadowBlur}px ${state.text.shadowColor}`
              : "none",
          }}
        >
          {state.text.title}
        </div>
      )}
      {state.timer.visible && <div className={`projection-overlay overlay-${state.timer.position}`} style={{ fontSize: state.timer.fontSize, color: state.timer.color }}>{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</div>}
      {state.clock.visible && <div className={`projection-overlay clock-overlay overlay-${state.clock.position}`} style={{ fontSize: state.clock.fontSize, color: state.clock.color }}>{clock}</div>}
      {state.alert.visible && (
        <div
          className={`projection-alert overlay-${state.alert.position} alert-animation-${state.alert.animation}`}
          style={{
            color: state.alert.color,
            fontSize: `${state.alert.fontSize * (preview ? 0.28 : 1)}px`,
          }}
        >
          <span>{state.alert.message}</span>
        </div>
      )}

      <div
        className={`lower-third ${state.lowerThird.visible ? "layer-visible" : "layer-hidden"}`}
      >
        <div className="lower-accent" />
        <div>
          <strong>{state.lowerThird.title}</strong>
          <span>{state.lowerThird.subtitle}</span>
        </div>
      </div>

      <PresentationLayer
        presentation={state.presentation}
        preview={preview}
        onSlideCount={onPresentationSlideCount}
      />

      <div
        className={`logo-layer logo-${state.church.logoMode} ${state.logo ? "layer-visible" : "layer-hidden"}`}
        style={{ backgroundColor: state.church.logoBackgroundColor }}
      >
        {state.church.logoUrl ? (
          <img className="church-logo" src={state.church.logoUrl} />
        ) : (
          <div className="logo-mark">FL</div>
        )}
        {state.church.logoMode === "centered" && state.church.name.trim() && (
          <div className="church-identity">
            <strong>{state.church.name}</strong>
            {(state.church.address || state.church.city) && (
              <span>
                {[state.church.address, state.church.city]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>
      <div
        className={`blackout-layer ${state.blackout ? "layer-visible" : "layer-hidden"}`}
      />
    </div>
  );
}

function PresentationLayer({
  presentation,
  preview,
  onSlideCount,
}: {
  presentation: ProjectionState["presentation"];
  preview: boolean;
  onSlideCount?: (count: number) => void;
}) {
  const viewer = useRef<PowerPointViewerHandle>(null);
  const [content, setContent] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const mockSlide = presentation.previewSlides?.[presentation.slideIndex];

  useEffect(() => {
    setContent(null);
    setError("");
    if (
      (!presentation.path && !presentation.url) ||
      presentation.previewSlides?.length
    )
      return;
    let cancelled = false;
    const read = presentation.path
      ? window.flProyector.readPresentation(presentation.path)
      : fetch(presentation.url!).then((response) => {
          if (!response.ok)
            throw new Error(
              `No se pudo leer la presentación (${response.status})`,
            );
          return response.arrayBuffer();
        });
    read
      .then((buffer) => {
        if (!cancelled) setContent(new Uint8Array(buffer));
      })
      .catch((reason) => {
        console.error("No se pudo cargar la presentación", reason);
        if (!cancelled)
          setError(
            reason instanceof Error && reason.message
              ? reason.message
              : "No se pudo abrir este archivo de PowerPoint.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [presentation.url, presentation.previewSlides]);

  useEffect(() => {
    if (!content || !viewer.current) return;
    const timer = window.setTimeout(() => {
      viewer.current?.setMode("present");
      viewer.current?.goTo(presentation.slideIndex);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [content]);

  useEffect(() => {
    if (!content) return;
    viewer.current?.goTo(presentation.slideIndex);
  }, [content, presentation.slideIndex]);

  if (!presentation.visible)
    return <div className="presentation-layer layer-hidden" />;

  return (
    <div
      className={`presentation-layer layer-visible ${preview ? "presentation-preview" : ""}`}
    >
      {mockSlide ? (
        <img
          src={mockSlide}
          alt={`Diapositiva ${presentation.slideIndex + 1}`}
        />
      ) : content ? (
        <PresentationErrorBoundary
          key={`${presentation.path || presentation.url}-${content.byteLength}`}
          fallback={
            <div className="presentation-loading">
              <PresentationIcon />
              No se pudo interpretar este archivo de PowerPoint.
            </div>
          }
        >
          <PowerPointViewer
            ref={viewer}
            content={content}
            filePath={presentation.path || undefined}
            fileName={presentation.name}
            canEdit={false}
            defaultLocale="en"
            onSlideCountChange={onSlideCount}
          />
        </PresentationErrorBoundary>
      ) : (
        <div className="presentation-loading">
          <PresentationIcon />
          {error || "Cargando presentación…"}
        </div>
      )}
    </div>
  );
}

function PresentationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 17V7h4.2a3.2 3.2 0 0 1 0 6.4H9m0-3.2h4" />
    </svg>
  );
}

function MediaLayer({
  url,
  speed,
  className,
  playback,
  preview,
  fit,
  onMetadata,
  onTime,
  onEnded,
}: {
  url: string;
  speed: number;
  className: string;
  playback: ProjectionState["video"];
  preview: boolean;
  fit: "cover" | "contain";
  onMetadata?: (duration: number) => void;
  onTime?: (time: number) => void;
  onEnded?: () => void;
}) {
  if (
    url.startsWith("data:image/") ||
    /\.(png|jpe?g|webp|gif|avif|bmp)(?:$|%)/i.test(decodeURIComponent(url))
  )
    return <img className={className} src={url} style={{ objectFit: fit }} />;
  return (
    <VideoLayer
      url={url}
      speed={speed}
      className={className}
      playback={playback}
      preview={preview}
      fit={fit}
      onMetadata={onMetadata}
      onTime={onTime}
      onEnded={onEnded}
    />
  );
}

function VideoLayer({
  url,
  speed,
  className,
  playback,
  preview,
  fit,
  onMetadata,
  onTime,
  onEnded,
}: {
  url: string;
  speed: number;
  className: string;
  playback: ProjectionState["video"];
  preview: boolean;
  fit: "cover" | "contain";
  onMetadata?: (duration: number) => void;
  onTime?: (time: number) => void;
  onEnded?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const finishNotified = useRef(false);
  const resumeAfterSeek = useRef(false);
  const notifyPlaybackEnded = (video: HTMLVideoElement) => {
    if (preview || playback.loop || finishNotified.current) return;
    finishNotified.current = true;
    onEnded?.();
  };
  useEffect(() => {
    if (playback.playing && !playback.loop) finishNotified.current = false;
  }, [url, playback.commandId, playback.playing, playback.loop]);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, playback.volume));
    video.muted = preview || playback.muted;
    if (playback.playing) video.play().catch(() => {});
    else video.pause();
  }, [playback.playing, playback.volume, playback.muted, preview]);
  useEffect(() => {
    const video = ref.current;
    try {
      if (video && video.readyState >= 1) {
        resumeAfterSeek.current = playback.playing;
        const upperBound = Number.isFinite(video.duration)
          ? Math.max(0, video.duration - (playback.playing ? 0.05 : 0))
          : playback.seekTime;
        const target = Math.max(0, Math.min(playback.seekTime, upperBound));
        if (typeof video.fastSeek === "function") video.fastSeek(target);
        else video.currentTime = target;
      }
    } catch {}
  }, [playback.commandId, playback.seekTime]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const keepPlaying = () => {
      if (preview || !playback.playing || !video.paused || video.ended) return;
      video.play().catch(() => {});
    };
    const restart = () => {
      if (!preview && playback.playing && !video.ended)
        video.play().catch(() => {});
    };
    // Some codecs can pause after a stall or at a loop boundary in a
    // background/projection window. Keep the motion layer alive without
    // overriding the operator's explicit Pause command.
    const watchdog = window.setInterval(keepPlaying, 1500);
    video.addEventListener("stalled", restart);
    video.addEventListener("waiting", restart);
    video.addEventListener("canplay", restart);
    return () => {
      window.clearInterval(watchdog);
      video.removeEventListener("stalled", restart);
      video.removeEventListener("waiting", restart);
      video.removeEventListener("canplay", restart);
    };
  }, [playback.playing, preview, url]);
  return (
    <video
      ref={ref}
      className={className}
      src={url}
      style={{ objectFit: fit }}
      autoPlay
      loop={playback.loop}
      preload="auto"
      muted={preview || playback.muted}
      playsInline
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (playback.seekTime > 0)
          video.currentTime = Math.min(
            playback.seekTime,
            video.duration || playback.seekTime,
          );
        onMetadata?.(video.duration);
      }}
      onDurationChange={(event) => onMetadata?.(event.currentTarget.duration)}
      onTimeUpdate={(event) => {
        const video = event.currentTarget;
        onTime?.(video.currentTime);
        if (
          video.duration > 0 &&
          video.duration - video.currentTime <= 0.45
        )
          notifyPlaybackEnded(video);
      }}
      onSeeked={(event) => {
        const video = event.currentTarget;
        onTime?.(video.currentTime);
        if (resumeAfterSeek.current && playback.playing && !video.ended)
          video.play().catch(() => {});
        resumeAfterSeek.current = false;
      }}
      onPause={(event) => {
        const video = event.currentTarget;
        if (
          playback.playing &&
          video.duration > 0 &&
          video.duration - video.currentTime <= 0.75
        )
          notifyPlaybackEnded(video);
      }}
      onEnded={(event) => notifyPlaybackEnded(event.currentTarget)}
    />
  );
}
