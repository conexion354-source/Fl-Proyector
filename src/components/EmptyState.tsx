import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  detail,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`win11-empty-state ${compact ? "compact" : ""}`}>
      <span className="win11-empty-icon">{icon}</span>
      <strong>{title}</strong>
      {detail && <small>{detail}</small>}
      {action}
    </div>
  );
}
