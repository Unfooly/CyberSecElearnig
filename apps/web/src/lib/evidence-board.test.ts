import { describe, expect, it } from 'vitest';
import { boardLayout, boardOrientation, boardRatio, feedbackSentence, placeCard, tiltOf, yarnSegments, type Rect } from './evidence-board';

const inside = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('boardLayout', () => {
  it('poziomo, 6 pól + zdjęcia: kształt U (3 u góry od lewej, 3 na dole od prawej), wszystko w korku, bez nakładania', () => {
    const layout = boardLayout(6, 'landscape', { start: true, end: true });
    expect(layout.width / layout.height).toBeCloseTo(16 / 9);
    expect(layout.slots).toHaveLength(6);
    const [a, b, c, d, e, f] = layout.slots;
    expect(a.y).toBe(b.y);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(d.y).toBeGreaterThan(a.y);
    expect(d.x).toBeGreaterThan(e.x);
    expect(e.x).toBeGreaterThan(f.x);
    const pieces = [...layout.slots, layout.start!, layout.end!];
    for (const piece of pieces) expect(inside(layout.cork, piece)).toBe(true);
    for (let i = 0; i < pieces.length; i += 1) for (let j = i + 1; j < pieces.length; j += 1) expect(overlaps(pieces[i], pieces[j])).toBe(false);
    expect(layout.tray!.y).toBeGreaterThanOrEqual(layout.frame.y + layout.frame.h);
    expect(layout.tray!.y + layout.tray!.h).toBeLessThanOrEqual(layout.height);
  });

  it('tacka (D-129): do 6 śladów jeden rząd i scena 16:9 bez zmian; 7 i więcej - dwa rzędy bez przewijania, scena wyższa o rząd kart', () => {
    for (const n of [3, 6]) {
      const layout = boardLayout(n, 'landscape', { start: true, end: true });
      expect(layout.trayRows, `n=${n}`).toBe(1);
      expect(layout.height, `n=${n}`).toBe(720);
      expect(boardRatio(n)).toBeCloseTo(16 / 9);
    }
    for (const n of [7, 9, 12]) {
      const layout = boardLayout(n, 'landscape', { start: true, end: true });
      expect(layout.trayRows, `n=${n}`).toBe(2);
      // Dwa rzędy kart + nagłówek mieszczą się na tacce, a tacka w scenie.
      expect(layout.tray!.h, `n=${n}`).toBeGreaterThanOrEqual(2 * layout.card.h + 12 + 24);
      expect(layout.tray!.y + layout.tray!.h, `n=${n}`).toBeLessThanOrEqual(layout.height);
      expect(layout.height, `n=${n}`).toBeGreaterThan(720);
      // Każdy rząd mieści połowę kart (zaokrągloną w górę) - bez poziomego przewijania.
      const perRow = Math.ceil(n / 2);
      expect(perRow * layout.card.w + (perRow - 1) * 16, `n=${n}`).toBeLessThanOrEqual(layout.tray!.w - 28);
      expect(boardRatio(n)).toBeCloseTo(layout.width / layout.height);
    }
  });

  it('poziomo: więcej pól = węższe karty, nadal bez nakładania (3..12)', () => {
    for (let n = 3; n <= 12; n += 1) {
      const layout = boardLayout(n, 'landscape', { start: true, end: true });
      const pieces = [...layout.slots, layout.start!, layout.end!];
      for (let i = 0; i < pieces.length; i += 1) for (let j = i + 1; j < pieces.length; j += 1) expect(overlaps(pieces[i], pieces[j]), `n=${n}`).toBe(false);
      for (const piece of pieces) expect(inside(layout.cork, piece), `n=${n}`).toBe(true);
    }
  });

  it('pionowo (telefon, D-116): oś z nicią po lewej, jedna kolumna szerokich kart po jej prawej, START na górze, KONIEC na dole', () => {
    const layout = boardLayout(6, 'portrait', { start: true, end: true });
    expect(layout.width).toBeLessThan(layout.height);
    const axis = layout.axis!;
    // Jedna kolumna: wszystkie pola i zdjęcia przy tej samej lewej krawędzi, na prawo od osi.
    expect(new Set([...layout.slots, layout.start!, layout.end!].map((piece) => piece.x)).size).toBe(1);
    expect(layout.slots[0].x).toBeGreaterThan(axis.x);
    expect(layout.card.w / layout.width).toBeGreaterThan(0.7);
    for (let i = 1; i < 6; i += 1) expect(layout.slots[i].y).toBeGreaterThanOrEqual(layout.slots[i - 1].y + layout.slots[i - 1].h);
    // START nad zdjęciem początku, KONIEC pod zdjęciem końca; tabliczki na osi.
    expect(axis.start.y + axis.start.h).toBeLessThanOrEqual(layout.start!.y);
    expect(axis.end.y).toBeGreaterThanOrEqual(layout.end!.y + layout.end!.h);
    for (const tag of [axis.start, axis.end]) expect(tag.x).toBeLessThanOrEqual(axis.x);
    for (const piece of [...layout.slots, layout.start!, layout.end!, axis.start, axis.end]) expect(inside(layout.cork, piece)).toBe(true);
    expect(layout.tray).toBeNull();
    expect(boardLayout(6, 'landscape').axis).toBeNull();
  });

  it('pionowo: nić prosto po osi od START do KONIEC (pinezki kart na osi), przerywana przy pustych polach', () => {
    const layout = boardLayout(3, 'portrait', { start: true, end: true });
    const segments = yarnSegments(layout, [true, false, true]);
    // START -> zdjęcie -> 3 pola -> zdjęcie -> KONIEC = 6 odcinków, wszystkie pionowe na x osi.
    expect(segments).toHaveLength(6);
    for (const segment of segments) expect(segment.d).toMatch(new RegExp(`^M${layout.axis!.x} [\\d.]+ L${layout.axis!.x} [\\d.]+$`));
    expect(segments.map((segment) => segment.solid)).toEqual([true, true, false, false, true, true]);
  });

  it('pionowo: długi tekst śladu i podpis zdjęcia = wyższe karty i zdjęcia (tekst 15 px się nie ucina), nadal bez nakładania', () => {
    const short = boardLayout(6, 'portrait', { start: true, end: true, maxChars: 64, photoChars: { label: 10, caption: 18 } });
    const long = boardLayout(6, 'portrait', { start: true, end: true, maxChars: 300, photoChars: { label: 40, caption: 60 } });
    // Moduł 1 (najdłuższy ślad 64 znaki) - minimalne 150 j.
    expect(short.card.h).toBe(150);
    expect(long.card.h).toBeGreaterThanOrEqual(30 + Math.ceil(300 / 26) * 36);
    expect(long.start!.h).toBeGreaterThan(short.start!.h);
    const pieces = [...long.slots, long.start!, long.end!];
    for (const piece of pieces) expect(inside(long.cork, piece)).toBe(true);
    for (let i = 0; i < pieces.length; i += 1) for (let j = i + 1; j < pieces.length; j += 1) expect(overlaps(pieces[i], pieces[j])).toBe(false);
  });

  it('pionowo: wysokość sceny rośnie z liczbą pól (scena przewija się, karty zawsze tej samej wielkości)', () => {
    const three = boardLayout(3, 'portrait', { start: true, end: true });
    const nine = boardLayout(9, 'portrait', { start: true, end: true });
    expect(nine.height).toBeGreaterThan(three.height);
    expect(nine.card).toEqual(three.card);
  });

  it('pionowo, 3..12 pól ze zdjęciami i bez: nic na siebie nie nachodzi (pola, zdjęcia), wszystko w korku', () => {
    for (const photos of [true, false]) {
      for (let n = 3; n <= 12; n += 1) {
        const layout = boardLayout(n, 'portrait', { start: photos, end: photos });
        const pieces = [...layout.slots, ...(photos ? [layout.start!, layout.end!] : [])];
        for (const piece of pieces) expect(inside(layout.cork, piece), `n=${n} zdjęcia=${photos}`).toBe(true);
        for (let i = 0; i < pieces.length; i += 1) {
          for (let j = i + 1; j < pieces.length; j += 1) expect(overlaps(pieces[i], pieces[j]), `n=${n} zdjęcia=${photos} ${i}/${j}`).toBe(false);
        }
        expect(layout.card.h).toBeGreaterThanOrEqual(56);
      }
    }
  });

  it('bez start/end: brak zdjęć, pola zaczynają się bliżej krawędzi', () => {
    const layout = boardLayout(4, 'landscape');
    expect(layout.start).toBeNull();
    expect(layout.end).toBeNull();
  });

  it('orientacja z wymiarów i proporcja sceny', () => {
    expect(boardOrientation(390, 700)).toBe('portrait');
    expect(boardOrientation(1300, 600)).toBe('landscape');
    expect(boardOrientation(500, 520)).toBe('landscape');
    expect(boardRatio()).toBeCloseTo(16 / 9);
  });
});

describe('yarnSegments', () => {
  it('start -> pola -> koniec; ciągła między przypiętymi, przerywana do pustych', () => {
    const layout = boardLayout(3, 'landscape', { start: true, end: true });
    const segments = yarnSegments(layout, [true, false, true]);
    expect(segments).toHaveLength(4);
    expect(segments.map((segment) => segment.solid)).toEqual([true, false, false, true]);
    expect(segments[0].d).toMatch(/^M[\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
  });

  it('bez zdjęć - tylko odcinki między polami', () => {
    expect(yarnSegments(boardLayout(3, 'landscape'), [true, true, true])).toHaveLength(2);
  });
});

describe('placeCard', () => {
  it('z tacki na puste pole; na zajęte - zamiana (poprzednia karta wraca na tackę)', () => {
    expect(placeCard([null, null, null], 'a', 1)).toEqual([null, 'a', null]);
    expect(placeCard([null, 'b', null], 'a', 1)).toEqual([null, 'a', null]);
  });

  it('z pola na zajęte pole - zamiana miejscami; na tackę - zdjęcie z pola; na to samo pole - bez zmian', () => {
    expect(placeCard(['a', 'b', null], 'a', 1)).toEqual(['b', 'a', null]);
    expect(placeCard(['a', 'b', null], 'a', 2)).toEqual([null, 'b', 'a']);
    expect(placeCard(['a', 'b', null], 'b', 'tray')).toEqual(['a', null, null]);
    expect(placeCard(['a', 'b', null], 'a', 0)).toEqual(['a', 'b', null]);
    expect(placeCard(['a', null], 'a', 5)).toEqual(['a', null]);
  });
});

describe('tiltOf i feedbackSentence', () => {
  it('obrót ±2°, stały dla pola', () => {
    for (let i = 0; i < 12; i += 1) expect(Math.abs(tiltOf(i))).toBeLessThanOrEqual(2);
    expect(tiltOf(7)).toBe(tiltOf(1));
  });

  it('pierwsze zdanie reakcji; krótkie wtrącenie łączy z kolejnym; bez reakcji - zdanie ogólne', () => {
    expect(feedbackSentence('Blisko. Kluczowe: logowanie oszusta było przed telefonem. Dzwonił, bo już był w środku.', false)).toBe(
      'Blisko. Kluczowe: logowanie oszusta było przed telefonem.',
    );
    expect(feedbackSentence('Łańcuch dało się przerwać w trzech miejscach. Pamiętaj o tym.', true)).toBe('Łańcuch dało się przerwać w trzech miejscach.');
    expect(feedbackSentence(undefined, true)).toMatch(/poprawna/);
    expect(feedbackSentence('', false)).toMatch(/Nie wszystko/);
  });
});
