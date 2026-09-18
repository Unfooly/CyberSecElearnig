import type { ReactNode } from 'react';

// Nagłówek strony: H1 28/800 + podtytuł + akcje po prawej.
export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 print:mb-4">
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
        {subtitle && <div className="mt-1 text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2.5 print:hidden">{actions}</div>}
    </div>
  );
}
