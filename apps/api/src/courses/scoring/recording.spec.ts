import { BadRequestException } from '@nestjs/common';
import { fullBlocks } from '@cyberszkolo/content/dist/fixtures';
import { evaluateSubmit, type Block } from './evaluate';
import { recordingDetail, scoreRecording, type RecordingTap } from './recording';

// Ocena odsłuchu nagrania (CALL_RECORDING, D-115) - reguły właściciela z 2026-09-29.

const now = new Date('2026-09-29T10:00:00Z');
const opaque = (blockId: string, itemId: string) => `${blockId}:${itemId}`;

// Dwie sąsiednie flagi o NAKŁADAJĄCYCH SIĘ oknach (jak segmenty 3 i 4 modułu 2):
//   a: 0-1000 ms, okno [0, 2500]; b: 1000-2000 ms, okno [1000, 3500]; część wspólna [1000, 2500]. c: 2000-3000 bez flagi.
const overlapping = {
  id: 'nagranie',
  segments: [
    { id: 'a', narration: { durationMs: 1000 } },
    { id: 'b', narration: { durationMs: 1000 } },
    { id: 'c', narration: { durationMs: 1000 } },
  ],
  flags: [
    { segmentId: 'a', category: 'fear' },
    { segmentId: 'b', category: 'code_request' },
  ],
  flagWindowAfterMs: 1500,
  falseTapPenalty: 0.1,
};

const score = (taps: RecordingTap[]) => scoreRecording(overlapping, taps);

describe('scoreRecording: dwa nakładające się okna flag (decyzja właściciela)', () => {
  it('dwa tapnięcia w części wspólnej trafiają obie flagi (pierwsze wcześniejszą, drugie kolejną)', () => {
    expect(score([{ atMs: 1200 }, { atMs: 1800 }])).toEqual({ points: 1, flagsHit: ['a', 'b'], falseTaps: 0 });
  });

  it('jedno tapnięcie w części wspólnej trafia WCZEŚNIEJSZĄ, jeszcze nietrafioną flagę', () => {
    expect(score([{ atMs: 1500 }])).toEqual({ points: 0.5, flagsHit: ['a'], falseTaps: 0 });
  });

  it('gdy wcześniejsza jest już trafiona, tapnięcie w części wspólnej trafia kolejną', () => {
    expect(score([{ atMs: 300 }, { atMs: 1500 }])).toEqual({ points: 1, flagsHit: ['a', 'b'], falseTaps: 0 });
  });

  it('tapnięcie w części wspólnej po trafieniu obu flag nie jest fałszywe (i nie daje punktu)', () => {
    expect(score([{ atMs: 1100 }, { atMs: 1200 }, { atMs: 1300 }])).toEqual({ points: 1, flagsHit: ['a', 'b'], falseTaps: 0 });
  });

  it('wynik nie zależy od kolejności tapnięć w odpowiedzi (czas rosnąco)', () => {
    expect(score([{ atMs: 1800 }, { atMs: 1200 }])).toEqual(score([{ atMs: 1200 }, { atMs: 1800 }]));
  });

  it('tapnięcie po segmencie liczy się najpierw: b z transkrypcji, potem czas w części wspólnej trafia a', () => {
    expect(score([{ atMs: 1500 }, { segmentId: 'b' }])).toEqual({ points: 1, flagsHit: ['a', 'b'], falseTaps: 0 });
  });

  it('okno kończy się 1500 ms po końcu segmentu: 3500 trafia b, 3501 jest fałszywe', () => {
    expect(score([{ atMs: 3500 }])).toEqual({ points: 0.5, flagsHit: ['b'], falseTaps: 0 });
    expect(score([{ atMs: 3501 }])).toEqual({ points: 0, flagsHit: [], falseTaps: 1 });
  });
});

describe('scoreRecording: fałszywe tapnięcia, punkty, błędy', () => {
  it('segment bez flagi (transkrypcja) i czas poza oknami to fałszywe; kara 0,1 za każde, min. 0', () => {
    expect(score([{ segmentId: 'a' }, { segmentId: 'b' }, { segmentId: 'c' }])).toEqual({ points: 0.9, flagsHit: ['a', 'b'], falseTaps: 1 });
    expect(score([{ atMs: 200 }, { atMs: 3600 }, { atMs: 3700 }])).toEqual({ points: 0.3, flagsHit: ['a'], falseTaps: 2 });
    expect(score(Array.from({ length: 12 }, () => ({ segmentId: 'c' })))).toEqual({ points: 0, flagsHit: [], falseTaps: 12 });
  });

  it('powtórne tapnięcie po segmencie w trafioną flagę nie jest fałszywe', () => {
    expect(score([{ segmentId: 'a' }, { segmentId: 'a' }])).toEqual({ points: 0.5, flagsHit: ['a'], falseTaps: 0 });
  });

  it('brak tapnięć = 0 punktów, bez fałszywych', () => {
    expect(score([])).toEqual({ points: 0, flagsHit: [], falseTaps: 0 });
  });

  it('nieznany segment = odpowiedź odrzucona (400)', () => {
    expect(() => score([{ segmentId: 'nie-ma' }])).toThrow(BadRequestException);
  });

  it('nagranie bez długości (przed TTS): tapnięcie po czasie odrzucone, po segmencie działa', () => {
    const noAudio = { ...overlapping, segments: overlapping.segments.map((s) => ({ id: s.id })) };
    expect(() => scoreRecording(noAudio, [{ atMs: 100 }])).toThrow(/znaczników czasu/);
    expect(scoreRecording(noAudio, [{ segmentId: 'a' }, { segmentId: 'b' }])).toEqual({ points: 1, flagsHit: ['a', 'b'], falseTaps: 0 });
  });

  it('domyślne okno 1500 ms i kara 0,1, gdy treść ich nie podaje', () => {
    const { flagWindowAfterMs: _w, falseTapPenalty: _p, ...defaults } = overlapping;
    expect(scoreRecording(defaults, [{ atMs: 3500 }, { segmentId: 'c' }])).toEqual({ points: 0.4, flagsHit: ['b'], falseTaps: 1 });
  });

  it('rozstrzygnięcie: każda flaga z kategorią i trafieniem, liczba fałszywych', () => {
    expect(recordingDetail(overlapping, { flagsHit: ['b'], falseTaps: 2 })).toEqual({
      flags: [
        { segmentId: 'a', category: 'fear', hit: false },
        { segmentId: 'b', category: 'code_request', hit: true },
      ],
      falseTaps: 2,
    });
  });
});

describe('evaluateSubmit: CALL_RECORDING i ANNOTATED_REPLAY', () => {
  const recording = fullBlocks().CALL_RECORDING as Block;
  const replay = fullBlocks().ANNOTATED_REPLAY as Block;

  it('wpis z punktami, trafieniami i fałszywymi; dowód dopisany tylko po trafieniu flagi jego segmentu; rozstrzygnięcie w detail', () => {
    // Fixtura: s1 0-1200 (flaga), s2 1600-2800, s3 2800-4000 (flaga, dowód "liczba").
    const all = evaluateSubmit(recording, { taps: [{ atMs: 500 }, { segmentId: 's3' }] }, undefined, now, opaque);
    expect(all.entry).toMatchObject({ type: 'CALL_RECORDING', done: true, weight: 2, points: 1, correct: true, flagsHit: ['s1', 's3'], falseTaps: 0 });
    expect(all.notesAdded).toEqual(['nagranie.liczba']);
    expect(all.detail).toEqual({ flags: [{ segmentId: 's1', category: 'fear', hit: true }, { segmentId: 's3', category: 'code_request', hit: true }], falseTaps: 0 });

    const partial = evaluateSubmit(recording, { taps: [{ atMs: 500 }, { segmentId: 's2' }] }, undefined, now, opaque);
    expect(partial.entry).toMatchObject({ points: 0.4, correct: false, flagsHit: ['s1'], falseTaps: 1 });
    expect(partial.notesAdded).toEqual([]);
  });

  it('odpowiedź innego kształtu (poprawność, punkty, kategoria od klienta) jest odrzucana', () => {
    for (const answer of [undefined, {}, { taps: [{ atMs: 1, segmentId: 's1' }] }, { taps: [{ segmentId: 's1', category: 'fear' }] }, { taps: [], points: 1 }, { taps: [{ atMs: -1 }] }]) {
      expect(() => evaluateSubmit(recording, answer, undefined, now, opaque)).toThrow(BadRequestException);
    }
  });

  it('omówienie: ukończone wyłącznie po przejściu wszystkich znaczników', () => {
    expect(evaluateSubmit(replay, { seen: 2 }, undefined, now, opaque).entry).toMatchObject({ type: 'ANNOTATED_REPLAY', done: true, weight: 0 });
    expect(() => evaluateSubmit(replay, { seen: 1 }, undefined, now, opaque)).toThrow(/znaczniki omówienia/);
    expect(() => evaluateSubmit(replay, {}, undefined, now, opaque)).toThrow(BadRequestException);
  });
});
