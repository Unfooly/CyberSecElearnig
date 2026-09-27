'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

// Krótkie dźwięki interfejsu odtwarzacza (feat/dialogue-chat, D-087): pliki z apps/web/public/sfx/, głośność 0.35, wczytane z góry
// (preload), grane dopiero po pierwszym geście użytkownika na stronie (przeglądarki i tak blokują dźwięk przed gestem - bez tego
// warunku dostalibyśmy odrzucone play() i ostrzeżenia w konsoli) i WYCISZONE, gdy Lektor jest wyłączony (jedno ustawienie dźwięku
// dla gracza, zapisane na koncie - useNarrationPreference). Podgląd ukończonego bloku gra bez dźwięków - decyduje wywołujący.

// Nazwa = plik apps/web/public/sfx/<nazwa>.mp3 (nowe dźwięki dopisuj razem z plikiem).
export type SfxName = 'msg-send' | 'msg-receive';
export const SFX_VOLUME = 0.35;

const SfxEnabledContext = createContext(false);

export function SfxProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <SfxEnabledContext.Provider value={enabled}>{children}</SfxEnabledContext.Provider>;
}

let gestureSeen = false;
function trackGesture() {
  if (gestureSeen || typeof document === 'undefined') return;
  const mark = () => {
    gestureSeen = true;
    document.removeEventListener('pointerdown', mark, true);
    document.removeEventListener('keydown', mark, true);
  };
  document.addEventListener('pointerdown', mark, true);
  document.addEventListener('keydown', mark, true);
}

// Nasłuch od załadowania modułu (nie od montowania pierwszego komponentu z dźwiękiem): gest, który OTWORZYŁ rozmowę (klik w drzwi), też się
// liczy - inaczej kwestia otwierająca pierwszej rozmowy grałaby bez dźwięku.
trackGesture();

function hasGesture(): boolean {
  if (gestureSeen) return true;
  const activation = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined;
  return activation?.hasBeenActive === true;
}

/** Tylko do testów: stan "był gest" (moduł trzyma go globalnie na czas życia strony). */
export function __setGestureSeenForTests(value: boolean) {
  gestureSeen = value;
}

/**
 * Zwraca `play(name)` dla podanych dźwięków (wczytanych przy montowaniu). Nic nie gra, gdy Lektor jest wyłączony, przed pierwszym
 * gestem albo gdy przeglądarka odrzuci odtwarzanie - dźwięk jest ozdobą, nigdy warunkiem działania.
 */
export function useSfx(names: readonly SfxName[]): (name: SfxName) => void {
  const enabled = useContext(SfxEnabledContext);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const audios = useRef(new Map<SfxName, HTMLAudioElement>());
  const key = names.join('|');

  useEffect(() => {
    // Podgląd bez dźwięku (Lektor wyłączony): bez wczytywania plików.
    if (typeof Audio === 'undefined' || !enabled) return undefined;
    const map = audios.current;
    for (const name of key.split('|') as SfxName[]) {
      const audio = new Audio(`/sfx/${name}.mp3`);
      audio.preload = 'auto';
      audio.volume = SFX_VOLUME;
      map.set(name, audio);
    }
    return () => {
      map.forEach((audio) => {
        try {
          audio.pause();
        } catch {
          // jsdom - bez odtwarzania.
        }
      });
      map.clear();
    };
  }, [key, enabled]);

  return useCallback((name: SfxName) => {
    if (!enabledRef.current || !hasGesture()) return;
    const audio = audios.current.get(name);
    if (!audio) return;
    try {
      audio.currentTime = 0;
      const played = audio.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    } catch {
      // jsdom / przeglądarka bez obsługi mediów - bez dźwięku.
    }
  }, []);
}
