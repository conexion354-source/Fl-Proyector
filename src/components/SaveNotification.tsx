import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";

type SaveNotice = {
  id: number;
  message: string;
  kind: "success" | "error";
};

const SAVE_NOTICE_EVENT = "fl-proyector:save-notice";

function emitSaveNotice(message: string, kind: SaveNotice["kind"]) {
  window.dispatchEvent(
    new CustomEvent<SaveNotice>(SAVE_NOTICE_EVENT, {
      detail: { id: Date.now(), message, kind },
    }),
  );
}

export function notifySaved(message = "Cambios guardados") {
  emitSaveNotice(message, "success");
}

export function notifySaveError(error: unknown) {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : "No se pudieron guardar los cambios.";
  emitSaveNotice(detail, "error");
}

export async function withSaveNotification<T>(
  action: () => Promise<T> | T,
  message = "Cambios guardados",
): Promise<T> {
  try {
    const result = await action();
    notifySaved(message);
    return result;
  } catch (error) {
    notifySaveError(error);
    return undefined as T;
  }
}

export function SaveNotificationHost() {
  const [notice, setNotice] = useState<SaveNotice | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      setNotice((event as CustomEvent<SaveNotice>).detail);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setNotice(null), 2600);
    };
    window.addEventListener(SAVE_NOTICE_EVENT, show);
    return () => {
      window.removeEventListener(SAVE_NOTICE_EVENT, show);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  if (!notice) return null;
  return (
    <div
      className={`save-notification ${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {notice.kind === "success" ? <CheckCircle2 /> : <CircleAlert />}
      <div>
        <strong>{notice.kind === "success" ? "Guardado" : "No se pudo guardar"}</strong>
        <span>{notice.message}</span>
      </div>
      <button aria-label="Cerrar notificación" onClick={() => setNotice(null)}>
        <X />
      </button>
    </div>
  );
}
