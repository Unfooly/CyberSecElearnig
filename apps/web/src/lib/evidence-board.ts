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
  /** Liczba rzędów kart na tacce (poziomo: 1 albo 2, D-129; pionowo: brak - pasek pod sceną). */
  trayRows?: number;
  /** Rozmiar karty śladu (w polu i na tacce). */
  card: { w: number; h: number };
  /**
   * Pionowo (telefon, D-116): oś łańcucha - czerwona nić po lewej (x), od tabliczki START na górze do KONIEC na dole; pinezka każdej
   * karty i zdjęcia leży na osi. Poziomo: null (nić łukami między pinezkami na górze kart).
   */
  axis: { x: number; start: Rect; end: Rect } | null;
}

const LANDSCAPE = { width: 1280, height: 720 } as const;
/** Szerokość projektu sceny poziomej (jednostki układu) - minimalna skala tablicy na szerokim ekranie liczy się od niej (D-130). */
export const BOARD_LANDSCAPE_WIDTH = LANDSCAPE.width;
const PORTRAIT_WIDTH = 600;

/**
 * Proporcja sceny poziomej (szerokość / wysokość) dla `count` śladów - tacka w dwóch rzędach (D-129) wydłuża scenę; pionowa ma proporcję
 * z układu (wysokość zależy od liczby pól).
 */
export function boardRatio(count = 1, options: { start?: boolean; end?: boolean } = {}): number {
  const layout = boardLayout(count, 'landscape', options);
  return layout.width / layout.height;
}

// Tacka pod tablicą (poziomo): nagłówek i odstępy wokół kart; ile kart mieści się w rzędzie o danej szerokości karty. Więcej śladów niż
// w jednym rzędzie - tacka w dwóch rzędach (D-129, bez poziomego przewijania), scena rośnie w dół o jeden rząd kart.
const TRAY = { x: 16, y: 542, w: 1248, paddingX: 14, header: 40, rowGap: 12, bottom: 12, cardGap: 16 } as const;
export function trayRows(count: number, cardW: number): number {
  const inner = TRAY.w - 2 * TRAY.paddingX;
  const perRow = Math.max(1, Math.floor((inner + TRAY.cardGap) / (cardW + TRAY.cardGap)));
  return count > perRow ? 2 : 1;
}

/**
 * Orientacja z wymiarów dostępnego miejsca: telefon w pionie (wysokość wyraźnie większa od szerokości) dostaje pionowy zygzak,
 * reszta poziome "U". Próg 1.15, żeby prawie kwadratowe okno nie przełączało układu przy każdej zmianie o piksel.
 */
export function boardOrientation(width: number, height: number): BoardOrientation {
  return height > width * 1.15 ? 'portrait' : 'landscape';
}

// Pionowo (D-116, jak makieta modułu 2 - zastępuje zygzak D-105): pionowa oś z czerwoną nicią po lewej, jedna kolumna kart i zdjęć po jej
// prawej, pinezka każdej karty na osi, START na górze i KONIEC na dole. Karta 440 j. szerokości przy najwęższym telefonie (scena ~340 px,
// 1 j. ~0.57 px) mieści ok. 26 znaków tekstu 15 px w linii; linia 15 px × 1.3 to ~36 j. Wysokość karty i zdjęcia rośnie z najdłuższym
// tekstem (schemat pozwala na 300 znaków śladu) - tekst nie jest ucinany; min. 150 j. = 3 linie.
const PORTRAIT_CARD_W = 440;
const PORTRAIT_LINE = 36;
const PORTRAIT_GAP = 34;
const PORTRAIT_PHOTO_W = 300;
/** Oś (nić) i lewa krawędź kolumny kart (j.). */
const AXIS_X = 64;
const COLUMN_X = 112;
/** Tabliczki START / KONIEC na osi (j.): min. 15 px tekstu przy najwęższej scenie. */
const TAG = { w: 170, h: 52 };
/** Pinezka karty na osi: tyle j. poniżej górnej krawędzi karty. */
const AXIS_PIN_DY = 34;

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
    const card = { w: Math.min(PORTRAIT_CARD_W, PORTRAIT_WIDTH - COLUMN_X - 40), h: portraitCardHeight(options.maxChars ?? 0) };
    const photo = { w: PORTRAIT_PHOTO_W, h: portraitPhotoHeight(options.photoChars?.label ?? 0, options.photoChars?.caption ?? 0) };
    // Tabliczka z tytułem ma na telefonie min. 15 px (~55 j. wysokości przy najwęższej scenie) - pod nią START, zdjęcie i pola.
    const startTag = { x: AXIS_X - 24, y: 104, ...TAG };
    const firstTop = startTag.y + startTag.h + 30;
    const start = options.start ? { x: COLUMN_X, y: firstTop, ...photo } : null;
    const top = start ? start.y + start.h + PORTRAIT_GAP : firstTop;
    const slots = Array.from({ length: n }, (_, index) => ({
      x: COLUMN_X,
      y: top + index * (card.h + PORTRAIT_GAP),
      w: card.w,
      h: card.h,
    }));
    const last = slots[n - 1];
    const end = options.end ? { x: COLUMN_X, y: last.y + last.h + PORTRAIT_GAP, ...photo } : null;
    const bottom = end ? end.y + end.h : last.y + last.h;
    const endTag = { x: AXIS_X - 24, y: bottom + 30, ...TAG };
    const height = endTag.y + endTag.h + 40;
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
      axis: { x: AXIS_X, start: startTag, end: endTag },
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
  // Jeden rząd: dotychczasowa tacka 164 j. (scena 1280×720 bez zmian - moduł 1). Dwa rzędy: + rząd kart i odstęp, scena odpowiednio wyższa.
  const rows = trayRows(n, cardW);
  const trayH = rows === 1 ? 164 : TRAY.header + 2 * card.h + TRAY.rowGap + TRAY.bottom;
  const height = rows === 1 ? LANDSCAPE.height : TRAY.y + trayH + (LANDSCAPE.height - (TRAY.y + 164));
  return {
    orientation,
    width: LANDSCAPE.width,
    height,
    frame,
    cork,
    title: { x: 48, y: 44 },
    slots: [...topRow, ...bottomRow],
    start: options.start ? { x: 50, y: 100, w: 170, h: 124 } : null,
    end: options.end ? { x: 230, y: 330, w: 170, h: 124 } : null,
    tray: { x: TRAY.x, y: TRAY.y, w: TRAY.w, h: trayH },
    trayRows: rows,
    card,
    axis: null,
  };
}

/** Pinezka: poziomo środek górnej krawędzi, lekko w dół; pionowo (oś, D-116) - na osi, na wysokości górnej części karty. */
export function pinOf(rect: Rect, layout?: Pick<BoardLayout, 'axis'>): Point {
  if (layout?.axis) return { x: layout.axis.x, y: rect.y + AXIS_PIN_DY };
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
  const axis = layout.axis;
  // Pionowo (D-116): nić prosto po osi, od tabliczki START do KONIEC (tabliczki są zawsze "przypięte").
  if (axis) nodes.push({ point: { x: axis.x, y: axis.start.y + axis.start.h / 2 }, filled: true });
  if (layout.start) nodes.push({ point: pinOf(layout.start, layout), filled: true });
  layout.slots.forEach((slot, index) => nodes.push({ point: pinOf(slot, layout), filled: filled[index] === true }));
  if (layout.end) nodes.push({ point: pinOf(layout.end, layout), filled: true });
  if (axis) nodes.push({ point: { x: axis.x, y: axis.end.y + axis.end.h / 2 }, filled: true });
  const r = (value: number) => Math.round(value * 10) / 10;
  const straight = (a: Point, b: Point) => `M${r(a.x)} ${r(a.y)} L${r(b.x)} ${r(b.y)}`;
  return nodes.slice(1).map((node, index) => ({
    d: axis ? straight(nodes[index].point, node.point) : yarnPath(nodes[index].point, node.point),
    solid: nodes[index].filled && node.filled,
  }));
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
