'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';

// Kaskada Escape w PlayerStage: karta hotspotu -> transkrypcja -> notatnik -> pełny ekran (kolejność PRIORITY).
// Zamiast każdej warstwy z WŁASNYM document.addEventListener('keydown', ...) (konkurowałyby o to samo zdarzenie,
// bez gwarancji kolejności) - jeden rejestr: każda warstwa zgłasza swój stan (otwarta/zamknięta) i funkcję
// zamykającą, PlayerStage na Escape woła closeTop(), który zamyka WYŁĄCZNIE najwyższą priorytetowo otwartą warstwę.
//
// D-075: w prawdziwej przeglądarce, gdy dokument JEST w trybie pełnoekranowym, pierwszy Escape jest przechwytywany
// przez samą przeglądarkę (natywne wyjście z fullscreena) - to dzieje się NIEZALEŻNIE od tego rejestru i PRZED (albo
// zamiast) tym, zanim strona w ogóle dostanie zdarzenie keydown w niezawodny, przenośny sposób. Efekt: kaskada
// karta->transkrypcja->notatnik, którą closeTop() implementuje poniżej, jest poprawna i przewidywalna WYŁĄCZNIE poza
// fullscreenem - w fullscreenie pierwszy Escape zawsze najpierw wychodzi z pełnego ekranu (obsługa przeglądarki, nie
// tego kodu), otwarta karta/panel zostają otwarte do kolejnego Escape. Świadomie tego nie obchodzimy (Keyboard Lock
// API działa tylko w Chromium i wymaga dodatkowych uprawnień/kontekstu) - stąd 'fullscreen' jako NAJNIŻSZY priorytet
// tutaj: dotyczy ścieżek innych niż "Escape w trakcie fullscreena" (np. programowe wywołanie closeTop()), nie
// zmienia natywnego zachowania przeglądarki.
export type OverlayLayer = 'hotspotCard' | 'transcript' | 'notebook' | 'fullscreen';

const PRIORITY: OverlayLayer[] = ['hotspotCard', 'transcript', 'notebook', 'fullscreen'];

interface OverlayEntry {
  isOpen: boolean;
  onClose: () => void;
}

interface OverlayStackContextValue {
  register: (layer: OverlayLayer, entry: OverlayEntry) => void;
  unregister: (layer: OverlayLayer) => void;
  /** Zamyka najwyższą priorytetowo otwartą warstwę; zwraca true, jeśli coś zamknęła. */
  closeTop: () => boolean;
}

const OverlayStackContext = createContext<OverlayStackContextValue | null>(null);

export function OverlayStackProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<OverlayLayer, OverlayEntry>());

  const register = useCallback((layer: OverlayLayer, entry: OverlayEntry) => {
    entries.current.set(layer, entry);
  }, []);
  const unregister = useCallback((layer: OverlayLayer) => {
    entries.current.delete(layer);
  }, []);
  const closeTop = useCallback(() => {
    for (const layer of PRIORITY) {
      const entry = entries.current.get(layer);
      if (entry?.isOpen) {
        entry.onClose();
        return true;
      }
    }
    return false;
  }, []);

  const value = useMemo(() => ({ register, unregister, closeTop }), [register, unregister, closeTop]);
  return <OverlayStackContext.Provider value={value}>{children}</OverlayStackContext.Provider>;
}

/** Rejestruje warstwę na czas, gdy komponent jest zamontowany; stan/onClose aktualizuje się przy każdej zmianie. */
export function useOverlayLayer(layer: OverlayLayer, isOpen: boolean, onClose: () => void): void {
  const ctx = useContext(OverlayStackContext);
  useEffect(() => {
    if (!ctx) return undefined;
    ctx.register(layer, { isOpen, onClose });
    return () => ctx.unregister(layer);
  }, [ctx, layer, isOpen, onClose]);
}

/** closeTop() poza komponentem-warstwą (np. PlayerStage na Escape) - no-op (false), gdy provider nie istnieje. */
export function useCloseTopOverlay(): () => boolean {
  const ctx = useContext(OverlayStackContext);
  return ctx?.closeTop ?? (() => false);
}
