'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Reakcje maskotki na zdarzenia w odtwarzaczu (domyślne przypisanie póz jest TU, w powłoce; treść bloku może nadpisać tylko pozę spoczynkową
// przez `block.mascot`). Zdarzenia: nowy dowód = cheer, zła odpowiedź = warning, podpowiedź = thinking, sceny z punktami = pointing (poza
// spoczynkowa). Warning i thinking podłączają bloki oceniane (kolejny commit); mechanizm jest wspólny.
export type MascotEvent = 'evidence' | 'wrong' | 'hint';

export const MASCOT_EVENT_POSE: Record<MascotEvent, string> = { evidence: 'cheer', wrong: 'warning', hint: 'thinking' };
/**
 * Poza i tekst spoczynkowe dla typu bloku, gdy autor ich nie ustawił (`block.mascot` z treści zawsze wygrywa). Tylko sceny z punktami;
 * reszta bez maskotki, żeby nie zajmować miejsca. Maskotka zawsze ma dymek: sama wskazywałaby w pustkę.
 */
export const DEFAULT_IDLE: Record<string, { pose: string; text: string }> = {
  SCENE_HOTSPOTS: { pose: 'pointing', text: 'Rozejrzyj się. Kliknij to, co wygląda podejrzanie.' },
};

const EVENT_TEXT: Record<MascotEvent, string> = {
  evidence: 'Mamy dowód! Trafił do notatnika.',
  wrong: 'Uważaj, coś tu nie gra.',
  hint: 'Hmm, zastanówmy się jeszcze raz.',
};

export interface MascotReaction {
  pose: string;
  text: string;
}

interface Value {
  reaction: MascotReaction | null;
  react: (event: MascotEvent) => void;
}

const MascotReactionContext = createContext<Value>({ reaction: null, react: () => {} });

const REACTION_MS = 5000;

/**
 * Reakcja jest przypisana do klucza widoku (`resetKey`: blok + faza): pokazuje się tylko w tym widoku i znika po REACTION_MS. Klucz
 * porównujemy przy renderze (bez efektu czyszczącego): reakcja wywołana w efekcie NOWEGO widoku (np. wynik bloku zaraz po zapisie)
 * nie może zostać skasowana przez efekt rodzica, który reaguje na tę samą zmianę klucza.
 */
export function MascotReactionProvider({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const [stored, setStored] = useState<{ reaction: MascotReaction; key: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestKey = useRef(resetKey);
  latestKey.current = resetKey;

  const react = useCallback((event: MascotEvent) => {
    if (timer.current) clearTimeout(timer.current);
    setStored({ reaction: { pose: MASCOT_EVENT_POSE[event], text: EVENT_TEXT[event] }, key: latestKey.current });
    timer.current = setTimeout(() => setStored(null), REACTION_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const reaction = stored && stored.key === resetKey ? stored.reaction : null;
  const value = useMemo(() => ({ reaction, react }), [reaction, react]);
  return <MascotReactionContext.Provider value={value}>{children}</MascotReactionContext.Provider>;
}

export const useMascotReaction = () => useContext(MascotReactionContext);
