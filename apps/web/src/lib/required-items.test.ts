import { describe, it, expect } from 'vitest';
import { requiredItemIds as original } from '@cyberszkolo/content';
import { requiredItemIds } from './required-items';

// Lustro reguły serwera: identyczny wynik na wszystkich kształtach wejścia.
describe('requiredItemIds: zgodność z packages/content', () => {
  const cases: [string, { id: string; required?: boolean }[], string[] | undefined][] = [
    ['bez required, bez listy', [{ id: 'a' }, { id: 'b' }], undefined],
    ['bez required, stara lista', [{ id: 'a' }, { id: 'b' }], ['b']],
    ['bez required, pusta stara lista (nic nie wymagane)', [{ id: 'a' }, { id: 'b' }], []],
    ['jawne required wygrywa ze starą listą', [{ id: 'a', required: false }, { id: 'b', required: true }], ['a']],
    ['required tylko na jednym elemencie: reszta opcjonalna', [{ id: 'a' }, { id: 'b', required: true }, { id: 'c' }], undefined],
    ['same required: false', [{ id: 'a', required: false }], undefined],
  ];
  it.each(cases)('%s', (_label, items, legacy) => {
    expect(requiredItemIds(items, legacy)).toEqual(original(items, legacy));
  });
});
