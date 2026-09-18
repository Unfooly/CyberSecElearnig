import type { ReactNode } from 'react';
import Card from '@/components/ui/Card';
import Pill from '@/components/ui/Pill';
import ProgressBar, { type ProgressTone } from '@/components/ui/ProgressBar';

interface KpiCardProps {
  label: string;
  value: string;
  // Jednostka / mianownik obok liczby, np. "%" albo "/ 52".
  unit?: string;
  progress?: { value: number; tone?: ProgressTone };
  hint?: ReactNode;
  hintTone?: 'ok' | 'warn';
  // Metryki, których dziś po prostu nie ma (phishing) - tło paper, przerywany
  // border i pill "Moduł wkrótce" zamiast samego "Brak danych" (BRAND.md).
  placeholder?: boolean;
  // Pill pod tekstem placeholdera; null = bez pilla (np. brak danych, a nie brak modułu).
  placeholderPill?: string | null;
}

export default function KpiCard({ label, value, unit, progress, hint, hintTone = 'ok', placeholder = false, placeholderPill = 'Moduł wkrótce' }: KpiCardProps) {
  if (placeholder) {
    return (
      <div className="flex min-h-[136px] flex-col gap-2.5 rounded-card border border-dashed border-border bg-paper px-[22px] py-5">
        <p className="text-[13px] font-semibold text-muted">{label}</p>
        <p className="text-sm font-semibold text-muted">{value}</p>
        {placeholderPill && (
          <div>
            <Pill tone="off">{placeholderPill}</Pill>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="flex min-h-[136px] flex-col gap-2.5 px-[22px] py-5">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className="text-[32px] font-extrabold leading-none tracking-[-0.03em]">
        {value}
        {unit && <small className="ml-1 text-base font-semibold tracking-normal text-muted">{unit}</small>}
      </p>
      {progress && <ProgressBar value={progress.value} tone={progress.tone} label={label} />}
      {hint && (
        <p className={`text-xs font-semibold ${hintTone === 'warn' ? 'text-warning' : 'text-success'}`}>{hint}</p>
      )}
    </Card>
  );
}
