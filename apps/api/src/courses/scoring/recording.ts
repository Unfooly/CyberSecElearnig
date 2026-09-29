import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_FALSE_TAP_PENALTY, DEFAULT_FLAG_WINDOW_AFTER_MS, MAX_RECORDING_TAPS, idSchema, recordingTimeline } from '@cyberszkolo/content';

// Ocena odsłuchu nagrania (CALL_RECORDING, D-115) - WYŁĄCZNIE po stronie serwera. Klient wysyła tylko swoje tapnięcia: pozycję w
// nagraniu (`{ atMs }`, tryb odsłuchu) albo segment (`{ segmentId }`, tryb transkrypcji); nigdy trafień ani punktów. Flagi, okno i kara
// są w zapisanej wersji kursu (sekret, FIELD_CLASSIFICATION).

const MAX_RECORDING_MS = 1_800_000;
const tap = z.union([
  z.object({ atMs: z.number().int().min(0).max(MAX_RECORDING_MS) }).strict(),
  z.object({ segmentId: idSchema }).strict(),
]);
export const recordingAnswer = z.object({ taps: z.array(tap).max(MAX_RECORDING_TAPS) }).strict();
export type RecordingTap = z.infer<typeof tap>;

interface RecordingBlock {
  id: string;
  segments: { id: string; gapAfterMs?: number; narration?: { durationMs?: number } }[];
  flags: { segmentId: string; category: string }[];
  flagWindowAfterMs?: number;
  falseTapPenalty?: number;
}

export interface RecordingScore {
  points: number;
  /** Segmenty z flagą, które gracz trafił (id z treści - zostają w postępie, podgląd „Wstecz” i osiągnięcia). */
  flagsHit: string[];
  falseTaps: number;
}

const invalid = () => new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');

/**
 * Reguły (decyzja właściciela 2026-09-29):
 *  - okno flagi = [początek segmentu, koniec segmentu + flagWindowAfterMs] (domyślnie 1500 ms);
 *  - `{ segmentId }` trafia flagę tego segmentu; segment bez flagi = fałszywe tapnięcie; nieznany segment = odpowiedź odrzucona;
 *  - `{ atMs }` poza oknem każdej flagi = fałszywe; w części wspólnej nakładających się okien liczy się do WCZEŚNIEJSZEJ, jeszcze
 *    nietrafionej flagi (najpierw tapnięcia po segmencie, potem po czasie rosnąco - wynik nie zależy od kolejności w odpowiedzi);
 *  - kolejne tapnięcie w już trafioną flagę nie jest fałszywe (i nie daje punktu);
 *  - punkty = trafione / wszystkie flagi - kara × fałszywe (domyślnie 0,1), min. 0.
 */
export function scoreRecording(block: RecordingBlock, taps: RecordingTap[]): RecordingScore {
  const segmentIds = new Set(block.segments.map((segment) => segment.id));
  const flagged = new Set(block.flags.map((flag) => flag.segmentId));
  const hit = new Set<string>();
  let falseTaps = 0;

  const bySegment = taps.filter((t): t is { segmentId: string } => 'segmentId' in t);
  const byTime = taps.filter((t): t is { atMs: number } => 'atMs' in t).sort((a, b) => a.atMs - b.atMs);

  for (const { segmentId } of bySegment) {
    if (!segmentIds.has(segmentId)) throw invalid();
    if (flagged.has(segmentId)) hit.add(segmentId);
    else falseTaps += 1;
  }

  if (byTime.length > 0) {
    const timeline = recordingTimeline(block.segments);
    // Bez nagrania (potok TTS nie wpisał długości) nie ma pozycji w nagraniu - klient w tym stanie oferuje tylko transkrypcję.
    if (!timeline) throw new BadRequestException('To nagranie nie ma jeszcze znaczników czasu - zaznacz kwestie w transkrypcji');
    const after = block.flagWindowAfterMs ?? DEFAULT_FLAG_WINDOW_AFTER_MS;
    const windows = timeline.segments
      .filter((segment) => flagged.has(segment.id))
      .map((segment) => ({ segmentId: segment.id, from: segment.startMs, to: segment.endMs + after }))
      .sort((a, b) => a.from - b.from);
    for (const { atMs } of byTime) {
      const containing = windows.filter((window) => window.from <= atMs && atMs <= window.to);
      if (containing.length === 0) {
        falseTaps += 1;
        continue;
      }
      const first = containing.find((window) => !hit.has(window.segmentId));
      if (first) hit.add(first.segmentId);
    }
  }

  const total = block.flags.length;
  const penalty = block.falseTapPenalty ?? DEFAULT_FALSE_TAP_PENALTY;
  const raw = total === 0 ? 0 : hit.size / total - penalty * falseTaps;
  const points = Math.max(0, Math.min(1, Math.round(raw * 10_000) / 10_000));
  // Kolejność trafień jak kolejność flag w treści (stabilny zapis w postępie).
  const flagsHit = block.flags.map((flag) => flag.segmentId).filter((id) => hit.has(id));
  return { points, flagsHit, falseTaps };
}

/**
 * Rozstrzygnięcie po ocenie (odpowiedź /progress i podgląd ukończonego bloku): które segmenty były flagami, ich kategorie i czy gracz je
 * trafił, plus liczba fałszywych tapnięć. Po ukończeniu bloku to już nie jest tajne (jak kryteria maila).
 */
export function recordingDetail(block: RecordingBlock, score: Pick<RecordingScore, 'flagsHit' | 'falseTaps'>) {
  const hit = new Set(score.flagsHit);
  return {
    flags: block.flags.map((flag) => ({ segmentId: flag.segmentId, category: flag.category, hit: hit.has(flag.segmentId) })),
    falseTaps: score.falseTaps,
  };
}
