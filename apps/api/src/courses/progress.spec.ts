import { BlockEntry, ProgressV2, computeScore, emptyProgress, entryOf, readProgress } from './progress';
import { clientProgress, evidenceSummary, resolveNote, shuffleContext } from './client-view';
import { Block } from './scoring/evaluate';
import { SECRET_MARKER, fullBlocks } from '@cyberszkolo/content/dist/fixtures';

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

  it('clientProgress: wyróżnienia easter egga (D-100) - etykiety z treści zapisanej wersji, nieznane id pominięte; dowody bez zmian', () => {
    const scene = entry({ type: 'SCENE_HOTSPOTS', weight: 0, easterEggs: ['ciekawski', 'nie-ma'] });
    const found = clientProgress({ v: 2, blocks: { scena: scene }, notes: [] }, blocks());
    expect(found.distinctions).toEqual([{ blockId: 'scena', label: 'Ciekawski detektyw' }]);
    const none = clientProgress({ v: 2, blocks: { scena: entry({ type: 'SCENE_HOTSPOTS', weight: 0 }) }, notes: [] }, blocks());
    expect(none.distinctions).toEqual([]);
    expect(found.evidence).toEqual(none.evidence);
    // Flaga nie wychodzi w widoku bloku (do klienta idzie tylko lista etykiet).
    expect(JSON.stringify(found.blocks)).not.toContain('ciekawski');
  });

  describe('clientProgress: podgląd ukończonych bloków ocenianych (answer i detail)', () => {
    const opaque = (blockId: string, itemId: string) => `op-${blockId}-${itemId}`;
    const done = (over: Partial<BlockEntry>) => entry({ done: true, ...over });
    const view = (blocksProgress: Record<string, BlockEntry>) => clientProgress({ v: 2, blocks: blocksProgress, notes: [] }, blocks(), opaque);

    it('QUIZ: własny wybór (indeks); e-mail: wybrane kryteria i rozstrzygnięcie jako id nieprzejrzyste; ORDERING: kolejność i klucz', () => {
      const result = view({
        quiz: done({ type: 'QUIZ', answer: 1, correct: true, points: 1 }),
        mail: done({ type: 'EMAIL_ANALYSIS', selected: ['c1', 'c3'], correct: true, points: 1 }),
        kolejnosc: done({ type: 'ORDERING', order: ['o2', 'o1', 'o3'], correct: false, points: 1 / 3 }),
      });
      expect(result.blocks.quiz).toMatchObject({ answer: 1 });
      expect(result.blocks.mail).toMatchObject({ answer: { selected: ['op-mail-c1', 'op-mail-c3'] } });
      expect((result.blocks.mail as { detail: { criteria: { id: string; selected: boolean; correct: boolean }[] } }).detail.criteria).toEqual([
        expect.objectContaining({ id: 'op-mail-c1', selected: true, correct: true }),
        expect.objectContaining({ id: 'op-mail-c2', selected: false, correct: false }),
        expect.objectContaining({ id: 'op-mail-c3', selected: true, correct: true }),
      ]);
      expect(result.blocks.kolejnosc).toMatchObject({
        answer: { order: ['op-kolejnosc-o2', 'op-kolejnosc-o1', 'op-kolejnosc-o3'] },
        detail: { correctOrder: ['op-kolejnosc-o1', 'op-kolejnosc-o2', 'op-kolejnosc-o3'] },
      });
      // Żadne id z treści nie wychodzi (tylko nieprzejrzyste).
      expect(JSON.stringify(result.blocks.mail)).not.toMatch(/"c[123]"/);
      expect(JSON.stringify(result.blocks.kolejnosc)).not.toMatch(/"o[123]"/);
    });

    it('blok nieukończony albo bez `opaque`: bez answer i detail (klucz niczego nie zdradza przed odpowiedzią)', () => {
      const undone = view({ mail: entry({ type: 'EMAIL_ANALYSIS', done: false, selected: ['c1'] }) });
      expect(undone.blocks.mail).not.toHaveProperty('answer');
      expect(undone.blocks.mail).not.toHaveProperty('detail');
      const withoutOpaque = clientProgress({ v: 2, blocks: { mail: done({ type: 'EMAIL_ANALYSIS', selected: ['c1'] }) }, notes: [] }, blocks());
      expect(withoutOpaque.blocks.mail).not.toHaveProperty('answer');
    });

    it('stary wpis bez selected/order (sprzed tej zmiany) nie psuje widoku', () => {
      const result = view({ mail: done({ type: 'EMAIL_ANALYSIS', correct: true, points: 1 }) });
      expect(result.blocks.mail).toMatchObject({ done: true, correct: true });
      expect(result.blocks.mail).not.toHaveProperty('answer');
    });

    it('reaction (schemaVersion 4): dopiero po ukończeniu, dobrana wg wyniku, obecna nawet bez `opaque`', () => {
      const cheer = view({ quiz: done({ type: 'QUIZ', answer: 1, correct: true, points: 1 }) });
      expect(cheer.blocks.quiz).toMatchObject({ reaction: { pose: 'cheer', text: expect.stringContaining(`${SECRET_MARKER}-quiz-cheer`) } });

      const warning = view({ quiz: done({ type: 'QUIZ', answer: 0, correct: false, points: 0 }) });
      expect(warning.blocks.quiz).toMatchObject({ reaction: { pose: 'warning', text: expect.stringContaining(`${SECRET_MARKER}-quiz-warning`) } });

      // Bez `opaque` (starsze wywołania): reaction i tak jest, bo nie niesie id z treści (w odróżnieniu od answer/detail).
      const withoutOpaque = clientProgress({ v: 2, blocks: { quiz: done({ type: 'QUIZ', correct: true, points: 1 }) }, notes: [] }, blocks());
      expect(withoutOpaque.blocks.quiz).toHaveProperty('reaction');

      // Nieukończony blok: żadnej reakcji (nie zdradza progu oceny przed odpowiedzią).
      const undone = view({ quiz: entry({ type: 'QUIZ', done: false }) });
      expect(undone.blocks.quiz).not.toHaveProperty('reaction');

      // Blok bez reactions.result w treści (eksploracyjny, bez wyniku 0-1): brak reakcji mimo done.
      const noReactions = view({ wideo: done({ type: 'VIDEO' }) });
      expect(noReactions.blocks.wideo).not.toHaveProperty('reaction');
    });
  });

  describe('evidenceSummary (Dowody X/Y liczy serwer)', () => {
    const done = (type: string) => entry({ type, done: true });

    it('bez notatek: total znany od startu dla wszystkich bloków, łącznie z jeszcze niezatwierdzonym mailem (D-055 pkt 2)', () => {
      const summary = evidenceSummary({ v: 2, blocks: {}, notes: [] }, blocks());
      expect(summary).toEqual({
        collected: 0,
        // scena: 2 - h1 (zewnętrzny) + h4-outlook (wewnątrz zagnieżdżonej sceny media.kind:'scene', B-086/D-071) - dowody
        // z zagnieżdżonej sceny LICZĄ SIĘ do bloku (spłaszczone id, ta sama funkcja co semantics.ts).
        // + akta: 1 - wiersz-dowód teczki (DOSSIER, D-083); + nagranie: 1 - dowód nagrania rozmowy (CALL_RECORDING, D-115);
        // + przesluchanie: 3 - fragment, wiersz konsoli i sprzeczność (INTERROGATION, D-118); + osint: 2 (OSINT_SPOT, D-120) -
        // dowody ukryte do zebrania liczą się do sumy od startu (stały mianownik, D-130).
        total: 11,
        perBlock: [
          { blockId: 'scena', collected: 0, total: 2 },
          { blockId: 'rozmowa', collected: 0, total: 1 },
          { blockId: 'mail', collected: 0, total: 1 },
          { blockId: 'akta', collected: 0, total: 1 },
          { blockId: 'nagranie', collected: 0, total: 1 },
          { blockId: 'przesluchanie', collected: 0, total: 3 },
          { blockId: 'osint', collected: 0, total: 2 },
        ],
      });
    });

    it('CALL_RECORDING: dowód liczy się po notatce <blok>.<id dowodu>, notatka rozwiązuje się z treści (rodzaj call)', () => {
      const summary = evidenceSummary({ v: 2, blocks: {}, notes: ['nagranie.liczba'] }, blocks());
      expect(summary.perBlock.find((b) => b.blockId === 'nagranie')).toEqual({ blockId: 'nagranie', collected: 1, total: 1 });
      expect(resolveNote(blocks(), 'nagranie.liczba')).toEqual({ key: 'nagranie.liczba', blockId: 'nagranie', text: `${SECRET_MARKER}-dowod-liczba`, kind: 'call' });
    });

    it('DOSSIER: zakreślony wiersz-dowód liczy się po notatce <blok>.<wiersz>, a notatka rozwiązuje się z treści', () => {
      const summary = evidenceSummary({ v: 2, blocks: {}, notes: ['akta.w2', 'akta.w1'] }, blocks());
      expect(summary.perBlock.find((b) => b.blockId === 'akta')).toEqual({ blockId: 'akta', collected: 1, total: 1 });
      expect(resolveNote(blocks(), 'akta.w2')).toEqual({ key: 'akta.w2', blockId: 'akta', text: 'Przelew 9:12.', kind: 'item' });
      // Zwykła linijka nie ma notatki - klucz nic nie rozwiązuje.
      expect(resolveNote(blocks(), 'akta.w1')).toBeNull();
    });

    it('zebrane dowody sumują się poprawnie (bez oglądania nieznanych kluczy)', () => {
      const summary = evidenceSummary(
        { v: 2, blocks: { mail: done('EMAIL_ANALYSIS') }, notes: ['scena.h1', 'rozmowa.q1', 'mail.c1', 'mail.c3', 'nie-ma.x'] },
        blocks(),
      );
      // mail: tylko c1 ma evidence (c3 to zwykła notatka); scena: h4-outlook (zagnieżdżony) nie ma notatki w tym teście,
      // więc liczy się do total, ale nie do collected.
      expect(summary).toEqual({
        collected: 3,
        total: 11,
        perBlock: [
          { blockId: 'scena', collected: 1, total: 2 },
          { blockId: 'rozmowa', collected: 1, total: 1 },
          { blockId: 'mail', collected: 1, total: 1 },
          { blockId: 'akta', collected: 0, total: 1 },
          { blockId: 'nagranie', collected: 0, total: 1 },
          { blockId: 'przesluchanie', collected: 0, total: 3 },
          { blockId: 'osint', collected: 0, total: 2 },
        ],
      });
    });

    it('dowód WEWNĄTRZ zagnieżdżonej sceny (media.kind:"scene") liczy się do collected po notatce z jego id', () => {
      const summary = evidenceSummary({ v: 2, blocks: {}, notes: ['scena.h4-outlook'] }, blocks());
      expect(summary.perBlock.find((b) => b.blockId === 'scena')).toEqual({ blockId: 'scena', collected: 1, total: 2 });
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
      for (const h of scene.hotspots as Record<string, any>[]) {
        delete h.evidence;
        // media.kind:'scene' (B-086/D-071): evidence WEWNĄTRZ zagnieżdżonej sceny liczy się do bloku (flattenHotspots),
        // więc trzeba je zdjąć też stąd, inaczej test dalej znalazłby "scena" w perBlock przez h4-outlook.
        if (h.media?.kind === 'scene') for (const inner of h.media.scene.hotspots as Record<string, any>[]) delete inner.evidence;
      }
      expect(evidenceSummary({ v: 2, blocks: {}, notes: ['scena.h1'] }, noEvidence).perBlock.map((b) => b.blockId)).not.toContain('scena');
    });
  });
});
