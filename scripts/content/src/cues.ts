import type { Alignment } from './types.js';

// Napisy z timestampów ElevenLabs: tekst narracji dzielimy na zdania, a początek każdego zdania to czas jego pierwszego znaku w nagraniu
// (`alignment`). Wynik to `narration.cues` w module (PR 2 pokazuje je w czasie nagrania; bez cues obowiązuje podział proporcjonalny).
//
// UWAGA: `splitSentences` jest KOPIĄ apps/web/src/lib/narration-captions.ts (skrypt jest poza workspace'ami i nie importuje kodu aplikacji).
// Zgodność obu pilnuje test `cues.test.ts` (ten sam wynik na korpusie zdań); zmiana reguł podziału musi iść w obu miejscach.

// Skróty, po których kropka NIE kończy zdania (polskie).
const ABBREVIATIONS = new Set(['np', 'tzn', 'tzw', 'itd', 'itp', 'ok', 'ul', 'godz', 'dr', 'prof', 'mgr', 'inż', 'zob', 'tj', 'm.in', 'ww', 'wg', 'pkt', 'nr', 'rys', 'tab']);

/** Dzieli tekst na zdania (. ! ? … po których jest spacja i wielka litera/cyfra/cudzysłów); nie tnie po skrótach i liczbach dziesiętnych. */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized === '') return [];

  const sentences: string[] = [];
  let start = 0;
  const boundary = /([.!?…]+)(["”')\]]*)\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9"„(])/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(normalized)) !== null) {
    const end = match.index + match[1].length + match[2].length;
    const candidate = normalized.slice(start, end);
    const lastWord = candidate.replace(/[.!?…"”')\]]+$/, '').split(/\s+/).pop()?.toLowerCase() ?? '';
    // Kropka po skrócie ("np.", "m.in.") albo po pojedynczej literze (inicjał) nie kończy zdania.
    if (match[1] === '.' && (ABBREVIATIONS.has(lastWord) || /^\p{L}$/u.test(lastWord))) continue;
    sentences.push(candidate.trim());
    start = match.index + match[0].length;
  }
  const rest = normalized.slice(start).trim();
  if (rest !== '') sentences.push(rest);
  return sentences;
}

export interface Cue {
  text: string;
  startMs: number;
}

export interface CuesResult {
  cues: Cue[];
  /** Czas nagrania (ms): koniec ostatniego znaku, zaokrąglony w górę. */
  durationMs: number;
}

const isSpace = (char: string) => /\s/u.test(char);

/**
 * Buduje `cues` i `durationMs` z tekstu i czasów znaków. Znaki alignment dopasowujemy do znaków tekstu POMIJAJĄC białe znaki po obu
 * stronach (ElevenLabs bywa niezgodny w spacjach i znakach nowej linii, nie w literach); niezgodność liter to błąd (złe wejście: nie
 * zgadujemy czasów). Limity zgodne ze schematem treści: max 200 napisów, łączna długość napisów <= 2 * długość tekstu + 200; napisy
 * rosnąco, pierwszy od 0 ms (napis widoczny od początku nagrania), żaden po `durationMs` (max 30 min), pojedynczy napis <= 1000 znaków.
 * Tekst i znaki alignment porównujemy jako code pointy (Array.from), więc emoji nie rozjeżdżają indeksów.
 */
export function alignmentToCues(text: string, alignment: Alignment): CuesResult {
  const { characters, characterStartTimesSeconds: starts, characterEndTimesSeconds: ends } = alignment;
  if (characters.length !== starts.length || characters.length !== ends.length) {
    throw new Error('Alignment: tablice znaków i czasów mają różną długość.');
  }
  if (characters.length === 0) throw new Error('Alignment jest pusty.');
  // NaN i nieskończoność w czasach dałyby po cichu startMs = NaN (Math.max/min propagują NaN); wychwytujemy je od razu.
  if (![...starts, ...ends].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('Alignment: czasy muszą być skończonymi liczbami nieujemnymi.');
  }
  // Znaki tekstu jako code pointy (jak `characters` z ElevenLabs): emoji i inne znaki spoza BMP to jeden znak, nie dwa code units.
  const chars = Array.from(text);

  // Indeksy znaków alignment, które nie są białymi znakami, w kolejności.
  const alignedIndexes: number[] = [];
  characters.forEach((char, index) => {
    if (!isSpace(char)) alignedIndexes.push(index);
  });

  // Dla każdego niebiałego znaku tekstu (po indeksie w `text`): indeks w alignment.
  const textToAligned = new Map<number, number>();
  let cursor = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (isSpace(char)) continue;
    const alignedIndex = alignedIndexes[cursor];
    if (alignedIndex === undefined || characters[alignedIndex] !== char) {
      throw new Error(`Alignment nie pasuje do tekstu (znak ${i}: "${char}"): czasy pochodzą z innego tekstu.`);
    }
    textToAligned.set(i, alignedIndex);
    cursor += 1;
  }
  if (cursor !== alignedIndexes.length) throw new Error('Alignment zawiera więcej znaków niż tekst.');

  const durationMs = Math.ceil(Math.max(...ends) * 1000);
  // Limit ze schematu treści (narration.durationMs <= 30 min).
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 1_800_000) throw new Error('Alignment: nieprawidłowy czas nagrania (0 do 30 minut).');

  const sentences = splitSentences(text);
  const cues: Cue[] = [];
  let position = 0;
  let previousStart = 0;
  for (const sentence of sentences) {
    // Pierwszy niebiały znak zdania w oryginale: idziemy po tekście, dopasowując znaki zdania (ono jest tekstem ze zwiniętymi spacjami).
    let firstIndex = -1;
    for (const char of sentence) {
      if (isSpace(char)) continue;
      while (position < chars.length && isSpace(chars[position])) position += 1;
      if (chars[position] !== char) throw new Error(`Nie można dopasować zdania "${sentence.slice(0, 40)}" do tekstu.`);
      if (firstIndex < 0) firstIndex = position;
      position += 1;
    }
    if (firstIndex < 0) continue;
    const alignedIndex = textToAligned.get(firstIndex)!;
    const startMs = cues.length === 0 ? 0 : Math.min(durationMs, Math.max(previousStart, Math.round(starts[alignedIndex] * 1000)));
    cues.push({ text: sentence, startMs });
    previousStart = startMs;
  }

  if (cues.length === 0) throw new Error('Tekst narracji nie zawiera zdań.');
  if (cues.length > 200) throw new Error(`Za dużo napisów (${cues.length}, max 200): skróć narrację albo podziel na bloki.`);
  const tooLong = cues.find((cue) => cue.text.length > 1000);
  if (tooLong) throw new Error(`Zdanie ma ponad 1000 znaków (limit napisu w schemacie): podziel je kropką. Początek: "${tooLong.text.slice(0, 40)}".`);
  const total = cues.reduce((sum, cue) => sum + cue.text.length, 0);
  if (total > 2 * text.length + 200) throw new Error('Łączna długość napisów przekracza limit ze schematu treści.');
  return { cues, durationMs };
}
