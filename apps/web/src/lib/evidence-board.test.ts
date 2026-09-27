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
    expect(layout.tray.y).toBeGreaterThanOrEqual(layout.frame.y + layout.frame.h);
    expect(layout.tray.y + layout.tray.h).toBeLessThanOrEqual(layout.height);
  });

  it('poziomo: więcej pól = węższe karty, nadal bez nakładania (3..12)', () => {
    for (let n = 3; n <= 12; n += 1) {
      const layout = boardLayout(n, 'landscape', { start: true, end: true });
      const pieces = [...layout.slots, layout.start!, layout.end!];
      for (let i = 0; i < pieces.length; i += 1) for (let j = i + 1; j < pieces.length; j += 1) expect(overlaps(pieces[i], pieces[j]), `n=${n}`).toBe(false);
      for (const piece of pieces) expect(inside(layout.cork, piece), `n=${n}`).toBe(true);
    }
  });

  it('pionowo (telefon): zygzak w dwóch kolumnach z góry na dół, tacka pod ramą', () => {
    const layout = boardLayout(6, 'portrait', { start: true, end: true });
    expect(layout.width).toBeLessThan(layout.height);
    const xs = layout.slots.map((slot) => slot.x);
    expect(new Set(xs).size).toBe(2);
    expect(xs[0]).not.toBe(xs[1]);
    for (let i = 1; i < 6; i += 1) expect(layout.slots[i].y).toBeGreaterThan(layout.slots[i - 1].y);
    for (const piece of [...layout.slots, layout.start!, layout.end!]) expect(inside(layout.cork, piece)).toBe(true);
    // Sąsiednie pola są w różnych kolumnach, więc się nie nakładają.
    for (let i = 1; i < 6; i += 1) expect(overlaps(layout.slots[i], layout.slots[i - 1])).toBe(false);
    expect(layout.tray.y).toBeGreaterThan(layout.frame.y + layout.frame.h);
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
    expect(boardRatio('landscape')).toBeCloseTo(16 / 9);
    expect(boardRatio('portrait')).toBeCloseTo(0.6);
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
