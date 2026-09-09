import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { withSaveNotification } from "./SaveNotification";

type Props = {
  title: string;
  icon?: ReactNode;
  description?: string;
  children: ReactNode;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  saveDisabled?: boolean;
};

export function Win11SettingsDialog({
  title,
  icon,
  description,
  children,
  onCancel,
  onSave,
  saveDisabled = false,
}: Props) {
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveDisabled || saving) return;
    setSaving(true);
    await withSaveNotification(onSave, "La configuración fue guardada.");
    setSaving(false);
  };

  return (
    <div className="win11-settings-backdrop" onMouseDown={onCancel}>
      <form
        className="win11-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="win11-settings-header">
          {icon && <span className="win11-settings-icon">{icon}</span>}
          <h2>{title}</h2>
          <button
            type="button"
            className="win11-settings-close"
            aria-label="Cerrar"
            onClick={onCancel}
          >
            <X />
          </button>
        </header>

        <div className="win11-settings-body">
          {description && <p className="win11-settings-description">{description}</p>}
          <div className="win11-settings-grid">{children}</div>
        </div>

        <footer className="win11-settings-footer">
          <button type="button" className="win11-settings-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="win11-settings-save" disabled={saveDisabled || saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </footer>
      </form>
    </div>
  );
}
