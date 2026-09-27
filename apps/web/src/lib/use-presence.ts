'use client';

import { useEffect, useState } from 'react';
import { prefersReducedMotion } from './motion';

/**
 * Montowanie nakładki z animacją wyjścia (D-090): po `open -> false` element zostaje jeszcze `exitMs` w DOM z `closing: true` (klasa
 * wyjścia, bez interakcji), potem znika. reduced-motion - znika od razu.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // Zmiana `open` w renderze (bez mrugnięcia pustej klatki między zamknięciem a startem animacji wyjścia).
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open && !prefersReducedMotion());
  }

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => setClosing(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [closing, exitMs]);

  return { mounted: open || closing, closing: !open && closing };
}
