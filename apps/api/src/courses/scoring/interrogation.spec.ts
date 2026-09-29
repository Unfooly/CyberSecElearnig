import { BadRequestException } from '@nestjs/common';
import { SECRET_MARKER, fullBlocks } from '@cyberszkolo/content/dist/fixtures';
import { clientProgress, noteKeyForRef, noteRef, resolveNote, evidenceSummary } from '../client-view';
import { BlockEntry, ProgressV2 } from '../progress';
import { Block, evaluateChallenge, evaluateSubmit, weightOf } from './evaluate';

// Przesłuchanie (D-118): podważenia (/challenge - jedna próba na kwestię, odsłona po trafieniu), zapis bloku z wynikiem, odnośniki notatek.

const now = new Date('2026-09-29T10:00:00.000Z');
const opaque = (blockId: string, itemId: string) => `op-${blockId}-${itemId}`;
const interrogation = () => fullBlocks().INTERROGATION as unknown as Block;
const all = () => Object.values(fullBlocks()) as unknown as Block[];
const submit = (answer: unknown, existing?: BlockEntry) => evaluateSubmit(interrogation(), answer, existing, now, opaque);
const fullAnswer = { asked: ['glos', 'kod', 'konsola'], noted: ['glos-1', 'l2'], opened: ['logowania'] };

describe('evaluateChallenge (podważenie kwestii)', () => {
  it('właściwy dowód: trafienie, kwestia po podważeniu, notatka sprzeczności; blok nieukończony', () => {
    const { entry, response, notesAdded } = evaluateChallenge(interrogation(), 'kod-1', 'nagranie.liczba', undefined, now);
    expect(response).toEqual({ blockId: 'przesluchanie', lineId: 'kod-1', correct: true, line: { text: `${SECRET_MARKER}-przyznanie` } });
    expect(notesAdded).toEqual(['przesluchanie.kod-1']);
    expect(entry).toMatchObject({ done: false, challenges: [{ lineId: 'kod-1', correct: true }] });
  });

  it('zły dowód albo prawdziwa kwestia: to samo „pudło” (bez treści sekretu, bez notatki)', () => {
    for (const [lineId, key] of [
      ['kod-1', 'akta.w2'],
      ['glos-2', 'nagranie.liczba'],
    ]) {
      const { response, notesAdded } = evaluateChallenge(interrogation(), lineId, key, undefined, now);
      expect(response).toEqual({ blockId: 'przesluchanie', lineId, correct: false });
      expect(notesAdded).toEqual([]);
    }
  });

  it('jedna próba na kwestię; nieznana kwestia - 400', () => {
    const first = evaluateChallenge(interrogation(), 'kod-1', 'akta.w2', undefined, now).entry;
    expect(() => evaluateChallenge(interrogation(), 'kod-1', 'nagranie.liczba', first, now)).toThrow('Ta kwestia była już podważona');
    expect(() => evaluateChallenge(interrogation(), 'nie-ma', 'nagranie.liczba', undefined, now)).toThrow(BadRequestException);
    // Inna kwestia po pudle - osobna próba, podważenia się sumują.
    expect(evaluateChallenge(interrogation(), 'glos-1', 'akta.w2', first, now).entry.challenges).toHaveLength(2);
  });
});

describe('evaluateSubmit: INTERROGATION', () => {
  const hit: BlockEntry = { type: 'INTERROGATION', done: false, answeredAt: now.toISOString(), weight: 1, challenges: [{ lineId: 'kod-1', correct: true }] };

  it('wynik = trafienia / (sprzeczności + pudła); podważenia przeniesione do wpisu; notatki fragmentów i konsoli; rozstrzygnięcie', () => {
    const result = submit(fullAnswer, hit);
    expect(result.entry).toMatchObject({ done: true, points: 1, correct: true, weight: 2, challenges: hit.challenges });
    expect(result.notesAdded).toEqual(['przesluchanie.glos-1', 'przesluchanie.l2']);
    // Po ukończeniu: które kwestie kłamały i ich przyznanie (jak klucz maila - dopiero po zapisie bloku).
    expect(result.detail).toEqual({ contradictions: [{ lineId: 'kod-1', line: { text: `${SECRET_MARKER}-przyznanie` } }] });
    // Bez podważenia (albo po pudle) - 0 punktów, ale blok się zapisuje.
    expect(submit(fullAnswer).entry).toMatchObject({ done: true, points: 0, correct: false });
    expect(submit(fullAnswer, { ...hit, challenges: [{ lineId: 'kod-1', correct: false }] }).entry.points).toBe(0);
    // Pudło kosztuje: „Podważ” przy każdej kwestii nie daje pełnego wyniku (trafienie + pudło = 1 / 2).
    const spray = submit(fullAnswer, { ...hit, challenges: [{ lineId: 'glos-2', correct: false }, { lineId: 'kod-1', correct: true }] }).entry;
    expect(spray).toMatchObject({ points: 0.5, correct: false });
  });

  it('podważenie kwestii z niezadanego pytania - zapis bloku odrzucony (bramka pytań)', () => {
    // `kod` nie jest wymagane w fixturze - bez niego zapis przechodzi, ale nie z podważeniem jego kwestii.
    const answer = { ...fullAnswer, asked: ['glos', 'konsola'] };
    expect(submit(answer).entry.done).toBe(true);
    expect(() => submit(answer, hit)).toThrow(BadRequestException);
  });

  it('wymagane pytania; konsola po jej pytaniu: wszystkie dokumenty i wymagane wiersze; noted tylko fragmenty zadanych pytań i wiersze-dowody', () => {
    expect(() => submit({ ...fullAnswer, asked: ['kod', 'konsola'] })).toThrow('Nie ukończono wymaganych elementów (pytania)');
    expect(() => submit({ ...fullAnswer, opened: [] })).toThrow('Nie ukończono wymaganych elementów (dokumenty)');
    expect(() => submit({ ...fullAnswer, noted: ['glos-1'] })).toThrow('dowody w konsoli');
    // Sprzeczność (notatka po podważeniu), zwykła kwestia, zwykły wiersz, nieznane id - nie przez noted.
    for (const extra of ['kod-1', 'glos-2', 'l1', 'nie-ma']) {
      expect(() => submit({ ...fullAnswer, noted: [...fullAnswer.noted, extra] })).toThrow(BadRequestException);
    }
    expect(() => submit({ ...fullAnswer, noted: ['glos-1', 'glos-1', 'l2'] })).toThrow(BadRequestException);
    expect(() => submit({ ...fullAnswer, correct: true })).toThrow(BadRequestException);
  });

  it('bez pytania o konsolę: żadnych otwartych dokumentów ani wierszy (gdy pytanie konsoli nie jest wymagane)', () => {
    const block = interrogation();
    (block.questions as { id: string; required?: boolean }[]).forEach((q) => (q.required = q.id !== 'konsola'));
    const answer = { asked: ['glos', 'kod'], noted: ['glos-1'] };
    expect(evaluateSubmit(block, answer, undefined, now, opaque).entry.done).toBe(true);
    expect(() => evaluateSubmit(block, { ...answer, opened: ['logowania'] }, undefined, now, opaque)).toThrow(BadRequestException);
    expect(() => evaluateSubmit(block, { ...answer, noted: ['glos-1', 'l2'] }, undefined, now, opaque)).toThrow(BadRequestException);
  });

  it('bez sprzeczności: waga domyślna 0, bez punktów', () => {
    const block = interrogation();
    delete block.weight;
    const kod = (block.questions as { lines: Record<string, unknown>[] }[])[1];
    kod.lines = [{ id: 'kod-1', text: 'Nie.' }];
    expect(weightOf(block)).toBe(0);
    const entry = evaluateSubmit(block, fullAnswer, undefined, now, opaque).entry;
    expect(entry).toMatchObject({ done: true, weight: 0 });
    expect(entry.points).toBeUndefined();
  });
});

describe('notatki i widok postępu przesłuchania', () => {
  const progress = (): ProgressV2 => ({
    v: 2,
    blocks: { przesluchanie: { type: 'INTERROGATION', done: false, answeredAt: now.toISOString(), weight: 2, challenges: [{ lineId: 'kod-1', correct: true }, { lineId: 'glos-2', correct: false }] } },
    notes: ['nagranie.liczba', 'przesluchanie.kod-1'],
  });

  it('noteRef: nieprzejrzysty, bez id elementu z treści; noteKeyForRef tylko dla notatek gracza', () => {
    const ref = noteRef(opaque, 'nagranie.liczba');
    expect(ref).toBe('op-nagranie-note:liczba');
    expect(noteKeyForRef(progress(), opaque, ref)).toBe('nagranie.liczba');
    expect(noteKeyForRef(progress(), opaque, noteRef(opaque, 'akta.w2'))).toBeNull();
    expect(noteKeyForRef(progress(), opaque, 'cokolwiek')).toBeNull();
  });

  it('notatka sprzeczności rozwiązywana z treści; do licznika dowodów dopiero po zebraniu (licznik nie zdradza liczby kłamstw)', () => {
    expect(resolveNote(all(), 'przesluchanie.kod-1')).toMatchObject({ text: `${SECRET_MARKER}-dowod-przyznanie`, kind: 'person' });
    const perBlock = (p: ProgressV2) => evidenceSummary(p, all()).perBlock.find((b) => b.blockId === 'przesluchanie');
    // Po trafieniu: fragment glos-1, sprzeczność kod-1, wiersz l2.
    expect(perBlock(progress())).toEqual({ blockId: 'przesluchanie', collected: 1, total: 3 });
    // Przed trafieniem - tylko publiczne dowody (fragment i wiersz konsoli).
    expect(perBlock({ ...progress(), notes: ['nagranie.liczba'] })).toEqual({ blockId: 'przesluchanie', collected: 0, total: 2 });
  });

  it('clientProgress: rozstrzygnięcie (które kwestie kłamały) tylko dla ukończonego bloku', () => {
    const doneProgress = progress();
    doneProgress.blocks.przesluchanie.done = true;
    const view = (p: ProgressV2) => (clientProgress(p, all(), opaque) as { blocks: Record<string, Record<string, unknown>> }).blocks.przesluchanie;
    expect(view(doneProgress).detail).toEqual({ contradictions: [{ lineId: 'kod-1', line: { text: `${SECRET_MARKER}-przyznanie` } }] });
    expect(view(progress()).detail).toBeUndefined();
  });

  it('clientProgress: podważenia w trakcie bloku, kwestia po podważeniu tylko przy trafieniu; notatki z odnośnikiem', () => {
    const view = clientProgress(progress(), all(), opaque) as { blocks: Record<string, Record<string, unknown>>; notes: Record<string, unknown>[] };
    expect(view.blocks.przesluchanie.challenges).toEqual([
      { lineId: 'kod-1', correct: true, line: { text: `${SECRET_MARKER}-przyznanie` } },
      { lineId: 'glos-2', correct: false },
    ]);
    // Odnośnik z kontekstu przypisania (tu testowy opaque); klucza notatki z id elementu treści w widoku nie ma.
    expect(view.notes.map((n) => n.ref)).toEqual(['op-nagranie-note:liczba', 'op-przesluchanie-note:kod-1']);
    expect(view.notes.every((n) => !('key' in n))).toBe(true);
    expect(JSON.stringify(view.notes)).not.toContain('nagranie.liczba');
  });
});
