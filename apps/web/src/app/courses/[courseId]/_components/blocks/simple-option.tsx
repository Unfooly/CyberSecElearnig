import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';

// Wygląd odpowiedzi quizu w monitorze (szablon modułu, D-164) - wspólny dla pojedynczego i wielokrotnego wyboru: ≥ 44 px, litera w kółku;
// po ocenie kolor (zielony/czerwony) i ✓/✕ zamiast litery - nie sam kolor. `relative` - schowane pole wyboru (sr-only, absolute) ma
// pozycję względem odpowiedzi, nie dalszego przodka.
export const OPTION =
  'relative flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-3.5 py-2 text-left text-base font-semibold leading-snug';

export function optionTone(state: 'good' | 'bad' | null, locked: boolean, selected = false): string {
  if (state === 'good') return 'border-2 border-success bg-success-soft text-[#0F5A3A]';
  if (state === 'bad') return 'border-2 border-danger bg-danger-soft text-[#8A251B]';
  if (selected) return 'border-2 border-accent bg-accent-soft text-ink';
  return `border border-border bg-white text-ink ${locked ? '' : 'hover:border-accent hover:bg-paper'}`;
}

export function OptionMark({ index, state, selected = false }: { index: number; state: 'good' | 'bad' | null; selected?: boolean }) {
  const tone =
    state === 'good' ? 'bg-success text-white' : state === 'bad' ? 'bg-danger text-white' : selected ? 'bg-accent text-white' : 'bg-[#F0EFEC] text-[#4A4A47]';
  return (
    <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${tone}`}>
      {state === 'good' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : state === 'bad' ? <X className="h-3.5 w-3.5" strokeWidth={3} /> : String.fromCharCode(65 + index)}
    </span>
  );
}

/**
 * Po każdej nowej ocenie ekran monitora przewija się do zdania z werdyktem (ekran bywa niższy niż treść, np. 1366×768 z czterema
 * odpowiedziami) - osoba widząca nie musi szukać werdyktu pod krawędzią ekranu. Bez przenoszenia fokusu (zostaje na odpowiedzi).
 */
export function useRevealOnCheck(checkCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (checkCount === 0) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [checkCount]);
  return ref;
}
