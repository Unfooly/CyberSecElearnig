import { ContentValidationError, recordingTimeline, segmentAt } from './index';
import { fullModule, fullModuleV6 } from './fixtures';
import { parseModule } from './node';

// Bloki modułu 2 (D-115): CALL_RECORDING (odsłuch z czerwonymi flagami) i ANNOTATED_REPLAY (omówienie ze znacznikami).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = Record<string, any>;

const errorsOf = (module: unknown): string => {
  try {
    parseModule(module);
  } catch (e) {
    return (e as ContentValidationError).issues.join('\n');
  }
  return '';
};

const mutate = (change: (m: AnyModule) => void): AnyModule => {
  const m = fullModuleV6() as AnyModule;
  change(m);
  return m;
};
const recording = (m: AnyModule) => m.blocks.find((b: AnyModule) => b.type === 'CALL_RECORDING');
const replay = (m: AnyModule) => m.blocks.find((b: AnyModule) => b.type === 'ANNOTATED_REPLAY');

describe('recordingTimeline', () => {
  it('początek segmentu = suma (durationMs + gapAfterMs) poprzednich; koniec bez ciszy', () => {
    const timeline = recordingTimeline(recording(fullModuleV6()).segments)!;
    expect(timeline.segments.map((s) => [s.id, s.startMs, s.endMs])).toEqual([
      ['s1', 0, 1200],
      ['s2', 1600, 2800],
      ['s3', 2800, 4000],
    ]);
    expect(timeline.totalMs).toBe(4000);
  });

  it('segment bez nagrania (przed potokiem TTS) = brak osi czasu (tylko tryb transkrypcji)', () => {
    expect(recordingTimeline([{ id: 'a', narration: { durationMs: 10 } }, { id: 'b', narration: {} }])).toBeNull();
  });

  it('segmentAt: segment grający w danej chwili (w ciszy po segmencie - ten segment), poza nagraniem null', () => {
    const timeline = recordingTimeline(recording(fullModuleV6()).segments)!;
    expect(segmentAt(timeline, 0)?.id).toBe('s1');
    expect(segmentAt(timeline, 1400)?.id).toBe('s1');
    expect(segmentAt(timeline, 1600)?.id).toBe('s2');
    expect(segmentAt(timeline, 4000)?.id).toBe('s3');
    expect(segmentAt(timeline, 4001)).toBeNull();
    expect(segmentAt(timeline, -1)).toBeNull();
  });
});

describe('CALL_RECORDING: walidacja', () => {
  it('fixtura v6 przechodzi', () => {
    expect(errorsOf(fullModuleV6())).toBe('');
  });

  it('blok wymaga schemaVersion 6', () => {
    const m = fullModule() as AnyModule;
    m.blocks.splice(m.blocks.length - 1, 0, recording(fullModuleV6()));
    for (const segment of m.blocks[m.blocks.length - 2].segments) delete segment.narration.voice;
    expect(errorsOf(m)).toContain('blok CALL_RECORDING wymaga schemaVersion 6');
  });

  it('flaga na nieznanym segmencie, dwie flagi na jednym segmencie, powtórzone id segmentu', () => {
    expect(errorsOf(mutate((m) => recording(m).flags.push({ segmentId: 'nie-ma', category: 'fear' })))).toContain('flags: nieznany identyfikator "nie-ma"');
    expect(errorsOf(mutate((m) => recording(m).flags.push({ segmentId: 's1', category: 'urgency' })))).toContain('segment "s1" ma więcej niż jedną flagę');
    expect(errorsOf(mutate((m) => (recording(m).segments[1].id = 's1')))).toContain('segments: powtórzony identyfikator "s1"');
  });

  it('dowód tylko na segmencie z flagą i z rodzajem notatki; kategoria flagi z zamkniętej listy', () => {
    expect(errorsOf(mutate((m) => (recording(m).evidence[0].segmentId = 's2')))).toContain('"s2" nie jest segmentem z flagą');
    expect(errorsOf(mutate((m) => delete recording(m).evidence[0].note.kind))).toContain('dowód wymaga rodzaju notatki');
    expect(errorsOf(mutate((m) => (recording(m).flags[0].category = 'greed')))).toContain('flags.0.category');
  });

  it('kwestia nagrania wymaga roli głosu; cyfry w tekście czytanym przez lektora to błąd (D-109) także w segmentach', () => {
    expect(errorsOf(mutate((m) => delete recording(m).segments[0].narration.voice))).toContain('kwestia nagrania wymaga roli głosu');
    expect(errorsOf(mutate((m) => (recording(m).segments[1].narration.text = 'Wpisz 47.')))).toContain('segments[1].narration: cyfry');
  });
});

describe('ANNOTATED_REPLAY: walidacja', () => {
  it('źródło musi być blokiem CALL_RECORDING tego modułu, kotwica - jego segmentem', () => {
    expect(errorsOf(mutate((m) => (replay(m).source.fromBlock = 'otwarcie')))).toContain('source.fromBlock "otwarcie" nie jest blokiem CALL_RECORDING');
    expect(errorsOf(mutate((m) => (replay(m).markers[0].anchor.segmentId = 's9')))).toContain('segmentId "s9" nie istnieje w bloku "nagranie"');
  });

  it('znaczniki numerowane kolejno od 1; kotwica zgodna ze źródłem; waga 0', () => {
    expect(errorsOf(mutate((m) => (replay(m).markers[1].n = 3)))).toContain('markers[1].n: znaczniki numerowane kolejno od 1');
    expect(errorsOf(mutate((m) => Object.assign(replay(m).markers[0].anchor, { x: 10, y: 10 })))).toContain('wyłącznie segmentId');
    expect(
      errorsOf(
        mutate((m) => {
          replay(m).source = { kind: 'image', image: 'scenes/omowienie.svg', alt: 'Omówienie' };
        }),
      ),
    ).toContain('kotwicą jest punkt { x, y }');
    expect(errorsOf(mutate((m) => (replay(m).weight = 1)))).toContain('ANNOTATED_REPLAY jest nieoceniany');
  });

  it('źródło-grafika z kotwicami { x, y } przechodzi', () => {
    const m = mutate((module) => {
      replay(module).source = { kind: 'image', image: 'scenes/omowienie.svg', imagePortrait: 'scenes/omowienie-pion.svg', alt: 'Omówienie' };
      replay(module).markers.forEach((marker: AnyModule, i: number) => (marker.anchor = { x: 20 + i * 30, y: 40 }));
    });
    expect(errorsOf(m)).toBe('');
  });
});
