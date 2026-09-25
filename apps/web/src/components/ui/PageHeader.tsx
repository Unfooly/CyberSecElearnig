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
        <h1 className="text-[24px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[28px]">{title}</h1>
        {subtitle && <div className="mt-1 text-muted">{subtitle}</div>}
      </div>
      {/* Poniżej sm akcje zajmują pełną szerokość i każdy przycisk rośnie do równego udziału (flex-1) - od sm
          wracają do naturalnej szerokości (flex-none), jak dziś. */}
      {actions && <div className="flex w-full flex-wrap gap-2.5 print:hidden sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </div>
  );
}
