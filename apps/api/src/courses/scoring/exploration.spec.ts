import { BadRequestException } from '@nestjs/common';
import { fullBlocks } from '@cyberszkolo/content/dist/fixtures';
import { clientProgress, evidenceSummary } from '../client-view';
import { BlockEntry, ProgressV2, computeScore } from '../progress';
import { Block, evaluateExploration, evaluateSubmit, weightOf } from './evaluate';

// Stan częściowy sceny (SCENE_HOTSPOTS, D-128): /explore zapisuje obejrzane przedmioty i zabrane dowody przed ukończeniem bloku.
// Fixtura: h1 (wymagany dowód), h2, h3 (bez dowodu), h4 (scena zagnieżdżona) z h4-outlook (dowód), h4-kosz, h4-folder, h4-gra (easter egg).

const now = new Date('2026-09-30T10:00:00.000Z');
const opaque = (blockId: string, itemId: string) => `op-${blockId}-${itemId}`;
const scene = () => fullBlocks().SCENE_HOTSPOTS as unknown as Block;
const all = () => Object.values(fullBlocks()) as unknown as Block[];
const explore = (visited: string[], noted: string[], existing?: BlockEntry) => evaluateExploration(scene(), { visited, noted }, existing, now);

describe('evaluateExploration (stan częściowy sceny)', () => {
  it('zapisuje obejrzane i zabrane, blok nieukończony, bez punktów; notatki tylko dla zabranych dowodów', () => {
    const { entry, notesAdded } = explore(['h1', 'h2'], ['h1']);
    expect(entry).toEqual({ type: 'SCENE_HOTSPOTS', done: false, answeredAt: now.toISOString(), weight: weightOf(scene()), visited: ['h1', 'h2'], noted: ['h1'] });
    expect(entry.points).toBeUndefined();
    expect(notesAdded).toEqual(['scena.h1']);
  });

  it('przedmiot sceny zagnieżdżonej i jego dowód', () => {
    const { entry, notesAdded } = explore(['h4', 'h4-outlook'], ['h4-outlook']);
    expect(entry.visited).toEqual(['h4', 'h4-outlook']);
    expect(notesAdded).toEqual(['scena.h4-outlook']);
  });

  it('stan tylko rośnie: suma z poprzednim zapisem, w kolejności przedmiotów z treści; spóźnione żądanie niczego nie cofa', () => {
    const first = explore(['h2', 'h1'], ['h1']).entry;
    const second = explore(['h3'], [], first);
    expect(second.entry.visited).toEqual(['h1', 'h2', 'h3']);
    expect(second.entry.noted).toEqual(['h1']);
    expect(second.notesAdded).toEqual(['scena.h1']);
    // Puste żądanie (np. powtórzone po błędzie sieci) zostawia stan.
    expect(explore([], [], second.entry).entry).toMatchObject({ visited: ['h1', 'h2', 'h3'], noted: ['h1'] });
  });

  it.each([
    ['nieznany przedmiot', ['h1', 'nie-ma'], []],
    ['powtórzony przedmiot', ['h1', 'h1'], []],
    ['dowód z nieobejrzanego przedmiotu', ['h2'], ['h1']],
    ['„dowód” z przedmiotu, który dowodem nie jest', ['h2'], ['h2']],
    ['powtórzony dowód', ['h1'], ['h1', 'h1']],
    ['nieznany dowód', ['h1'], ['nie-ma']],
  ])('%s - 400 bez treści bloku', (_name, visited, noted) => {
    expect(() => explore(visited as string[], noted as string[])).toThrow(BadRequestException);
    expect(() => explore(visited as string[], noted as string[])).toThrow('Brak lub nieprawidłowa odpowiedź dla tego bloku');
  });

  it('drzwi (action: next) nie są przedmiotem do obejrzenia', () => {
    const withDoor = { ...scene(), hotspots: [...(scene().hotspots as object[]), { id: 'drzwi', label: 'Wyjście', x: 1, y: 1, width: 5, height: 5, action: 'next' }] } as unknown as Block;
    expect(() => evaluateExploration(withDoor, { visited: ['drzwi'], noted: [] }, undefined, now)).toThrow(BadRequestException);
    expect(evaluateExploration(withDoor, { visited: ['h1'], noted: [] }, undefined, now).entry.visited).toEqual(['h1']);
  });

  it('tylko scena: inny typ bloku odrzucony', () => {
    const dialogue = fullBlocks().DIALOGUE as unknown as Block;
    expect(() => evaluateExploration(dialogue, { visited: [], noted: [] }, undefined, now)).toThrow('Ten blok nie zapisuje stanu częściowego');
  });

  it('ukończony wpis bloku nie jest zastępowany stanem częściowym (punkty i wyróżnienia zostają)', () => {
    const done = { type: 'SCENE_HOTSPOTS', done: true, answeredAt: now.toISOString(), weight: 0, easterEggs: ['h4-gra'] } as unknown as BlockEntry;
    expect(() => explore(['h1'], [], done)).toThrow('Ten blok jest już ukończony');
  });

  it('uszkodzony poprzedni wpis (postęp z bazy) nie wywala zapisu', () => {
    const broken = { type: 'SCENE_HOTSPOTS', done: false, answeredAt: 'x', weight: 0, visited: 'h1', noted: [1, null, 'h1'] } as unknown as BlockEntry;
    // `noted` z poprzedniego wpisu bez obejrzenia przedmiotu nie przechodzi (dowód tylko z obejrzanego przedmiotu).
    expect(explore(['h2'], [], broken).entry).toMatchObject({ visited: ['h2'], noted: [] });
  });

  it('easter egg: obejrzenie zapisuje tylko stan - wyróżnienie nadaje dopiero zapis bloku', () => {
    const { entry } = explore(['h4', 'h4-gra'], []);
    expect(entry.visited).toEqual(['h4', 'h4-gra']);
    expect(entry.easterEggs).toBeUndefined();
  });
});

describe('stan częściowy w postępie', () => {
  const progressWith = (entry: BlockEntry, notes: string[]): ProgressV2 => ({ v: 2, blocks: { scena: entry }, notes });

  it('widok postępu (/start): obejrzane i zabrane nieukończonej sceny, notatka i licznik dowodów; blok nadal nieukończony', () => {
    const { entry, notesAdded } = explore(['h1', 'h4', 'h4-outlook'], ['h1']);
    const progress = progressWith(entry, notesAdded);
    const view = clientProgress(progress, all(), opaque);
    expect(view.blocks.scena).toEqual({ type: 'SCENE_HOTSPOTS', done: false, exploration: { visited: ['h1', 'h4', 'h4-outlook'], noted: ['h1'] } });
    expect(view.notes).toEqual([expect.objectContaining({ blockId: 'scena', text: 'Hasło na kartce przy monitorze.' })]);
    expect(evidenceSummary(progress, all()).perBlock.find((b) => b.blockId === 'scena')).toEqual({ blockId: 'scena', collected: 1, total: 2 });
    // Nieukończony blok nie wchodzi do wyniku.
    expect(computeScore(progress)).toBeNull();
  });

  it('widok postępu pomija id, których nie ma już w treści bloku, i nie pokazuje pustego stanu', () => {
    const stale = { type: 'SCENE_HOTSPOTS', done: false, answeredAt: now.toISOString(), weight: 0, visited: ['usuniety', 'h2'], noted: ['usuniety'] } as BlockEntry;
    expect((clientProgress(progressWith(stale, []), all(), opaque).blocks.scena as { exploration?: unknown }).exploration).toEqual({ visited: ['h2'], noted: [] });
    const empty = { ...stale, visited: [], noted: [] };
    expect(clientProgress(progressWith(empty, []), all(), opaque).blocks.scena).toEqual({ type: 'SCENE_HOTSPOTS', done: false });
  });

  it('zapis bloku („Dalej”) zastępuje stan częściowy zwykłym wpisem ukończenia; notatki się nie dublują', () => {
    const partial = explore(['h1'], ['h1']);
    const done = evaluateSubmit(scene(), { visited: ['h1', 'h4', 'h4-outlook'], noted: ['h1', 'h4-outlook'] }, partial.entry, now, opaque);
    expect(done.entry).toMatchObject({ type: 'SCENE_HOTSPOTS', done: true });
    expect(done.entry.visited).toBeUndefined();
    expect(done.entry.noted).toBeUndefined();
    expect(done.notesAdded).toEqual(['scena.h1', 'scena.h4-outlook']);
    // Ukończony blok nie ma już stanu częściowego w widoku.
    const view = clientProgress({ v: 2, blocks: { scena: done.entry }, notes: ['scena.h1', 'scena.h4-outlook'] }, all(), opaque);
    expect((view.blocks.scena as { exploration?: unknown }).exploration).toBeUndefined();
  });
});
