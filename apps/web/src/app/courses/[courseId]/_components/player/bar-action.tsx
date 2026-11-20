'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

/**
 * Akcja bloku w miejscu „Dalej” (D-187, uwaga właściciela 2026-11-20: „przycisk Sprawdź powinien być w tym samym miejscu co Dalej i zmieniać
 * nazwę w zależności od kontentu”). Blok oceniany przed odpowiedzią rejestruje swoją akcję (np. „Sprawdź”) - przycisk w dolnym pasku
 * pokazuje jej nazwę i ją uruchamia (nieaktywny, dopóki nie ma czego sprawdzić). Po odpowiedzi blok zdejmuje akcję i pasek wraca do „Dalej”
 * (wynik, gotowość - D-106). Jedna akcja naraz; podgląd „Wstecz” jej nie pokazuje (CoursePlayer).
 */
export interface BarAction {
  label: string;
  enabled: boolean;
  run: () => void;
}

type Setter = (action: BarAction | null) => void;

const BarActionContext = createContext<Setter | null>(null);

export function BarActionProvider({ onChange, children }: { onChange: Setter; children: ReactNode }) {
  return <BarActionContext.Provider value={onChange}>{children}</BarActionContext.Provider>;
}

/** Czy blok ma pasek z akcją (odtwarzacz) - bez niego (testy pojedynczego bloku, harness bez paska) blok pokazuje własny przycisk. */
export function useHasBarAction(): boolean {
  return useContext(BarActionContext) !== null;
}

/**
 * Rejestruje akcję bloku w pasku. `action` null = brak akcji (pasek pokazuje „Dalej”). `run` może się zmieniać co render - pasek woła zawsze
 * najnowszą wersję (ref), rejestracja zmienia się tylko przy zmianie nazwy albo aktywności. Niezmiennik: jeden rejestrujący blok na provider
 * (bieżący blok; podgląd „Wstecz” ma własny, pusty provider) - przy dwóch wygrywałby ostatni.
 */
export function useBarAction(action: BarAction | null): void {
  const set = useContext(BarActionContext);
  const runRef = useRef<(() => void) | null>(null);
  const run = action?.run ?? null;
  // Najnowsza akcja po każdym renderze (nie w trakcie renderu).
  useEffect(() => {
    runRef.current = run;
  });
  const label = action?.label ?? null;
  const enabled = action?.enabled ?? false;
  useEffect(() => {
    if (!set) return undefined;
    if (label === null) {
      set(null);
      return undefined;
    }
    set({ label, enabled, run: () => runRef.current?.() });
    return () => set(null);
  }, [set, label, enabled]);
}
