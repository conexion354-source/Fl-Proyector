import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, QrCode, ShieldCheck, Smartphone } from "lucide-react";
import { withSaveNotification } from "./SaveNotification";

export function RemotePanel({
  urls,
}: {
  urls: string[];
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
  const collaboratorUrl = url ? `${url}/colaborador` : "";
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
