'use client';

import { useEffect, useState } from 'react';

// prefers-reduced-motion jako stan Reacta. Start ZAWSZE od false, odczyt dopiero w efekcie: serwer nie zna preferencji, a
// inicjalizator czytający matchMedia dawał inny pierwszy render w przeglądarce niż na serwerze (błąd hydratacji, złapany przez
// layout-check z reducedMotion:'reduce'). Nasłuchuje zmian ustawienia w trakcie sesji.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}
