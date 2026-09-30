import { BadRequestException } from '@nestjs/common';
import { fullBlocks } from '@cyberszkolo/content/dist/fixtures';
import { clientProgress } from '../client-view';
import { ProgressV2 } from '../progress';
import { Block, evaluateSubmit, weightOf } from './evaluate';

// Rozmowa na żywo (D-122): serwer przechodzi drzewo po ścieżce gracza, cisza tylko z limitem czasu, ocena zakończenia good/partial/bad.

const now = new Date('2026-09-29T12:00:00.000Z');
const opaque = (blockId: string, itemId: string) => `op-${blockId}-${itemId}`;
const call = () => fullBlocks().LIVE_CALL as unknown as Block;
const all = () => Object.values(fullBlocks()) as unknown as Block[];
const submit = (answer: unknown, block = call()) => evaluateSubmit(block, answer, undefined, now, opaque);

describe('evaluateSubmit: LIVE_CALL', () => {
  it('zakończenie dobre - 1, częściowe - 0,5, złe - 0; ścieżka i tryb czasu w wpisie; rozstrzygnięcie po ocenie', () => {
    const good = submit({ path: ['oddzwonie'], timed: true });
    expect(good.entry).toMatchObject({ done: true, correct: true, points: 1, weight: 2, path: ['oddzwonie'], timed: true });
    expect(good.detail).toEqual({ ending: 'dobre', outcome: 'good', gaveInfo: [] });
    expect(good.notesAdded).toEqual([]);

    const partial = submit({ path: ['sprawdze', 'nie-instaluje'], timed: false });
    expect(partial.entry).toMatchObject({ correct: false, points: 0.5, timed: false });
    expect(partial.detail).toEqual({ ending: 'czesciowe', outcome: 'partial', gaveInfo: [] });

    const bad = submit({ path: ['jaka-liczba', 'wpisuje'], timed: true });
    expect(bad.entry).toMatchObject({ correct: false, points: 0 });
    expect(bad.detail).toEqual({ ending: 'zle', outcome: 'bad', gaveInfo: ['wpisuje'] });
  });

  it('cisza po limicie: krawędź silence tylko z limitem czasu', () => {
    expect(submit({ path: ['silence', 'rozlaczam'], timed: true }).detail).toEqual({ ending: 'dobre', outcome: 'good', gaveInfo: [] });
    expect(submit({ path: ['silence', 'silence'], timed: true }).detail).toMatchObject({ ending: 'zle', outcome: 'bad' });
    expect(() => submit({ path: ['silence', 'rozlaczam'], timed: false })).toThrow(BadRequestException);
  });

  it('odrzuca ścieżkę niezgodną z grafem i odpowiedź spoza schematu', () => {
    for (const answer of [
      { path: ['rozlaczam'], timed: true },
      { path: ['jaka-liczba'], timed: true },
      { path: ['oddzwonie', 'rozlaczam'], timed: true },
      { path: ['sprawdze', 'silence'], timed: true },
      { path: [], timed: true },
      { path: ['oddzwonie'] },
      { path: ['oddzwonie'], timed: true, outcome: 'good' },
      { path: ['Oddzwonie'], timed: true },
      { path: Array(21).fill('silence'), timed: true },
      ['oddzwonie'],
    ]) {
      expect(() => submit(answer)).toThrow(BadRequestException);
    }
  });

  it('D-129: odrzucenie połączenia i rozłączenie się bez oddanej informacji - dobre zakończenie (1)', () => {
    expect(submit({ path: ['reject'], timed: true })).toMatchObject({
      entry: { correct: true, points: 1, path: ['reject'] },
      detail: { ending: 'odrzucone', outcome: 'good', gaveInfo: [] },
    });
    expect(submit({ path: ['hangup'], timed: true }).detail).toEqual({ ending: 'rozlaczenie', outcome: 'good', gaveInfo: [] });
    expect(submit({ path: ['sprawdze', 'hangup'], timed: false }).entry).toMatchObject({ correct: true, points: 1 });
    // Blok bez `reject` / `hangUp` - tych kroków nie ma.
    const plain = { ...call(), reject: undefined, hangUp: undefined } as Block;
    expect(() => submit({ path: ['reject'], timed: true }, plain)).toThrow(BadRequestException);
    expect(() => submit({ path: ['hangup'], timed: true }, plain)).toThrow(BadRequestException);
  });

  it('D-129: rozłączenie się PO oddaniu informacji - złe (0), niezależnie od zakończenia „rozłączenia”; podgląd tak samo', () => {
    // Wariant drzewa: po wpisaniu liczby rozmowa trwa dalej (w module 2 odpowiedzi z infoChoices kończą rozmowę od razu).
    const block = call() as unknown as { nodes: { id: string; choices: { id: string; next: string }[] }[] };
    block.nodes.find((n) => n.id === 'nacisk')!.choices.find((c) => c.id === 'wpisuje')!.next = 'autorytet';
    const leaked = submit({ path: ['jaka-liczba', 'wpisuje', 'hangup'], timed: false }, block as unknown as Block);
    expect(leaked.entry).toMatchObject({ correct: false, points: 0 });
    expect(leaked.detail).toEqual({ ending: 'rozlaczenie', outcome: 'bad', gaveInfo: ['wpisuje'] });
    const view = (clientProgress({ v: 2, blocks: { 'na-zywo': leaked.entry }, notes: [] }, [block as unknown as Block], opaque) as {
      blocks: Record<string, Record<string, unknown>>;
    }).blocks['na-zywo'];
    expect(view.detail).toEqual({ ending: 'rozlaczenie', outcome: 'bad', gaveInfo: ['wpisuje'] });
  });

  it('waga domyślna 1', () => {
    expect(weightOf({ ...call(), weight: undefined } as Block)).toBe(1);
  });

  it('podgląd ukończonego bloku: ścieżka i rozstrzygnięcie; przed ukończeniem - nic', () => {
    const entry = submit({ path: ['sprawdze', 'instaluje'], timed: true }).entry;
    const view = (p: ProgressV2) => (clientProgress(p, all(), opaque) as { blocks: Record<string, Record<string, unknown>> }).blocks['na-zywo'];
    const done = view({ v: 2, blocks: { 'na-zywo': entry }, notes: [] });
    expect(done.answer).toEqual({ path: ['sprawdze', 'instaluje'], timed: true });
    expect(done.detail).toEqual({ ending: 'zle', outcome: 'bad', gaveInfo: ['instaluje'] });
    const inProgress = view({ v: 2, blocks: { 'na-zywo': { ...entry, done: false } }, notes: [] });
    expect(inProgress.detail).toBeUndefined();
  });

  it('uszkodzona treść w zapisanej wersji: podgląd bez rozstrzygnięcia zamiast wyjątku', () => {
    const entry = submit({ path: ['oddzwonie'], timed: true }).entry;
    const broken = all().map((block) => (block.type === 'LIVE_CALL' ? ({ ...block, nodes: 'x', infoChoices: 'x' } as Block) : block));
    const view = (clientProgress({ v: 2, blocks: { 'na-zywo': entry }, notes: [] }, broken, opaque) as { blocks: Record<string, Record<string, unknown>> })
      .blocks['na-zywo'];
    expect(view.detail).toBeUndefined();
  });
});
