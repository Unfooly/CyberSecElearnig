import { describe, it, expect } from 'vitest';
import { alignmentToCues, splitSentences } from './cues.js';
import { splitSentences as webSplitSentences } from '../../../apps/web/src/lib/narration-captions';
import type { Alignment } from './types.js';
import { createRequire } from 'node:module';

// Realny schemat treści (CJS z packages/content/dist, budowany przez postinstall): wynik alignmentToCues musi przechodzić walidację modułu.
const requireCjs = createRequire(import.meta.url);
const { narrationSchema } = requireCjs('../../../packages/content/dist/index.js') as {
  narrationSchema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: unknown } } };
};

// Alignment jak z ElevenLabs: po jednym wpisie na znak tekstu, 50 ms na znak (spacje i nowe linie też mają czas).
function alignmentFor(text: string, msPerChar = 50): Alignment {
  const characters = [...text];
  return {
    characters,
    characterStartTimesSeconds: characters.map((_, i) => (i * msPerChar) / 1000),
    characterEndTimesSeconds: characters.map((_, i) => ((i + 1) * msPerChar) / 1000),
  };
}

const CORPUS = [
  'Spójrz uważnie na adres nadawcy. Oszuści często podmieniają jedną literę. Zwróć uwagę na zero zamiast litery o.',
  'Np. dr Kowalski z ul. Długiej pisze do Ciebie. Jan K. prosi o pilną wpłatę! Czy to prawda? Sprawdź to.',
  'Kwota wynosi 12,50 zł. Termin: 21.09.2026 r. Zadzwoń pod 800 123 456.',
  'Jedno zdanie bez kropki na końcu',
  '   Wiele   spacji\n\noraz nowe linie. Drugie   zdanie.  ',
  'Wielokropek… Potem dalej. „Cytat.” Koniec.',
  '',
  '   ',
];

describe('splitSentences: zgodność z apps/web (napisy w odtwarzaczu)', () => {
  it.each(CORPUS.map((text) => [text.slice(0, 40)?.replace(/\s+/g, ' ') || '(pusty)', text]))('ten sam podział zdań: %s', (_label, text) => {
    expect(splitSentences(text)).toEqual(webSplitSentences(text));
  });
});

describe('alignmentToCues', () => {
  const text = 'Pierwsze zdanie. Drugie zdanie jest dłuższe. Trzecie.';

  it('startMs zdania = czas jego pierwszego znaku; pierwszy napis od 0; durationMs = koniec ostatniego znaku (w górę)', () => {
    const { cues, durationMs } = alignmentToCues(text, alignmentFor(text));
    expect(cues.map((cue) => cue.text)).toEqual(['Pierwsze zdanie.', 'Drugie zdanie jest dłuższe.', 'Trzecie.']);
    expect(cues[0].startMs).toBe(0);
    expect(cues[1].startMs).toBe(17 * 50); // "Drugie" zaczyna się na indeksie 17 (po "Pierwsze zdanie. ")
    expect(cues[2].startMs).toBe(text.indexOf('Trzecie') * 50);
    expect(durationMs).toBe(text.length * 50);
  });

  it('czas nagrania zaokrąglany w górę do pełnej milisekundy', () => {
    const alignment = alignmentFor('Ok.');
    alignment.characterEndTimesSeconds[2] = 0.1234;
    expect(alignmentToCues('Ok.', alignment).durationMs).toBe(124);
  });

  it('białe znaki w tekście i alignment mogą się różnić (nowe linie, podwójne spacje): liczą się litery', () => {
    const original = 'Pierwsze zdanie.\n\nDrugie   zdanie.';
    // ElevenLabs: te same litery, ale spacje inaczej (jedna spacja zamiast "\n\n" i "   ").
    const aligned = 'Pierwsze zdanie. Drugie zdanie.';
    const { cues } = alignmentToCues(original, alignmentFor(aligned));
    expect(cues.map((cue) => cue.text)).toEqual(['Pierwsze zdanie.', 'Drugie zdanie.']);
    expect(cues[1].startMs).toBe(aligned.indexOf('Drugie') * 50);
  });

  it('startMs jest niemalejące nawet przy nierosnących czasach w alignment; żaden nie przekracza durationMs', () => {
    const alignment = alignmentFor(text);
    const second = text.indexOf('Drugie');
    const third = text.indexOf('Trzecie');
    alignment.characterStartTimesSeconds[third] = 0.01; // "cofnięty" czas trzeciego zdania
    alignment.characterStartTimesSeconds[second] = 99; // "z przyszłości"
    const { cues, durationMs } = alignmentToCues(text, alignment);
    expect(cues[1].startMs).toBe(durationMs);
    expect(cues[2].startMs).toBeGreaterThanOrEqual(cues[1].startMs);
    for (const cue of cues) expect(cue.startMs).toBeLessThanOrEqual(durationMs);
  });

  it('inna litera niż w tekście to błąd (czasy z innego tekstu; nie zgadujemy)', () => {
    const alignment = alignmentFor('Pierwsze zdania. Drugie zdanie.');
    expect(() => alignmentToCues('Pierwsze zdanie. Drugie zdanie.', alignment)).toThrow(/nie pasuje do tekstu/);
  });

  it('nadmiar znaków w alignment, różne długości tablic i pusty alignment to błąd', () => {
    expect(() => alignmentToCues('Ok.', alignmentFor('Ok. Jeszcze coś.'))).toThrow(/więcej znaków/);
    const broken = alignmentFor('Ok.');
    broken.characterEndTimesSeconds.pop();
    expect(() => alignmentToCues('Ok.', broken)).toThrow(/różną długość/);
    expect(() => alignmentToCues('Ok.', { characters: [], characterStartTimesSeconds: [], characterEndTimesSeconds: [] })).toThrow(/pusty/);
  });

  it('limity ze schematu treści: max 200 napisów', () => {
    const many = Array.from({ length: 201 }, (_, i) => `Zdanie numer ${i + 1}.`).join(' ');
    expect(() => alignmentToCues(many, alignmentFor(many))).toThrow(/Za dużo napisów/);
  });

  it('wynik przechodzi narrationSchema z packages/content (audioUrl + durationMs + cues), więc zapis do modułu nie odbije się od walidacji', () => {
    const { cues, durationMs } = alignmentToCues(text, alignmentFor(text));
    const parsed = narrationSchema.safeParse({ text, audioUrl: 'audio/mod/v1/blok/0123456789abcdef.mp3', durationMs, cues });
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? '')).toBe(true);
  });

  it('NaN i nieskończoność w czasach to błąd (nie cichy startMs = NaN); ujemne czasy też', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const starts = alignmentFor(text);
      starts.characterStartTimesSeconds[text.indexOf('Drugie')] = bad;
      expect(() => alignmentToCues(text, starts)).toThrow(/skończonymi liczbami/);
      const ends = alignmentFor(text);
      ends.characterEndTimesSeconds[3] = bad;
      expect(() => alignmentToCues(text, ends)).toThrow(/skończonymi liczbami/);
    }
  });

  it('limity schematu: napis do 1000 znaków, nagranie do 30 minut', () => {
    const long = `${'a'.repeat(1001)}.`;
    expect(() => alignmentToCues(long, alignmentFor(long))).toThrow(/ponad 1000 znaków/);
    expect(() => alignmentToCues('Ok.', alignmentFor('Ok.', 700_000))).toThrow(/30 minut/);
  });

  it('emoji (znak spoza BMP) jest jednym znakiem: indeksy nie rozjeżdżają się względem alignment z code pointów', () => {
    const emoji = 'Uwaga 🚨 phishing. Drugie zdanie.';
    const { cues } = alignmentToCues(emoji, alignmentFor(emoji)); // alignmentFor rozbija tekst na code pointy ([...text])
    expect(cues.map((cue) => cue.text)).toEqual(['Uwaga 🚨 phishing.', 'Drugie zdanie.']);
    expect(cues[1].startMs).toBe(Array.from(emoji).indexOf('D') * 50);
  });

  it('zdanie bez kropki i tekst w jednym zdaniu dają jeden napis od 0', () => {
    const one = 'Jedno zdanie bez kropki na końcu';
    const { cues } = alignmentToCues(one, alignmentFor(one));
    expect(cues).toEqual([{ text: one, startMs: 0 }]);
  });
});
