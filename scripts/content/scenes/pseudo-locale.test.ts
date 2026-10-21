import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composePseudoScene, composeScene, validateScene } from './compose.js';
import { PSEUDO_EXPANSION, PSEUDO_LOCALE, pseudoLocalize, pseudoTable } from './pseudo-locale.js';
import type { SceneSpec } from './types.js';

// Pseudo-lokalizacja `xx` (D-143): każda scena ze `strings` we wszystkich celach (moduły, trofea) buduje się w `xx` z tymi samymi
// kontrolami co prawdziwy język - zanim powstanie EN. Sceny bez `strings` (moduły 1-2, tekst PL wpalony) nie mają kontroli dopasowania
// także w PL, więc `xx` ich nie dotyczy. Wynik tylko w pamięci.
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const examplesRoot = join(here, 'examples');
const targets = readdirSync(examplesRoot).filter((dir) => statSync(join(examplesRoot, dir)).isDirectory()).sort();
const scenes = targets.flatMap((target) =>
  readdirSync(join(examplesRoot, target))
    .filter((file) => file.endsWith('.json') && !file.endsWith('.hotspots.json'))
    .map((file) => ({ label: `${target}/${file.replace(/\.json$/, '')}`, spec: JSON.parse(readFileSync(join(examplesRoot, target, file), 'utf8')) as SceneSpec }))
    .filter(({ spec }) => spec.strings !== undefined),
);

/**
 * Sceny opublikowane przed D-143 ze slotem za ciasnym na tekst o 35% dłuższy (B-156): poprawka slotu zmienia też grafikę PL (nowa
 * publikacja assetów i wersja kursu), więc idzie osobnym PR. Wartość - element i slot z komunikatu błędu (pierwszy błąd sceny).
 */
const KNOWN_TOO_TIGHT: Record<string, string> = {
  'achievements/osiagniecie-pierwsza-sprawa': '"odznaka", język xx, slot "stampLabel"',
  'lancuszek/logowanie-zoom': '"tekst-adres", język xx, slot "text"',
  'lancuszek/odprawa': '"tekst-naglowek", język xx, slot "text"',
  'lancuszek/zamkniecie-pieczec': '"pieczec", język xx, slot "text"',
  'lancuszek/zamkniecie-raport-pion': '"raport", język xx, slot "evidence"',
  'lancuszek/zamkniecie-raport': '"raport", język xx, slot "signature"',
};

describe('pseudoLocalize (D-143)', () => {
  it('akcenty, nawiasy [ ] i sufiks ~ - tekst dłuższy o co najmniej 35%', () => {
    // 20 znaków -> 27 (135%): nawiasy, spacja i 4 tyldy; polskie litery zostają, łacińskie dostają akcenty.
    expect(pseudoLocalize('Łańcuszek przerwany.')).toBe('[Łáńçüšžék pržérwáñý. ~~~~]');
    expect(pseudoLocalize('SPRAWA')).toBe('[ŠPRÁWÁ ~~~]');
    for (const text of ['A', 'SPRAWA', 'Łańcuszek przerwany.', 'Nie klikaj w linki z nieznanych wiadomości, nawet od znajomych.']) {
      const result = pseudoLocalize(text);
      expect([...result].length).toBeGreaterThanOrEqual(Math.ceil([...text].length * (1 + PSEUDO_EXPANSION)));
      // Sufiks w słowach po najwyżej 5 tyld (żadne nierozerwalne długie słowo).
      expect(result).toMatch(/^\[.+ ~{1,5}(?: ~{1,5})*\]$/);
      expect(result).not.toMatch(/~{6}/);
    }
    // 43 znaki -> 13 tyld (59 = 135%) w słowach 5 + 5 + 3.
    expect(pseudoLocalize('Nie klikaj w linki z nieznanych wiadomości.')).toMatch(/ ~~~~~ ~~~~~ ~~~\]$/);
  });

  it('tekst bez języka (cyfry, „???”, „№ 1”, „100%”) bez zmian', () => {
    for (const text of ['100%', '7/7', '№ 1', '???', '12:30', '12 3XX XX 41']) expect(pseudoLocalize(text)).toBe(text);
  });

  it('tabela: listy napisów każdy osobno, klucze bez zmian', () => {
    expect(pseudoTable({ a: 'Tak', b: ['Raz', 'Dwa'] })).toEqual({ a: pseudoLocalize('Tak'), b: [pseudoLocalize('Raz'), pseudoLocalize('Dwa')] });
  });
});

describe('pseudo-lokalizacja scen (D-143)', () => {
  it('są sceny ze "strings" do sprawdzenia', () => {
    expect(scenes.length).toBeGreaterThan(0);
  });

  // Błąd = slot albo układ za ciasny na dłuższy przekład: poprawiamy klocek/scenę, NIE skracamy tekstu PL (decyzja właściciela 2026-10-16).
  it.each(scenes.filter((scene) => !KNOWN_TOO_TIGHT[scene.label]).map((scene) => [scene.label, scene.spec] as const))('%s mieści tekst w xx', (label, spec) => {
    expect(() => composePseudoScene(spec, label)).not.toThrow();
  });

  // Lista znanych za ciasnych slotów się nie rozrasta: wpis, który już przechodzi, trzeba usunąć (test pada), a nowa scena (moduł 4+)
  // nie może tu trafić bez decyzji - DoD od modułu 4: PL + pseudo-lokalizacja zielone.
  it.each(Object.entries(KNOWN_TOO_TIGHT))('%s - znany za ciasny slot (%s), nadal do poprawy', (label, slot) => {
    const scene = scenes.find((candidate) => candidate.label === label);
    expect(scene, `${label}: sceny nie ma - usuń wpis z KNOWN_TOO_TIGHT`).toBeDefined();
    expect(() => composePseudoScene(scene!.spec, label), `${label} mieści się w xx - usuń wpis z KNOWN_TOO_TIGHT`).toThrow(slot);
  });

  it('błąd w xx wskazuje scenę, element i język xx', () => {
    // Scena 364 px = skala 1 na telefonie (minimum 14 px): PL mieści się w jednej linii, dłuższy tekst xx już nie.
    const spec: SceneSpec = {
      width: 364,
      height: 60,
      background: { flat: true },
      strings: { pl: { t: 'Sprawdź nadawcę' } },
      items: [{ id: 'dymek', prop: 'textBox', x: 0, y: 0, params: { text: { $t: 't' }, w: 140, h: 30, size: 16, maxLines: 1 } }],
    };
    expect(() => composeScene(spec, { locale: 'pl', name: 'ciasna' })).not.toThrow();
    expect(() => composePseudoScene(spec, 'ciasna')).toThrow(/ciasna.*"dymek".*język xx/);
  });

  it('xx nie jest językiem źródła sceny ani plików wynikowych (nie trafia do repo ani R2)', () => {
    const spec = scenes[0].spec;
    expect(validateScene({ ...spec, strings: { ...spec.strings, [PSEUDO_LOCALE]: pseudoTable(spec.strings!.pl!) } } as SceneSpec)).toEqual(
      expect.arrayContaining([expect.stringContaining(`Nieznane języki w "strings": ${PSEUDO_LOCALE}`)]),
    );
    expect(() => composeScene(spec, { locale: PSEUDO_LOCALE as never })).toThrow();
    const outputs = [join(repo, 'apps', 'web', 'public', 'achievements'), ...readdirSync(join(repo, 'packages', 'content', 'modules')).map((slug) => join(repo, 'packages', 'content', 'modules', slug, 'assets', 'scenes'))];
    for (const dir of outputs) expect(existsSync(join(dir, PSEUDO_LOCALE))).toBe(false);
  });
});
