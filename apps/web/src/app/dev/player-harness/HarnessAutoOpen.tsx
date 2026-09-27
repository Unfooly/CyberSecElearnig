'use client';

import { useEffect } from 'react';

function waitForElement(selector: string, timeoutMs = 5000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    function poll() {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        resolve(el);
        return;
      }
      if (performance.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(poll);
    }
    poll();
  });
}

// Dev-only (dev/player-harness/page.tsx, tylko NEXT_PUBLIC_DEV_HARNESS=1): otwiera kartę hotspotu programowo po
// zamontowaniu, klikając po kolei w data-testid="hotspot-overlay-<id>" z `path` (od zewnętrznego do wewnętrznego -
// np. ['monitor', 'outlook'] dla hotspotu zagnieżdżonego w scenie). Klika PRAWDZIWE przyciski (nie ustawia stanu
// bloku wprost), więc otwarcie zachowuje się identycznie jak klik użytkownika - scripts/layout-check.mjs mierzy
// układ takiej samej karty, jaką dostałby gracz, tylko bez ręcznej nawigacji po scenie dla każdego hotspotu.
export default function HarnessAutoOpen({ path }: { path: string[] }) {
  useEffect(() => {
    let mounted = true;
    (async () => {
      for (const id of path) {
        // :not([aria-hidden]) - przedmioty sceny zagnieżdżonej są nieaktywne, dopóki kamera nie dojedzie na monitor (D-086).
        const el = await waitForElement(`[data-testid="hotspot-overlay-${id}"]:not([aria-hidden="true"])`);
        if (!mounted || !el) return;
        el.click();
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.join('>')]);
  return null;
}
