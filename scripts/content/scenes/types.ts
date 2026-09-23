/**
 * Klocek (prop) renderuje się w lokalnym układzie współrzędnych (0,0) → (w,h).
 * Kompozytor przesuwa i skaluje go transformem; hotspot liczy z (x, y, w*scale, h*scale).
 */
export interface PropOutput {
  /** Fragment SVG bez <svg>, w lokalnych współrzędnych. */
  svg: string;
  /** Rozmiar lokalny (przed skalowaniem). */
  w: number;
  h: number;
  /**
   * Opcjonalne pod-obszary, które mogą być osobnym hotspotem
   * (np. karteczka przyklejona do monitora). Lokalne współrzędne.
   */
  parts?: Record<string, { x: number; y: number; w: number; h: number }>;
}

export type PropFn<Params = Record<string, unknown>> = (params: Params) => PropOutput;

export interface SceneItem {
  /** Identyfikator elementu; gdy `hotspot` jest ustawione, staje się id hotspotu. */
  id: string;
  prop: string;
  x: number;
  y: number;
  scale?: number;
  /** Parametry klocka (zależne od typu). */
  params?: Record<string, unknown>;
  /**
   * true → cały klocek jest hotspotem;
   * "nazwa-części" → hotspotem jest tylko część (z `parts`);
   * brak/false → tylko dekoracja.
   */
  hotspot?: boolean | string;
  /** Dodatkowy hotspot dla części klocka pod innym id, np. { karteczka: 'sticky' }. */
  partHotspots?: Record<string, string>;
  /** Margines hotspotu w px sceny (domyślnie 8). */
  pad?: number;
}

export interface SceneSpec {
  width?: number;
  height?: number;
  background?: {
    wall?: string;
    floor?: string;
    /** Linia podłogi w px od góry. */
    floorY?: number;
    /** true → jednolite tło (kolor `wall`), bez podłogi — do pulpitu i zbliżeń. */
    flat?: boolean;
  };
  items: SceneItem[];
}

export interface Hotspot {
  id: string;
  /** Procenty szerokości/wysokości sceny, zaokrąglone do 0.1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComposeResult {
  svg: string;
  hotspots: Hotspot[];
  width: number;
  height: number;
}
