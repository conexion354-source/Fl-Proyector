import { useState } from "react";
import { Copy, MonitorUp, QrCode, Radio, Users, X } from "lucide-react";
import type { LiveAudienceStatus } from "../../shared/types";

export function LiveAudienceDialog({
  status,
  url,
  qr,
  qrOnAir,
  networkAvailable,
  onClose,
  onStart,
  onToggleQr,
  onStop,
}: {
  status: LiveAudienceStatus;
  url: string;
  qr: string;
  qrOnAir: boolean;
  networkAvailable: boolean;
  onClose: () => void;
  onStart: () => Promise<void>;
  onToggleQr: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="live-audience-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="live-audience-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-audience-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="live-audience-dialog-title">
            <span className="live-audience-dialog-icon"><QrCode /></span>
            <div>
              <span className="eyebrow">MODO AUDIENCIA</span>
              <h2 id="live-audience-title">Lectura en vivo por QR</h2>
            </div>
          </div>
          <button className="live-audience-dialog-close" type="button" aria-label="Cerrar" onClick={onClose}>
            <X />
          </button>
        </header>

        {!status.active ? (
          <div className="live-audience-dialog-start">
            <Radio />
            <h3>Compartí la lectura con la congregación</h3>
            <p>Los teléfonos podrán seguir canciones, versículos y anuncios desde el navegador, sin controlar el proyector.</p>
            <button className="primary" type="button" disabled={busy || !networkAvailable} onClick={() => run(onStart)}>
              <Radio /> {busy ? "Iniciando…" : "Iniciar transmisión"}
            </button>
            {!networkAvailable && <small>No se detectó una dirección de red disponible.</small>}
          </div>
        ) : (
          <div className="live-audience-dialog-content">
            <div className="live-audience-dialog-qr">
              {qr ? <img src={qr} alt="QR de lectura en vivo" /> : <QrCode />}
            </div>
            <div className="live-audience-dialog-details">
              <div className="live-audience-dialog-status"><Radio /> Transmitiendo</div>
              <div className="live-audience-code"><span>Código de sesión</span><strong>{status.code}</strong></div>
              <div className="live-audience-viewers"><Users /><span><b>{status.viewers}</b> dispositivo{status.viewers === 1 ? "" : "s"} conectado{status.viewers === 1 ? "" : "s"}</span></div>
              <div className="live-audience-url">
                <code title={url}>{url}</code>
                <button type="button" onClick={async () => {
                  await navigator.clipboard.writeText(url).catch(() => undefined);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}><Copy /> {copied ? "Copiado" : "Copiar"}</button>
              </div>
              <p>La pantalla de cada teléfono se actualiza automáticamente cuando cambia el contenido.</p>
              <div className="live-audience-actions">
                <button className="primary" type="button" disabled={busy || !qr} onClick={() => run(onToggleQr)}>
                  {qrOnAir ? <X /> : <MonitorUp />}
                  {qrOnAir ? "Quitar QR de pantalla" : "Proyectar QR grande"}
                </button>
                <button className="danger-secondary" type="button" disabled={busy} onClick={() => run(onStop)}>Finalizar</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
