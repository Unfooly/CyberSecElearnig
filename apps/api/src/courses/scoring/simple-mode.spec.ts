import { BadRequestException } from '@nestjs/common';
import { SECRET_MARKER, simpleModule } from '@cyberszkolo/content/dist/fixtures';
import { clientProgress } from '../client-view';
import { BlockEntry, ProgressV2 } from '../progress';
import { Block, checksView, evaluateCheck, evaluateSubmit } from './evaluate';

// Tryb prosty i SWIPE_SORT (D-132): ocena każdego kliknięcia (/check), wynik bloku z prób, podpowiedź po 2 błędach.

const now = new Date('2026-10-07T12:00:00.000Z');
const opaque = (blockId: string, itemId: string) => `op-${blockId}-${itemId}`;
const blockOf = (type: string) => simpleModule().blocks.find((block) => block.type === type) as unknown as Block;
const quiz = () => blockOf('QUIZ');
const swipe = () => blockOf('SWIPE_SORT');

/** Kolejne kliknięcia jak w /check - każde na wpisie po poprzednim. */
function clicks(block: Block, answers: unknown[], simpleMode = true) {
  let entry: BlockEntry | undefined;
  const responses = answers.map((answer) => {
    const result = evaluateCheck(block, answer, entry, now, opaque, simpleMode);
    entry = result.entry;
    return result.response;
  });
  return { entry: entry!, responses };
}

describe('evaluateCheck: wybór w trybie prostym', () => {
  it('błędna odpowiedź - „bad” i jej zdanie; poprawna - „good”, blok gotowy; wpis nieukończony do zapisu', () => {
    const { entry, responses } = clicks(quiz(), [{ option: 0 }, { option: 1 }]);
    expect(responses[0]).toEqual({ blockId: 'wybor', result: 'bad', feedback: `${SECRET_MARKER}-prosty-zle`, done: false });
    expect(responses[1]).toEqual({ blockId: 'wybor', result: 'good', feedback: `${SECRET_MARKER}-prosty-dobrze`, done: true });
    expect(entry).toMatchObject({ done: false, checks: [{ item: '0', correct: false }, { item: '1', correct: true }] });
  });

  it('po trafieniu i przy powtórzonej odpowiedzi - 400; poza trybem prostym QUIZ nie przyjmuje /check', () => {
    const { entry } = clicks(quiz(), [{ option: 1 }]);
    expect(() => evaluateCheck(quiz(), { option: 0 }, entry, now, opaque, true)).toThrow(BadRequestException);
    const wrong = clicks(quiz(), [{ option: 0 }]).entry;
    expect(() => evaluateCheck(quiz(), { option: 0 }, wrong, now, opaque, true)).toThrow(BadRequestException);
    expect(() => evaluateCheck(quiz(), { option: 0 }, undefined, now, opaque, false)).toThrow(BadRequestException);
    expect(() => evaluateCheck(quiz(), { option: 5 }, undefined, now, opaque, true)).toThrow(BadRequestException);
  });

  it('poza trybem prostym QUIZ ocenia się po staremu - z odpowiedzi w zapisie, bez /check', () => {
    expect(evaluateSubmit(quiz(), 1, undefined, now, opaque).entry).toMatchObject({ done: true, answer: 1, correct: true, points: 1 });
    expect(evaluateSubmit(quiz(), 0, undefined, now, opaque, { simpleMode: false }).entry).toMatchObject({ correct: false, points: 0 });
    expect(() => evaluateCheck(quiz(), { option: 1 }, undefined, now, opaque, false)).toThrow('Ten blok nie przyjmuje sprawdzania odpowiedzi');
  });

  it('zapis bloku: dopiero po trafieniu; wynik z PIERWSZEJ próby', () => {
    expect(() => evaluateSubmit(quiz(), 1, undefined, now, opaque, { simpleMode: true })).toThrow('Najpierw wybierz poprawną odpowiedź');
    const firstWrong = clicks(quiz(), [{ option: 0 }, { option: 1 }]).entry;
    expect(evaluateSubmit(quiz(), 1, firstWrong, now, opaque, { simpleMode: true }).entry).toMatchObject({ done: true, answer: 1, correct: false, points: 0 });
    const firstRight = clicks(quiz(), [{ option: 1 }]).entry;
    expect(evaluateSubmit(quiz(), 1, firstRight, now, opaque, { simpleMode: true }).entry).toMatchObject({ done: true, correct: true, points: 1 });
  });
});

describe('evaluateCheck: wielokrotny wybór (D-158)', () => {
  // Poprawne: 0 i 2; błędne: 1 i 3.
  const multi = () =>
    ({
      ...quiz(),
      multiple: true,
      options: [
        { text: 'A', correct: true, feedback: `${SECRET_MARKER}-a` },
        { text: 'B', correct: false, feedback: `${SECRET_MARKER}-b` },
        { text: 'C', correct: true, feedback: `${SECRET_MARKER}-c` },
        { text: 'D', correct: false, feedback: `${SECRET_MARKER}-d` },
      ],
    }) as unknown as Block;

  it('trafienie = dokładnie zbiór poprawnych; ocena i zdanie tylko dla zaznaczonych, bez zdradzania brakującej poprawnej', () => {
    const { entry, responses } = clicks(multi(), [{ options: [0] }, { options: [2, 0, 1] }, { options: [2, 0] }]);
    // Sama jedna poprawna - „bad”, ale brakująca (2) nie jest w odpowiedzi.
    expect(responses[0]).toEqual({ blockId: 'wybor', result: 'bad', feedback: '', done: false, options: [{ option: 0, result: 'good', feedback: `${SECRET_MARKER}-a` }] });
    expect(responses[1].result).toBe('bad');
    expect(responses[1].options).toEqual([
      { option: 0, result: 'good', feedback: `${SECRET_MARKER}-a` },
      { option: 1, result: 'bad', feedback: `${SECRET_MARKER}-b` },
      { option: 2, result: 'good', feedback: `${SECRET_MARKER}-c` },
    ]);
    expect(responses[2]).toMatchObject({ result: 'good', done: true });
    // Próba zapisana jako posortowany zbiór - kolejność kliknięć bez znaczenia.
    expect(entry.checks).toEqual([
      { item: '0', correct: false },
      { item: '0,1,2', correct: false },
      { item: '0,2', correct: true },
    ]);
  });

  it('ten sam zbiór drugi raz (w innej kolejności), powtórzony indeks, indeks spoza bloku, pusty zbiór, pojedynczy `option` - 400', () => {
    const { entry } = clicks(multi(), [{ options: [1, 0] }]);
    expect(() => evaluateCheck(multi(), { options: [0, 1] }, entry, now, opaque, true)).toThrow('Ta odpowiedź była już sprawdzona');
    for (const bad of [{ options: [0, 0] }, { options: [4] }, { options: [] }, { option: 0 }, { options: [0], option: 1 }, { options: ['0'] }]) {
      expect(() => evaluateCheck(multi(), bad, undefined, now, opaque, true)).toThrow(BadRequestException);
    }
    // Zwykły wybór nie przyjmuje zbioru.
    expect(() => evaluateCheck(quiz(), { options: [1] }, undefined, now, opaque, true)).toThrow(BadRequestException);
  });

  it('po trafieniu kolejna próba - 400; zapis bloku po trafieniu, wynik z pierwszej próby, bez pola `answer`', () => {
    const firstWrong = clicks(multi(), [{ options: [0] }, { options: [0, 2] }]).entry;
    expect(() => evaluateCheck(multi(), { options: [0, 2, 3] }, firstWrong, now, opaque, true)).toThrow('Ten wybór jest już rozstrzygnięty');
    const saved = evaluateSubmit(multi(), undefined, firstWrong, now, opaque, { simpleMode: true }).entry;
    expect(saved).toMatchObject({ done: true, correct: false, points: 0 });
    expect(saved.answer).toBeUndefined();
    const firstRight = clicks(multi(), [{ options: [2, 0] }]).entry;
    expect(evaluateSubmit(multi(), undefined, firstRight, now, opaque, { simpleMode: true }).entry).toMatchObject({ correct: true, points: 1 });
    expect(() => evaluateSubmit(multi(), undefined, clicks(multi(), [{ options: [1] }]).entry, now, opaque, { simpleMode: true })).toThrow(
      'Najpierw wybierz poprawną odpowiedź',
    );
  });

  it('widok prób po odświeżeniu strony: zbiór indeksów i ocena każdej zaznaczonej - jak w odpowiedzi /check', () => {
    const { entry } = clicks(multi(), [{ options: [1, 0] }]);
    expect(checksView(multi(), entry, opaque)).toEqual({
      checks: [
        {
          item: [0, 1],
          result: 'bad',
          feedback: '',
          options: [
            { option: 0, result: 'good', feedback: `${SECRET_MARKER}-a` },
            { option: 1, result: 'bad', feedback: `${SECRET_MARKER}-b` },
          ],
        },
      ],
    });
  });

  it('poza trybem prostym blok `multiple` nie przyjmuje zapisu z jednym indeksem (druga linia obrony za walidacją treści)', () => {
    expect(() => evaluateSubmit(multi(), 0, undefined, now, opaque, { simpleMode: false })).toThrow('Ten blok nie przyjmuje takiej odpowiedzi');
  });

  it('podpowiedź po 2 błędnych próbach (zbiorach)', () => {
    const { responses } = clicks(multi(), [{ options: [0] }, { options: [1] }]);
    expect(responses[0].hint).toBeUndefined();
    expect(responses[1].hint).toBe(`${SECRET_MARKER}-prosty-hint`);
  });
});

describe('evaluateCheck: SWIPE_SORT', () => {
  it('karta po id nieprzejrzystym; werdykt i zdanie; blok gotowy po ostatniej karcie; odpowiedź bez pola `correct`', () => {
    const { entry, responses } = clicks(swipe(), [
      { card: opaque('wiadomosci', 'paczka'), verdict: 'suspicious' },
      { card: opaque('wiadomosci', 'szef'), verdict: 'suspicious' },
    ]);
    expect(responses[0]).toEqual({ blockId: 'wiadomosci', result: 'good', feedback: `${SECRET_MARKER}-swipe-paczka`, done: false });
    expect(responses[1]).toEqual({ blockId: 'wiadomosci', result: 'bad', feedback: `${SECRET_MARKER}-swipe-szef`, done: true });
    for (const response of responses) expect(response).not.toHaveProperty('correct');
    expect(entry.checks).toEqual([{ item: 'paczka', correct: true }, { item: 'szef', correct: false }]);
  });

  it('id z treści, karta oceniona drugi raz i zły werdykt - 400', () => {
    expect(() => evaluateCheck(swipe(), { card: 'paczka', verdict: 'ok' }, undefined, now, opaque, true)).toThrow(BadRequestException);
    const { entry } = clicks(swipe(), [{ card: opaque('wiadomosci', 'paczka'), verdict: 'ok' }]);
    expect(() => evaluateCheck(swipe(), { card: opaque('wiadomosci', 'paczka'), verdict: 'suspicious' }, entry, now, opaque, true)).toThrow('Ta karta jest już oceniona');
    expect(() => evaluateCheck(swipe(), { card: opaque('wiadomosci', 'szef'), verdict: 'moze' }, undefined, now, opaque, true)).toThrow(BadRequestException);
  });

  it('podpowiedź dopiero po 2 błędach w bloku', () => {
    const block = { ...swipe(), cards: [...(swipe().cards as object[]), { id: 'kod', channel: 'sms', from: 'Bank', text: 'Kod: 1234', correct: 'suspicious', feedback: 'Kod.' }] } as Block;
    const { responses } = clicks(block, [
      { card: opaque('wiadomosci', 'paczka'), verdict: 'ok' },
      { card: opaque('wiadomosci', 'szef'), verdict: 'ok' },
      { card: opaque('wiadomosci', 'kod'), verdict: 'ok' },
    ]);
    expect(responses[0]).not.toHaveProperty('hint');
    expect(responses[1]).not.toHaveProperty('hint');
    expect(responses[2].hint).toBe(`${SECRET_MARKER}-swipe-hint`);
  });

  it('zapis bloku: wszystkie karty ocenione; wynik = trafione / karty, bez `correct`', () => {
    const half = clicks(swipe(), [{ card: opaque('wiadomosci', 'paczka'), verdict: 'suspicious' }]).entry;
    expect(() => evaluateSubmit(swipe(), undefined, half, now, opaque)).toThrow('Nie oceniono wszystkich kart');
    const both = clicks(swipe(), [
      { card: opaque('wiadomosci', 'paczka'), verdict: 'suspicious' },
      { card: opaque('wiadomosci', 'szef'), verdict: 'suspicious' },
    ]).entry;
    const { entry } = evaluateSubmit(swipe(), {}, both, now, opaque);
    expect(entry).toMatchObject({ done: true, points: 0.5 });
    expect(entry).not.toHaveProperty('correct');
    expect(() => evaluateSubmit(swipe(), { verdicts: [] }, both, now, opaque)).toThrow(BadRequestException);
  });

  it('widok postępu: własne próby (karty po id nieprzejrzystym, zdania) i podpowiedź; bez klucza nieocenionych kart', () => {
    const { entry } = clicks(swipe(), [{ card: opaque('wiadomosci', 'paczka'), verdict: 'ok' }]);
    const progress: ProgressV2 = { v: 2, blocks: { wiadomosci: entry }, notes: [] };
    const view = clientProgress(progress, [swipe()], opaque);
    expect(view.blocks.wiadomosci).toMatchObject({
      done: false,
      checks: [{ item: opaque('wiadomosci', 'paczka'), result: 'bad', feedback: `${SECRET_MARKER}-swipe-paczka` }],
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain('swipe-szef');
    expect(json).not.toContain('"correct"');
  });
});
