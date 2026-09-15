import { useEffect, useRef, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import {
  MonitorPlay,
  BellRing,
  BookOpenText,
  CalendarRange,
  Clock,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Film,
  Eraser,
  MonitorUp,
  Music2,
  Pause,
  Play,
  QrCode,
  Settings,
  Smartphone,
  Square,
  Timer,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { ProjectionStage } from "./components/ProjectionStage";
import { MediaLibrary } from "./components/MediaLibrary";
import { SongLibrary } from "./components/SongLibrary";
import { BibleOperator } from "./components/BibleOperator";
import { SettingsPanel } from "./components/SettingsPanel";
import { MeetingBuilder } from "./components/MeetingBuilder";
import { RemotePanel } from "./components/RemotePanel";
import { LiveAudienceDialog } from "./components/LiveAudienceDialog";
import { Win11SettingsDialog } from "./components/Win11SettingsDialog";
import { HelpDialog } from "./components/HelpDialog";
import {
  SaveNotificationHost,
} from "./components/SaveNotification";
import {
  clampColumnWidth,
  ColumnResizer,
  storedColumnWidth,
} from "./components/ColumnResizer";
import { useProjectionState } from "./hooks/useProjectionState";
import {
  initialDisplaySettings,
  type DisplayInfo,
  type DisplaySettings,
  type LiveAudienceStatus,
} from "../shared/types";

type Tab = "reuniones" | "canciones" | "fondos" | "biblia" | "remoto" | "ajustes";

const tabs: Tab[] = ["reuniones", "canciones", "fondos", "biblia", "remoto", "ajustes"];

const savedLivePanelWidth = (tab: Tab) =>
  clampColumnWidth(
    storedColumnWidth(
      `fl-layout-live-${tab}`,
      storedColumnWidth("fl-layout-live", 376),
    ),
    300,
    1200,
  );

const minimumContentWidth = (tab: Tab) => (tab === "reuniones" ? 748 : 420);

const maximumLivePanelWidth = (tab: Tab) =>
  Math.max(300, window.innerWidth - 180 - minimumContentWidth(tab) - 4);

export function App() {
  const { state, update } = useProjectionState();
  const [tab, setTab] = useState<Tab>("reuniones");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("fl-sidebar-collapsed") === "1",
  );
  const [meetingId, setMeetingId] = useState<number | null>(null);
  const [focusedMeetingItemId, setFocusedMeetingItemId] = useState<
    number | null
  >(null);
  const [status, setStatus] = useState({
    open: false,
    displays: [] as DisplayInfo[],
    remoteUrls: [] as string[],
  });
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const lastVideoTelemetry = useRef({ time: -1, sentAt: 0 });
  const [showHelp, setShowHelp] = useState(false);
  const [overlaySettings, setOverlaySettings] = useState<"timer" | "clock" | null>(null);
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const [showLiveAudienceDialog, setShowLiveAudienceDialog] = useState(false);
  const [liveAudienceStatus, setLiveAudienceStatus] = useState<LiveAudienceStatus>({ active: false, code: null, viewers: 0 });
  const [liveAudienceQr, setLiveAudienceQr] = useState("");
  const beforeLiveAudienceQr = useRef<typeof state | null>(null);
  const [settingsPreview, setSettingsPreview] = useState<ReturnType<typeof useProjectionState>["state"] | null>(null);
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(initialDisplaySettings);
  const [displayPreviewSettings, setDisplayPreviewSettings] = useState<DisplaySettings | null>(null);
  const [livePanelWidths, setLivePanelWidths] = useState<Record<Tab, number>>(
    () =>
      Object.fromEntries(
        tabs.map((item) => [item, savedLivePanelWidth(item)]),
      ) as Record<Tab, number>,
  );
  const livePanelWidth = Math.min(
    livePanelWidths[tab],
    maximumLivePanelWidth(tab),
  );
  const showSidePreview = tab !== "remoto";
  const isSettings = tab === "ajustes";
  const activeDisplaySettings = displayPreviewSettings ?? displaySettings;
  const previewDisplay =
    status.displays.find(
      (display) => display.id === activeDisplaySettings.mainDisplayId,
    ) ??
    status.displays.find((display) => !display.primary) ??
    status.displays.find((display) => display.primary);
  const previewAspectRatio =
    activeDisplaySettings.aspectRatio === "auto"
      ? `${previewDisplay?.cssWidth || 16} / ${previewDisplay?.cssHeight || 9}`
      : activeDisplaySettings.aspectRatio === "custom"
        ? "16 / 9"
        : activeDisplaySettings.aspectRatio.replace(":", " / ");
  const liveAudienceUrl = status.remoteUrls[0] && liveAudienceStatus.code
    ? `${status.remoteUrls[0]}/live/${liveAudienceStatus.code}`
    : "";
  const liveAudienceQrOnAir = state.text.visible && state.text.html.includes("data-live-audience-qr");
  const refreshStatus = () =>
    window.flProyector.projectionStatus().then(setStatus);
  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 2000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("fl-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  useEffect(() => {
    const refresh = () => window.flProyector.getLiveAudienceStatus().then(setLiveAudienceStatus);
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!liveAudienceUrl) return void setLiveAudienceQr("");
    QRCode.toDataURL(liveAudienceUrl, {
      width: 900,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#ffffff" },
    }).then(setLiveAudienceQr).catch(() => setLiveAudienceQr(""));
  }, [liveAudienceUrl]);
  useEffect(() => {
    window.flProyector.getDisplaySettings().then(setDisplaySettings);
    return window.flProyector.onDisplaySettings(setDisplaySettings);
  }, []);
  useEffect(() => {
    try {
      const savedAlert = JSON.parse(
        localStorage.getItem("fl-overlay-alert") || "null",
      );
      if (savedAlert?.message) update({ alert: savedAlert });
    } catch {
      localStorage.removeItem("fl-overlay-alert");
    }
  }, [update]);
  useEffect(() => {
    const migrationKey = "fl-fluent-theme-v1";
    if (!localStorage.getItem(migrationKey)) {
      localStorage.setItem("fl-interface-theme", "light");
      localStorage.setItem(migrationKey, "1");
    }
    document.documentElement.dataset.theme =
      localStorage.getItem("fl-interface-theme") === "dark" ? "dark" : "light";
  }, []);
  useEffect(() => {
    const keepColumnsUsable = () =>
      setLivePanelWidths((widths) =>
        Object.fromEntries(
          tabs.map((item) => [
            item,
            clampColumnWidth(
              widths[item],
              300,
              maximumLivePanelWidth(item),
            ),
          ]),
        ) as Record<Tab, number>,
      );
    window.addEventListener("resize", keepColumnsUsable);
    return () => window.removeEventListener("resize", keepColumnsUsable);
  }, []);
  useEffect(() => {
    setVideoTime(0);
    setVideoDuration(0);
  }, [state.background.id, state.background.url]);
  useEffect(() => {
    if (tab !== "ajustes") setSettingsPreview(null);
  }, [tab]);
  const handleVideoMetadata = (duration: number) => {
    setVideoDuration(duration);
    if (Number.isFinite(duration) && Math.abs(state.video.duration - duration) > 0.1)
      update({ video: { duration } });
  };
  const handleVideoTime = (time: number) => {
    setVideoTime(time);
    const now = Date.now();
    if (
      Number.isFinite(time) &&
      (now - lastVideoTelemetry.current.sentAt > 700 ||
        Math.abs(lastVideoTelemetry.current.time - time) > 1)
    ) {
      lastVideoTelemetry.current = { time, sentAt: now };
      update({ video: { currentTime: time } });
    }
  };
  const timerRemaining = Math.max(0, state.timer.remaining - (state.timer.running ? Math.floor((Date.now() - state.timer.startedAt) / 1000) : 0));
  const openOverlaySettings = (kind: "timer" | "clock") => setOverlaySettings(kind);
  const startLiveAudience = async () => {
    if (!status.remoteUrls[0]) return;
    setLiveAudienceStatus(await window.flProyector.startLiveAudience());
  };
  const restoreBeforeLiveAudienceQr = async () => {
    const previous = beforeLiveAudienceQr.current;
    beforeLiveAudienceQr.current = null;
    if (!previous) {
      await update({ text: { visible: false, html: "" } });
      return;
    }
    await update({
      text: previous.text,
      presentation: previous.presentation,
      lowerThird: previous.lowerThird,
      blackout: previous.blackout,
      logo: previous.logo,
    });
  };
  const projectLiveAudienceQr = async (qr = liveAudienceQr) => {
    if (!qr) return;
    if (!liveAudienceQrOnAir) beforeLiveAudienceQr.current = structuredClone(state);
    await window.flProyector.openProjection();
    await update({
      blackout: false,
      logo: false,
      presentation: { visible: false },
      lowerThird: { visible: false },
      text: {
        visible: true,
        kind: "anuncio",
        html: `<div data-live-audience-qr="true" class="live-audience-projection"><span>ESCANEA EL QR CON EL CELULAR</span><strong>SEGUÍ CANCIONES Y BIBLIA EN VIVO</strong><img src="${qr}" alt="Código QR"></div>`,
        fontSize: 48,
        fontFamily: "Inter",
        color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0)",
        position: "center",
        align: "center",
        template: "plain",
        animation: "fade",
        shadowEnabled: true,
        shadowColor: "#000000",
        shadowBlur: 14,
      },
    });
    refreshStatus();
  };
  const toggleLiveAudienceQr = async () => {
    if (liveAudienceQrOnAir) {
      await restoreBeforeLiveAudienceQr();
      return;
    }
    let nextStatus = liveAudienceStatus;
    if (!nextStatus.active) {
      if (!status.remoteUrls[0]) return;
      nextStatus = await window.flProyector.startLiveAudience();
      setLiveAudienceStatus(nextStatus);
    }
    const nextUrl = status.remoteUrls[0] && nextStatus.code
      ? `${status.remoteUrls[0]}/live/${nextStatus.code}`
      : "";
    const nextQr = nextUrl
      ? await QRCode.toDataURL(nextUrl, {
          width: 900,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#111827", light: "#ffffff" },
        })
      : "";
    if (nextQr) {
      setLiveAudienceQr(nextQr);
      await projectLiveAudienceQr(nextQr);
    }
  };
  const stopLiveAudience = async () => {
    if (liveAudienceQrOnAir) await restoreBeforeLiveAudienceQr();
    setLiveAudienceStatus(await window.flProyector.stopLiveAudience());
    setLiveAudienceQr("");
  };
  useEffect(() => {
    localStorage.setItem(`fl-layout-live-${tab}`, String(livePanelWidth));
  }, [tab, livePanelWidth]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <MonitorPlay size={22} />
          </div>
          <div>
            <strong>FL PROYECTOR</strong>
            <span>Control de proyección</span>
          </div>
        </div>
        <div className="on-air">
          <i className={status.open ? "live" : ""} />
          {status.open ? "Proyección activa" : "Salida cerrada"} ·{" "}
          {status.displays.length} monitor
          {status.displays.length !== 1 ? "es" : ""}
        </div>
        <button
          className={status.open ? "project-button active" : "project-button"}
          onClick={async () => {
            status.open
              ? await window.flProyector.closeProjection()
              : await window.flProyector.openProjection();
            refreshStatus();
          }}
        >
          {status.open ? <X size={18} /> : <MonitorUp size={18} />}{" "}
          {status.open ? "Cerrar proyector" : "Enviar al proyector"}
        </button>
      </header>
      <div
        className="workspace"
        style={
          {
            "--live-panel-width": `${livePanelWidth}px`,
          } as CSSProperties
        }
      >
        <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
            title={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
          >
            {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </button>
          <nav>
            <button
              className={tab === "reuniones" ? "active" : ""}
              onClick={() => setTab("reuniones")}
              title={sidebarCollapsed ? "Reuniones" : undefined}
            >
              <CalendarRange />
              <span>Reuniones</span>
            </button>
            <button
              className={tab === "canciones" ? "active" : ""}
              onClick={() => setTab("canciones")}
              title={sidebarCollapsed ? "Canciones" : undefined}
            >
              <Music2 />
              <span>Canciones</span>
            </button>
            <button
              className={tab === "fondos" ? "active" : ""}
              onClick={() => setTab("fondos")}
              title={sidebarCollapsed ? "Fondos" : undefined}
            >
              <Film />
              <span>Fondos</span>
            </button>
            <button
              className={tab === "biblia" ? "active" : ""}
              onClick={() => setTab("biblia")}
              title={sidebarCollapsed ? "Biblia" : undefined}
            >
              <BookOpenText />
              <span>Biblia</span>
            </button>
            <button
              className={tab === "remoto" ? "active" : ""}
              onClick={() => setTab("remoto")}
              title={sidebarCollapsed ? "Remoto" : undefined}
            >
              <Smartphone />
              <span>Remoto</span>
            </button>
            <button
              className={tab === "ajustes" ? "active" : ""}
              onClick={() => setTab("ajustes")}
              title={sidebarCollapsed ? "Ajustes" : undefined}
            >
              <Settings />
              <span>Ajustes</span>
            </button>
          </nav>
          <div className="sidebar-bottom">
            <button
              onClick={() => setShowHelp(true)}
              title={sidebarCollapsed ? "Ayuda" : undefined}
            >
              <CircleHelp />
              <span>Ayuda</span>
            </button>
          </div>
        </aside>
        <main className="content">
          {tab === "reuniones" && (
            <MeetingBuilder
              state={state}
              update={update}
              meetingId={meetingId}
              setMeetingId={setMeetingId}
              focusedItemId={focusedMeetingItemId}
              onFocusedItem={() => setFocusedMeetingItemId(null)}
            />
          )}{" "}
          {tab === "canciones" && (
            <SongLibrary
              meetingId={meetingId}
              onAddToMeeting={(itemId) => {
                setFocusedMeetingItemId(itemId);
                setTab("reuniones");
              }}
            />
          )}{" "}
          {tab === "fondos" && <MediaLibrary state={state} update={update} />}{" "}
          {tab === "biblia" && <BibleOperator state={state} update={update} />}{" "}
          {tab === "remoto" && (
            <RemotePanel urls={status.remoteUrls} />
          )}{" "}
          {tab === "ajustes" && (
            <SettingsPanel
              state={state}
              update={update}
              displays={status.displays}
              onPreviewChange={setSettingsPreview}
              onDisplayPreviewChange={setDisplayPreviewSettings}
            />
          )}
        </main>
        {showSidePreview && <ColumnResizer
          label="Cambiar ancho de la vista en vivo"
          onResize={(delta) =>
            setLivePanelWidths((widths) => ({
              ...widths,
              [tab]: clampColumnWidth(
                widths[tab] - delta,
                300,
                maximumLivePanelWidth(tab),
              ),
            }))
          }
        />}
        {showSidePreview && <aside className="live-panel">
          <div className="panel-heading">
            <div>
              <span className="live-dot" />
              {isSettings ? "Vista previa de ajustes" : "Vista en vivo"}
            </div>
            <span>
              {activeDisplaySettings.aspectRatio === "auto"
                ? `${previewDisplay?.width || 0}×${previewDisplay?.height || 0}`
                : activeDisplaySettings.aspectRatio === "custom"
                  ? "16:9"
                  : activeDisplaySettings.aspectRatio}
            </span>
          </div>
          <div className="preview-frame" style={{ aspectRatio: previewAspectRatio, backgroundColor: activeDisplaySettings.backgroundColor }}>
            <ProjectionStage
              state={settingsPreview ?? state}
              preview
              onVideoMetadata={isSettings ? undefined : handleVideoMetadata}
              onVideoTime={isSettings ? undefined : handleVideoTime}
              onPresentationSlideCount={(count) => {
                if (!isSettings && count !== state.presentation.slideCount)
                  update({ presentation: { slideCount: count } });
              }}
            />
            {!isSettings && <div className="preview-label">En vivo</div>}
          </div>
          {isSettings ? <p className="settings-preview-note">Esta vista sirve solo para diseñar. La proyección en vivo no cambia hasta que guardes y envíes contenido.</p> : <><LiveContentControls
            state={state}
            update={update}
            videoTime={videoTime}
            videoDuration={videoDuration}
            setVideoTime={setVideoTime}
          />
          <div className="master-controls">
            <span className="eyebrow">Controles maestros</span>
            <div className="master-grid master-grid-four">
              <button
                className={state.blackout ? "active red" : ""}
                onClick={() => update({ blackout: !state.blackout })}
              >
                <Square fill="currentColor" />
                Pantalla negra
              </button>
              <button
                className={liveAudienceQrOnAir ? "active red" : ""}
                aria-label={liveAudienceQrOnAir ? "Quitar QR de la proyección" : "Proyectar QR en vivo"}
                title="Clic: mostrar o quitar QR · Clic derecho: administrar sesión"
                onClick={toggleLiveAudienceQr}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setShowLiveAudienceDialog(true);
                }}
              >
                <QrCode aria-hidden="true" />
                <small aria-hidden="true">{liveAudienceStatus.viewers} conectado{liveAudienceStatus.viewers === 1 ? "" : "s"}</small>
              </button>
              <button
                aria-label="Limpiar textos de la proyección"
                title="Oculta Biblia, canciones, anuncios y alertas; conserva el fondo"
                onClick={() =>
                  update({
                    text: { visible: false, html: "" },
                    lowerThird: { visible: false },
                    alert: { visible: false },
                  })
                }
              >
                <Eraser aria-hidden="true" />
                Limpiar texto
              </button>
              <button
                className={state.logo ? "active blue" : ""}
                onClick={() => update({ logo: !state.logo })}
              >
                <MonitorPlay />
                {state.logo ? "Ocultar logo" : "Mostrar logo"}
              </button>
            </div>
          </div>
          <div className="background-controls">
            <div className="background-control">
              <div className="control-title">
                <span>
                  Atenuado del fondo
                  <small>Mejora la legibilidad del texto</small>
                </span>
                <b>{state.background.dim}%</b>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                value={state.background.dim}
                style={
                  {
                    "--range-progress": `${(state.background.dim / 80) * 100}%`,
                  } as CSSProperties
                }
                onChange={(e) =>
                  update({ background: { dim: Number(e.target.value) } })
                }
              />
            </div>
            <div className="background-control">
              <div className="control-title">
                <span>
                  Desenfoque
                  <small>Suaviza solamente el fondo</small>
                </span>
                <b>{state.background.blur}px</b>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                value={state.background.blur}
                style={
                  {
                    "--range-progress": `${(state.background.blur / 20) * 100}%`,
                  } as CSSProperties
                }
                onChange={(e) =>
                  update({ background: { blur: Number(e.target.value) } })
                }
              />
            </div>
            {state.background.kind === "video" && (
              <div className="speed-control">
                <div>
                  <span>Velocidad del video</span>
                  <small>Solo afecta el fondo en movimiento</small>
                </div>
                <div className="speed-options">
                  {([0.5, 1, 1.5] as const).map((speed) => (
                    <button
                      className={
                        state.background.speed === speed ? "active" : ""
                      }
                      onClick={() => update({ background: { speed } })}
                      key={speed}
                    >
                      {speed}×
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="overlay-controls">
              <button
                className={`overlay-action ${state.timer.visible ? "active" : ""}`}
                aria-pressed={state.timer.visible}
                onClick={() => update({ timer: state.timer.running ? { running: false, remaining: timerRemaining } : { visible: true, running: true, startedAt: Date.now(), remaining: timerRemaining || state.timer.duration } })}
                onContextMenu={(event) => { event.preventDefault(); openOverlaySettings("timer"); }}
                title="Clic derecho: configurar cronómetro"
              >
                <Timer />
                {state.timer.running
                  ? "Pausar"
                  : state.timer.visible
                    ? "Reanudar"
                    : "Cronómetro"}
              </button>
              <button
                className="overlay-action stop-overlay"
                disabled={!state.timer.visible}
                onClick={() => update({ timer: { visible: false, running: false, remaining: state.timer.duration, startedAt: 0 } })}
              >
                Detener
              </button>
              <button
                className={`overlay-action ${state.clock.visible ? "active" : ""}`}
                aria-pressed={state.clock.visible}
                onClick={() => update({ clock: { visible: !state.clock.visible } })}
                onContextMenu={(event) => { event.preventDefault(); openOverlaySettings("clock"); }}
                title="Clic derecho: configurar hora"
              >
                <Clock />
                {state.clock.visible ? "Ocultar hora" : "Mostrar hora"}
              </button>
            </div>
            <div className="alert-control-row">
              <button
                className={`overlay-action alert-action ${state.alert.visible ? "active" : ""}`}
                aria-pressed={state.alert.visible}
                onClick={() =>
                  update({ alert: { visible: !state.alert.visible } })
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  setShowAlertSettings(true);
                }}
                title="Clic derecho: configurar alerta"
              >
                <BellRing />
                {state.alert.visible ? "Ocultar alerta" : "Alertas"}
              </button>
            </div>
          </div>
          </>}
        </aside>}
      </div>
      {overlaySettings && (
        <OverlaySettingsDialog
          kind={overlaySettings}
          timer={state.timer}
          clock={state.clock}
          onClose={() => setOverlaySettings(null)}
          onSave={(values) => {
            if (values.kind === "timer") {
              const duration = Math.max(
                1,
                Math.floor(values.minutes) * 60 + Math.floor(values.seconds),
              );
              update({ timer: { duration, remaining: duration, running: false, visible: false, startedAt: 0, position: values.position, fontSize: values.fontSize, color: values.color } });
            } else {
              update({ clock: { position: values.position, fontSize: values.fontSize, color: values.color } });
            }
            setOverlaySettings(null);
          }}
        />
      )}
      {showAlertSettings && (
        <AlertSettingsDialog
          alert={state.alert}
          onClose={() => setShowAlertSettings(false)}
          onSave={(values) => {
            localStorage.setItem("fl-overlay-alert", JSON.stringify(values));
            update({ alert: values });
            setShowAlertSettings(false);
          }}
        />
      )}
      {showLiveAudienceDialog && (
        <LiveAudienceDialog
          status={liveAudienceStatus}
          url={liveAudienceUrl}
          qr={liveAudienceQr}
          qrOnAir={liveAudienceQrOnAir}
          networkAvailable={Boolean(status.remoteUrls[0])}
          onClose={() => setShowLiveAudienceDialog(false)}
          onStart={startLiveAudience}
          onToggleQr={toggleLiveAudienceQr}
          onStop={stopLiveAudience}
        />
      )}
      <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
      <SaveNotificationHost />
    </div>
  );
}

function OverlaySettingsDialog({
  kind, timer, clock, onClose, onSave,
}: {
  kind: "timer" | "clock";
  timer: ReturnType<typeof useProjectionState>["state"]["timer"];
  clock: ReturnType<typeof useProjectionState>["state"]["clock"];
  onClose: () => void;
  onSave: (values: { kind: "timer" | "clock"; minutes: number; seconds: number; position: "top" | "center" | "bottom"; fontSize: number; color: string }) => void;
}) {
  const source = kind === "timer" ? timer : clock;
  // Keep number fields as text while editing. Clamping on every keystroke
  // prevents clearing "18" before typing a value such as "400".
  const timerDuration = Math.max(1, Math.round(timer.duration));
  const [minutesInput, setMinutesInput] = useState(
    String(Math.floor(timerDuration / 60)),
  );
  const [secondsInput, setSecondsInput] = useState(
    String(timerDuration % 60),
  );
  const [position, setPosition] = useState(source.position);
  const [fontSizeInput, setFontSizeInput] = useState(String(source.fontSize));
  const [color, setColor] = useState(source.color);
  const label = kind === "timer" ? "Cronómetro" : "Hora";
  const save = () => onSave({
    kind,
    minutes: Math.max(0, Math.floor(Number(minutesInput) || 0)),
    seconds: Math.min(
      59,
      Math.max(0, Math.floor(Number(secondsInput) || 0)),
    ),
    position,
    fontSize: Math.min(200, Math.max(18, Number(fontSizeInput) || 18)),
    color,
  });

  return (
    <Win11SettingsDialog
      title={`Configurar ${label}`}
      icon={kind === "timer" ? <Timer /> : <Clock />}
      onCancel={onClose}
      onSave={save}
    >
      {kind === "timer" && (
        <label className="win11-settings-field">
          <span>Minutos</span>
          <input
            className="win11-number-box"
            type="number"
            min="0"
            value={minutesInput}
            onChange={(event) => setMinutesInput(event.target.value)}
          />
        </label>
      )}
      {kind === "timer" && (
        <label className="win11-settings-field">
          <span>Segundos</span>
          <input
            className="win11-number-box"
            type="number"
            min="0"
            max="59"
            value={secondsInput}
            onChange={(event) => setSecondsInput(event.target.value)}
          />
        </label>
      )}
      <label className="win11-settings-field">
        <span>Ubicación</span>
        <select
          value={position}
          onChange={(event) => setPosition(event.target.value as "top" | "center" | "bottom")}
        >
          <option value="top">Parte superior</option>
          <option value="center">Centro</option>
          <option value="bottom">Parte inferior</option>
        </select>
      </label>
      <label className="win11-settings-field">
        <span>Tamaño</span>
        <input
          className="win11-number-box"
          type="number"
          min="18"
          max="200"
          value={fontSizeInput}
          onChange={(event) => setFontSizeInput(event.target.value)}
        />
      </label>
      <label className="win11-settings-field">
        <span>Color</span>
        <span className="win11-settings-color">
          <input
            type="color"
            value={color}
            aria-label="Elegir color"
            onChange={(event) => setColor(event.target.value)}
          />
          <code>{color.toUpperCase()}</code>
        </span>
      </label>
    </Win11SettingsDialog>
  );
}

function AlertSettingsDialog({
  alert,
  onClose,
  onSave,
}: {
  alert: ReturnType<typeof useProjectionState>["state"]["alert"];
  onClose: () => void;
  onSave: (values: Omit<ReturnType<typeof useProjectionState>["state"]["alert"], "visible">) => void;
}) {
  const [message, setMessage] = useState(alert.message);
  const [position, setPosition] = useState(alert.position);
  const [fontSizeInput, setFontSizeInput] = useState(String(alert.fontSize));
  const [color, setColor] = useState(alert.color);
  const [animation, setAnimation] = useState(alert.animation);
  const fontSize = Math.min(160, Math.max(18, Number(fontSizeInput) || 18));

  return (
    <Win11SettingsDialog
      title="Configurar alerta"
      icon={<BellRing />}
      description="Escribí el aviso que se mostrará sobre el contenido proyectado."
      onCancel={onClose}
      saveDisabled={!message.trim()}
      onSave={() =>
        onSave({
          message: message.trim(),
          position,
          fontSize,
          color,
          animation,
        })
      }
    >
      <label className="win11-settings-field win11-settings-full">
        <span>Mensaje de la alerta</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ej. Bebé llorando o auto blanco mal estacionado"
          rows={2}
        />
      </label>
      <label className="win11-settings-field">
        <span>Ubicación</span>
        <select
          value={position}
          onChange={(event) =>
            setPosition(event.target.value as typeof position)
          }
        >
          <option value="top">Parte superior</option>
          <option value="center">Centro</option>
          <option value="bottom">Parte inferior</option>
        </select>
      </label>
      <label className="win11-settings-field">
        <span>Movimiento</span>
        <select
          value={animation}
          onChange={(event) =>
            setAnimation(event.target.value as typeof animation)
          }
        >
          <option value="none">Sin movimiento</option>
          <option value="pulse">Pulso suave</option>
          <option value="scroll">Desplazamiento horizontal</option>
          <option value="bounce">Rebote suave</option>
        </select>
      </label>
      <label className="win11-settings-field">
        <span>Tamaño</span>
        <input
          className="win11-number-box"
          type="number"
          min="18"
          max="160"
          value={fontSizeInput}
          onChange={(event) => setFontSizeInput(event.target.value)}
        />
      </label>
      <label className="win11-settings-field">
        <span>Color del texto</span>
        <span className="win11-settings-color">
          <input
            type="color"
            value={color}
            aria-label="Elegir color del texto"
            onChange={(event) => setColor(event.target.value)}
          />
          <code>{color.toUpperCase()}</code>
        </span>
      </label>
      <div className="alert-dialog-preview win11-settings-full">
        <span
          className={`alert-preview-text alert-animation-${animation}`}
          style={{ color, fontSize: `${Math.min(28, fontSize * 0.45)}px` }}
        >
          <span>{message.trim() || "Vista previa de la alerta"}</span>
        </span>
      </div>
    </Win11SettingsDialog>
  );
}

function formatMediaTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function LiveContentControls({
  state,
  update,
  videoTime,
  videoDuration,
  setVideoTime,
}: {
  state: ReturnType<typeof useProjectionState>["state"];
  update: ReturnType<typeof useProjectionState>["update"];
  videoTime: number;
  videoDuration: number;
  setVideoTime: (value: number) => void;
}) {
  if (state.presentation.visible) {
    const count = state.presentation.slideCount;
    const index = state.presentation.slideIndex;
    const move = (direction: -1 | 1) =>
      update({
        presentation: {
          slideIndex: Math.max(
            0,
            Math.min(index + direction, Math.max(count - 1, 0)),
          ),
        },
      });
    return (
      <section className="live-media-controls presentation-live-controls">
        <div className="live-control-title">
          <span>CONTROL DE POWERPOINT</span>
          <b>{state.presentation.name}</b>
        </div>
        <div className="live-presentation-status">
          Diapositiva <strong>{index + 1}</strong> de{" "}
          <strong>{count || "—"}</strong>
        </div>
        <div className="live-presentation-buttons">
          <button disabled={index === 0} onClick={() => move(-1)}>
            <ChevronLeft />
            Anterior
          </button>
          <button
            disabled={count > 0 && index >= count - 1}
            onClick={() => move(1)}
          >
            Siguiente
            <ChevronRight />
          </button>
        </div>
      </section>
    );
  }
  if (state.background.kind !== "video") return null;
  const seek = (value: number) => {
    const target = Math.max(0, Math.min(value, videoDuration || value));
    setVideoTime(target);
    update({
      video: {
        seekTime: target,
        currentTime: target,
        commandId: state.video.commandId + 1,
      },
    });
  };
  return (
    <section className="live-media-controls">
      <div className="live-control-title">
        <span>CONTROL DE VIDEO</span>
        <b>{state.background.name}</b>
      </div>
      <div className="video-transport">
        <button
          className="transport-main"
          title={state.video.playing ? "Pausar" : "Reproducir"}
          onClick={() => update({ video: { playing: !state.video.playing } })}
        >
          {state.video.playing ? (
            <Pause fill="currentColor" />
          ) : (
            <Play fill="currentColor" />
          )}
        </button>
        <input
          aria-label="Posición del video"
          type="range"
          min="0"
          max={Math.max(videoDuration, 1)}
          step="0.1"
          value={Math.min(videoTime, Math.max(videoDuration, 1))}
          onInput={(event) => setVideoTime(Number(event.currentTarget.value))}
          onPointerUp={(event) => {
            seek(Number(event.currentTarget.value));
          }}
          onKeyUp={(event) => seek(Number(event.currentTarget.value))}
        />
        <span>
          {formatMediaTime(videoTime)} / {formatMediaTime(videoDuration)}
        </span>
      </div>
      <div className="video-volume">
        <button
          title={state.video.muted ? "Activar sonido" : "Silenciar"}
          onClick={() => update({ video: { muted: !state.video.muted } })}
        >
          {state.video.muted ? <VolumeX /> : <Volume2 />}
        </button>
        <input
          aria-label="Volumen"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={state.video.volume}
          onChange={(event) =>
            update({
              video: { volume: Number(event.target.value), muted: false },
            })
          }
        />
        <b>
          {state.video.muted
            ? "MUTE"
            : `${Math.round(state.video.volume * 100)}%`}
        </b>
      </div>
    </section>
  );
}
