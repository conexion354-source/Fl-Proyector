import { ChevronDown } from "lucide-react";
import { useId, useState, type MouseEvent, type ReactNode } from "react";

type ExpanderRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
};

export function ExpanderRow({
  title,
  description,
  checked,
  onCheckedChange,
  children,
  defaultExpanded = false,
  className = "",
}: ExpanderRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <section
      className={`win11-expander ${expanded ? "expanded" : "collapsed"} ${className}`.trim()}
    >
      {/* The header deliberately has no click handler. */}
      <div className="win11-expander-header">
        <button
          type="button"
          className="win11-expander-trigger"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          <ChevronDown className="win11-expander-chevron" aria-hidden="true" />
          <span className="win11-expander-copy">
            <strong>{title}</strong>
            {description && <small>{description}</small>}
          </span>
        </button>

        <div
          className="win11-expander-toggle"
          onClick={stopPropagation}
          onMouseDown={stopPropagation}
        >
          <label>
            <input
              className="win11-toggle"
              type="checkbox"
              aria-label={checked ? `Desactivar ${title}` : `Activar ${title}`}
              checked={checked}
              onChange={(event) => onCheckedChange(event.target.checked)}
            />
          </label>
        </div>
      </div>

      <div
        id={contentId}
        className="win11-expander-collapse"
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className="win11-expander-clip">
          <div className="win11-expander-body">{children}</div>
        </div>
      </div>
    </section>
  );
}
