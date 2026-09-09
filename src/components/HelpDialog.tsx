import { useEffect, type ReactNode } from "react";
import {
  MessageCircle,
  MonitorPlay,
  Sparkles,
  Target,
  UserRound,
  X,
} from "lucide-react";

type HelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

const whatsappNumber = "543735500082";
const whatsappMessage = encodeURIComponent(
  "Hola Mauro, te escribo desde FL Proyector. Necesito ayuda con...",
);
const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${whatsappMessage}`;

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="help-dialog-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-dialog-header">
          <div className="help-dialog-logo" aria-hidden="true">
            <MonitorPlay />
          </div>
          <div className="help-dialog-heading">
            <h1 id="help-dialog-title">FL PROYECTOR</h1>
            <p>Versión 10.11 · Fase Beta</p>
            <small>Windows 11 · Fluent Design</small>
          </div>
          <button
            type="button"
            className="help-dialog-close"
            onClick={onClose}
            aria-label="Cerrar ayuda"
          >
            <X />
          </button>
        </header>

        <div className="help-dialog-body">
          <HelpSection icon={<Sparkles />} title="Nuestra historia">
            FL Proyector nació con una iniciativa simple y profunda: ayudar a
            todas las iglesias del mundo donde se exalte el nombre de Cristo.
            No es solo software: es un ministerio digital creado a partir de
            una necesidad real de las iglesias locales, con una herramienta
            simple, confiable y gratuita.
          </HelpSection>

          <HelpSection icon={<Target />} title="Nuestra misión">
            Brindar un servicio de excelencia a Dios y a los miembros de las
            iglesias locales. Que cada letra, versículo y anuncio ayude a la
            congregación a enfocarse en lo que importa. Tecnología al servicio
            de la fe, accesible, offline y fácil de usar.
          </HelpSection>

          <HelpSection icon={<UserRound />} title="Desarrollado por Mauro Polini">
            Sirviendo a iglesias desde 2018.
          </HelpSection>

          <div className="help-support-card">
            <div className="help-support-copy">
              <strong>¿Necesitás ayuda o tenés una sugerencia?</strong>
              <span>Estoy para servirte. Escribime directamente.</span>
            </div>
            <button
              type="button"
              className="help-whatsapp-button"
              onClick={() => void window.flProyector.openExternal(whatsappUrl)}
            >
              <MessageCircle />
              WhatsApp
            </button>
          </div>
        </div>

        <footer className="help-dialog-footer">
          <p>© 2018–2026 FL Proyector.</p>
          <button type="button" className="fl-primary-button" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </section>
    </div>
  );
}

function HelpSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="help-section">
      <div className="help-section-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </article>
  );
}
