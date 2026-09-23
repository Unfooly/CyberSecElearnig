import type { InnerSceneHotspot, SceneHotspot } from './courses-types';

/**
 * LUSTRO `flattenHotspots` z packages/content/src/semantics.ts (serwer - apps/api - używa oryginału): spłaszcza hotspoty
 * SCENE_HOTSPOTS (zewnętrzne + WEWNĘTRZNE z `media.kind: 'scene'`, B-086/D-071) do jednej listy. Musi dawać te same id co
 * po stronie serwera, inaczej required/ukończenie bloku na kliencie rozjedzie się z tym, co faktycznie przyjmie
 * POST /courses/:id/progress. Web importuje z @cyberszkolo/content WYŁĄCZNIE część izomorficzną - `apps/web/.eslintrc.json`
 * (`no-restricted-imports`) blokuje `@cyberszkolo/content/dist/*`/`src/*` w CAŁYM apps/web BEZ WYJĄTKU dla plików
 * testowych (sprawdzone: próba importu oryginału w flatten-hotspots.test.ts wywala `next lint`/`next build`, mimo że
 * Vitest sam w sobie uruchamia się pod prawdziwym Node i techniczne rozwiązanie `re2` by tam zadziałało) - stąd bez
 * testu porównawczego z oryginałem, w odróżnieniu od required-items.test.ts (który mirroruje `requiredItemIds`, funkcję
 * z części izomorficznej, więc porównanie z oryginałem nie łamie tej reguły).
 */
export function flattenHotspots(hotspots: readonly SceneHotspot[]): (SceneHotspot | InnerSceneHotspot)[] {
  return hotspots.flatMap((hotspot) => [hotspot, ...(hotspot.media?.kind === 'scene' ? (hotspot.media.scene?.hotspots ?? []) : [])]);
}
