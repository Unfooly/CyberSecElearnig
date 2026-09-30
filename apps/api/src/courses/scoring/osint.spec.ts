import { BadRequestException } from '@nestjs/common';
import { SECRET_MARKER, fullBlocks } from '@cyberszkolo/content/dist/fixtures';
import { clientProgress, distinctions, evidenceSummary } from '../client-view';
import { ProgressV2 } from '../progress';
import { Block, evaluateSubmit, weightOf } from './evaluate';

// OSINT (D-120): zaznaczenia obszarów strony, kara za pułapki, dowody po ocenie, ukryte zakończenie nagrania (wyróżnienie bez punktów).

const now = new Date('2026-09-29T12:00:00.000Z');
const opaque = (blockId: string, itemId: string) => `op-${blockId}-${itemId}`;
const osint = () => fullBlocks().OSINT_SPOT as unknown as Block;
const all = () => Object.values(fullBlocks()) as unknown as Block[];
const submit = (answer: unknown, block = osint()) => evaluateSubmit(block, answer, undefined, now, opaque);

describe('evaluateSubmit: OSINT_SPOT', () => {
  it('wszystkie użyte bez pułapek - 1; dowody tylko zaznaczonych użytych z notatką; rozstrzygnięcie po ocenie', () => {
    const result = submit({ marked: ['zespol', 'kierownik', 'webinar'] });
    expect(result.entry).toMatchObject({ done: true, points: 1, correct: true, weight: 2, marked: ['zespol', 'kierownik', 'webinar'] });
    expect(result.notesAdded).toEqual(['osint.zespol', 'osint.webinar']);
    expect(result.detail).toEqual({
      spots: [
        { id: 'zespol', used: true, marked: true },
        { id: 'kierownik', used: true, marked: true },
        { id: 'webinar', used: true, marked: true },
        { id: 'godziny', used: false, marked: false, trapText: `${SECRET_MARKER}-pulapka-godziny` },
        { id: 'adres', used: false, marked: false, trapText: 'Adres nic oszustowi nie dał.' },
      ],
    });
  });

  it('wynik: trafione użyte / wszystkie użyte − kara × pułapki, min. 0', () => {
    expect(submit({ marked: ['zespol'] }).entry.points).toBeCloseTo(1 / 3);
    // 3/3 − 0,25 × 1 pułapka.
    expect(submit({ marked: ['zespol', 'kierownik', 'webinar', 'godziny'] }).entry).toMatchObject({ points: 0.75, correct: false });
    // „Zaznacz wszystko”: 1 − 0,25 × 2 = 0,5.
    expect(submit({ marked: ['zespol', 'kierownik', 'webinar', 'godziny', 'adres'] }).entry.points).toBe(0.5);
    // Same pułapki - 0, nie ujemne.
    expect(submit({ marked: ['godziny', 'adres'] }).entry.points).toBe(0);
    expect(submit({ marked: [] }).entry.points).toBe(0);
    // Kara z treści; bez niej - domyślne 0,25.
    const noPenalty = { ...osint(), falseSpotPenalty: undefined } as Block;
    expect(submit({ marked: ['zespol', 'kierownik', 'webinar', 'godziny'] }, noPenalty).entry.points).toBe(0.75);
    // Kara 0: „zaznacz wszystko” daje 1 punkt, ale nie jest poprawne (pułapki zaznaczone).
    const zeroPenalty = { ...osint(), falseSpotPenalty: 0 } as Block;
    expect(submit({ marked: ['zespol', 'kierownik', 'webinar', 'godziny', 'adres'] }, zeroPenalty).entry).toMatchObject({ points: 1, correct: false });
  });

  it('odpowiedź: znane, niepowtórzone obszary i ukryte zakończenia; bez pól spoza schematu', () => {
    for (const answer of [
      { marked: ['nie-ma'] },
      { marked: ['zespol', 'zespol'] },
      { marked: ['zespol'], heard: ['inne-zakonczenie'] },
      { marked: ['zespol'], heard: ['off-the-record', 'off-the-record'] },
      { marked: ['zespol'], points: 1 },
      { selected: ['zespol'] },
    ]) {
      expect(() => submit(answer)).toThrow(BadRequestException);
    }
  });

  it('ukryte zakończenie: flaga w wpisie (bez wpływu na punkty), wyróżnienie w notatniku z etykietą i zdaniem', () => {
    const entry = submit({ marked: ['zespol'], heard: ['off-the-record'] }).entry;
    expect(entry.secretEndings).toEqual(['off-the-record']);
    expect(entry.points).toBeCloseTo(1 / 3);
    expect(submit({ marked: ['zespol'] }).entry.secretEndings).toBeUndefined();
    const progress: ProgressV2 = { v: 2, blocks: { osint: entry }, notes: [] };
    expect(distinctions(progress, all())).toEqual([{ blockId: 'osint', label: 'Off the Record', note: 'Na końcu webinaru padło to, czego nie powinno.' }]);
  });

  it('waga domyślna 1; dowody strony w sumie licznika od startu (stały mianownik, D-130), zebrane - po ocenie', () => {
    expect(weightOf({ ...osint(), weight: undefined } as Block)).toBe(1);
    const perBlock = (notes: string[]) => evidenceSummary({ v: 2, blocks: {}, notes }, all()).perBlock.find((b) => b.blockId === 'osint');
    expect(perBlock([])).toEqual({ blockId: 'osint', collected: 0, total: 2 });
    expect(perBlock(['osint.zespol'])).toEqual({ blockId: 'osint', collected: 1, total: 2 });
  });

  it('podgląd ukończonego bloku: zaznaczenia gracza i rozstrzygnięcie; przed ukończeniem - nic', () => {
    const entry = submit({ marked: ['zespol', 'godziny'] }).entry;
    const view = (p: ProgressV2) => (clientProgress(p, all(), opaque) as { blocks: Record<string, Record<string, unknown>> }).blocks.osint;
    const done = view({ v: 2, blocks: { osint: entry }, notes: [] });
    expect(done.answer).toEqual({ marked: ['zespol', 'godziny'] });
    expect((done.detail as { spots: unknown[] }).spots).toHaveLength(5);
    const inProgress = view({ v: 2, blocks: { osint: { ...entry, done: false } }, notes: [] });
    expect(inProgress.detail).toBeUndefined();
  });
});
