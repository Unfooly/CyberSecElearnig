import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// Ikona liniowa 28 px w kółku accent-soft, jeden nagłówek, jedno zdanie,
// opcjonalny jeden przycisk primary (przekazywany jako `action`).
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon size={28} strokeWidth={2} aria-hidden="true" />
      </span>
      <h3 className="text-base font-bold">{title}</h3>
      <p className="max-w-sm text-muted">{description}</p>
      {action}
    </div>
  );
}
