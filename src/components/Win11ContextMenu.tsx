import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Win11ContextMenuItem = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  separatorBefore?: boolean;
  keepOpen?: boolean;
  onClick: () => void;
};

export function Win11ContextMenu({
  x,
  y,
  onClose,
  items,
  children,
  ariaLabel = "Menú contextual",
}: {
  x: number;
  y: number;
  onClose: () => void;
  items: Win11ContextMenuItem[];
  children?: ReactNode;
  ariaLabel?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const placeInsideViewport = () => {
      const bounds = menu.getBoundingClientRect();
      const next = {
        x: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)),
      };
      setPosition((current) =>
        current.x === next.x && current.y === next.y ? current : next,
      );
    };
    placeInsideViewport();
    const observer = new ResizeObserver(placeInsideViewport);
    observer.observe(menu);
    window.addEventListener("resize", placeInsideViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", placeInsideViewport);
    };
  }, [x, y]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="win11-context-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={menuRef}
        className="win11-context-menu"
        style={{ left: position.x, top: position.y }}
        role="menu"
        aria-label={ariaLabel}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
        {items.map((item) => (
          <div className="win11-context-entry" key={item.label}>
            {(item.separatorBefore || item.danger) && (
              <div className="win11-context-separator" role="separator" />
            )}
            <button
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : ""}
              onClick={() => {
                item.onClick();
                if (!item.keepOpen) onClose();
              }}
            >
              <span className="win11-context-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
