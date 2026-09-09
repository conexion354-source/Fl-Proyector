import type { PointerEvent as ReactPointerEvent } from "react";

export function ColumnResizer({
  label,
  onResize,
}: {
  label: string;
  onResize: (deltaX: number) => void;
}) {
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    let lastX = event.clientX;
    const body = document.body;
    body.classList.add("resizing-columns");
    // Send only the movement since the previous event. Sending the distance
    // from the initial click repeatedly made the panel grow/shrink faster
    // than the pointer and eventually squeezed the rest of the interface.
    const move = (pointerEvent: PointerEvent) => {
      onResize(pointerEvent.clientX - lastX);
      lastX = pointerEvent.clientX;
    };
    const stop = () => {
      body.classList.remove("resizing-columns");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  return (
    <div
      className="column-resizer"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      onPointerDown={startResize}
    >
      <span aria-hidden="true" />
    </div>
  );
}

export function storedColumnWidth(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function clampColumnWidth(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.max(minimum, Math.min(maximum, value));
}
