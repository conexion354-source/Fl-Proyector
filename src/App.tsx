import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import {
  MonitorPlay,
  Download,
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
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ProjectionPreview } from "./components/ProjectionStage";
import { MediaLibrary } from "./components/MediaLibrary";
import { SongLibrary } from "./components/SongLibrary";
import { BibleOperator } from "./components/BibleOperator";
import { SettingsPanel } from "./components/SettingsPanel";
import { MeetingBuilder } from "./components/MeetingBuilder";
import { RemotePanel } from "./components/RemotePanel";
import { LiveAudienceDialog } from "./components/LiveAudienceDialog";
import { Win11ContextMenu } from "./components/Win11ContextMenu";
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
import { isEditableTarget, loadShortcuts, normalizeShortcut, type ShortcutAction } from "./keyboardShortcuts";
import {
  initialDisplaySettings,
  initialProjectionState,
  clampImageZoom,
  MAX_IMAGE_ZOOM,
  type ImageZoom,
  type DisplayInfo,
  type DisplaySettings,
  type LiveAudienceStatus,
  type SavedAlert,
  type UpdateStatus,
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
  const [livePanelCollapsed, setLivePanelCollapsed] = useState(
    () => localStorage.getItem("fl-live-panel-collapsed") === "1",
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
  const videoClock = useRef({ time: 0, observedAt: performance.now() });
  const lastVideoTelemetry = useRef({ time: -1, sentAt: 0 });
  const [showHelp, setShowHelp] = useState(false);
  const [overlaySettings, setOverlaySettings] = useState<"timer" | "clock" | null>(null);
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const [savedAlerts, setSavedAlerts] = useState<SavedAlert[]>([]);
  const [editingSavedAlert, setEditingSavedAlert] = useState<SavedAlert | null>(null);
  const [savedAlertContext, setSavedAlertContext] = useState<{
    alert: SavedAlert;
    x: number;
    y: number;
  } | null>(null);
  const [showLiveAudienceDialog, setShowLiveAudienceDialog] = useState(false);
  const [liveAudienceStatus, setLiveAudienceStatus] = useState<LiveAudienceStatus>({ active: false, code: null, viewers: 0 });
  const [liveAudienceQr, setLiveAudienceQr] = useState("");
  const beforeLiveAudienceQr = useRef<typeof state | null>(null);
  const [settingsPreview, setSettingsPreview] = useState<ReturnType<typeof useProjectionState>["state"] | null>(null);
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(initialDisplaySettings);
  const [displayPreviewSettings, setDisplayPreviewSettings] = useState<DisplaySettings | null>(null);
  const [liveState, setLiveState] = useState(initialProjectionState);
  const [projectionFrozen, setProjectionFrozen] = useState(false);
  const [floatingPreviewOpen, setFloatingPreviewOpen] = useState(false);
  const [previewPanelMode, setPreviewPanelMode] = useState<"live" | "prepare">("live");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateNoticeDismissed, setUpdateNoticeDismissed] = useState(false);
  const [openVersionSectionSignal, setOpenVersionSectionSignal] = useState(0);
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
    let active = true;
    void window.flProyector.getLiveState().then((next) => active && setLiveState(next));
    void window.flProyector.getProjectionFrozen().then((next) => active && setProjectionFrozen(next));
    void window.flProyector.getFloatingPreviewOpen().then((next) => active && setFloatingPreviewOpen(next));
    const stopLive = window.flProyector.onLiveState(setLiveState);
    const stopFrozen = window.flProyector.onProjectionFreezeStatus(setProjectionFrozen);
    const stopFloating = window.flProyector.onFloatingPreviewStatus(setFloatingPreviewOpen);
    return () => {
      active = false;
      stopLive();
      stopFrozen();
      stopFloating();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const receive = (next: UpdateStatus) => {
      if (!active) return;
      setUpdateStatus(next);
    };
    const unsubscribe = window.flProyector.onUpdateStatus(receive);
    void window.flProyector.getUpdateStatus().then(async (initial) => {
      if (!active) return;
      receive(initial);
      if (
        initial.packaged &&
        (initial.state === "idle" ||
          initial.state === "current" ||
          initial.state === "error")
      ) {
        receive(await window.flProyector.checkForUpdates());
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (updateStatus?.availableVersion) setUpdateNoticeDismissed(false);
  }, [updateStatus?.availableVersion]);
  useEffect(() => {
    const runShortcut = async (action: ShortcutAction) => {
      if (["reuniones", "canciones", "fondos", "biblia", "remoto", "ajustes"].includes(action)) {
        setTab(action as Tab);
        return;
      }
      if (action === "proyector") {
        if (!status.open) await window.flProyector.openProjection();
        refreshStatus();
        return;
      }
      if (action === "cerrarProyector") {
        if (status.open) await window.flProyector.closeProjection();
        refreshStatus();
        return;
      }
      if (action === "logo") {
        await toggleLogo();
        return;
      }
      if (action === "qr") {
        await toggleLiveAudienceQr();
        return;
      }
      if (action === "congelar") {
        await toggleFreeze();
        return;
      }
      if (action === "pantallaNegra") {
        await update({ blackout: !state.blackout });
        return;
      }
      await window.flProyector.clearProjectionContent();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.repeat || isEditableTarget(event.target)) return;
      const pressed = normalizeShortcut(event).toLowerCase();
      const action = (Object.entries(loadShortcuts()) as [ShortcutAction, string][])
        .find(([, shortcut]) => shortcut.trim().toLowerCase() === pressed)?.[0];
      if (!action) return;
      event.preventDefault();
      void runShortcut(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [projectionFrozen, state.blackout, state.logo, status.open, update]);
  useEffect(() => {
    localStorage.setItem("fl-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  useEffect(() => {
    localStorage.setItem("fl-live-panel-collapsed", livePanelCollapsed ? "1" : "0");
  }, [livePanelCollapsed]);
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
    window.flProyector.getSavedAlerts().then(setSavedAlerts);
  }, []);
  const saveAlertList = (next: SavedAlert[]) => {
    setSavedAlerts(next);
    void window.flProyector.saveSavedAlerts(next);
  };
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
  const updateVideoTime = useCallback((time: number) => {
    const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
    videoClock.current = { time: safeTime, observedAt: performance.now() };
    setVideoTime(safeTime);
  }, []);
  useEffect(() => {
    updateVideoTime(0);
    setVideoDuration(0);
  }, [state.background.id, state.background.url, updateVideoTime]);
  useEffect(() => {
    if (tab !== "ajustes") setSettingsPreview(null);
  }, [tab]);
  const handleVideoMetadata = (duration: number) => {
    setVideoDuration(duration);
    if (Number.isFinite(duration) && Math.abs(state.video.duration - duration) > 0.1)
      update({ video: { duration } });
  };
  const handleVideoTime = (time: number) => {
    updateVideoTime(time);
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
  useEffect(() => {
    if (
      state.background.kind !== "video" ||
      !state.video.playing ||
      videoDuration <= 0
    )
      return;
    let frame = 0;
    const animate = () => {
      const elapsed = Math.max(0, (performance.now() - videoClock.current.observedAt) / 1000);
      const raw = videoClock.current.time + elapsed * state.background.speed;
      const next = state.video.loop
        ? raw % videoDuration
        : Math.min(videoDuration, raw);
      setVideoTime((current) =>
        Math.abs(current - next) > 0.004 ? next : current,
      );
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [state.background.kind, state.background.speed, state.video.loop, state.video.playing, videoDuration]);
  // El atajo y el botón hacen exactamente lo mismo: mostrar el logo siempre
  // saca la pantalla negra, para que el logo realmente se vea.
  const toggleLogo = () => update({ logo: !state.logo, blackout: false });
  const toggleFreeze = async () => {
    const frozen = await window.flProyector.setProjectionFrozen(!projectionFrozen);
    setProjectionFrozen(frozen);
    setPreviewPanelMode(frozen ? "prepare" : "live");
  };
  const outputState = !status.open
    ? { tone: "idle", label: "Proyector apagado" }
    : state.blackout
      ? { tone: "black", label: "Pantalla negra" }
      : projectionFrozen
        ? { tone: "frozen", label: "En vivo · congelado" }
        : { tone: "live", label: "En vivo" };
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
    // The QR is content for the configured projector. Do not create a new
    // floating output window merely because the operator shares the QR.
    await update({
      blackout: false,
      logo: false,
      presentation: { visible: false },
      lowerThird: { visible: false },
      text: {
        visible: true,
        kind: "anuncio",
        html: `<div data-live-audience-qr="true" class="live-audience-projection"><strong>SEGUÍ LA REUNIÓN EN TU MÓVIL</strong><img src="${qr}" alt="Código QR"></div>`,
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
        <div
          className={`on-air on-air-${outputState.tone}`}
          role="status"
          aria-live="polite"
          title={`${status.displays.length} monitor${status.displays.length !== 1 ? "es" : ""} conectado${status.displays.length !== 1 ? "s" : ""}`}
        >
          <i className={status.open ? "live" : ""} />
          <strong>{outputState.label}</strong>
          <span>
            {status.displays.length} monitor
            {status.displays.length !== 1 ? "es" : ""}
          </span>
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
            "--live-panel-width": `${showSidePreview && livePanelCollapsed ? 52 : livePanelWidth}px`,
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
              previewAspectRatio={previewAspectRatio}
              meetingId={meetingId}
              setMeetingId={setMeetingId}
              focusedItemId={focusedMeetingItemId}
              onFocusedItem={() => setFocusedMeetingItemId(null)}
            />
          )}{" "}
          {tab === "canciones" && (
            <SongLibrary
              meetingId={meetingId}
              onAddToMeeting={(targetMeetingId, itemId) => {
                setMeetingId(targetMeetingId);
                setFocusedMeetingItemId(itemId);
                setTab("reuniones");
              }}
            />
          )}{" "}
          {tab === "fondos" && <MediaLibrary state={state} update={update} />}{" "}
          {tab === "biblia" && <BibleOperator state={state} update={update} projectionFrozen={projectionFrozen} />}{" "}
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
              openVersionSectionSignal={openVersionSectionSignal}
            />
          )}
        </main>
        {showSidePreview && !livePanelCollapsed && <ColumnResizer
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
        {showSidePreview && livePanelCollapsed && (
          <aside className="live-panel live-panel-rail" aria-label="Controles en vivo (panel contraído)">
            <button
              type="button"
              className="rail-expand"
              title="Mostrar la vista en vivo"
              aria-label="Mostrar la vista en vivo"
              onClick={() => setLivePanelCollapsed(false)}
            >
              <ChevronLeft />
            </button>
            <span className={`rail-status on-air-${outputState.tone}`} title={outputState.label}>
              <i />
            </span>
            <span className="rail-label">Vista en vivo</span>
            <div className="rail-actions">
              <button
                type="button"
                className={projectionFrozen ? "active amber" : ""}
                title={projectionFrozen ? "Publicar" : "Congelar"}
                aria-label={projectionFrozen ? "Publicar" : "Congelar"}
                onClick={toggleFreeze}
              >
                {projectionFrozen ? <Play /> : <Pause />}
              </button>
              <button
                type="button"
                className={state.blackout ? "active red" : ""}
                title="Pantalla negra"
                aria-label="Pantalla negra"
                onClick={() => update({ blackout: !state.blackout })}
              >
                <Square fill="currentColor" />
              </button>
              <button
                type="button"
                title="Limpiar pantalla"
                aria-label="Limpiar pantalla"
                onClick={() => window.flProyector.clearProjectionContent()}
              >
                <Eraser />
              </button>
              <button
                type="button"
                className={state.logo ? "active blue" : ""}
                title={state.logo ? "Ocultar logo" : "Mostrar logo"}
                aria-label={state.logo ? "Ocultar logo" : "Mostrar logo"}
                onClick={toggleLogo}
              >
                <MonitorPlay />
              </button>
            </div>
          </aside>
        )}
        {showSidePreview && !livePanelCollapsed && <aside className="live-panel">
          <div className="panel-heading">
            <div>
              <span className="live-dot" />
              {isSettings ? "Vista previa de ajustes" : previewPanelMode === "live" ? "Vista en vivo" : "Preparación"}
            </div>
            {!isSettings && <div className="preview-panel-actions">
              <div className="preview-mode-switch" aria-label="Elegir vista previa">
                <button className={previewPanelMode === "live" ? "active" : ""} onClick={() => setPreviewPanelMode("live")}>En vivo</button>
                <button className={previewPanelMode === "prepare" ? "active" : ""} onClick={() => setPreviewPanelMode("prepare")}>Preparar</button>
              </div>
              <button
                className={floatingPreviewOpen ? "preview-float-button active" : "preview-float-button"}
                aria-label={floatingPreviewOpen ? "Cerrar vista previa flotante" : "Abrir vista previa flotante"}
                title={floatingPreviewOpen ? "Cerrar vista previa flotante" : "Abrir vista previa flotante y ajustable"}
                onClick={async () => setFloatingPreviewOpen(await window.flProyector.setFloatingPreviewOpen(!floatingPreviewOpen))}
              >
                <MonitorUp />
              </button>
            </div>}
            <span>
              {activeDisplaySettings.aspectRatio === "auto"
                ? `${previewDisplay?.width || 0}×${previewDisplay?.height || 0}`
                : activeDisplaySettings.aspectRatio === "custom"
                  ? "16:9"
                  : activeDisplaySettings.aspectRatio}
            </span>
            <button
              type="button"
              className="live-panel-collapse"
              title="Contraer el panel para ganar espacio"
              aria-label="Contraer la vista en vivo"
              onClick={() => setLivePanelCollapsed(true)}
            >
              <ChevronRight />
            </button>
          </div>
          <div className="preview-frame" style={{ aspectRatio: previewAspectRatio, backgroundColor: activeDisplaySettings.backgroundColor }}>
            <ProjectionPreview
              state={isSettings ? (settingsPreview ?? state) : previewPanelMode === "live" ? liveState : state}
              onVideoMetadata={isSettings ? undefined : handleVideoMetadata}
              onVideoTime={isSettings ? undefined : handleVideoTime}
              onPresentationSlideCount={(count) => {
                if (!isSettings && count !== state.presentation.slideCount)
                  update({ presentation: { slideCount: count } });
              }}
              onPresentationSlideChange={(slideIndex) => {
                if (
                  !isSettings &&
                  state.presentation.visible &&
                  slideIndex !== state.presentation.slideIndex
                )
                  update({ presentation: { slideIndex } });
              }}
            />
            {!isSettings && <div className={`preview-label ${previewPanelMode === "prepare" ? "prepare" : ""}`}>
              {previewPanelMode === "live" ? (projectionFrozen ? "En vivo · congelado" : "En vivo") : "Preparación"}
            </div>}
          </div>
          {isSettings ? <p className="settings-preview-note">Esta vista sirve solo para diseñar. La proyección en vivo no cambia hasta que guardes y envíes contenido.</p> : <><LiveContentControls
            state={state}
            update={update}
            videoTime={videoTime}
            videoDuration={videoDuration}
            setVideoTime={updateVideoTime}
          />
          <div className="master-controls">
            <span className="eyebrow">Controles maestros</span>
            <div className="master-grid master-grid-five">
              <button
                className={projectionFrozen ? "active amber" : ""}
                title="Mantiene intacta la salida mientras preparás otro contenido"
                onClick={toggleFreeze}
              >
                {projectionFrozen ? <Play /> : <Pause />}
                {projectionFrozen ? "Publicar" : "Congelar"}
              </button>
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
                {liveAudienceQrOnAir ? "Quitar QR" : "QR en vivo"}
                {liveAudienceStatus.viewers > 0 && (
                  <small aria-hidden="true">{liveAudienceStatus.viewers}</small>
                )}
              </button>
              <button
                aria-label="Limpiar contenido de la proyección"
                title="Quita textos, videos, imágenes, PowerPoint y alertas; conserva el fondo global"
                onClick={() => window.flProyector.clearProjectionContent()}
              >
                <Eraser aria-hidden="true" />
                Limpiar pantalla
              </button>
              <button
                className={state.logo ? "active blue" : ""}
                onClick={toggleLogo}
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
            <section className="saved-alerts" aria-label="Alertas guardadas">
              <div className="saved-alerts-heading">
                <b>Alertas guardadas</b>
                <small>{savedAlerts.length ? `${savedAlerts.length} lista${savedAlerts.length === 1 ? "" : "s"}` : "Guardá una desde Alertas"}</small>
              </div>
              {savedAlerts.length > 0 && (
                <div className="saved-alert-list">
                  {savedAlerts.map((alert) => (
                    <div className="saved-alert-item" key={alert.id}>
                      <button
                        type="button"
                        title="Clic: mostrar u ocultar · Clic derecho: editar"
                        onClick={() => {
                          const isLive = state.alert.visible && state.alert.message === alert.message;
                          update({ alert: isLive ? { visible: false } : { ...alert, visible: true } });
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setSavedAlertContext({ alert, x: event.clientX, y: event.clientY });
                        }}
                      >
                        <BellRing />
                        <span>{state.alert.visible && state.alert.message === alert.message ? `${alert.name} · En vivo` : alert.name}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
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
          alert={editingSavedAlert ? { ...state.alert, ...editingSavedAlert, visible: false } : state.alert}
          onClose={() => {
            setShowAlertSettings(false);
            setEditingSavedAlert(null);
          }}
          onSave={(values) => {
            localStorage.setItem("fl-overlay-alert", JSON.stringify(values));
            update({ alert: values });
            const existing = editingSavedAlert ?? savedAlerts.find(
              (alert) => alert.message.toLocaleLowerCase() === values.message.toLocaleLowerCase(),
            );
            const saved: SavedAlert = {
              ...values,
              id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: values.message,
            };
            saveAlertList(
              existing
                ? savedAlerts.map((alert) => alert.id === existing.id ? saved : alert)
                : [...savedAlerts, saved],
            );
            setShowAlertSettings(false);
            setEditingSavedAlert(null);
          }}
        />
      )}
      {savedAlertContext && (
        <Win11ContextMenu
          x={savedAlertContext.x}
          y={savedAlertContext.y}
          onClose={() => setSavedAlertContext(null)}
          ariaLabel={`Opciones de ${savedAlertContext.alert.name}`}
          items={[
            {
              label: "Editar alerta (texto, color y tamaño)",
              icon: <Settings />,
              onClick: () => {
                setEditingSavedAlert(savedAlertContext.alert);
                setShowAlertSettings(true);
              },
            },
            {
              label: "Eliminar alerta",
              icon: <X />,
              danger: true,
              onClick: () => saveAlertList(
                savedAlerts.filter((item) => item.id !== savedAlertContext.alert.id),
              ),
            },
          ]}
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
      {!updateNoticeDismissed &&
        updateStatus &&
        ["available", "downloading", "downloaded"].includes(updateStatus.state) && (
          <div className="update-floating-notice" role="status" aria-live="polite">
            <button
              type="button"
              className="update-floating-main"
              onClick={() => {
                setTab("ajustes");
                setOpenVersionSectionSignal((value) => value + 1);
              }}
            >
              <span className="update-floating-icon"><Download /></span>
              <span>
                <strong>
                  {updateStatus.state === "downloaded"
                    ? "Actualización lista para instalar"
                    : `Actualización ${updateStatus.availableVersion || "nueva"} disponible`}
                </strong>
                <small>
                  {updateStatus.state === "downloading"
                    ? `Descargando… ${updateStatus.progress ?? 0}%`
                    : "Hacé clic para abrir el actualizador."}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              className="update-floating-close"
              aria-label="Cerrar aviso de actualización"
              onClick={() => setUpdateNoticeDismissed(true)}
            >
              <X />
            </button>
          </div>
        )}
      <SaveNotificationHost />
    </div>
  );
}

const overlayColors = ["#ffffff", "#fde047", "#facc15", "#fb923c", "#f87171", "#4ade80", "#38bdf8", "#c084fc"];

/** Muestras de color + color personalizado, en lugar del selector nativo. */
function SwatchPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  const normalized = value.toLowerCase();
  const custom = !overlayColors.includes(normalized);
  return (
    <div className="dlg-swatches" role="radiogroup" aria-label={label}>
      {overlayColors.map((color) => (
        <button
          type="button"
          role="radio"
          aria-checked={normalized === color}
          aria-label={`${label} ${color}`}
          title={color.toUpperCase()}
          className={normalized === color ? "active" : ""}
          style={{ background: color }}
          onClick={() => onChange(color)}
          key={color}
        />
      ))}
      <label className={`dlg-swatch-custom ${custom ? "active" : ""}`} title="Otro color">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(event) => onChange(event.target.value)} aria-label={`${label}: otro color`} />
        <span style={custom ? { background: value } : undefined} />
      </label>
      <code>{value.toUpperCase()}</code>
    </div>
  );
}

function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="dlg-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          key={option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SizeStepper({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  label: string;
}) {
  const step = (delta: number) =>
    onChange(String(Math.min(max, Math.max(min, (Number(value) || min) + delta))));
  return (
    <div className="dlg-stepper">
      <button type="button" aria-label={`Achicar ${label}`} onClick={() => step(-4)}>−</button>
      <input type="number" min={min} max={max} value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} />
      <button type="button" aria-label={`Agrandar ${label}`} onClick={() => step(4)}>+</button>
      <span>px</span>
    </div>
  );
}

const overlayPositions = [
  { value: "top" as const, label: "Arriba" },
  { value: "center" as const, label: "Centro" },
  { value: "bottom" as const, label: "Abajo" },
];

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
  const [minutesInput, setMinutesInput] = useState(String(Math.floor(timerDuration / 60)));
  const [secondsInput, setSecondsInput] = useState(String(timerDuration % 60));
  const [position, setPosition] = useState(source.position);
  const [fontSizeInput, setFontSizeInput] = useState(String(source.fontSize));
  const [color, setColor] = useState(source.color);
  const label = kind === "timer" ? "cronómetro" : "hora";
  const fontSize = Math.min(200, Math.max(18, Number(fontSizeInput) || 18));
  const minutes = Math.max(0, Math.floor(Number(minutesInput) || 0));
  const seconds = Math.min(59, Math.max(0, Math.floor(Number(secondsInput) || 0)));
  const save = () => onSave({ kind, minutes, seconds, position, fontSize, color });
  const sample =
    kind === "timer"
      ? `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Win11SettingsDialog
      title={kind === "timer" ? "Configurar cronómetro" : "Configurar hora"}
      icon={kind === "timer" ? <Timer /> : <Clock />}
      onCancel={onClose}
      onSave={save}
    >
      {kind === "timer" && (
        <div className="dlg-field win11-settings-full">
          <span>Duración</span>
          <div className="dlg-duration">
            <label><input type="number" min="0" value={minutesInput} onChange={(event) => setMinutesInput(event.target.value)} aria-label="Minutos" /> min</label>
            <label><input type="number" min="0" max="59" value={secondsInput} onChange={(event) => setSecondsInput(event.target.value)} aria-label="Segundos" /> s</label>
          </div>
        </div>
      )}
      <div className="dlg-field win11-settings-full">
        <span>Ubicación en la pantalla</span>
        <SegmentedChoice label="Ubicación" value={position} options={overlayPositions} onChange={setPosition} />
      </div>
      <div className="dlg-field">
        <span>Tamaño</span>
        <SizeStepper label={`tamaño del ${label}`} value={fontSizeInput} onChange={setFontSizeInput} min={18} max={200} />
      </div>
      <div className="dlg-field win11-settings-full">
        <span>Color</span>
        <SwatchPicker label="Color" value={color} onChange={setColor} />
      </div>
      <div className={`dlg-preview win11-settings-full position-${position}`} aria-hidden="true">
        <span style={{ color, fontSize: `${Math.max(12, Math.min(40, fontSize * 0.32))}px` }}>{sample}</span>
      </div>
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
      description="El aviso aparece sobre lo que se está proyectando. Se guarda en Alertas guardadas para usarlo otra vez."
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
      <label className="dlg-field win11-settings-full">
        <span>Mensaje</span>
        <textarea
          className="dlg-textarea"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ej. Bebé llorando en la sala cuna"
          rows={2}
          autoFocus
        />
      </label>
      <div className="dlg-field win11-settings-full">
        <span>Ubicación en la pantalla</span>
        <SegmentedChoice label="Ubicación" value={position} options={overlayPositions} onChange={setPosition} />
      </div>
      <div className="dlg-field win11-settings-full">
        <span>Movimiento</span>
        <SegmentedChoice
          label="Movimiento"
          value={animation}
          onChange={setAnimation}
          options={[
            { value: "none", label: "Fijo" },
            { value: "pulse", label: "Pulso" },
            { value: "scroll", label: "Desplazar" },
            { value: "bounce", label: "Rebote" },
          ]}
        />
      </div>
      <div className="dlg-field">
        <span>Tamaño</span>
        <SizeStepper label="tamaño de la alerta" value={fontSizeInput} onChange={setFontSizeInput} min={18} max={160} />
      </div>
      <div className="dlg-field win11-settings-full">
        <span>Color del texto</span>
        <SwatchPicker label="Color del texto" value={color} onChange={setColor} />
      </div>
      <div className={`dlg-preview win11-settings-full position-${position}`} aria-hidden="true">
        <span
          className={`alert-preview-text alert-animation-${animation}`}
          style={{ color, "--dlg-color": color, fontSize: `${Math.max(12, Math.min(30, fontSize * 0.36))}px` } as CSSProperties}
        >
          <span>{message.trim() || "Vista previa de la alerta"}</span>
        </span>
        <em>Vista previa</em>
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
    const move = (direction: -1 | 1) => {
      update({
        presentation: {
          navigationId: state.presentation.navigationId + 1,
          navigationDirection: direction,
        },
      });
    };
    return (
      <section className="live-media-controls presentation-live-controls">
        <div className="live-control-title">
          <span>Control de PowerPoint</span>
          <b>{state.presentation.name}</b>
        </div>
        <div className="live-presentation-status">
          Diapositiva <strong>{index + 1}</strong> de{" "}
          <strong>{count || "—"}</strong>
        </div>
        <div className="live-presentation-buttons">
          <button onClick={() => move(-1)}>
            <ChevronLeft />
            Anterior
          </button>
          <button onClick={() => move(1)}>
            Siguiente
            <ChevronRight />
          </button>
        </div>
      </section>
    );
  }
  if (state.background.kind === "image" && state.background.url)
    return <ImageZoomControls state={state} update={update} />;
  if (state.background.kind !== "video") return null;
  const videoProgress =
    videoDuration > 0
      ? Math.max(0, Math.min(100, (videoTime / videoDuration) * 100))
      : 0;
  const seek = (value: number) => {
    const target = Math.max(0, Math.min(value, videoDuration || value));
    setVideoTime(target);
    update({
      video: {
        seekTime: target,
        commandId: state.video.commandId + 1,
      },
    });
  };
  return (
    <section className="live-media-controls">
      <div className="live-control-title">
        <span>Control de video</span>
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
        <button
          className="transport-stop"
          title="Detener y volver al inicio"
          aria-label="Detener y volver al inicio"
          onClick={() => {
            setVideoTime(0);
            update({
              video: {
                playing: false,
                seekTime: 0,
                commandId: state.video.commandId + 1,
              },
            });
          }}
        >
          <Square fill="currentColor" />
        </button>
        <input
          aria-label="Posición del video"
          type="range"
          min="0"
          max={Math.max(videoDuration, 1)}
          step="0.1"
          value={Math.min(videoTime, Math.max(videoDuration, 1))}
          style={{ "--range-progress": `${videoProgress}%` } as CSSProperties}
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
          style={{ "--range-progress": `${Math.max(0, Math.min(100, state.video.volume * 100))}%` } as CSSProperties}
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

/**
 * Zoom sobre la imagen proyectada. En la miniatura: clic para acercar ese
 * punto, arrastrar para moverse y la rueda del mouse para acercar o alejar.
 */
function ImageZoomControls({
  state,
  update,
}: {
  state: ReturnType<typeof useProjectionState>["state"];
  update: ReturnType<typeof useProjectionState>["update"];
}) {
  const zoom = clampImageZoom(state.background.zoom);
  const [draft, setDraft] = useState<ImageZoom>(zoom);
  const dragging = useRef<{ startX: number; startY: number; origin: ImageZoom; moved: boolean } | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<ImageZoom | null>(null);
  const map = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dragging.current) setDraft(zoom);
  }, [zoom.scale, zoom.x, zoom.y]);
  const send = (next: Partial<ImageZoom>) => {
    const value = clampImageZoom({ ...draft, ...next });
    setDraft(value);
    pending.current = value;
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current) update({ background: { zoom: pending.current } });
      pending.current = null;
    });
  };
  const pointFromEvent = (event: { clientX: number; clientY: number }) => {
    const box = map.current!.getBoundingClientRect();
    // Coordenadas dentro de la parte visible → coordenadas de la imagen.
    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;
    return { x: Math.max(0, Math.min(1, px)), y: Math.max(0, Math.min(1, py)) };
  };
  // La rueda se escucha sin "passive" para que no desplace el panel.
  const wheel = useRef<(event: WheelEvent) => void>(() => {});
  wheel.current = (event: WheelEvent) => {
    event.preventDefault();
    const point = pointFromEvent(event);
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scale = Math.max(1, Math.min(MAX_IMAGE_ZOOM, draft.scale * factor));
    // Mantiene fijo el punto bajo el mouse mientras cambia el zoom.
    const keep = (center: number, target: number) => target + (center - target) * (draft.scale / scale);
    send({ scale, x: keep(draft.x, point.x), y: keep(draft.y, point.y) });
  };
  useEffect(() => {
    const element = map.current;
    if (!element) return;
    const listener = (event: WheelEvent) => wheel.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, MAX_IMAGE_ZOOM];
  const stepZoom = (direction: 1 | -1) => {
    const current = draft.scale;
    const next =
      direction === 1
        ? steps.find((value) => value > current + 0.01) ?? MAX_IMAGE_ZOOM
        : [...steps].reverse().find((value) => value < current - 0.01) ?? 1;
    send({ scale: next });
  };
  const ratio = state.outputViewport.width / Math.max(1, state.outputViewport.height) || 16 / 9;
  const view = {
    left: `${(draft.x - 0.5 / draft.scale) * 100}%`,
    top: `${(draft.y - 0.5 / draft.scale) * 100}%`,
    width: `${100 / draft.scale}%`,
    height: `${100 / draft.scale}%`,
  };
  return (
    <section className="live-media-controls image-zoom-controls">
      <div className="live-control-title">
        <span>Zoom de imagen</span>
        <b>{state.background.name}</b>
      </div>
      <div
        ref={map}
        className={`image-zoom-map ${draft.scale > 1.001 ? "is-zoomed" : ""}`}
        style={{ aspectRatio: String(ratio) }}
        title="Clic para acercar ese punto · arrastrá para moverte · rueda para acercar o alejar"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = { startX: event.clientX, startY: event.clientY, origin: draft, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragging.current;
          if (!drag) return;
          const box = map.current!.getBoundingClientRect();
          const dx = (event.clientX - drag.startX) / box.width;
          const dy = (event.clientY - drag.startY) / box.height;
          if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
          drag.moved = true;
          // Arrastrar el recuadro: se mueve en la misma dirección que el mouse.
          send({ scale: drag.origin.scale, x: drag.origin.x + dx, y: drag.origin.y + dy });
        }}
        onPointerUp={(event) => {
          const drag = dragging.current;
          dragging.current = null;
          if (!drag || drag.moved) return;
          const point = pointFromEvent(event);
          send({ scale: draft.scale > 1.001 ? draft.scale : 2, ...point });
        }}
        onPointerCancel={() => (dragging.current = null)}
      >
        <img src={state.background.url!} alt="" draggable={false} />
        {draft.scale > 1.001 && <span className="image-zoom-view" style={view} />}
      </div>
      <div className="image-zoom-bar">
        <button title="Alejar" aria-label="Alejar" disabled={draft.scale <= 1.001} onClick={() => stepZoom(-1)}>
          <ZoomOut />
        </button>
        <input
          aria-label="Nivel de zoom"
          type="range"
          min="1"
          max={MAX_IMAGE_ZOOM}
          step="0.05"
          value={draft.scale}
          style={{ "--range-progress": `${((draft.scale - 1) / (MAX_IMAGE_ZOOM - 1)) * 100}%` } as CSSProperties}
          onChange={(event) => send({ scale: Number(event.target.value) })}
        />
        <button title="Acercar" aria-label="Acercar" disabled={draft.scale >= MAX_IMAGE_ZOOM - 0.001} onClick={() => stepZoom(1)}>
          <ZoomIn />
        </button>
        <b>{Math.round(draft.scale * 100)}%</b>
        <button
          className="image-zoom-reset"
          disabled={draft.scale <= 1.001}
          onClick={() => send({ scale: 1, x: 0.5, y: 0.5 })}
        >
          Ver completa
        </button>
      </div>
    </section>
  );
}
