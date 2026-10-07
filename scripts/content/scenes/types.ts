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

/**
 * Kontekst renderowania klocka (D-135). Klocki z tekstem dopasowywanym (`fitText`) biorą z niego dolną granicę rozmiaru
 * czcionki w SWOICH jednostkach (po uwzględnieniu skali elementu i skali sceny na telefonie) oraz nazwy do komunikatów błędów.
 */
export interface PropContext {
  /** Najmniejszy dopuszczalny rozmiar czcionki w lokalnych jednostkach klocka; 0 = bez dolnej granicy (sceny bez `strings`). */
  minFontSize: number;
  /** Do komunikatu błędu: scena, element, język. */
  where: string;
}

export type PropFn<Params = Record<string, unknown>> = (params: Params, context?: PropContext) => PropOutput;

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
  /**
   * Tekst tła, którego nie trzeba czytać (grzbiety segregatorów, drobne etykiety) - bez kontroli minimalnego rozmiaru (D-135).
   * Tylko w scenach z `strings`; tekst i tak musi pochodzić ze `strings` (jeden język w grafice).
   */
  decorative?: boolean;
  /** Ekran telefonu w scenie: minimalny rozmiar tekstu 16 px zamiast 14 px (domyślnie dla klocków z PHONE_SCREEN_PROPS). */
  phoneScreen?: boolean;
}

export type SceneLocale = 'pl' | 'en';
/** Wartość tekstu w `strings`: napis albo lista (parametry typu `lines[]`). */
export type SceneString = string | string[];

export interface SceneSpec {
  width?: number;
  height?: number;
  background?: {
    /** Kolor tła; 'none' (z `flat: true`) - przezroczyste tło bez prostokąta (zbliżenia, ekrany w ramce monitora - D-101). */
    wall?: string;
    floor?: string;
    /** Linia podłogi w px od góry. */
    floorY?: number;
    /** true → jednolite tło (kolor `wall`), bez podłogi — do pulpitu i zbliżeń. */
    flat?: boolean;
  };
  items: SceneItem[];
  /**
   * Teksty sceny per język (D-135, i18n-3): parametr klocka `{ "$t": "klucz" }` dostaje napis z `strings[język].klucz`. Scena ze
   * `strings` jest budowana osobno dla każdego języka (`<out>/<język>/<nazwa>.svg`), każdy tekst w niej musi pochodzić ze `strings`
   * (poza samymi cyframi), a tekst do czytania ma na telefonie co najmniej 14 px (16 px na ekranie telefonu) - inaczej błąd builda.
   */
  strings?: Partial<Record<SceneLocale, Record<string, SceneString>>>;
  /**
   * Jak scena jest pokazywana na telefonie 390×844 (skala do kontroli rozmiaru tekstu): 'contain' (domyślnie: cała scena w obszarze
   * bloku - warianty pionowe, zbliżenia) albo 'panorama' (scena pozioma na pełną wysokość obszaru, przewijana w bok).
   */
  phone?: 'contain' | 'panorama';
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
  /** Język wyniku - tylko dla scen ze `strings`. */
  locale?: SceneLocale;
  hotspots: Hotspot[];
  width: number;
  height: number;
}
