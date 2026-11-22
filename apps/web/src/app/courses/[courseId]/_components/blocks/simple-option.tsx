import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import type { CheckedOption, SimpleCheck } from '@/lib/courses-types';

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
 * Oceny odpowiedzi po „Sprawdź” (D-204): rozstrzyga pierwsza próba - zaznaczone (dobre i złe) oraz poprawne niezaznaczone, każda ze zdaniem
 * z treści. Starsza odpowiedź serwera bez `options` (pojedynczy wybór sprzed D-204) - tylko zaznaczona odpowiedź z werdyktem bloku.
 */
export function decidedMarks(decided: SimpleCheck | undefined): Map<number, CheckedOption> {
  if (!decided) return new Map();
  if (decided.options) return new Map(decided.options.map((entry) => [entry.option, entry]));
  return typeof decided.item === 'number'
    ? new Map([[decided.item, { option: decided.item, result: decided.result, feedback: decided.feedback, picked: true }]])
    : new Map();
}

/** Zdanie pod odpowiedzią po ocenie; czytnik słyszy też, czy to zaznaczona odpowiedź, czy poprawna, której zabrakło. */
export function OptionFeedback({ mark, testId }: { mark: CheckedOption; testId: string }) {
  const missed = mark.picked === false;
  return (
    <span data-testid={testId} className="text-base font-normal">
      <span lang="pl" className={missed ? 'font-semibold' : 'sr-only'}>
        {missed ? 'Poprawna odpowiedź. ' : mark.result === 'good' ? 'Dobra odpowiedź: ' : 'Zła odpowiedź: '}
      </span>
      {mark.feedback}
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
