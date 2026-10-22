'use client';

import { createContext, useContext, type ReactNode } from 'react';

// Wstrzymanie lektora bloku (pasek narracji) przez blok, który sam gra głos postaci (przesłuchanie, B-135): narrator i postać nie mówią
// naraz. Poza odtwarzaczem (testy bloków) - nic nie robi.
const NarrationPauseContext = createContext<() => void>(() => {});

export function NarrationPauseProvider({ pause, children }: { pause: () => void; children: ReactNode }) {
  return <NarrationPauseContext.Provider value={pause}>{children}</NarrationPauseContext.Provider>;
}

export function usePauseNarration(): () => void {
  return useContext(NarrationPauseContext);
}
