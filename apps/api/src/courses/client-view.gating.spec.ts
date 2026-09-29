import { fullModuleV6 } from '@cyberszkolo/content/dist/fixtures';
import { projectBlockForStart, revealedBlockAt, shuffleContext } from './client-view';
import type { Block } from './scoring/evaluate';

// Security review 1b (D-115): /start wysyła WSZYSTKIE bloki kursu, a znaczniki omówienia (ANNOTATED_REPLAY) wskazują segmenty z flagami
// nagrania i nazywają ich kategorie - przed dotarciem gracza do omówienia byłyby kluczem odpowiedzi CALL_RECORDING.

const blocks = fullModuleV6().blocks as unknown as Block[];
const context = shuffleContext('sekret-testowy-do-hmac-min-32-znaki!!', 'assignment-1', 'version-1');
const recordingIndex = blocks.findIndex((b) => b.type === 'CALL_RECORDING');
const replayIndex = blocks.findIndex((b) => b.type === 'ANNOTATED_REPLAY');
const project = (reached: number, completed = false) => blocks.map((block, index) => projectBlockForStart(block, index, context, reached, completed));

describe('omówienie nagrania w /start (projectBlockForStart)', () => {
  it('przed dotarciem do omówienia (np. przy nagraniu): bez znaczników, z withheld - żadnych tytułów ani kotwic znaczników w całym /start', () => {
    const projected = project(recordingIndex);
    const replay = projected[replayIndex] as Record<string, unknown>;
    // Tylko id, typ i tytuł - bez znaczników, narracji, podpowiedzi i źródła (każde z nich mogłoby nazwać flagi).
    expect(replay).toEqual({ id: 'omowienie', type: 'ANNOTATED_REPLAY', title: 'Blok omowienie', withheld: true });
    const json = JSON.stringify(projected);
    for (const secret of ['Strach', 'Parowanie liczb', 'W stresie myślimy krócej', 'anchor']) expect(json).not.toContain(secret);
  });

  it('po dotarciu (bieżący blok), w podglądzie wstecz i po ukończeniu kursu - pełne znaczniki', () => {
    for (const projected of [project(replayIndex), project(replayIndex + 1), project(0, true)]) {
      const replay = projected[replayIndex] as { markers?: { anchor: { segmentId?: string }; title: string }[]; withheld?: boolean };
      expect(replay.withheld).toBeUndefined();
      expect(replay.markers?.map((m) => [m.anchor.segmentId, m.title])).toEqual([
        ['s1', 'Strach'],
        ['s3', 'Parowanie liczb'],
      ]);
    }
  });

  it('inne bloki bez zmian (ta sama projekcja co toClientBlock)', () => {
    const early = project(0);
    const late = project(blocks.length);
    blocks.forEach((block, index) => {
      if (block.type !== 'ANNOTATED_REPLAY') expect(early[index]).toEqual(late[index]);
    });
  });
});

describe('revealedBlockAt (odpowiedź /progress po dotarciu do omówienia)', () => {
  it('pełny blok omówienia dla jego indeksu; dla zwykłych bloków nic', () => {
    expect(revealedBlockAt(blocks, replayIndex, context)).toMatchObject({ blockIndex: replayIndex, block: { id: 'omowienie', markers: expect.any(Array) } });
    expect(revealedBlockAt(blocks, recordingIndex, context)).toBeUndefined();
    expect(revealedBlockAt(blocks, blocks.length, context)).toBeUndefined();
  });
});
