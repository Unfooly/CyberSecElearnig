'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Podpowiedzi odtwarzacza (refactor/remove-mascot-player, D-093) - dawne reakcje maskotki bez postaci: sam tekst w neutralnym dymku
// (player/Hint.tsx). Źródła tekstu: stała podpowiedź bloku (`block.mascot.text` z treści albo DEFAULT_HINT dla typu), zdarzenia powłoki
// (nowy dowód, zła odpowiedź, podpowiedź) i reakcje z treści (`reactions.complete/result`). Poza (`pose`) z treści i API jest ignorowana
// - zostaje w schemacie jako przestarzała (zgodność ze starszymi wersjami kursów).
export type HintEvent = 'evidence' | 'wrong' | 'hint';

/** Stała podpowiedź dla typu bloku, gdy autor jej nie ustawił (`block.mascot.text` wygrywa). Tylko sceny z punktami. */
export const DEFAULT_HINT: Record<string, string> = {
  SCENE_HOTSPOTS: 'Rozejrzyj się. Kliknij to, co wygląda podejrzanie.',
};

export const HINT_EVENT_TEXT: Record<HintEvent, string> = {
  evidence: 'Mamy dowód! Trafił do notatnika.',
  wrong: 'Uważaj, coś tu nie gra.',
  hint: 'Hmm, zastanówmy się jeszcze raz.',
};

/** Reakcja z treści/API: tylko tekst się liczy (`pose` - przestarzała, ignorowana). */
export interface HintMessage {
  text?: string;
  pose?: string;
}

interface Value {
  /** Bieżąca podpowiedź zdarzenia/reakcji (null - brak, pokazuje się stała podpowiedź bloku). */
  hint: string | null;
  notify: (event: HintEvent) => void;
  show: (message: HintMessage) => void;
}

const HintsContext = createContext<Value>({ hint: null, notify: () => {}, show: () => {} });

const HINT_MS = 5000;

/**
 * Podpowiedź jest przypisana do klucza widoku (`resetKey`: blok + faza): pokazuje się tylko w tym widoku i znika po HINT_MS. Klucz
 * porównujemy przy renderze (bez efektu czyszczącego): podpowiedź wywołana w efekcie NOWEGO widoku (np. wynik bloku zaraz po zapisie)
 * nie może zostać skasowana przez efekt rodzica, który reaguje na tę samą zmianę klucza.
 */
export function HintProvider({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const [stored, setStored] = useState<{ text: string; key: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestKey = useRef(resetKey);
  latestKey.current = resetKey;

  const show = useCallback((message: HintMessage) => {
    if (!message.text) return;
    if (timer.current) clearTimeout(timer.current);
    setStored({ text: message.text, key: latestKey.current });
    timer.current = setTimeout(() => setStored(null), HINT_MS);
  }, []);

  const notify = useCallback((event: HintEvent) => show({ text: HINT_EVENT_TEXT[event] }), [show]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const hint = stored && stored.key === resetKey ? stored.text : null;
  const value = useMemo(() => ({ hint, notify, show }), [hint, notify, show]);
  return <HintsContext.Provider value={value}>{children}</HintsContext.Provider>;
}

export const useHints = () => useContext(HintsContext);

/**
 * Reakcja z treści na ukończenie bloku eksploracyjnego (reactions.complete, schemaVersion 4): wywołana raz, gdy `ready` stanie się
 * prawdziwe (np. wymagane elementy obejrzane), nigdy w podglądzie ("Wstecz" - `review`). Wspólna dla SCENE_HOTSPOTS/DIALOGUE/TABS
 * (ready = pokrycie wymaganych elementów) i NOTEPAD/SUMMARY/NARRATIVE (ready = zamontowanie, bo nie mają pokrycia do zliczenia).
 */
export function useCompleteHint(message: HintMessage | undefined, ready: boolean, review: boolean) {
  const { show } = useHints();
  const fired = useRef(false);
  useEffect(() => {
    if (review || !ready || !message?.text || fired.current) return;
    fired.current = true;
    show(message);
    // show ma stabilną tożsamość (useCallback w providerze); message/ready/review to jedyne prawdziwe zależności.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, review, message]);
}
