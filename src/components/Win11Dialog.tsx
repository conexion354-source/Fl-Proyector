import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

type Win11DialogProps = {
  open: boolean;
  title: string;
  message?: string;
  submessage?: string;
  cancelText?: string;
  confirmText?: string;
  isDanger?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function Win11Dialog({
  open,
  title,
  message,
  submessage,
  cancelText = "Cancelar",
  confirmText = "Eliminar",
  isDanger = true,
  onCancel,
  onConfirm,
}: Win11DialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="win11-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="win11-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="win11-dialog-title"
      >
        <div className="win11-dialog-body">
          <AlertTriangle className="win11-dialog-warning" aria-hidden="true" />
          <div className="win11-dialog-copy">
            <h2 id="win11-dialog-title">{title}</h2>
            {message && <p className="win11-dialog-message">{message}</p>}
            {submessage && <p className="win11-dialog-detail">{submessage}</p>}
          </div>
        </div>
        <div className="win11-dialog-divider" />
        <div className="win11-dialog-actions">
          <button className="win11-dialog-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            className={isDanger ? "win11-dialog-confirm danger" : "win11-dialog-confirm"}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}
