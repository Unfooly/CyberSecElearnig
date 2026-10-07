import { CourseVersion } from '@prisma/client';
import { toResolved } from './course-versions';

// Język treści wersji (D-133): język gracza, jeśli wersja go ma (`locales`), inaczej `pl` z flagą plakietki; tytuł w języku treści.

const blocks = [{ id: 'wstep', type: 'NARRATIVE', text: { pl: 'Dzień dobry.', en: 'Good morning.' } }];

function version(overrides: Partial<CourseVersion> = {}): CourseVersion {
  return {
    id: 'v1',
    courseId: 'c1',
    version: 1,
    schemaVersion: 6,
    contentHash: 'x',
    contentBlocks: blocks,
    blockCount: 1,
    simpleMode: false,
    locales: ['pl', 'en'],
    title: { pl: 'Łańcuszek', en: 'The chain' },
    createdAt: new Date(0),
    ...overrides,
  } as CourseVersion;
}

describe('toResolved: język treści (D-133)', () => {
  it('gracz EN, kurs z EN - treść i tytuł po angielsku, bez plakietki', () => {
    const resolved = toResolved(version(), 'en');
    expect(resolved).toMatchObject({ locale: 'en', localeFallback: false, locales: ['pl', 'en'], title: 'The chain' });
    expect(resolved.blocks[0].text).toBe('Good morning.');
  });

  it('gracz EN, kurs tylko PL - całość po polsku z plakietką (nigdy mieszanka, także przy częściowym tłumaczeniu pól)', () => {
    const resolved = toResolved(version({ locales: ['pl'] }), 'en');
    expect(resolved).toMatchObject({ locale: 'pl', localeFallback: true, title: 'Łańcuszek' });
    expect(resolved.blocks[0].text).toBe('Dzień dobry.');
  });

  it('gracz PL - polski bez plakietki; bez języka gracza (gamifikacja) - polski; wersja sprzed D-133 (bez tytułu) - bez tytułu', () => {
    expect(toResolved(version({ locales: ['pl'] }), 'pl')).toMatchObject({ locale: 'pl', localeFallback: false });
    expect(toResolved(version())).toMatchObject({ locale: 'pl', localeFallback: false });
    expect(toResolved(version({ title: null }), 'en')).not.toHaveProperty('title');
  });

  it('języki spoza obsługiwanych w kolumnie są pomijane; `pl` zawsze dostępny', () => {
    expect(toResolved(version({ locales: ['de', 'en'] }), 'en').locales).toEqual(['pl', 'en']);
  });
});
