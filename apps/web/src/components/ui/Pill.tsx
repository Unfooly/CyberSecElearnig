import type { ReactNode } from 'react';

// ok = sukces, warn = zaległe/terminy, acc = akcent/w toku, off = nieaktywne.
export type PillTone = 'ok' | 'warn' | 'acc' | 'off';

const TONES: Record<PillTone, string> = {
  ok: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  acc: 'bg-accent-soft text-accent-ink',
  off: 'border border-border bg-paper text-muted',
};

export default function Pill({
  tone = 'off',
  dot = false,
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-bold ${TONES[tone]}`}
    >
      {dot && <span data-pill-dot aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
