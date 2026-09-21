import { describe, it, expect } from 'vitest';
import { activeCaptionIndex, buildCaptions, splitSentences } from './narration-captions';

describe('splitSentences', () => {
  it('dzieli po . ! ? … przed wielką literą', () => {
    expect(splitSentences('Pierwsze zdanie. Drugie zdanie! Trzecie? Czwarte… Piąte.')).toEqual([
      'Pierwsze zdanie.',
      'Drugie zdanie!',
      'Trzecie?',
      'Czwarte…',
      'Piąte.',
    ]);
  });

  it('nie tnie po skrótach, inicjałach i liczbach dziesiętnych', () => {
    expect(splitSentences('Sprawdź np. adres nadawcy. To ważne.')).toEqual(['Sprawdź np. adres nadawcy.', 'To ważne.']);
    expect(splitSentences('Napisał J. Kowalski w sprawie. Dalej.')).toEqual(['Napisał J. Kowalski w sprawie.', 'Dalej.']);
    expect(splitSentences('Kwota to 3.14 zł. Koniec.')).toEqual(['Kwota to 3.14 zł.', 'Koniec.']);
    expect(splitSentences('Zob. m.in. punkt drugi. Koniec.')).toEqual(['Zob. m.in. punkt drugi.', 'Koniec.']);
  });

  it('cudzysłów po kropce zostaje w zdaniu; wielokrotne białe znaki są normalizowane', () => {
    expect(splitSentences('Powiedział: "Uważaj." Potem odszedł.')).toEqual(['Powiedział: "Uważaj."', 'Potem odszedł.']);
    expect(splitSentences('  Jedno   zdanie \n bez  kropki  ')).toEqual(['Jedno zdanie bez kropki']);
  });

  it('pusty tekst i same spacje dają pustą listę', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n ')).toEqual([]);
  });
});

describe('buildCaptions', () => {
  it('cues z treści mają pierwszeństwo (dokładne czasy)', () => {
    const captions = buildCaptions({
      text: 'Ignorowany tekst. Bo są cues.',
      durationMs: 5000,
      cues: [{ text: 'Pierwsze.', startMs: 0 }, { text: 'Drugie.', startMs: 3200 }],
    });
    expect(captions).toEqual([{ text: 'Pierwsze.', startMs: 0 }, { text: 'Drugie.', startMs: 3200 }]);
  });

  it('bez cues: zdania z czasem proporcjonalnym do długości, pierwszy startuje w 0', () => {
    const captions = buildCaptions({ text: 'Krótkie. To jest zdecydowanie dłuższe zdanie testowe.', durationMs: 10_000 });
    expect(captions.map((c) => c.text)).toEqual(['Krótkie.', 'To jest zdecydowanie dłuższe zdanie testowe.']);
    expect(captions[0].startMs).toBe(0);
    // Drugie zdanie startuje po czasie proporcjonalnym do długości pierwszego w całości tekstu.
    const first = 'Krótkie.'.length;
    const second = 'To jest zdecydowanie dłuższe zdanie testowe.'.length;
    expect(captions[1].startMs).toBe(Math.round((first / (first + second)) * 10_000));
  });

  it('czasy są niemalejące i mieszczą się w nagraniu', () => {
    const captions = buildCaptions({ text: 'Raz. Dwa dwa. Trzy trzy trzy. Cztery cztery cztery cztery.', durationMs: 7300 });
    for (let i = 0; i < captions.length; i += 1) {
      expect(captions[i].startMs).toBeGreaterThanOrEqual(0);
      expect(captions[i].startMs).toBeLessThanOrEqual(7300);
      if (i > 0) expect(captions[i].startMs as number).toBeGreaterThanOrEqual(captions[i - 1].startMs as number);
    }
  });

  it('bez czasu nagrania: zdania bez czasu (pokazywane razem); pusty tekst: brak napisów', () => {
    expect(buildCaptions({ text: 'Raz. Dwa.' })).toEqual([{ text: 'Raz.', startMs: null }, { text: 'Dwa.', startMs: null }]);
    expect(buildCaptions({ text: '   ' })).toEqual([]);
  });
});

describe('activeCaptionIndex', () => {
  const captions = [{ text: 'A', startMs: 0 }, { text: 'B', startMs: 1000 }, { text: 'C', startMs: 2500 }];

  it('zwraca ostatni napis, którego czas już nastąpił', () => {
    expect(activeCaptionIndex(captions, 0)).toBe(0);
    expect(activeCaptionIndex(captions, 999)).toBe(0);
    expect(activeCaptionIndex(captions, 1000)).toBe(1);
    expect(activeCaptionIndex(captions, 2499)).toBe(1);
    expect(activeCaptionIndex(captions, 9999)).toBe(2);
  });

  it('-1 przed pierwszym napisem i dla pustej listy; 0 dla napisów bez czasu', () => {
    expect(activeCaptionIndex([{ text: 'A', startMs: 500 }], 100)).toBe(-1);
    expect(activeCaptionIndex([], 100)).toBe(-1);
    expect(activeCaptionIndex([{ text: 'A', startMs: null }, { text: 'B', startMs: null }], 5000)).toBe(0);
  });
});
