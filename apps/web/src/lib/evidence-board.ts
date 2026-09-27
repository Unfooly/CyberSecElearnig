// Geometria tablicy śledczej (ORDERING, feat/evidence-board, D-088): czyste funkcje, bez Reacta - łatwe do testów jednostkowych.
// Wszystkie wymiary w "jednostkach projektu" sceny (poziomo 1280×720 = 16:9, telefon w pionie 600×1000); komponent przelicza je na
// procenty sceny, a czcionki na cqw pudełka sceny - scena skaluje się jak obraz ("contain"), bez przewijania.

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
  /** Tacka "Ślady do przypięcia" z kartami i przyciskiem "Sprawdź trop". */
  tray: Rect;
  /** Rozmiar karty śladu (w polu i na tacce). */
  card: { w: number; h: number };
}

const LANDSCAPE = { width: 1280, height: 720 } as const;
const PORTRAIT = { width: 600, height: 1000 } as const;

/** Proporcja sceny (szerokość / wysokość) dla danej orientacji. */
export function boardRatio(orientation: BoardOrientation): number {
  return orientation === 'portrait' ? PORTRAIT.width / PORTRAIT.height : LANDSCAPE.width / LANDSCAPE.height;
}

/**
 * Orientacja z wymiarów dostępnego miejsca: telefon w pionie (wysokość wyraźnie większa od szerokości) dostaje pionowy zygzak,
 * reszta poziome "U". Próg 1.15, żeby prawie kwadratowe okno nie przełączało układu przy każdej zmianie o piksel.
 */
export function boardOrientation(width: number, height: number): BoardOrientation {
  return height > width * 1.15 ? 'portrait' : 'landscape';
}

/**
 * Układ tablicy dla `count` pól. Poziomo: pola w kształcie U - górny rząd od lewej do prawej, dolny od prawej do lewej, zdjęcie
 * początku po lewej u góry, końca po lewej na dole. Pionowo (telefon): zygzak w dwóch kolumnach z góry na dół, początek u góry z
 * lewej, koniec na dole w kolumnie PRZECIWNEJ do ostatniego pola (wysokość kart dobierana tak, by nic się nie nakładało).
 */
export function boardLayout(count: number, orientation: BoardOrientation, options: { start?: boolean; end?: boolean } = {}): BoardLayout {
  const n = Math.max(1, count);
  if (orientation === 'portrait') {
    const frame = { x: 10, y: 10, w: 580, h: 740 };
    const cork = { x: 22, y: 22, w: 556, h: 716 };
    const columns = [38, 312];
    const top = options.start ? 196 : 90;
    const floor = cork.y + cork.h - 8; // dolna krawędź ostatniej karty
    // Zdjęcie końca stoi w kolumnie PRZECIWNEJ do ostatniego pola, na dole - pola jego kolumny muszą kończyć się nad nim.
    const endColumn = (n - 1) % 2 === 0 ? 1 : 0;
    const end = options.end ? { x: endColumn === 0 ? 38 : 412, y: floor - 92, w: 150, h: 92 } : null;
    // Wysokość karty i odstęp: karty tej samej kolumny (co drugie pole) nie mogą na siebie nachodzić (2 × krok >= wysokość + 8).
    let h = 110;
    let step = 0;
    for (; h >= 56; h -= 2) {
      const spans = [(floor - top - h) / Math.max(1, n - 1)];
      if (end && n > 1) spans.push((end.y - 8 - top - h) / Math.max(1, n - 2));
      step = Math.max(0, Math.min(...spans));
      if (n === 1 || 2 * step >= h + 8) break;
    }
    const card = { w: 250, h };
    const slots = Array.from({ length: n }, (_, index) => ({ x: columns[index % 2], y: top + index * step, w: card.w, h: card.h }));
    return {
      orientation,
      width: PORTRAIT.width,
      height: PORTRAIT.height,
      frame,
      cork,
      title: { x: 36, y: 32 },
      slots,
      start: options.start ? { x: 38, y: 88, w: 150, h: 92 } : null,
      end,
      tray: { x: 10, y: 762, w: 580, h: 228 },
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
