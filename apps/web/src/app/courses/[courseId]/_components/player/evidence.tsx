'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import type { EvidenceSummary } from '@/lib/courses-types';

// Dowody śledztwa. Liczby (zebrane, suma, per blok) należą do SERWERA (progress.evidence i odpowiedź /progress); klient dodaje tylko
// dowody dodane w bieżącym, jeszcze niezapisanym bloku ("Dodaj do notatnika" przed "Kontynuuj"), żeby licznik reagował od razu.
// Po zapisie bloku serwer podaje nowe liczby, a lokalne dowody są czyszczone.
const EMPTY: EvidenceSummary = { collected: 0, total: 0, perBlock: [] };

interface EvidenceContextValue {
  summary: EvidenceSummary;
  /** Dowody dodane w niezapisanym bloku (unikalne po kluczu). */
  pending: number;
  addPending: (key: string) => void;
}

const EvidenceContext = createContext<EvidenceContextValue>({ summary: EMPTY, pending: 0, addPending: () => {} });

export function EvidenceProvider({ summary, children }: { summary: EvidenceSummary | undefined; children: ReactNode }) {
  // Lokalne dowody należą do konkretnego stanu serwera (`base`): gdy przychodzą nowe liczby (po zapisie bloku), poprzednie lokalne wpisy
  // przestają się liczyć w tym samym renderze (bez chwilowego podwójnego liczenia i fałszywego "+1").
  const [local, setLocal] = useState<{ base: EvidenceSummary | undefined; keys: string[] }>({ base: summary, keys: [] });
  const keys = local.base === summary ? local.keys : [];
  const addPending = useCallback(
    (key: string) =>
      setLocal((current) => {
        const existing = current.base === summary ? current.keys : [];
        return existing.includes(key) ? current : { base: summary, keys: [...existing, key] };
      }),
    [summary],
  );
  const value = useMemo(() => ({ summary: summary ?? EMPTY, pending: keys.length, addPending }), [summary, keys.length, addPending]);
  return <EvidenceContext.Provider value={value}>{children}</EvidenceContext.Provider>;
}

export const useEvidence = () => useContext(EvidenceContext);

/** Czy w module w ogóle są dowody (bez nich licznik w nagłówku się nie pojawia). */
export function hasEvidence(summary: EvidenceSummary | undefined): boolean {
  return !!summary && summary.perBlock.length > 0;
}

/** "Dowody 2/5" z lupą; przy nowym dowodzie krótkie "+1" (animacja tylko bez prefers-reduced-motion). Suma znana od startu (D-055 pkt 2). */
export function EvidenceCounter() {
  const { summary, pending } = useEvidence();
  const collected = summary.collected + pending;
  const previous = useRef(collected);
  const [flash, setFlash] = useState(false);
  // Przewinięcie cyfry (D-090, 200 ms) tylko po zmianie względem wartości z pierwszego renderu (dowody z /start przychodzą w `initial`
  // synchronicznie, więc wejście do modułu nie animuje).
  const initial = useRef(collected);

  useEffect(() => {
    if (collected > previous.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1600);
      previous.current = collected;
      return () => clearTimeout(timer);
    }
    // Liczba bez wzrostu (np. serwer podał mniej): nie zostawiamy "+1" na stałe.
    setFlash(false);
    previous.current = collected;
  }, [collected]);

  if (!hasEvidence(summary)) return null;
  const total = summary.total;

  return (
    <div
      data-testid="evidence-counter"
      aria-label={`Dowody ${collected} z ${total}`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-slate-800"
    >
      <Search aria-hidden="true" className="h-4 w-4 text-indigo-700" />
      {/* player-compact-label: zwinięte do samej ikony na telefonie w pionie (PlayerStage, globals.css) - aria-label
          na kontenerze wyżej zostaje niezależnie od tego, czy tekst jest widoczny. */}
      <span aria-hidden="true" className="player-compact-label">
        Dowody{' '}
        <span className="inline-block overflow-hidden align-bottom tabular-nums">
          <span
            key={collected}
            data-testid="evidence-count"
            className={`inline-block ${collected !== initial.current ? 'motion-safe:animate-digit-roll' : ''}`}
          >
            {collected}
          </span>
        </span>
        /{total}
      </span>
      {/* "+1" w wierszu licznika, po prawej, w zarezerwowanym miejscu (bez przesuwania układu i bez wystawania poza pasek postępu);
          animacja tylko bez prefers-reduced-motion (motion-safe), inaczej po prostu jest widoczny. */}
      <span aria-hidden="true" className="inline-block w-5 text-xs font-bold text-green-700">
        {flash && (
          <span data-testid="evidence-plus-one" className="inline-block motion-safe:animate-bounce">
            +1
          </span>
        )}
      </span>
      <span className="sr-only" aria-live="polite">
        {flash ? `Nowy dowód. Dowody ${collected} z ${total}.` : ''}
      </span>
    </div>
  );
}
