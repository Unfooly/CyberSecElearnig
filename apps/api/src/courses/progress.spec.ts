import { BlockEntry, ProgressV2, computeScore, emptyProgress, entryOf, readProgress } from './progress';
import { clientProgress, evidenceSummary, resolveNote, shuffleContext } from './client-view';
import { Block } from './scoring/evaluate';
import { fullBlocks } from '@cyberszkolo/content/dist/fixtures';

const entry = (overrides: Partial<BlockEntry> = {}): BlockEntry => ({
  type: 'QUIZ',
  done: true,
  answeredAt: '2026-09-21T10:00:00.000Z',
  weight: 1,
  ...overrides,
});

describe('readProgress: format sprzed silnika i nowy', () => {
  it('brak progress -> pusty v2', () => {
    expect(readProgress(null)).toEqual(emptyProgress());
    expect(readProgress(undefined)).toEqual(emptyProgress());
    expect(readProgress([1, 2] as never)).toEqual(emptyProgress());
  });

  it('przelicza stary format (klucz = indeks) na id b<indeks>, z zachowaniem oceny', () => {
    const progress = readProgress({
      '0': { type: 'VIDEO', answeredAt: '2026-01-01T00:00:00.000Z' },
      '1': { type: 'QUIZ', answer: 1, correct: true, answeredAt: '2026-01-01T00:01:00.000Z' },
      '2': { type: 'BRANCHING_SCENARIO', answer: 0, correct: false, answeredAt: '2026-01-01T00:02:00.000Z' },
    });

    expect(progress.v).toBe(2);
    expect(progress.blocks.b0).toMatchObject({ type: 'VIDEO', done: true, weight: 0 });
    expect(progress.blocks.b0.points).toBeUndefined();
    expect(progress.blocks.b1).toMatchObject({ done: true, weight: 1, points: 1, correct: true, answer: 1 });
    expect(progress.blocks.b2).toMatchObject({ weight: 1, points: 0, correct: false });
    // Wynik liczony z przeliczonego progressu = 1 z 2 = 50 (jak w starym computeScore).
    expect(computeScore(progress)).toBe(50);
  });

  it('ignoruje śmieci w starym formacie (klucze nienumeryczne, wpisy bez typu)', () => {
    const progress = readProgress({ x: { type: 'QUIZ' }, '1': 'nie-obiekt', '2': { correct: true } } as never);
    expect(progress.blocks).toEqual({});
  });

  it('zachowuje nowy format i odrzuca klucz __proto__', () => {
    const raw = JSON.parse(
      '{"v":2,"blocks":{"a":{"type":"QUIZ","done":true,"weight":1,"answeredAt":"x"},"__proto__":{"polluted":true}},"notes":["a.b",5]}',
    );
    const progress = readProgress(raw);
    expect(Object.keys(progress.blocks)).toEqual(['a']);
    expect(progress.notes).toEqual(['a.b']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('entryOf nie trafia w prototyp (id "constructor")', () => {
    expect(entryOf(emptyProgress(), 'constructor')).toBeUndefined();
    expect(entryOf(emptyProgress(), 'toString')).toBeUndefined();
  });
});

describe('computeScore: średnia ważona bloków ocenianych', () => {
  const progress = (blocks: Record<string, BlockEntry>): ProgressV2 => ({ v: 2, blocks, notes: [] });

  it('brak bloków ocenianych -> null (jak dziś dla kursu bez quizów)', () => {
    expect(computeScore(progress({}))).toBeNull();
    expect(computeScore(progress({ a: entry({ weight: 0 }) }))).toBeNull();
  });

  it('bloki eksploracyjne (waga 0) nie wpływają na wynik, wagi ważą', () => {
    expect(
      computeScore(
        progress({
          a: entry({ weight: 2, points: 1 }),
          b: entry({ weight: 1, points: 0 }),
          c: entry({ weight: 0, points: 1 }),
          d: entry({ weight: 0 }),
        }),
      ),
    ).toBe(67);
  });

  it('punkty częściowe są uwzględniane', () => {
    expect(computeScore(progress({ a: entry({ points: 0.5 }), b: entry({ points: 0.75 }) }))).toBe(63);
  });

  it('nierozstrzygnięty blok (done: false) nie wchodzi do wyniku', () => {
    expect(computeScore(progress({ a: entry({ done: false, points: 1 }), b: entry({ points: 0 }) }))).toBe(0);
  });
});

describe('client-view', () => {
  const blocks = (): Block[] => Object.values(fullBlocks()) as unknown as Block[];

  it('shuffleContext: stały dla tych samych danych, zależny od sekretu, przypisania, wersji i bloku', () => {
    const seed = (secret: string, assignment = 'a1', version = 'v1', block = 'b') =>
      shuffleContext(secret, assignment, version).shuffleSeed(block).join(',');
    expect(seed('s')).toBe(seed('s'));
    expect(seed('s')).not.toBe(seed('inny-sekret'));
    expect(seed('s')).not.toBe(seed('s', 'a2'));
    expect(seed('s')).not.toBe(seed('s', 'a1', 'v2'));
    expect(seed('s')).not.toBe(seed('s', 'a1', 'v1', 'inny'));
  });

  it('opaqueId: stały dla przypisania, inny dla każdego przypisania/wersji/bloku/elementu i sekretu, zgodny z idSchema, nie ujawnia id z treści', () => {
    const id = (secret: string, assignment = 'a1', version = 'v1', block = 'b', item = 'krok1') =>
      shuffleContext(secret, assignment, version).opaqueId(block, item);
    expect(id('s')).toBe(id('s'));
    expect(id('s')).toMatch(/^[0-9a-f]{24}$/);
    expect(id('s')).not.toContain('krok');
    expect(new Set([id('s'), id('s', 'a2'), id('s', 'a1', 'v2'), id('s', 'a1', 'v1', 'inny'), id('s', 'a1', 'v1', 'b', 'krok2'), id('t')]).size).toBe(6);
  });

  it('klucze tasowania i id są wyprowadzone osobno (HKDF z innym info): seed nie zdradza id i odwrotnie', () => {
    const context = shuffleContext('sekret', 'a1', 'v1');
    expect(context.shuffleSeed('b').map((n) => n.toString(16)).join('')).not.toContain(context.opaqueId('b', 'x').slice(0, 8));
  });

  it('resolveNote: notatki DIALOGUE i EMAIL_ANALYSIS z treści modułu; nieznane klucze -> null', () => {
    expect(resolveNote(blocks(), 'rozmowa.q1')).toEqual({ key: 'rozmowa.q1', blockId: 'rozmowa', text: 'Mail przyszedł rano.', kind: 'mail' });
    expect(resolveNote(blocks(), 'mail.c1')?.text).toContain('SEKRET');
    expect(resolveNote(blocks(), 'scena.h1')).toEqual({ key: 'scena.h1', blockId: 'scena', text: 'Hasło na kartce przy monitorze.', kind: 'item' });
    expect(resolveNote(blocks(), 'scena.h2')).toBeNull();
    expect(resolveNote(blocks(), 'rozmowa.q2')).toBeNull();
    expect(resolveNote(blocks(), 'nie-ma.q1')).toBeNull();
    expect(resolveNote(blocks(), 'bezkropki')).toBeNull();
  });

  it('clientProgress: odsłonięte podpowiedzi zgodnie z hintsShown, rozwiązanie tylko po wyczerpaniu prób', () => {
    const base: ProgressV2 = { v: 2, blocks: {}, notes: [] };
    const inProgress = clientProgress(
      { ...base, blocks: { domena: entry({ type: 'TEXT_INPUT_GUIDED', done: false, attempts: 1, hintsShown: 1 }) } },
      blocks(),
    );
    expect(inProgress.blocks.domena).toMatchObject({ done: false, attempts: 1, revealedHints: [expect.objectContaining({ text: expect.any(String) })] });
    expect(inProgress.blocks.domena).not.toHaveProperty('solution');

    const noHints = clientProgress({ ...base, blocks: { domena: entry({ type: 'TEXT_INPUT_GUIDED', done: false, attempts: 1, hintsShown: 0 }) } }, blocks());
    expect(noHints.blocks.domena).not.toHaveProperty('revealedHints');

    const exhausted = clientProgress(
      { ...base, blocks: { domena: entry({ type: 'TEXT_INPUT_GUIDED', done: true, correct: false, points: 0, attempts: 4, hintsShown: 1 }) } },
      blocks(),
    );
    expect(exhausted.blocks.domena).toHaveProperty('solution');

    const solved = clientProgress(
      { ...base, blocks: { domena: entry({ type: 'TEXT_INPUT_GUIDED', done: true, correct: true, points: 1, attempts: 2, hintsShown: 1 }) } },
      blocks(),
    );
    expect(solved.blocks.domena).not.toHaveProperty('solution');
  });

  it('clientProgress: notatki jako treści rozwiązane po stronie serwera', () => {
    const view = clientProgress({ v: 2, blocks: {}, notes: ['rozmowa.q1', 'zly.klucz'] }, blocks());
    // Bez `key`: klucz zawiera id elementu z treści (np. kryterium maila), więc klient dostaje tylko blockId i treść.
    expect(view.notes).toEqual([{ blockId: 'rozmowa', text: 'Mail przyszedł rano.', kind: 'mail' }]);
    expect(JSON.stringify(view)).not.toContain('rozmowa.q1');
  });

  describe('evidenceSummary (Dowody X/Y liczy serwer)', () => {
    const done = (type: string) => entry({ type, done: true });

    it('bez notatek: 0 z sumy dowodów w hotspotach i dialogu; e-mail ukryty (total null) do zatwierdzenia odpowiedzi', () => {
      const summary = evidenceSummary({ v: 2, blocks: {}, notes: [] }, blocks());
      expect(summary).toEqual({
        collected: 0,
        total: null,
        perBlock: [
          { blockId: 'scena', collected: 0, total: 1 },
          { blockId: 'rozmowa', collected: 0, total: 1 },
          { blockId: 'mail', collected: 0, total: null },
        ],
      });
    });

    it('zebrane dowody i po zatwierdzeniu maila znana suma (bez oglądania nieznanych kluczy)', () => {
      const summary = evidenceSummary(
        { v: 2, blocks: { mail: done('EMAIL_ANALYSIS') }, notes: ['scena.h1', 'rozmowa.q1', 'mail.c1', 'mail.c3', 'nie-ma.x'] },
        blocks(),
      );
      // mail: tylko c1 ma evidence (c3 to zwykła notatka)
      expect(summary).toEqual({
        collected: 3,
        total: 3,
        perBlock: [
          { blockId: 'scena', collected: 1, total: 1 },
          { blockId: 'rozmowa', collected: 1, total: 1 },
          { blockId: 'mail', collected: 1, total: 1 },
        ],
      });
    });

    it('perBlock ma tylko blockId i liczby (bez identyfikatorów elementów), a clientProgress dołącza evidence', () => {
      const view = clientProgress({ v: 2, blocks: {}, notes: ['scena.h1'] }, blocks());
      expect(view.evidence.collected).toBe(1);
      const json = JSON.stringify(view.evidence);
      for (const secret of ['h1', 'q1', 'c1', 'SEKRET']) expect(json).not.toContain(`"${secret}"`);
      expect(Object.keys(view.evidence.perBlock[0]).sort()).toEqual(['blockId', 'collected', 'total']);
    });

    it('nie liczy dowodów bez notatki i notatek bez evidence', () => {
      const noEvidence = blocks();
      const scene = noEvidence.find((b) => b.type === 'SCENE_HOTSPOTS') as Block;
      (scene.hotspots as Record<string, unknown>[]).forEach((h) => delete h.evidence);
      expect(evidenceSummary({ v: 2, blocks: {}, notes: ['scena.h1'] }, noEvidence).perBlock.map((b) => b.blockId)).not.toContain('scena');
    });
  });
});
