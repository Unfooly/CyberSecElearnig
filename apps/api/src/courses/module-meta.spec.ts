import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { loadModuleMeta, moduleMetaFor, setModuleMetaCacheForTests } from './module-meta';

describe('module-meta (ekran startu modułu, D-163)', () => {
  let dir: string;
  const write = (folder: string, content: unknown) => {
    mkdirSync(path.join(dir, folder), { recursive: true });
    writeFileSync(path.join(dir, folder, 'module.json'), typeof content === 'string' ? content : JSON.stringify(content));
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'module-meta-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    setModuleMetaCacheForTests(null);
  });

  it('czyta okładki, numer sprawy i podtytuł po slug z pliku; język treści wybiera wariant okładki i podtytułu', () => {
    write('sprawa', {
      slug: 'sprawa',
      caseNumber: 5,
      subtitle: { pl: 'Podtytuł', en: 'Subtitle' },
      startNotice: { pl: 'Najpierw moduł „Podstawy”.', en: 'Complete “Basics” first.' },
      cover: { start: { pl: 'assets/s/start.1.webp', en: 'assets/s/start-en.1.webp' }, end: 'assets/s/koniec.1.webp', startPortrait: 'assets/s/pion.1.webp' },
      blocks: [{ type: 'QUIZ', correctIndex: 1 }],
    });
    setModuleMetaCacheForTests(loadModuleMeta(dir));

    expect(moduleMetaFor('sprawa', 'pl')).toEqual({
      caseNumber: 5,
      subtitle: 'Podtytuł',
      notice: 'Najpierw moduł „Podstawy”.',
      cover: { start: 'assets/s/start.1.webp', end: 'assets/s/koniec.1.webp', startPortrait: 'assets/s/pion.1.webp', endPortrait: null },
    });
    expect(moduleMetaFor('sprawa', 'en')).toMatchObject({ subtitle: 'Subtitle', notice: 'Complete “Basics” first.', cover: { start: 'assets/s/start-en.1.webp' } });
  });

  it('za długa uwaga startu (D-171) odrzuca cały wpis - jak niepoprawna okładka', () => {
    write('dluga-uwaga', { slug: 'dluga-uwaga', startNotice: 'x'.repeat(201) });
    expect(loadModuleMeta(dir).has('dluga-uwaga')).toBe(false);
  });

  it('w pamięci zostają WYŁĄCZNIE pola ekranu startu - bloki z kluczem odpowiedzi nie są przechowywane', () => {
    write('sprawa', { slug: 'sprawa', caseNumber: 1, blocks: [{ type: 'QUIZ', correctIndex: 1 }], thumbnail: 'x.svg' });
    const stored = loadModuleMeta(dir).get('sprawa');
    expect(stored).toEqual({ slug: 'sprawa', caseNumber: 1 });
  });

  it('moduł bez okładki, nieznany slug, uszkodzony plik i katalog bez module.json - same null, bez wyjątku', () => {
    write('bez-okladki', { slug: 'bez-okladki' });
    write('zepsuty', '{nie json');
    write('zla-okladka', { slug: 'zla-okladka', cover: { start: 'https://evil.example/x.webp', end: 'b.webp' } });
    mkdirSync(path.join(dir, 'wspolne'));
    const loaded = loadModuleMeta(dir);
    setModuleMetaCacheForTests(loaded);

    expect(moduleMetaFor('bez-okladki', 'pl')).toEqual({ cover: null, caseNumber: null, subtitle: null, notice: null });
    expect(moduleMetaFor('nie-ma', 'pl')).toEqual({ cover: null, caseNumber: null, subtitle: null, notice: null });
    // Niepoprawna okładka (adres zewnętrzny) odrzuca cały wpis - nigdy nie trafia do klienta.
    expect(loaded.has('zla-okladka')).toBe(false);
    expect(loaded.size).toBe(1);
  });

  it('powtórzony slug w dwóch katalogach - zostaje pierwszy (kolejność katalogów), drugi pominięty', () => {
    write('a-pierwszy', { slug: 'sprawa', caseNumber: 1 });
    write('b-drugi', { slug: 'sprawa', caseNumber: 2 });
    expect(loadModuleMeta(dir).get('sprawa')?.caseNumber).toBe(1);
  });

  it('brak katalogu modułów - pusta mapa', () => {
    expect(loadModuleMeta(path.join(dir, 'nie-ma')).size).toBe(0);
  });

  it('domyślny katalog to packages/content/modules (jak content-import) - moduły repo mają wpisy', () => {
    const loaded = loadModuleMeta();
    expect(loaded.has('najlatwiejsze-drzwi')).toBe(true);
    expect(loaded.has('wyludzone-haslo')).toBe(true);
  });
});
