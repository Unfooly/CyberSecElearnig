import type { InnerSceneHotspot, SceneHotspot } from './courses-types';

/**
 * LUSTRO `flattenHotspots` z packages/content/src/semantics.ts (serwer - apps/api - używa oryginału): spłaszcza hotspoty
 * SCENE_HOTSPOTS (zewnętrzne + WEWNĘTRZNE z `media.kind: 'scene'`, B-086/D-071) do jednej listy. Musi dawać te same id co
 * po stronie serwera, inaczej required/ukończenie bloku na kliencie rozjedzie się z tym, co faktycznie przyjmie
 * POST /courses/:id/progress. Web nie importuje wartości z pakietu (ten sam powód co `required-items.ts` - patrz tam),
 * a tu dodatkowo oryginał żyje w części WYŁĄCZNIE dla Node (semantics.ts, natywny moduł re2 przez ./regex), więc importu
 * nie da się bezpiecznie zbundlować do przeglądarki nawet w testach - stąd bez testu porównawczego z oryginałem, w
 * odróżnieniu od required-items.test.ts.
 */
export function flattenHotspots(hotspots: readonly SceneHotspot[]): (SceneHotspot | InnerSceneHotspot)[] {
  return hotspots.flatMap((hotspot) => [hotspot, ...(hotspot.media?.kind === 'scene' ? (hotspot.media.scene?.hotspots ?? []) : [])]);
}
