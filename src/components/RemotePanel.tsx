import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Copy, Eye, MonitorUp, QrCode, Radio, ShieldCheck, Smartphone, Users, X } from "lucide-react";
import type { LiveAudienceStatus, ProjectionPatch, ProjectionState } from "../../shared/types";
import { notifySaved, withSaveNotification } from "./SaveNotification";

export function RemotePanel({
  urls,
  state,
  update,
}: {
  urls: string[];
  state: ProjectionState;
  update: (patch: ProjectionPatch) => Promise<void>;
}) {
  const url = urls[0] || "";
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [collaboratorCode, setCollaboratorCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [savedCode, setSavedCode] = useState("");
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [firewallResult, setFirewallResult] = useState<"success" | "error" | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveAudienceStatus>({ active: false, code: null, viewers: 0 });
  const [liveQr, setLiveQr] = useState("");
  const [liveCopied, setLiveCopied] = useState(false);
  const beforeQr = useRef<ProjectionState | null>(null);
  const collaboratorUrl = url ? `${url}/colaborador` : "";
  const liveUrl = url && liveStatus.code ? `${url}/live/${liveStatus.code}` : "";
  const liveQrOnAir = state.text.html.includes("data-live-audience-qr");
  useEffect(() => {
    window.flProyector.getCollaboratorCode().then((code) => {
      setCollaboratorCode(code);
      setSavedCode(code);
    });
  }, []);
  useEffect(() => {
    if (!url) return void setQr("");
    QRCode.toDataURL(url, { width: 280, margin: 1, color: { dark: "#141827", light: "#ffffff" } }).then(setQr).catch(() => setQr(""));
  }, [url]);
  useEffect(() => {
    const refresh = () => window.flProyector.getLiveAudienceStatus().then(setLiveStatus);
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!liveUrl) return void setLiveQr("");
    QRCode.toDataURL(liveUrl, {
      width: 900,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#ffffff" },
    }).then(setLiveQr).catch(() => setLiveQr(""));
  }, [liveUrl]);
  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const saveCode = async () => {
    await withSaveNotification(async () => {
      await window.flProyector.saveCollaboratorCode(collaboratorCode);
      setSavedCode(collaboratorCode);
      setEditingCode(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    }, "El código de colaborador fue guardado.");
  };
  const enableWindowsAccess = async () => {
    setFirewallBusy(true);
    setFirewallResult(null);
    const enabled = await window.flProyector.enableWindowsRemoteAccess();
    setFirewallBusy(false);
    setFirewallResult(enabled ? "success" : "error");
  };
  const startAudience = async () => {
    if (!url) return;
    const next = await window.flProyector.startLiveAudience();
    setLiveStatus(next);
    notifySaved("La lectura pública está disponible para escanear.");
  };
  const restoreBeforeQr = async () => {
    const previous = beforeQr.current;
    beforeQr.current = null;
    if (!previous) return update({ text: { visible: false } });
    await update({
      text: previous.text,
      presentation: previous.presentation,
      lowerThird: previous.lowerThird,
      blackout: previous.blackout,
      logo: previous.logo,
    });
  };
  const projectAudienceQr = async () => {
    if (!liveQr || !liveUrl) return;
    if (!liveQrOnAir) beforeQr.current = structuredClone(state);
    await window.flProyector.openProjection();
    await update({
      blackout: false,
      logo: false,
      presentation: { visible: false },
      lowerThird: { visible: false },
      text: {
        visible: true,
        kind: "anuncio",
        html: `<div data-live-audience-qr="true" class="live-audience-projection"><span>LECTURA EN VIVO</span><strong>Escaneá para seguir las canciones y la Biblia</strong><img src="${liveQr}" alt="Código QR"><small>${liveUrl}</small></div>`,
        fontSize: 42,
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
  };
  const stopAudience = async () => {
    if (liveQrOnAir) await restoreBeforeQr();
    setLiveStatus(await window.flProyector.stopLiveAudience());
    notifySaved("La lectura pública fue finalizada.");
  };
  return (
    <section className="remote-panel-page">
      <div className="section-title">
        <div>
          <span className="eyebrow">CONTROL REMOTO</span>
          <h2>Conectá un teléfono</h2>
        </div>
      </div>

      <div className="remote-connect-card">
        <div className="remote-qr-wrap">
          {qr ? <img src={qr} alt="Código QR para control remoto" /> : <QrCode />}
        </div>
        <div className="remote-connect-copy">
          <div className="remote-connect-heading">
            <div className="remote-icon"><Smartphone /></div>
            <div>
              <h3>Escaneá el código QR</h3>
              <p>Conectá el teléfono a la misma red Wi-Fi.</p>
            </div>
          </div>
          {url ? (
            <>
              <div className="remote-url-row">
                <code title={url}>{url}</code>
                <button onClick={copy}><Copy size={16} />{copied ? "Copiada" : "Copiar"}</button>
              </div>
              <p className="remote-webapp-note">
                Abrila en el navegador y elegí <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b>.
                Después podés usar <b>Biblia</b> o <b>Multimedia</b> mientras ambos equipos estén en la misma red.
              </p>
              {window.flProyector.platform === "win32" && (
                <div className={`remote-firewall ${firewallResult ?? ""}`}>
                  <div>
                    <ShieldCheck size={18} />
                    <span>
                      <b>Acceso desde otros equipos</b>
                      Si el enlace no abre, habilitá FL Proyector en el Firewall de Windows.
                    </span>
                  </div>
                  <button type="button" disabled={firewallBusy} onClick={enableWindowsAccess}>
                    {firewallBusy ? "Esperando permiso…" : "Habilitar acceso"}
                  </button>
                  {firewallResult === "success" && <small>Acceso habilitado. Probá nuevamente el enlace.</small>}
                  {firewallResult === "error" && <small>No se pudo habilitar. Aceptá el permiso de administrador e intentá otra vez.</small>}
                </div>
              )}
            </>
          ) : (
            <p className="remote-unavailable">No se detectó una dirección de red. Verificá la conexión Wi-Fi.</p>
          )}
        </div>
      </div>

      <div className="remote-feature-grid">
        <article><b>Biblia</b><span>Elegí versión, libro y capítulo para proyectar versículos.</span></article>
        <article><b>Multimedia</b><span>Elegí una reunión y enviá videos, imágenes o PowerPoints.</span></article>
      </div>

      <section className="live-audience-section">
        <header className="live-audience-heading">
          <div>
            <span className="eyebrow">MODO AUDIENCIA</span>
            <h3>Lectura en vivo por QR</h3>
            <p>Las personas siguen canciones, Biblias y anuncios desde su navegador, sin controles.</p>
          </div>
          <div className={`live-audience-state ${liveStatus.active ? "active" : ""}`}>
            <Radio size={16} /> {liveStatus.active ? "Transmitiendo" : "Sin iniciar"}
          </div>
        </header>
        {!liveStatus.active ? (
          <div className="live-audience-start-card">
            <div className="live-audience-symbol"><Eye /></div>
            <div>
              <b>Compartí la lectura con toda la congregación</b>
              <span>Funciona con teléfonos conectados a la misma red Wi-Fi.</span>
            </div>
            <button className="primary" type="button" disabled={!url} onClick={startAudience}>
              <Radio size={17} /> Iniciar transmisión
            </button>
          </div>
        ) : (
          <div className="live-audience-card">
            <div className="live-audience-qr">
              {liveQr ? <img src={liveQr} alt="QR de lectura pública" /> : <QrCode />}
            </div>
            <div className="live-audience-details">
              <div className="live-audience-code"><span>Código de sesión</span><strong>{liveStatus.code}</strong></div>
              <div className="live-audience-viewers"><Users /><span><b>{liveStatus.viewers}</b> dispositivo{liveStatus.viewers === 1 ? "" : "s"} conectado{liveStatus.viewers === 1 ? "" : "s"}</span></div>
              <div className="live-audience-url">
                <code title={liveUrl}>{liveUrl}</code>
                <button type="button" onClick={async () => { await navigator.clipboard.writeText(liveUrl).catch(() => undefined); setLiveCopied(true); window.setTimeout(() => setLiveCopied(false), 1500); }}><Copy size={15} />{liveCopied ? "Copiado" : "Copiar"}</button>
              </div>
              <p>Al cambiar la canción, el versículo o el anuncio, todos los teléfonos se actualizan automáticamente.</p>
              <div className="live-audience-actions">
                <button className="primary" type="button" onClick={liveQrOnAir ? restoreBeforeQr : projectAudienceQr}>
                  {liveQrOnAir ? <X size={17} /> : <MonitorUp size={17} />}
                  {liveQrOnAir ? "Quitar QR" : "Proyectar QR grande"}
                </button>
                <button className="danger-secondary" type="button" onClick={stopAudience}>Finalizar</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="collaborator-section">
        <header className="collaborator-heading">
          <div><span className="eyebrow">ACCESO DE EQUIPO</span><h3>Colaborador</h3></div>
        </header>
        <div className="collaborator-card">
          <p>Permite editar canciones y preparar reuniones desde otra computadora de la misma red. No permite controlar el proyector.</p>
          <div className="collaborator-fields">
            <label className="collaborator-url-field">
              Dirección de acceso
              <div className="collaborator-link">
                {collaboratorUrl && <code title={collaboratorUrl}>{collaboratorUrl}</code>}
                <button onClick={async () => { await navigator.clipboard.writeText(collaboratorUrl).catch(() => undefined); }}>
                  <Copy size={15} />Copiar URL
                </button>
              </div>
            </label>
            <div className="collaborator-code-row">
              <label>
                Código de acceso
                <input value={collaboratorCode} disabled={!editingCode} onChange={(event) => setCollaboratorCode(event.target.value)} placeholder="Creá un código" type="password" autoComplete="new-password" />
              </label>
              <div className="collaborator-actions">
                {editingCode ? (
                  <><button className="secondary" onClick={() => { setCollaboratorCode(savedCode); setEditingCode(false); }}>Cancelar</button><button onClick={saveCode}>{saved ? "Guardado" : "Guardar"}</button></>
                ) : <button onClick={() => setEditingCode(true)}>Editar código</button>}
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
