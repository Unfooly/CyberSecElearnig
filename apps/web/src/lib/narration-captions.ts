import type { Narration } from '@cyberszkolo/content';

// Napisy do narracji. Dokładne czasy (`cues`, z timestampów TTS, PR 3) mają pierwszeństwo; bez nich `text` jest dzielony na zdania, a czas
// rozkładany proporcjonalnie do długości zdań (bez znaczników per słowo) - zgrubny, ale wystarczający fallback.

export interface Caption {
  text: string;
  /** Początek napisu w nagraniu (ms); null, gdy nie znamy czasu nagrania (wtedy pokazujemy całość naraz). */
  startMs: number | null;
}

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

/** Napisy dla narracji: `cues` z treści, albo zdania z czasem proporcjonalnym do długości, albo (bez czasu nagrania) zdania bez czasu. */
export function buildCaptions(narration: Pick<Narration, 'text' | 'durationMs' | 'cues'>): Caption[] {
  if (narration.cues && narration.cues.length > 0) {
    return narration.cues.map((cue) => ({ text: cue.text, startMs: cue.startMs }));
  }
  const sentences = splitSentences(narration.text);
  if (sentences.length === 0) return [];
  if (narration.durationMs === undefined) return sentences.map((text) => ({ text, startMs: null }));

  // Waga zdania = liczba znaków (min. 1): dłuższe zdanie trwa proporcjonalnie dłużej.
  const weights = sentences.map((sentence) => Math.max(1, sentence.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let accumulated = 0;
  return sentences.map((text, index) => {
    const startMs = Math.round((accumulated / total) * narration.durationMs!);
    accumulated += weights[index];
    return { text, startMs };
  });
}

/** Indeks napisu aktywnego w danej chwili (ostatni o startMs <= pozycja); -1 przed pierwszym; 0, gdy napisy nie mają czasu. */
export function activeCaptionIndex(captions: Caption[], positionMs: number): number {
  if (captions.length === 0) return -1;
  if (captions.some((caption) => caption.startMs === null)) return 0;
  let active = -1;
  for (let i = 0; i < captions.length; i += 1) {
    if ((captions[i].startMs as number) <= positionMs) active = i;
    else break;
  }
  return active;
}
