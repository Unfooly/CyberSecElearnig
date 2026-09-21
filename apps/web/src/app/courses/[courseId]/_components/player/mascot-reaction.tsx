'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Reakcje maskotki na zdarzenia w odtwarzaczu (domyślne przypisanie póz jest TU, w powłoce; treść bloku może nadpisać tylko pozę spoczynkową
// przez `block.mascot`). Zdarzenia: nowy dowód = cheer, zła odpowiedź = warning, podpowiedź = thinking, sceny z punktami = pointing (poza
// spoczynkowa). Warning i thinking podłączają bloki oceniane (kolejny commit); mechanizm jest wspólny.
export type MascotEvent = 'evidence' | 'wrong' | 'hint';

export const MASCOT_EVENT_POSE: Record<MascotEvent, string> = { evidence: 'cheer', wrong: 'warning', hint: 'thinking' };
/** Poza spoczynkowa dla typu bloku, gdy autor jej nie ustawił (tylko sceny z punktami; reszta bez maskotki, żeby nie zajmować miejsca). */
export const DEFAULT_IDLE_POSE: Record<string, string> = { SCENE_HOTSPOTS: 'pointing' };

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

/** Stan reakcji czyszczony po REACTION_MS i przy zmianie bloku (`resetKey`). */
export function MascotReactionProvider({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const [reaction, setReaction] = useState<MascotReaction | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setReaction(null);
  }, []);

  const react = useCallback(
    (event: MascotEvent) => {
      if (timer.current) clearTimeout(timer.current);
      setReaction({ pose: MASCOT_EVENT_POSE[event], text: EVENT_TEXT[event] });
      timer.current = setTimeout(clear, REACTION_MS);
    },
    [clear],
  );

  useEffect(() => {
    clear();
  }, [resetKey, clear]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ reaction, react }), [reaction, react]);
  return <MascotReactionContext.Provider value={value}>{children}</MascotReactionContext.Provider>;
}

export const useMascotReaction = () => useContext(MascotReactionContext);
