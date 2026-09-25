import { useCallback, useEffect, useState, type RefObject } from 'react';

// Fullscreen API na ramce odtwarzacza (PlayerStage). `enabled` odzwierciedla document.fullscreenEnabled - przycisk
// jest ukryty, gdy przeglądarka/kontekst (np. iframe bez allow="fullscreen") go nie wspiera. `active` śledzi
// document.fullscreenElement przez zdarzenie fullscreenchange (nie tylko stan po naszym własnym toggle() - Escape w
// fullscreenie wychodzi z niego przez samą przeglądarkę, bez wołania toggle(), więc trzeba to złapać z zewnątrz).
export function useFullscreen(ref: RefObject<HTMLElement>): { enabled: boolean; active: boolean; toggle: () => void } {
  const [enabled] = useState(() => typeof document !== 'undefined' && document.fullscreenEnabled === true);
  const [active, setActive] = useState(() => typeof document !== 'undefined' && document.fullscreenElement != null);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
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
