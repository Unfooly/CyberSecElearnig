import { BadRequestException } from '@nestjs/common';
import { SECRET_MARKER, fullBlocks } from '@cyberszkolo/content/dist/fixtures';
import {
  Block,
  attemptPoints,
  emailPoints,
  evaluateAttempt,
  evaluateSubmit,
  isTextCorrect,
  normalizeText,
  pickReaction,
  weightOf,
} from './evaluate';

const now = new Date('2026-09-21T10:00:00.000Z');
const blocks = () => fullBlocks() as unknown as Record<string, Block>;
// Nieprzejrzyste id jak w produkcji (inne dla każdego przypisania); tu deterministyczne, byle nie równe id z treści.
const opaque = (blockId: string, itemId: string) => `op${blockId}${itemId}`;
const ops = (blockId: string, ...itemIds: string[]) => itemIds.map((id) => opaque(blockId, id));
const submit = (block: Block, answer: unknown, existing?: Parameters<typeof evaluateSubmit>[2]) =>
  evaluateSubmit(block, answer, existing, now, opaque);

describe('evaluateSubmit: bloki wyborów (QUIZ / BRANCHING_SCENARIO)', () => {
  it('poprawna i błędna opcja dają 1 / 0 punktów, waga z bloku', () => {
    const quiz = blocks().QUIZ;
    expect(submit(quiz, 1).entry).toMatchObject({ correct: true, points: 1, answer: 1, weight: 2, done: true });
    expect(submit(quiz, 0).entry).toMatchObject({ correct: false, points: 0 });
    expect(submit(blocks().BRANCHING_SCENARIO, 1).entry.correct).toBe(true);
  });

  it('waga domyślna 1, gdy blok jej nie ustawia', () => {
    const quiz = { ...blocks().QUIZ, weight: undefined };
    expect(weightOf(quiz)).toBe(1);
    expect(weightOf({ ...blocks().VIDEO, weight: undefined })).toBe(0);
    expect(weightOf({ id: 'x', type: 'NIEZNANY' })).toBe(0);
  });

  it.each([undefined, -1, 2, 1.5, '1', null, { a: 1 }])('odrzuca odpowiedź %p', (answer) => {
    expect(() => submit(blocks().QUIZ, answer)).toThrow(BadRequestException);
  });
});

describe('evaluateSubmit: DOSSIER (teczka sprawy, D-083)', () => {
  const block = () => ({ ...blocks().DOSSIER, weight: 0 });

  it('wszystkie dokumenty otwarte + wymagany dowód zakreślony: zaliczony, nieoceniany, notatka pod kluczem <blok>.<wiersz>', () => {
    const result = submit(block(), { opened: ['wyciag', 'procedury'], noted: ['w2'] });
    expect(result.entry).toMatchObject({ done: true, type: 'DOSSIER' });
    expect(result.entry.points).toBeUndefined();
    expect(result.notesAdded).toEqual(['akta.w2']);
  });

  it('nieotwarty dokument albo niezakreślony wymagany dowód: 400', () => {
    expect(() => submit(block(), { opened: ['wyciag'], noted: ['w2'] })).toThrow(BadRequestException);
    expect(() => submit(block(), { opened: ['wyciag', 'procedury'], noted: [] })).toThrow(/wymaganych elementów/);
  });

  it('zwykła linijka, nieznany wiersz, id dokumentu, duplikat w noted albo pole spoza DTO: 400 bez treści bloku', () => {
    const opened = ['wyciag', 'procedury'];
    for (const answer of [
      { opened, noted: ['w2', 'w1'] }, // w1 to zwykła operacja - nie dowód
      { opened, noted: ['w2', 'nie-ma'] },
      { opened, noted: ['w2', 'wyciag'] },
      { opened, noted: ['w2', 'w2'] },
      { opened: [...opened, 'nie-ma'], noted: ['w2'] },
      { opened, noted: ['w2'], visited: [] },
      { opened },
      undefined,
    ]) {
      let message = '';
      try {
        submit(block(), answer);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toMatch(/Przelew|Opłata|SEKRET/);
    }
  });
});

describe('evaluateSubmit: bloki eksploracyjne', () => {
  it('SCENE_HOTSPOTS: wymaga wszystkich wskazanych hotspotów, nie ocenia', () => {
    const block = { ...blocks().SCENE_HOTSPOTS, weight: 0 };
    const ok = submit(block, { visited: ['h1'] });
    expect(ok.entry.done).toBe(true);
    expect(ok.entry.points).toBeUndefined();
    expect(() => submit(block, { visited: ['h2'] })).toThrow(BadRequestException);
    expect(() => submit(block, { visited: [] })).toThrow(BadRequestException);
    expect(() => submit(block, { visited: ['h1', 'nie-ma'] })).toThrow(BadRequestException);
    expect(() => submit(block, { visited: ['h1', 'h1'] })).toThrow(BadRequestException);
    expect(() => submit(block, { visited: ['h1'], inne: 1 })).toThrow(BadRequestException);
    expect(() => submit(block, undefined)).toThrow(BadRequestException);
  });

  it('SCENE_HOTSPOTS: hotspot WEWNĄTRZ zagnieżdżonej sceny (media.kind:"scene", B-086/D-071) liczy się do required na tych samych zasadach co zewnętrzny', () => {
    const block = blocks().SCENE_HOTSPOTS;
    const gateway = (block.hotspots as unknown as Record<string, any>[]).find((h) => h.media?.kind === 'scene')!;
    gateway.media.scene.hotspots[0].required = true; // h4-outlook required na tej próbie (w fixturze domyślnie false)
    expect(() => submit(block, { visited: ['h1'] })).toThrow(BadRequestException); // brakuje wymaganego h4-outlook
    expect(submit(block, { visited: ['h1', 'h4-outlook'] }).entry.done).toBe(true);
  });

  it('SCENE_HOTSPOTS: "drzwi" (action:"next", B-086/D-071) WYKLUCZONE z puli required - scena z samymi drzwiami (bez innych hotspotów, np. "korytarz") daje się ukończyć pustym visited', () => {
    const block = { ...blocks().SCENE_HOTSPOTS, requiredHotspots: undefined, hotspots: [{ id: 'drzwi', label: 'Wyjście', x: 90, y: 5, width: 8, height: 10, action: 'next' }] };
    // Bez wykluczenia drzwi z required fallback ("wszystkie required", bo żaden hotspot nie ma jawnej flagi) liczyłby
    // same drzwi jako wymagane - a drzwi nigdy nie trafiają do `visited` same z siebie, więc blok nigdy by się nie ukończył.
    expect(submit(block, { visited: [] }).entry.done).toBe(true);
  });

  it('SCENE_HOTSPOTS: drzwi + INNY required hotspot naraz - wykluczenie drzwi z puli nie "zjada" pozostałych required', () => {
    const block = {
      ...blocks().SCENE_HOTSPOTS,
      requiredHotspots: undefined,
      hotspots: [
        { id: 'dowod', label: 'Kartka', x: 10, y: 10, width: 20, height: 20, content: 'x', required: true },
        { id: 'drzwi', label: 'Wyjście', x: 90, y: 5, width: 8, height: 10, action: 'next' },
      ],
    };
    expect(() => submit(block, { visited: [] })).toThrow(BadRequestException); // dowod required:true, mimo wykluczenia drzwi
    expect(submit(block, { visited: ['dowod'] }).entry.done).toBe(true); // drzwi same NIE muszą być w visited
  });

  it('SCENE_HOTSPOTS: drzwi + dowód OPCJONALNY (required:false, D-086 - tablica w korytarzu): pusty visited kończy blok, noted bez visited = 400', () => {
    const block = {
      ...blocks().SCENE_HOTSPOTS,
      requiredHotspots: undefined,
      hotspots: [
        { id: 'tablica', label: 'Tablica', x: 60, y: 10, width: 20, height: 20, content: 'x', evidence: true, note: { text: 'Zasada była znana.', kind: 'item' }, required: false },
        { id: 'drzwi', label: 'Wyjście', x: 40, y: 30, width: 10, height: 40, action: 'next' },
      ],
    };
    expect(submit(block, { visited: [] }).entry.done).toBe(true);
    expect(() => submit(block, { visited: [], noted: ['tablica'] })).toThrow(BadRequestException);
    expect(submit(block, { visited: ['tablica'], noted: ['tablica'] }).entry.done).toBe(true);
  });

  it('SCENE_HOTSPOTS: nieznane id (spoza spłaszczonego zbioru zewnętrzne+wewnętrzne) jest odrzucone bez treści bloku', () => {
    const block = blocks().SCENE_HOTSPOTS;
    const rejected = () => submit(block, { visited: ['h1', 'wymyslone-id'] });
    expect(rejected).toThrow(BadRequestException);
    try {
      rejected();
    } catch (e) {
      expect(JSON.stringify((e as BadRequestException).getResponse())).not.toContain('SEKRET');
    }
  });

  const plainHotspots = () => {
    const block = blocks().SCENE_HOTSPOTS;
    return {
      ...block,
      requiredHotspots: undefined,
      hotspots: block.hotspots.map((h: Record<string, any>) => ({
        ...h,
        required: undefined,
        // required jest liczone na SPŁASZCZONEJ liście (flattenHotspots, B-086/D-071) - trzeba je zdjąć też z
        // hotspotów WEWNĄTRZ media.kind:'scene', inaczej jedyny pozostały required:false (h4-outlook) sprawiłby,
        // że "żaden element nie jest required" (pusty zbiór), zamiast "wszystkie są required" (fallback).
        ...(h.media?.kind === 'scene'
          ? { media: { ...h.media, scene: { ...h.media.scene, hotspots: h.media.scene.hotspots.map((ih: Record<string, any>) => ({ ...ih, required: undefined })) } } }
          : {}),
      })),
    };
  };

  it('bez required i requiredHotspots wymagane są wszystkie', () => {
    const block = plainHotspots();
    expect(() => submit(block, { visited: ['h1'] })).toThrow(BadRequestException);
    // Fixtura ma 5 hotspotów najwyższego poziomu + 3 wewnątrz zagnieżdżonej sceny h4 (h4-outlook/h4-kosz/h4-folder) -
    // required liczone na spłaszczonej liście (B-086/D-071), więc wszystkich 8 trzeba odwiedzić.
    expect(() => submit(block, { visited: ['h1', 'h2', 'h3', 'h4', 'h5'] })).toThrow(BadRequestException);
    expect(submit(block, { visited: ['h1', 'h2', 'h3', 'h4', 'h5', 'h4-outlook', 'h4-kosz', 'h4-folder'] }).entry.done).toBe(true);
  });

  it('hotspots[].required: wymagane tylko oznaczone, "smaczek" nie blokuje ukończenia; jawne required wygrywa ze starą listą', () => {
    const block = blocks().SCENE_HOTSPOTS; // h1 required: true, h2 required: false, requiredHotspots: ['h1']
    expect(submit(block, { visited: ['h1'] }).entry.done).toBe(true);
    const flipped = {
      ...block,
      requiredHotspots: ['h1'],
      hotspots: block.hotspots.map((h: Record<string, unknown>) => ({ ...h, required: h.id === 'h2' })),
    };
    expect(() => submit(flipped, { visited: ['h1'] })).toThrow(BadRequestException);
    expect(submit(flipped, { visited: ['h2'] }).entry.done).toBe(true);
  });

  it('SCENE_HOTSPOTS: "Dodaj do notatnika" (noted) dopisuje notatkę tylko odwiedzonego hotspotu z evidence', () => {
    const block = blocks().SCENE_HOTSPOTS;
    expect(submit(block, { visited: ['h1'], noted: ['h1'] }).notesAdded).toEqual(['scena.h1']);
    expect(submit(block, { visited: ['h1'] }).notesAdded).toEqual([]);
    expect(submit(block, { visited: ['h1'], noted: [] }).notesAdded).toEqual([]);
  });

  it.each([
    ['element bez evidence', { visited: ['h1', 'h2'], noted: ['h2'] }],
    ['element nieodwiedzony', { visited: ['h1'], noted: ['h1', 'h2'] }],
    ['element nieistniejący', { visited: ['h1'], noted: ['nie-ma'] }],
    ['duplikat', { visited: ['h1'], noted: ['h1', 'h1'] }],
    ['zła postać', { visited: ['h1'], noted: 'h1' }],
  ])('SCENE_HOTSPOTS: noted - %s to 400 bez treści bloku', (_label, answer) => {
    let error: unknown;
    try {
      submit(blocks().SCENE_HOTSPOTS, answer);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((error as BadRequestException).getResponse())).toBe(
      JSON.stringify({ message: 'Brak lub nieprawidłowa odpowiedź dla tego bloku', error: 'Bad Request', statusCode: 400 }),
    );
  });

  it('hotspot z evidence, ale bez note, nie trafia do notatnika (noted odrzucone)', () => {
    const block = blocks().SCENE_HOTSPOTS;
    const noNote = { ...block, hotspots: block.hotspots.map((h: Record<string, unknown>) => (h.id === 'h1' ? { ...h, note: undefined } : h)) };
    expect(() => submit(noNote, { visited: ['h1'], noted: ['h1'] })).toThrow(BadRequestException);
  });

  it('DIALOGUE dopisuje notatki tylko zadanych pytań, które je mają; wymagane wg questions[].required', () => {
    const block = blocks().DIALOGUE; // q1 required: true (z notatką), q2 required: false
    expect(submit(block, { asked: ['q1', 'q2'] }).notesAdded).toEqual(['rozmowa.q1']);
    expect(submit(block, { asked: ['q1'] }).notesAdded).toEqual(['rozmowa.q1']);
    expect(() => submit(block, { asked: ['q2'] })).toThrow(BadRequestException);
  });

  it('TABS: wymagane zakładki', () => {
    expect(submit(blocks().TABS, { opened: ['t1'] }).entry.done).toBe(true);
    expect(() => submit(blocks().TABS, { opened: ['t2'] })).toThrow(BadRequestException);
  });

  it('bloki bez odpowiedzi (wideo, notatnik, podsumowanie, nieznane) kończą się bez oceny i ignorują odpowiedź klienta', () => {
    for (const type of ['VIDEO', 'NOTEPAD', 'SUMMARY', 'DRAG_AND_DROP', 'EMBEDDED_HTML'] as const) {
      const result = submit(blocks()[type], { correct: true, points: 1 });
      expect(result.entry.correct).toBeUndefined();
      expect(result.entry.points).toBeUndefined();
    }
    expect(submit({ id: 'b0', type: 'NIEZNANY' }, undefined).entry).toMatchObject({ done: true, weight: 0 });
  });

  it('blok eksploracyjny z wagą > 0 daje 1 punkt po spełnieniu wymagań', () => {
    const block = { ...blocks().TABS, weight: 1 };
    expect(submit(block, { opened: ['t1'] }).entry).toMatchObject({ points: 1, weight: 1 });
  });
});

describe('EMAIL_ANALYSIS: punkty częściowe i scoring exact', () => {
  // kryteria: c1 (poprawne), c2 (błędne), c3 (poprawne)
  const email = () => blocks().EMAIL_ANALYSIS;
  // Klient wysyła id nieprzejrzyste (jak z /start); tu podajemy id z treści i tłumaczymy je tak, jak zrobiłby klient.
  const points = (selected: string[], block = email()) =>
    submit(block, { selected: ops('mail', ...selected) }).entry.points;

  it('wpis bloku zapamiętuje wybór (id z treści) do podglądu ukończonego bloku', () => {
    expect(submit(email(), { selected: ops('mail', 'c1', 'c3') }).entry.selected).toEqual(['c1', 'c3']);
    const ordering = blocks().ORDERING;
    expect(submit(ordering, { order: ops('kolejnosc', 'o2', 'o1', 'o3') }).entry.order).toEqual(['o2', 'o1', 'o3']);
  });

  it('partial: (trafione - błędne) / liczba poprawnych, nie mniej niż 0', () => {
    expect(points(['c1', 'c3'])).toBe(1);
    expect(points(['c1'])).toBe(0.5);
    expect(points(['c1', 'c3', 'c2'])).toBe(0.5);
    expect(points(['c1', 'c2'])).toBe(0);
    expect(points(['c2'])).toBe(0);
    expect(points([])).toBe(0);
  });

  it('exact: cały zestaw albo 0', () => {
    const exact = { ...email(), scoring: 'exact' };
    expect(points(['c1', 'c3'], exact)).toBe(1);
    expect(points(['c1'], exact)).toBe(0);
    expect(points(['c1', 'c3', 'c2'], exact)).toBe(0);
  });

  it('correct = pełny wynik; notatki tylko dla zaznaczonych poprawnych; detail rozstrzyga kryteria (id nieprzejrzyste)', () => {
    const result = submit(email(), { selected: ops('mail', 'c1', 'c2') });
    expect(result.entry.correct).toBe(false);
    expect(result.notesAdded).toEqual(['mail.c1']);
    expect(result.detail).toEqual({
      criteria: [
        { id: opaque('mail', 'c1'), correct: true, selected: true, explanation: expect.any(String) },
        { id: opaque('mail', 'c2'), correct: false, selected: true, explanation: expect.any(String) },
        { id: opaque('mail', 'c3'), correct: true, selected: false, explanation: expect.any(String) },
      ],
    });
  });

  it('odrzuca id z treści (nieprzejrzyste są jedyną drogą) oraz id z cudzego przypisania, bez treści bloku w komunikacie', () => {
    for (const selected of [['c1'], ['op-cudzy-mail-c1'], ops('inny-blok', 'c1')]) {
      let error: unknown;
      try {
        submit(email(), { selected });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(BadRequestException);
      const body = JSON.stringify((error as BadRequestException).getResponse());
      expect(body).not.toContain('Podejrzana domena');
      expect(body).not.toContain(SECRET_MARKER);
    }
  });

  it('emailPoints: brak poprawnych kryteriów (zestaw "mail jest w porządku")', () => {
    expect(emailPoints('partial', 0, 0, 0)).toBe(1);
    expect(emailPoints('partial', 0, 0, 2)).toBe(0);
    expect(emailPoints('exact', 0, 0, 0)).toBe(1);
  });

  it.each([
    { selected: ['nie-ma'] },
    { selected: [opaque('mail', 'c1'), opaque('mail', 'c1')] },
    { selected: opaque('mail', 'c1') },
    {},
    undefined,
  ])('odrzuca odpowiedź %p', (answer) => {
    expect(() => submit(email(), answer)).toThrow(BadRequestException);
  });
});

describe('ORDERING: punkty częściowe i scoring exact', () => {
  const ordering = () => blocks().ORDERING; // poprawnie: o1, o2, o3

  const order = (...ids: string[]) => ({ order: ops('kolejnosc', ...ids) });

  it('partial: udział elementów na właściwych pozycjach', () => {
    expect(submit(ordering(), order('o1', 'o2', 'o3')).entry.points).toBe(1);
    expect(submit(ordering(), order('o1', 'o3', 'o2')).entry.points).toBeCloseTo(1 / 3);
    expect(submit(ordering(), order('o3', 'o1', 'o2')).entry.points).toBe(0);
  });

  it('exact: tylko idealna kolejność', () => {
    const exact = { ...ordering(), scoring: 'exact' };
    expect(submit(exact, order('o1', 'o2', 'o3')).entry.points).toBe(1);
    expect(submit(exact, order('o1', 'o3', 'o2')).entry.points).toBe(0);
  });

  it('detail zawiera poprawną kolejność (id nieprzejrzyste) dopiero po odpowiedzi', () => {
    expect(submit(ordering(), order('o3', 'o2', 'o1')).detail).toMatchObject({
      correctOrder: ops('kolejnosc', 'o1', 'o2', 'o3'),
    });
  });

  it.each([
    { order: ops('kolejnosc', 'o1', 'o2') },
    { order: ops('kolejnosc', 'o1', 'o2', 'o2') },
    { order: [...ops('kolejnosc', 'o1', 'o2'), 'nie-ma'] },
    { order: ops('kolejnosc', 'o1', 'o2', 'o3', 'o1') },
    { order: ['o1', 'o2', 'o3'] }, // id z treści zamiast nieprzejrzystych
    { order: [...ops('kolejnosc', 'o1', 'o2'), 'opcudzy-o3'] }, // id z cudzego przypisania
    { order: 'o1,o2,o3' },
  ])('odrzuca %p', (answer) => {
    expect(() => submit(ordering(), answer)).toThrow(BadRequestException);
  });
});

describe('TEXT_INPUT_GUIDED: próby, podpowiedzi, punkty malejące z próbami', () => {
  const text = (overrides: Record<string, unknown> = {}): Block => ({
    ...blocks().TEXT_INPUT_GUIDED,
    answer: { accept: ['Bank-Prawdziwy.pl'], regex: undefined },
    hints: [{ text: 'Podpowiedź 1' }, { text: 'Podpowiedź 2' }],
    maxAttempts: 4,
    ...overrides,
  });

  // Symuluje kolejne próby, przekazując zapisany wpis dalej (jak progress w bazie).
  function play(block: Block, inputs: string[]) {
    let entry: Parameters<typeof evaluateAttempt>[2];
    const responses = [];
    for (const input of inputs) {
      const result = evaluateAttempt(block, input, entry, now);
      entry = result.entry;
      responses.push(result.response);
    }
    return { entry: entry!, responses };
  }

  it('poprawna od razu: 1 punkt, brak podpowiedzi, brak rozwiązania w odpowiedzi', () => {
    const { entry, responses } = play(text(), ['  BANK-prawdziwy.PL ']);
    expect(responses[0]).toEqual({ blockId: 'domena', correct: true, attempt: 1, attemptsLeft: 3, done: true, points: 1 });
    expect(entry).toMatchObject({ done: true, correct: true, points: 1, attempts: 1 });
  });

  it('punkty maleją z próbami (1, 0.75, 0.5, 0.25) i nie schodzą poniżej floor', () => {
    const wrong = 'zla';
    expect(play(text(), [wrong, 'bank-prawdziwy.pl']).entry.points).toBe(0.75);
    expect(play(text(), [wrong, wrong, 'bank-prawdziwy.pl']).entry.points).toBe(0.5);
    expect(play(text(), [wrong, wrong, wrong, 'bank-prawdziwy.pl']).entry.points).toBe(0.25);
    expect(attemptPoints(10, 0.25, 0.25)).toBe(0.25);
    expect(attemptPoints(3, 0.1, 0)).toBeCloseTo(0.8);
  });

  it('błędna próba odsłania kolejne podpowiedzi po kolei, nie wcześniej', () => {
    const { responses } = play(text(), ['zla', 'zla', 'zla']);
    expect(responses[0].hint).toEqual({ text: 'Podpowiedź 1' });
    expect(responses[1].hint).toEqual({ text: 'Podpowiedź 2' });
    expect(responses[2].hint).toBeUndefined();
    expect(responses[0].solution).toBeUndefined();
  });

  it('wyczerpanie prób: blok rozstrzygnięty z 0 punktów, odpowiedź odsłania rozwiązanie i wyjaśnienie', () => {
    const block = text();
    const { entry, responses } = play(block, ['a', 'b', 'c', 'd']);
    const last = responses[3];
    expect(last).toMatchObject({ correct: false, done: true, attemptsLeft: 0, points: 0 });
    expect(last.solution).toEqual(block.solution);
    expect(entry).toMatchObject({ done: true, correct: false, points: 0, attempts: 4 });
    expect(last.hint).toBeUndefined();
  });

  it('po rozstrzygnięciu kolejna próba jest odrzucona (także po wyczerpaniu prób)', () => {
    const solved = play(text(), ['bank-prawdziwy.pl']).entry;
    expect(() => evaluateAttempt(text(), 'x', solved, now)).toThrow(BadRequestException);
    const exhausted = play(text(), ['a', 'b', 'c', 'd']).entry;
    expect(() => evaluateAttempt(text(), 'bank-prawdziwy.pl', exhausted, now)).toThrow(BadRequestException);
  });

  it('domyślny limit prób to 4, limit z bloku jest respektowany', () => {
    const block = text({ maxAttempts: 2, hints: [] });
    const { responses } = play(block, ['a', 'b']);
    expect(responses[1]).toMatchObject({ done: true, correct: false, attemptsLeft: 0 });
  });

  it('regex: dopasowanie po normalizacji, domyślnie bez rozróżniania wielkości liter', () => {
    const block = text({ answer: { accept: [], regex: '^bank-prawdziwy\\.(pl|com)$' } });
    expect(play(block, ['Bank-Prawdziwy.COM']).entry.correct).toBe(true);
    expect(play(block, ['bank-prawdziwy.eu']).entry.done).toBe(false);
  });

  it('regex zawsze dopasowuje CAŁĄ odpowiedź: podciąg nie wystarcza, a alternatywy nie omijają kotwic', () => {
    const anchored = text({ answer: { accept: [], regex: '^bank\\.pl$' } });
    expect(isTextCorrect(anchored, 'xxbank.plxx')).toBe(false);
    expect(isTextCorrect(anchored, 'bank.pl')).toBe(true);
    // ^a|b$ czytane naiwnie akceptuje "xb" i "ax"; opakowane w ^(?:...)$ - nie.
    const alternation = text({ answer: { accept: [], regex: '^(?:a)|(?:b)$' } });
    expect(isTextCorrect(alternation, 'xb')).toBe(false);
    expect(isTextCorrect(alternation, 'ax')).toBe(false);
    expect(isTextCorrect(alternation, 'a')).toBe(true);
    expect(isTextCorrect(alternation, 'b')).toBe(true);
  });

  it('caseSensitive: rozróżnia wielkość liter zarówno w accept, jak i w regex (domyślnie false)', () => {
    const accept = text({ answer: { accept: ['BankPL'], caseSensitive: true } });
    expect(isTextCorrect(accept, 'BankPL')).toBe(true);
    expect(isTextCorrect(accept, 'bankpl')).toBe(false);
    const regex = text({ answer: { accept: [], regex: '^Bank[A-Z]{2}$', caseSensitive: true } });
    expect(isTextCorrect(regex, 'BankPL')).toBe(true);
    expect(isTextCorrect(regex, 'bankpl')).toBe(false);
    expect(isTextCorrect(text({ answer: { accept: ['BankPL'] } }), 'bankpl')).toBe(true);
  });

  it.each(['^a*a*a*a*a*a*$', '^((a|aa))+$', '^(a+)+$', '^(.*a){20}$'])(
    'wzorzec katastrofalny dla silnika z nawrotem (%s) dopasowuje maksymalną odpowiedź (500 znaków) w < 50 ms (RE2)',
    (regex) => {
      const block = text({ answer: { accept: [], regex } });
      const started = process.hrtime.bigint();
      expect(isTextCorrect(block, `${'a'.repeat(499)}!`)).toBe(false);
      expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(50);
      // Pełny przebieg próby (z limitem długości, normalizacją i zapisem wyniku) też jest szybki.
      const attemptStarted = process.hrtime.bigint();
      expect(evaluateAttempt(block, `${'a'.repeat(499)}!`, undefined, now).response.correct).toBe(false);
      expect(Number(process.hrtime.bigint() - attemptStarted) / 1e6).toBeLessThan(50);
    },
  );

  it('odpowiedź ponad limit długości nie dochodzi do dopasowania w ogóle', () => {
    const block = text({ answer: { accept: [], regex: '^a*a*a*a*a*a*$' } });
    expect(() => evaluateAttempt(block, 'a'.repeat(501), undefined, now)).toThrow(BadRequestException);
  });

  it('normalizacja: trim, małe litery, zwijanie białych znaków - każde wyłączane', () => {
    expect(normalizeText('  Ala   MA  Kota ', {})).toBe('ala ma kota');
    expect(normalizeText('  Ala  ', { trim: false, caseSensitive: true, collapseWhitespace: false })).toBe('  Ala  ');
    expect(normalizeText('A   B', { collapseWhitespace: false })).toBe('a   b');
    expect(normalizeText('Ala', { caseSensitive: true })).toBe('Ala');
  });

  it('zbyt długa odpowiedź jest odrzucana', () => {
    expect(() => evaluateAttempt(text(), 'a'.repeat(501), undefined, now)).toThrow(BadRequestException);
  });

  it('"Dalej" (submit) wymaga rozstrzygnięcia i nie zmienia wyniku zapisanego przez /attempt', () => {
    const block = text();
    expect(() => submit(block, undefined)).toThrow(BadRequestException);
    const inProgress = play(block, ['zla']).entry;
    expect(() => submit(block, undefined, inProgress)).toThrow(BadRequestException);
    const solved = play(block, ['zla', 'bank-prawdziwy.pl']).entry;
    expect(submit(block, { correct: true, points: 1 }, solved).entry).toBe(solved);
  });
});

describe('pickReaction: reakcja maskotki na wynik (schemaVersion 4, reactions.result)', () => {
  it('QUIZ/BRANCHING_SCENARIO (minScore, wynik 0 albo 1): trafia próg 1 albo 0', () => {
    expect(pickReaction(blocks().QUIZ, { points: 1 })?.text).toContain(`${SECRET_MARKER}-quiz-cheer`);
    expect(pickReaction(blocks().QUIZ, { points: 0 })?.text).toContain(`${SECRET_MARKER}-quiz-warning`);
    expect(pickReaction(blocks().BRANCHING_SCENARIO, { points: 1 })?.text).toContain(`${SECRET_MARKER}-branching-cheer`);
  });

  it('EMAIL_ANALYSIS/ORDERING (minScore malejąco): pierwszy próg <= wynikowi wygrywa', () => {
    expect(pickReaction(blocks().EMAIL_ANALYSIS, { points: 0.9 })?.text).toContain(`${SECRET_MARKER}-email-cheer`);
    expect(pickReaction(blocks().EMAIL_ANALYSIS, { points: 0.8 })?.text).toContain(`${SECRET_MARKER}-email-cheer`);
    expect(pickReaction(blocks().EMAIL_ANALYSIS, { points: 0.5 })?.text).toContain(`${SECRET_MARKER}-email-thinking`);
    expect(pickReaction(blocks().EMAIL_ANALYSIS, { points: 0.1 })?.text).toContain(`${SECRET_MARKER}-email-warning`);
    expect(pickReaction(blocks().EMAIL_ANALYSIS, { points: 0 })?.text).toContain(`${SECRET_MARKER}-email-warning`);
    expect(pickReaction(blocks().ORDERING, { points: 1 })?.text).toContain(`${SECRET_MARKER}-ordering-cheer`);
    expect(pickReaction(blocks().ORDERING, { points: 0.5 })?.text).toContain(`${SECRET_MARKER}-ordering-thinking`);
  });

  it('TEXT_INPUT_GUIDED (when, nie próg): poprawnie/niepoprawnie, bez reakcji dopóki nierozstrzygnięte', () => {
    expect(pickReaction(blocks().TEXT_INPUT_GUIDED, { correct: true, points: 1 })?.text).toContain(`${SECRET_MARKER}-text-cheer`);
    expect(pickReaction(blocks().TEXT_INPUT_GUIDED, { correct: false, points: 0 })?.text).toContain(`${SECRET_MARKER}-text-warning`);
    // Próba z pozostałymi podejściami: entry.correct jeszcze nie ustawione (evaluateAttempt ustawia je tylko przy done).
    expect(pickReaction(blocks().TEXT_INPUT_GUIDED, {})).toBeUndefined();
  });

  it('pełny przebieg evaluateAttempt: reakcja pojawia się dopiero przy rozstrzygnięciu, nie przy próbie z podpowiedzią', () => {
    const block: Block = { ...blocks().TEXT_INPUT_GUIDED, answer: { accept: ['bank-prawdziwy.pl'], regex: undefined }, maxAttempts: 4 };
    const wrong = evaluateAttempt(block, 'zla', undefined, now);
    expect(pickReaction(block, wrong.entry)).toBeUndefined(); // attempt 1/4, jeszcze nie done
    const right = evaluateAttempt(block, 'bank-prawdziwy.pl', wrong.entry, now);
    expect(pickReaction(block, right.entry)?.text).toContain(`${SECRET_MARKER}-text-cheer`);
  });

  it('blok bez wyniku 0-1 (eksploracyjny, bez oceny): brak reakcji niezależnie od reactions.result', () => {
    expect(pickReaction(blocks().SCENE_HOTSPOTS, { points: 1, correct: true })).toBeUndefined();
    expect(pickReaction({ ...blocks().NOTEPAD, reactions: { result: [{ minScore: 0, pose: 'cheer', text: 'x' }] } }, { points: 1 })).toBeUndefined();
  });

  it('brak reactions.result w treści: brak reakcji (nic nie rzuca)', () => {
    expect(pickReaction({ ...blocks().QUIZ, reactions: {} }, { points: 1 })).toBeUndefined();
    expect(pickReaction({ ...blocks().QUIZ, reactions: undefined }, { points: 1 })).toBeUndefined();
  });
});
