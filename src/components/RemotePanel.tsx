import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Music2, QrCode, ShieldCheck, Smartphone } from "lucide-react";
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
  const [fullControlEnabled, setFullControlEnabled] = useState(false);
  const [fullControlBusy, setFullControlBusy] = useState(false);
  const collaboratorUrl = url ? `${url}/colaborador` : "";
  useEffect(() => {
    window.flProyector.getCollaboratorCode().then((code) => {
      setCollaboratorCode(code);
      setSavedCode(code);
    });
    window.flProyector.getRemoteFullControlStatus().then((status) => {
      setFullControlEnabled(status.fullControlEnabled);
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
  const toggleFullControl = async () => {
    setFullControlBusy(true);
    try {
      const status = await window.flProyector.setRemoteFullControlEnabled(
        !fullControlEnabled,
      );
      setFullControlEnabled(status.fullControlEnabled);
    } finally {
      setFullControlBusy(false);
    }
  };
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const ready = Boolean(url && host);
  const [manualOpen, setManualOpen] = useState(false);
  const [collabCopied, setCollabCopied] = useState(false);
  return (
    <section className="remote-panel-page rp">
      <header className="rp-title">
        <span className="eyebrow">Control remoto</span>
        <h2>Teléfono y equipo</h2>
        <p>Controlá la proyección desde el celular y prepará reuniones desde otra computadora de la misma red.</p>
      </header>

      <section className="rp-hero" aria-label="Conectar un teléfono">
        <div className="rp-qr">
          {ready && qr ? <img src={qr} alt="Código QR para conectar el teléfono" /> : <QrCode aria-hidden="true" />}
        </div>
        <div className="rp-steps">
          <h3>Conectar un teléfono</h3>
          {ready ? (
            <ol>
              <li>
                <b>Conectá el teléfono al mismo Wi-Fi</b> que esta computadora.
              </li>
              <li>
                <b>Escaneá el código QR</b> con la cámara o abrí esta dirección:
                <span className="rp-address">
                  <code title={url}>{url}</code>
                  <button type="button" onClick={copy}>
                    <Copy aria-hidden="true" /> {copied ? "Copiada" : "Copiar"}
                  </button>
                </span>
              </li>
              <li>
                <b>Instalala</b> con «Instalar app» o «Agregar a pantalla de inicio». La próxima vez encuentra la PC sola, sin Internet.
              </li>
            </ol>
          ) : (
            <p className="rp-offline">
              No se detectó una red. Conectá esta computadora a un Wi-Fi o a un cable de red y volvé a abrir esta pantalla.
            </p>
          )}
          {ready && (
            <div className={`rp-manual ${manualOpen ? "open" : ""}`}>
              <button type="button" className="rp-link" aria-expanded={manualOpen} onClick={() => setManualOpen((value) => !value)}>
                ¿El teléfono no encuentra la PC?
              </button>
              {manualOpen && (
                <div>
                  <p>
                    En la app, tocá <b>Conectar</b> (iPhone) o <b>Escanear código QR / Conectar al proyector</b> (Android) y escribí:
                  </p>
                  <strong className="rp-host">{host}</strong>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <h3 className="rp-group-title">Permisos</h3>
      <div className="rp-group">
        <div className={`rp-row ${fullControlEnabled ? "is-on" : ""}`}>
          <span className="rp-row-icon"><Music2 aria-hidden="true" /></span>
          <span className="rp-row-text">
            <b>Control total desde el teléfono</b>
            <small>Canciones del orden del culto, sus estrofas y los controles en vivo. Se desactiva solo al cerrar el programa.</small>
          </span>
          <label className="rp-switch">
            <span>{fullControlBusy ? "Aplicando…" : fullControlEnabled ? "Activado" : "Desactivado"}</span>
            <input
              type="checkbox"
              role="switch"
              checked={fullControlEnabled}
              disabled={fullControlBusy}
              onChange={() => void toggleFullControl()}
              aria-label="Control total desde el teléfono"
            />
            <i aria-hidden="true" />
          </label>
        </div>
        <div className="rp-row">
          <span className="rp-row-icon"><Smartphone aria-hidden="true" /></span>
          <span className="rp-row-text">
            <b>Siempre disponible</b>
            <small>Biblia (versión, libro y capítulo) y Multimedia (videos, imágenes y PowerPoint de las reuniones).</small>
          </span>
        </div>
        {window.flProyector.platform === "win32" && (
          <div className={`rp-row ${firewallResult ?? ""}`}>
            <span className="rp-row-icon"><ShieldCheck aria-hidden="true" /></span>
            <span className="rp-row-text">
              <b>Firewall de Windows</b>
              <small>
                {firewallResult === "success"
                  ? "Acceso habilitado. Probá de nuevo desde el teléfono."
                  : firewallResult === "error"
                    ? "No se pudo habilitar. Aceptá el permiso de administrador e intentá otra vez."
                    : "Si el teléfono no abre la dirección, permití a FL Proyector recibir conexiones."}
              </small>
            </span>
            <button type="button" className="rp-button" disabled={firewallBusy} onClick={enableWindowsAccess}>
              {firewallBusy ? "Esperando permiso…" : "Habilitar acceso"}
            </button>
          </div>
        )}
      </div>

      <h3 className="rp-group-title">Colaborador</h3>
      <div className="rp-group">
        <div className="rp-row rp-row-intro">
          <span className="rp-row-text">
            <small>Otra computadora de la misma red puede editar canciones y preparar reuniones. No puede controlar el proyector.</small>
          </span>
        </div>
        <div className="rp-row">
          <span className="rp-row-text">
            <b>Dirección</b>
            <small>Abrila en el navegador de la otra computadora.</small>
          </span>
          <span className="rp-address">
            <code title={collaboratorUrl}>{ready ? collaboratorUrl : "Sin red"}</code>
            <button
              type="button"
              disabled={!ready}
              onClick={async () => {
                await navigator.clipboard.writeText(collaboratorUrl).catch(() => undefined);
                setCollabCopied(true);
                window.setTimeout(() => setCollabCopied(false), 1500);
              }}
            >
              <Copy aria-hidden="true" /> {collabCopied ? "Copiada" : "Copiar"}
            </button>
          </span>
        </div>
        <div className="rp-row">
          <span className="rp-row-text">
            <b>Código de acceso</b>
            <small>{savedCode ? "Se pide al entrar como colaborador." : "Creá un código para habilitar el acceso."}</small>
          </span>
          <span className="rp-code">
            <input
              value={collaboratorCode}
              disabled={!editingCode}
              onChange={(event) => setCollaboratorCode(event.target.value)}
              placeholder={editingCode ? "Escribí un código" : savedCode ? "••••••" : "Sin código"}
              type="password"
              autoComplete="new-password"
              aria-label="Código de acceso"
            />
            {editingCode ? (
              <>
                <button type="button" className="rp-button" onClick={() => { setCollaboratorCode(savedCode); setEditingCode(false); }}>
                  Cancelar
                </button>
                <button type="button" className="rp-button rp-primary" onClick={saveCode}>
                  {saved ? "Guardado" : "Guardar"}
                </button>
              </>
            ) : (
              <button type="button" className="rp-button" onClick={() => setEditingCode(true)}>
                {savedCode ? "Cambiar" : "Crear código"}
              </button>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
