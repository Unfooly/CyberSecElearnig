import { useCallback, useEffect, useState, type RefObject } from 'react';

// Fullscreen API na ramce odtwarzacza (PlayerStage). `enabled` odzwierciedla document.fullscreenEnabled - przycisk
// jest ukryty, gdy przeglądarka/kontekst (np. iframe bez allow="fullscreen") go nie wspiera. `active` śledzi
// document.fullscreenElement przez zdarzenie fullscreenchange (nie tylko stan po naszym własnym toggle() - Escape w
// fullscreenie wychodzi z niego przez samą przeglądarkę, bez wołania toggle(), więc trzeba to złapać z zewnątrz).
export function useFullscreen(ref: RefObject<HTMLElement>): { enabled: boolean; active: boolean; toggle: () => void } {
  // Zawsze false/false na starcie (kod review PR #44): CoursePlayer jest 'use client', ale page.tsx renderuje go
  // najpierw server-side (SSR) - tam document.fullscreenEnabled nie istnieje. Odczyt PRAWDZIWEGO stanu WYŁĄCZNIE
  // w useEffect (po hydratacji) - inaczej initializer useState zwracałby różne wartości na serwerze i w
  // przeglądarce (np. true na desktopie), co jest dokładnie hydration mismatch (React zgłasza błąd i re-renderuje
  // całe poddrzewo od nowa przy KAŻDYM wejściu w odtwarzacz).
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    setEnabled(document.fullscreenEnabled === true);
    setActive(document.fullscreenElement != null);
    function handleChange() {
      setActive(document.fullscreenElement != null);
    }
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    ref.current?.requestFullscreen().catch(() => {});
  }, [ref]);

  return { enabled, active, toggle };
}
