// Oś czasu nagrania rozmowy (CALL_RECORDING, D-115) - JEDNA definicja dla odtwarzacza (pozycja, przewijanie, napisy) i serwera (okna
// flag w ocenie), żeby tapnięcie `{ atMs }` znaczyło po obu stronach to samo. Część izomorficzna pakietu (bez modułów Node).

/** Domyślne okno flagi po końcu segmentu (decyzja właściciela 2026-09-29: od początku segmentu do końca + 1500 ms). */
export const DEFAULT_FLAG_WINDOW_AFTER_MS = 1500;
/** Domyślna kara za fałszywe tapnięcie (punkty = trafione / wszystkie - kara × fałszywe, min. 0). */
export const DEFAULT_FALSE_TAP_PENALTY = 0.1;
/** Najwięcej tapnięć w jednej odpowiedzi - limit odpowiedzi serwera i przycisku flagi w odtwarzaczu (jedna stała). */
export const MAX_RECORDING_TAPS = 200;

export interface TimelineSegmentInput {
  id: string;
  gapAfterMs?: number;
  narration?: { durationMs?: number };
}

export interface TimelineSegment {
  id: string;
  index: number;
  startMs: number;
  durationMs: number;
  /** Koniec segmentu (bez ciszy po nim). */
  endMs: number;
}

export interface RecordingTimeline {
  segments: TimelineSegment[];
  totalMs: number;
}

/**
 * Oś czasu z długości nagrań: początek segmentu = suma (durationMs + gapAfterMs) poprzednich. null, gdy któryś segment nie ma jeszcze
 * nagrania (`durationMs` wpisuje potok TTS) - wtedy odsłuch i tapnięcia `{ atMs }` nie istnieją, zostaje tryb transkrypcji.
 */
export function recordingTimeline(segments: readonly TimelineSegmentInput[]): RecordingTimeline | null {
  let cursor = 0;
  const result: TimelineSegment[] = [];
  for (const [index, segment] of segments.entries()) {
    const durationMs = segment.narration?.durationMs;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
    result.push({ id: segment.id, index, startMs: cursor, durationMs, endMs: cursor + durationMs });
    cursor += durationMs + Math.max(0, segment.gapAfterMs ?? 0);
  }
  return { segments: result, totalMs: cursor };
}

/** Segment grający w chwili `atMs` (w ciszy po segmencie - ten segment); null poza nagraniem. */
export function segmentAt(timeline: RecordingTimeline, atMs: number): TimelineSegment | null {
  if (atMs < 0 || atMs > timeline.totalMs) return null;
  let found: TimelineSegment | null = null;
  for (const segment of timeline.segments) {
    if (segment.startMs <= atMs) found = segment;
    else break;
  }
  return found;
}
