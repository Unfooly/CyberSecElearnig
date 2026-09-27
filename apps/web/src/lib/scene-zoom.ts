// "Kamera" sceny (SceneHotspotsBlock, feat/scene-zoom, D-086): po kliknięciu przedmiotu scena przybliża się tak, żeby przedmiot zajął
// ~70% WIDOCZNEGO obszaru (a nie obrazu - na telefonie w pionie obraz jest szerszy od ekranu i przewijany w poziomie). Liczone w px z
// prostokątów z getBoundingClientRect: transform-origin w środku przedmiotu (względem obrazu), skala do celu, przesunięcie środka
// przedmiotu na środek widocznego obszaru. Tylko transform (bez zmian układu), więc hotspoty w % dalej leżą na obrazie.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SceneZoom {
  /** transform-origin względem pudełka obrazu, w px. */
  originX: number;
  originY: number;
  /** Przesunięcie (px) po skalowaniu wokół origin. */
  translateX: number;
  translateY: number;
  scale: number;
}

export const ZOOM_FILL = 0.7;
export const ZOOM_MAX_SCALE = 4;

/**
 * Transform przybliżenia: `item` - prostokąt przedmiotu, `image` - pudełko obrazu sceny (element z transformem), `view` - widoczny
 * obszar sceny (tam ma wylądować przedmiot). Skala tak, by przedmiot zajął `fill` widoku w ciaśniejszym wymiarze, w [1, max]; przedmiot
 * już większy niż cel - bez powiększania (skala 1), tylko wyśrodkowanie.
 */
export function sceneZoom(item: Box, image: Box, view: Box, fill = ZOOM_FILL, max = ZOOM_MAX_SCALE): SceneZoom {
  const itemCenterX = item.left + item.width / 2;
  const itemCenterY = item.top + item.height / 2;
  const fit = Math.min((view.width * fill) / Math.max(item.width, 1), (view.height * fill) / Math.max(item.height, 1));
  const scale = Math.min(max, Math.max(1, fit));
  return {
    originX: itemCenterX - image.left,
    originY: itemCenterY - image.top,
    translateX: view.left + view.width / 2 - itemCenterX,
    translateY: view.top + view.height / 2 - itemCenterY,
    scale,
  };
}

/** Wartości CSS dla `SceneZoom` (transform-origin + transform). */
export function sceneZoomStyle(zoom: SceneZoom): { transformOrigin: string; transform: string } {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    transformOrigin: `${r(zoom.originX)}px ${r(zoom.originY)}px`,
    transform: `translate(${r(zoom.translateX)}px, ${r(zoom.translateY)}px) scale(${r(zoom.scale)})`,
  };
}
