'use client';

import { useSyncExternalStore } from 'react';

// Tryb telefonu odtwarzacza jako stan Reacta - te same dwa zapytania co tryby telefonowe odtwarzacza w globals.css (bloki @media z
// `.player-outer`/`.player-frame`, PlayerStage):
// telefon w poziomie (niska wysokość) albo w pionie (wąski ekran), zawsze z dotykowym wskaźnikiem, żeby wąskie/niskie okno na
// desktopie ich nie łapało (zgodność z globals.css pilnuje use-phone-layout.test.ts).
// useSyncExternalStore: na serwerze i przy hydracji false (serwer nie zna ekranu), a komponent montowany dopiero w przeglądarce (np.
// okienka easter egga po kliknięciu) dostaje właściwą wartość już w PIERWSZYM renderze - bez klatki w trybie desktopowym.
export const PHONE_LAYOUT_QUERIES = [
  '(max-height: 500px) and (orientation: landscape) and (pointer: coarse)',
  '(max-width: 767px) and (orientation: portrait) and (pointer: coarse)',
] as const;
// Lista zapytań po przecinku = którekolwiek pasuje.
export const PHONE_LAYOUT_QUERY = PHONE_LAYOUT_QUERIES.join(', ');

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(PHONE_LAYOUT_QUERY);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(PHONE_LAYOUT_QUERY)?.matches ?? false,
    () => false,
  );
}
