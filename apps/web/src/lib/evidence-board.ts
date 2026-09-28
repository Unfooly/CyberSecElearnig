// Geometria tablicy śledczej (ORDERING, feat/evidence-board, D-088): czyste funkcje, bez Reacta - łatwe do testów jednostkowych.
// Wszystkie wymiary w "jednostkach projektu" sceny (poziomo 1280×720 = 16:9, telefon w pionie szerokość 600, wysokość z liczby pól);
// komponent przelicza je na procenty sceny, a czcionki na cqw pudełka sceny. Poziomo scena skaluje się jak obraz ("contain"), bez
// przewijania; pionowo (D-105) ma szerokość bloku i przewija się w pionie - karty są dość duże na tekst 15 px.

export type BoardOrientation = 'landscape' | 'portrait';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface BoardLayout {
  orientation: BoardOrientation;
  width: number;
  height: number;
  /** Drewniana rama i korek wewnątrz niej. */
  frame: Rect;
  cork: Rect;
  /** Tabliczka "Tablica śledcza · ..." (lewy górny róg korka). */
  title: Point;
  /** Pola 1..N (kolejność = kolejność łańcucha). */
  slots: Rect[];
  /** "Zdjęcia" początku i końca łańcucha (null, gdy treść ich nie ma). */
  start: Rect | null;
  end: Rect | null;
  /** Tacka "Ślady do przypięcia" z kartami i przyciskiem "Sprawdź trop" (pionowo: null - tacka to pasek pod sceną, D-105). */
  tray: Rect | null;
  /** Rozmiar karty śladu (w polu i na tacce). */
  card: { w: number; h: number };
}

const LANDSCAPE = { width: 1280, height: 720 } as const;
const PORTRAIT_WIDTH = 600;

/** Proporcja sceny poziomej (szerokość / wysokość); pionowa ma proporcję z układu (wysokość zależy od liczby pól). */
export function boardRatio(): number {
  return LANDSCAPE.width / LANDSCAPE.height;
}

/**
 * Orientacja z wymiarów dostępnego miejsca: telefon w pionie (wysokość wyraźnie większa od szerokości) dostaje pionowy zygzak,
 * reszta poziome "U". Próg 1.15, żeby prawie kwadratowe okno nie przełączało układu przy każdej zmianie o piksel.
 */
export function boardOrientation(width: number, height: number): BoardOrientation {
  return height > width * 1.15 ? 'portrait' : 'landscape';
}

// Pionowo (D-105): jedna kolumna szerokich kart na przemian przesuniętych w lewo i w prawo (zygzak). Karta 440 j. szerokości przy
// najwęższym telefonie (scena ~340 px, 1 j. ~0.57 px) mieści ok. 26 znaków tekstu 15 px w linii; linia 15 px × 1.3 to ~36 j. Wysokość
// karty i zdjęcia rośnie z najdłuższym tekstem (schemat pozwala na 300 znaków śladu) - tekst nie jest ucinany; min. 150 j. = 3 linie.
const PORTRAIT_CARD_W = 440;
const PORTRAIT_LINE = 36;
const PORTRAIT_GAP = 34;
const PORTRAIT_PHOTO_W = 300;

/** Wysokość karty pionowej (j.) dla najdłuższego tekstu śladu: padding 28 j. + linie, min. 150 j. */
export function portraitCardHeight(maxChars: number): number {
  return Math.max(150, 30 + Math.ceil(maxChars / 26) * PORTRAIT_LINE);
}

/** Wysokość zdjęcia pionowego (j.): etykieta (~14 znaków w linii) + podpis (~16 znaków w linii), min. 130 j. */
export function portraitPhotoHeight(labelChars: number, captionChars: number): number {
  const lines = Math.max(1, Math.ceil(labelChars / 14)) + Math.max(1, Math.ceil(captionChars / 16));
  return Math.max(130, 24 + lines * PORTRAIT_LINE);
}

/**
 * Układ tablicy dla `count` pól. Poziomo: pola w kształcie U - górny rząd od lewej do prawej, dolny od prawej do lewej, zdjęcie
 * początku po lewej u góry, końca po lewej na dole. Pionowo (telefon, D-105): jedna kolumna kart z góry na dół na przemian przy lewej
 * i prawej krawędzi (zygzak), początek u góry z lewej, koniec pod ostatnim polem po stronie przeciwnej; wysokość sceny rośnie z
 * liczbą pól (scena przewija się w pionie), tacka jest paskiem pod sceną (tray: null).
 */
export function boardLayout(
  count: number,
  orientation: BoardOrientation,
  options: {
    start?: boolean;
    end?: boolean;
    /** Tylko pionowo: najdłuższy tekst śladu i etykiety/podpisu zdjęć (znaki) - wysokość kart i zdjęć (D-105). */
    maxChars?: number;
    photoChars?: { label: number; caption: number };
  } = {},
): BoardLayout {
  const n = Math.max(1, count);
  if (orientation === 'portrait') {
    const margin = 40;
    const card = { w: PORTRAIT_CARD_W, h: portraitCardHeight(options.maxChars ?? 0) };
    const photo = { w: PORTRAIT_PHOTO_W, h: portraitPhotoHeight(options.photoChars?.label ?? 0, options.photoChars?.caption ?? 0) };
    const columns = [margin, PORTRAIT_WIDTH - margin - card.w];
    // Tabliczka z tytułem ma na telefonie min. 15 px (~55 j. wysokości przy najwęższej scenie) - pod nią zdjęcie albo pierwsze pole.
    const start = options.start ? { x: margin, y: 100, ...photo } : null;
    const top = start ? start.y + start.h + 40 : 110;
    const slots = Array.from({ length: n }, (_, index) => ({
      x: columns[index % 2],
      y: top + index * (card.h + PORTRAIT_GAP),
      w: card.w,
      h: card.h,
    }));
    const last = slots[n - 1];
    // Zdjęcie końca po stronie przeciwnej do ostatniego pola - nić schodzi ukosem jak między polami.
    const end = options.end ? { x: (n - 1) % 2 === 0 ? PORTRAIT_WIDTH - margin - photo.w : margin, y: last.y + last.h + 40, ...photo } : null;
    const bottom = end ? end.y + end.h : last.y + last.h;
    const height = bottom + 40;
    return {
      orientation,
      width: PORTRAIT_WIDTH,
      height,
      frame: { x: 10, y: 10, w: PORTRAIT_WIDTH - 20, h: height - 20 },
      cork: { x: 22, y: 22, w: PORTRAIT_WIDTH - 44, h: height - 44 },
      title: { x: 36, y: 32 },
      slots,
      start,
      end,
      tray: null,
      card,
    };
  }

  const frame = { x: 16, y: 16, w: 1248, h: 514 };
  const cork = { x: 30, y: 30, w: 1220, h: 486 };
  const topCount = Math.ceil(n / 2);
  const bottomCount = n - topCount;
  const topSpan = { from: 250, to: 1230 };
  const bottomSpan = { from: options.end ? 420 : 250, to: 1230 };
  const topPitch = (topSpan.to - topSpan.from) / topCount;
  const bottomPitch = bottomCount > 0 ? (bottomSpan.to - bottomSpan.from) / bottomCount : topPitch;
  // 184 = sześć kart mieści się na tacce w jednym rzędzie (moduł 1); przy większej liczbie pól karty węższe.
  const cardW = Math.min(184, Math.floor(Math.min(topPitch, bottomPitch)) - 20);
  const card = { w: cardW, h: 112 };
  const topRow = Array.from({ length: topCount }, (_, index) => ({
    x: topSpan.from + index * topPitch + (topPitch - cardW) / 2,
    y: 104,
    w: cardW,
    h: card.h,
  }));
  // Dolny rząd idzie od prawej do lewej (łańcuch zawraca jak litera U).
  const bottomRow = Array.from({ length: bottomCount }, (_, index) => ({
    x: bottomSpan.to - (index + 1) * bottomPitch + (bottomPitch - cardW) / 2,
    y: 326,
    w: cardW,
    h: card.h,
  }));
  return {
    orientation,
    width: LANDSCAPE.width,
    height: LANDSCAPE.height,
    frame,
    cork,
    title: { x: 48, y: 44 },
    slots: [...topRow, ...bottomRow],
    start: options.start ? { x: 50, y: 100, w: 170, h: 124 } : null,
    end: options.end ? { x: 230, y: 330, w: 170, h: 124 } : null,
    tray: { x: 16, y: 542, w: 1248, h: 164 },
    card,
  };
}

/** Pinezka: środek górnej krawędzi, lekko w dół. */
export function pinOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + 6 };
}

/** Nić między dwiema pinezkami: łuk kwadratowy z lekkim zwisem (prostopadle do odcinka, w dół ekranu). */
export function yarnPath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const sag = Math.min(46, length * 0.16);
  // Normalna skierowana "w dół" (dodatnie y) - nić wisi, a nie wybrzusza się w górę.
  let nx = -dy / length;
  let ny = dx / length;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const cx = (a.x + b.x) / 2 + nx * sag;
  const cy = (a.y + b.y) / 2 + ny * sag;
  const r = (value: number) => Math.round(value * 10) / 10;
  return `M${r(a.x)} ${r(a.y)} Q ${r(cx)} ${r(cy)} ${r(b.x)} ${r(b.y)}`;
}

/**
 * Odcinki nici: początek -> pola 1..N -> koniec. Ciągły między dwoma przypiętymi węzłami (zdjęcia są zawsze przypięte), przerywany,
 * gdy któryś koniec to puste pole.
 */
export function yarnSegments(layout: BoardLayout, filled: readonly boolean[]): { d: string; solid: boolean }[] {
  const nodes: { point: Point; filled: boolean }[] = [];
  if (layout.start) nodes.push({ point: pinOf(layout.start), filled: true });
  layout.slots.forEach((slot, index) => nodes.push({ point: pinOf(slot), filled: filled[index] === true }));
  if (layout.end) nodes.push({ point: pinOf(layout.end), filled: true });
  return nodes.slice(1).map((node, index) => ({ d: yarnPath(nodes[index].point, node.point), solid: nodes[index].filled && node.filled }));
}

/**
 * Przypięcie karty `id` do pola `target` albo odłożenie na tackę. Upuszczenie na zajęte pole = zamiana: dotychczasowa karta idzie
 * tam, skąd przyszła przeciągana (inne pole albo tacka). Zwraca nową tablicę (bez mutacji).
 */
export function placeCard(placements: readonly (string | null)[], id: string, target: number | 'tray'): (string | null)[] {
  const next = [...placements];
  const from = next.indexOf(id);
  if (target === 'tray') {
    if (from >= 0) next[from] = null;
    return next;
  }
  if (target < 0 || target >= next.length || from === target) return next;
  const occupant = next[target];
  next[target] = id;
  if (from >= 0) next[from] = occupant;
  return next;
}

/** Lekki obrót przypiętej karty (±2°), stały dla pola - tablica nie "drga" przy każdym renderze. */
export const CARD_TILT = [-2, 1.5, -1, 2, -1.5, 1];
export function tiltOf(index: number): number {
  return CARD_TILT[index % CARD_TILT.length];
}

/**
 * Jedno zdanie informacji zwrotnej pod tablicą: z tekstu źródłowego (reakcja wyniku albo wyjaśnienie autora) - pierwsze zdanie, a gdy
 * jest tylko krótkim wtrąceniem ("Blisko."), razem z kolejnym. Bez tekstu - ogólne zdanie o wyniku.
 */
export function feedbackSentence(sourceText: string | undefined, correct: boolean | undefined): string {
  const text = sourceText?.trim();
  if (!text) return correct ? 'Kolejność jest poprawna - trop się zgadza.' : 'Nie wszystko jest na swoim miejscu - zobacz, jak było naprawdę.';
  const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map((sentence) => sentence.trim()) ?? [text];
  const first = sentences[0] ?? text;
  if (first.split(/\s+/).length < 4 && sentences[1]) return `${first} ${sentences[1]}`;
  return first;
}
