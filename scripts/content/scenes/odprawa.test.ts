import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composeScene, composeSceneLocales, SCENE_LOCALES, sceneLocales } from './compose.js';
import { EKRAN_PROPS, KEYART_PROPS, ODPRAWA_PROPS, PION_OKNA_PROPS, PION_PROPS, PRZEGLADARKA_PROPS, TROFEA_PROPS, ZAMKNIECIE_PROPS } from './props-odprawa.js';
import { HELPDESK_PROPS } from './props-helpdesk.js';
import { PROPS } from './props.js';
import type { SceneLocale, SceneSpec } from './types.js';

// Grafiki modułów i trofea to WYNIK kompozytora ze źródeł scenes/examples/<cel>/*.json (B-128: jeden katalog na cel, dowolny moduł) -
// build ze źródła musi dać identyczny plik (inaczej ktoś poprawił SVG ręcznie albo zmienił klocek bez przebudowania scen) i identyczne
// *.hotspots.json. Cel = slug modułu (packages/content/modules/<slug>: scenes/ albo assets/, np. miniatura) albo `achievements`
// (trofea osiągnięć - globalne, statyczne pliki aplikacji web). Nowy moduł: katalog examples/<slug>/ - test obejmuje go sam.
// Współrzędne hotspotów/slotów odprawy w module.json modułu 1 (przepisane ręcznie) muszą być równe *.hotspots.json - osobne testy niżej.
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const examplesRoot = join(here, 'examples');
const modulesRoot = join(repo, 'packages', 'content', 'modules');
const achievements = join(repo, 'apps', 'web', 'public', 'achievements');
// Grafika og:image serwisu (D-126): statyczny plik aplikacji web; PNG obok powstaje z tego SVG (scripts/render-og-image.mjs).
const og = join(repo, 'apps', 'web', 'public', 'og');
const STATIC_TARGETS: Record<string, string> = { achievements, og };
const targets = readdirSync(examplesRoot).filter((dir) => statSync(join(examplesRoot, dir)).isDirectory()).sort();
/** Katalogi wyników celu: moduł - assets/scenes i assets (miniatura); trofea - public/achievements; og - public/og. */
const outputDirs = (target: string) =>
  STATIC_TARGETS[target] ? [STATIC_TARGETS[target]] : [join(modulesRoot, target, 'assets', 'scenes'), join(modulesRoot, target, 'assets')];
interface Source {
  target: string;
  name: string;
}
const sources: Source[] = targets.flatMap((target) =>
  readdirSync(join(examplesRoot, target))
    .filter((file) => file.endsWith('.json') && !file.endsWith('.hotspots.json'))
    .map((file) => ({ target, name: file.replace(/\.json$/, '') }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);
const label = (source: Source) => `${source.target}/${source.name}`;
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const specOf = (source: Source) => JSON.parse(readFileSync(join(examplesRoot, source.target, `${source.name}.json`), 'utf8')) as SceneSpec;
/** Wszystkie wyniki źródła: jeden, a dla sceny ze `strings` (D-135) - jeden na język. */
const buildAll = (source: Source) => composeSceneLocales(specOf(source), source.name);
const svgPath = (source: Source) =>
  outputDirs(source.target).map((dir) => join(dir, `${source.name}.svg`)).find((file) => existsSync(file)) ?? join(outputDirs(source.target)[0], `${source.name}.svg`);
/** Plik wyniku: scena ze `strings` - <katalog celu>/<język>/<nazwa>.svg (jak cli.ts build). */
const resultPath = (source: Source, locale?: SceneLocale) => (locale ? join(outputDirs(source.target)[0], locale, `${source.name}.svg`) : svgPath(source));

// Moduł 1 - testy współrzędnych (module.json vs *.hotspots.json).
const examples = join(examplesRoot, 'wyludzone-haslo');
const assets = join(modulesRoot, 'wyludzone-haslo', 'assets');

describe('sceny z kompozytora (każdy moduł i trofea)', () => {
  it('cele w scenes/examples: moduły z packages/content/modules albo cele statyczne (achievements, og)', () => {
    expect(targets).toContain('wyludzone-haslo');
    expect(targets).toContain('achievements');
    for (const target of targets) expect(target in STATIC_TARGETS || existsSync(join(modulesRoot, target, 'module.json')), target).toBe(true);
  });

  it('og:image serwisu (D-126): jedyny tekst to nazwa i podtytuł; klocki `wordless` nie mają napisów', () => {
    const spec = JSON.parse(readFileSync(join(examplesRoot, 'og', 'og-unfooly.json'), 'utf8')) as SceneSpec;
    // Napisy klocków PRZED zamianą na krzywe (D-135) - w gotowym SVG tekst jest już ścieżkami.
    const propSvg = spec.items.map((item) => PROPS[item.prop](item.params ?? {}).svg as string).join('');
    const texts = [...propSvg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
    expect(texts).toEqual(['Unfooly', 'Szkolenia z cyberbezpieczeństwa']);
    // Także tekst zagnieżdżony (np. <tspan>) - elementów <text> jest dokładnie tyle, ile napisów.
    expect(propSvg.match(/<text\b/g)).toHaveLength(2);
    const svg = composeScene(spec).svg;
    expect(svg).not.toMatch(/<text\b|<tspan\b/);
    expect(svg).toMatch(/viewBox="0 0 1200 630"/);
    expect(PROPS.caseFolderClosed({ wordless: true }).svg).not.toContain('<text');
    expect(PROPS.phoneTop({ state: 'ringing', wordless: true }).svg).not.toContain('<text');
    // Domyślnie (moduły) napisy zostają.
    expect(PROPS.caseFolderClosed({}).svg).toContain('AKTA SPRAWY');
    expect(PROPS.phoneTop({ state: 'ringing' }).svg).toContain('Odbierz');
  });

  // Kontrola „grafika bez źródła” obejmuje assets/scenes modułu (i public/achievements), nie korzeń assets/: tam leżą też avatary i
  // pliki spoza kompozytora (miniatura ma źródło, ale obok bywa podgląd PNG).
  it('każde źródło ma swój plik wynikowy (scena ze strings - w katalogu każdego języka); każda grafika w assets/scenes modułu i w public/achievements ma źródło (nic ręcznego)', () => {
    for (const source of sources) {
      const locales = sceneLocales(specOf(source));
      if (locales.length === 0) expect(existsSync(svgPath(source)), label(source)).toBe(true);
      for (const locale of locales) expect(existsSync(resultPath(source, locale)), `${label(source)} (${locale})`).toBe(true);
    }
    for (const target of targets) {
      const ofTarget = sources.filter((s) => s.target === target);
      const dir = outputDirs(target)[0];
      if (!existsSync(dir)) continue;
      const produced = new Set(ofTarget.filter((s) => sceneLocales(specOf(s)).length === 0).map((s) => `${s.name}.svg`));
      const orphans = readdirSync(dir).filter((file) => file.endsWith('.svg') && !produced.has(file));
      expect(orphans, `${target}: grafiki bez źródła w scenes/examples/${target}/`).toEqual([]);
      for (const locale of SCENE_LOCALES) {
        if (!existsSync(join(dir, locale))) continue;
        const localized = new Set(ofTarget.filter((s) => sceneLocales(specOf(s)).includes(locale)).map((s) => `${s.name}.svg`));
        const localeOrphans = readdirSync(join(dir, locale)).filter((file) => file.endsWith('.svg') && !localized.has(file));
        expect(localeOrphans, `${target}/${locale}: grafiki bez źródła ze "strings.${locale}"`).toEqual([]);
      }
    }
  });

  it.each(sources.map((source) => [label(source), source] as const))('%s: build ze źródła daje identyczne SVG (każdy język) i hotspoty', (_label, source) => {
    const results = buildAll(source);
    for (const res of results) expect(res.svg, res.locale).toBe(lf(readFileSync(resultPath(source, res.locale), 'utf8')));
    const hotspotsFile = join(examplesRoot, source.target, `${source.name}.hotspots.json`);
    expect(results[0].hotspots).toEqual(existsSync(hotspotsFile) ? JSON.parse(readFileSync(hotspotsFile, 'utf8')) : []);
  });

  it('animacje: CSS w SVG, zatrzymywane przez reduced-motion i fragment #static (id="static" na <svg>), bez SMIL', () => {
    for (const source of sources) {
      for (const { svg } of buildAll(source)) {
        expect(svg, label(source)).toMatch(/^<svg [^>]*id="static"/);
        expect(svg, label(source)).toContain('#static:target *{animation:none!important}');
        expect(svg, label(source)).toContain('@media (prefers-reduced-motion: reduce){*{animation:none!important}}');
        expect(svg, label(source)).not.toMatch(/<animate/);
      }
    }
  });

  it('SVG scen nie zawiera skryptów, zdarzeń ani odwołań zewnętrznych; cały tekst to krzywe (D-135: bez <text>, bez czcionek systemu)', () => {
    for (const source of sources) {
      for (const { svg } of buildAll(source)) {
        expect(svg, label(source)).not.toMatch(/<script|\son\w+=|href=|foreignObject|javascript:|@import|url\((?!#)/i);
        expect(svg, label(source)).not.toMatch(/<text\b|<tspan\b|font-family/);
      }
    }
  });
});

describe('sceny modułu 1 z kompozytora', () => {
  it('moduł 1: komplet źródeł (11 scen + 2 sceny w pionie + 2 okna w pionie, 5 odprawy + 5 pionowych, 3 zamknięcia sprawy + 1 pionowa, miniatura); trofea: moduł 1 - 3 × zdobyte/zablokowane, moduł 2 (D-124) - 3 × zdobyte/zablokowane + tajne zdobyte (zablokowane tajne - wspólna grafika)', () => {
    expect(sources.filter((s) => s.target === 'wyludzone-haslo')).toHaveLength(30);
    expect(sources.filter((s) => s.target === 'achievements')).toHaveLength(13);
  });

  it('klocki odprawy, zamknięcia sprawy i przeglądarki są zarejestrowane w PROPS kompozytora', () => {
    for (const name of Object.keys(ODPRAWA_PROPS)) expect(PROPS[name], name).toBe(ODPRAWA_PROPS[name as keyof typeof ODPRAWA_PROPS]);
    for (const name of Object.keys(ZAMKNIECIE_PROPS)) expect(PROPS[name], name).toBe(ZAMKNIECIE_PROPS[name as keyof typeof ZAMKNIECIE_PROPS]);
    for (const name of Object.keys(PRZEGLADARKA_PROPS)) expect(PROPS[name], name).toBe(PRZEGLADARKA_PROPS[name as keyof typeof PRZEGLADARKA_PROPS]);
    for (const name of Object.keys(PION_PROPS)) expect(PROPS[name], name).toBe(PION_PROPS[name as keyof typeof PION_PROPS]);
    for (const name of Object.keys(PION_OKNA_PROPS)) expect(PROPS[name], name).toBe(PION_OKNA_PROPS[name as keyof typeof PION_OKNA_PROPS]);
    for (const name of Object.keys(TROFEA_PROPS)) expect(PROPS[name], name).toBe(TROFEA_PROPS[name as keyof typeof TROFEA_PROPS]);
    for (const name of Object.keys(KEYART_PROPS)) expect(PROPS[name], name).toBe(KEYART_PROPS[name as keyof typeof KEYART_PROPS]);
  });

  it('trofea modułu 2 (grafik, trophyHelpdesk, D-124): zdobyte z nazwą, zablokowane bez nazwy; klocki HELPDESK_PROPS zarejestrowane', () => {
    for (const name of Object.keys(HELPDESK_PROPS)) expect(PROPS[name], name).toBe(HELPDESK_PROPS[name as keyof typeof HELPDESK_PROPS]);
    const svg = (kind: 'dead-air' | 'perfect-pitch' | 'full-transcript' | 'off-the-record', locked: boolean) =>
      PROPS.trophyHelpdesk({ kind, locked }).svg as string;
    for (const [kind, name, rank] of [
      ['dead-air', 'DEAD AIR', 'RARE'],
      ['perfect-pitch', 'PERFECT PITCH', 'RARE'],
      ['full-transcript', 'FULL TRANSCRIPT', 'LEGENDARY'],
      ['off-the-record', 'OFF THE RECORD', 'SECRET'],
    ] as const) {
      expect(svg(kind, false), kind).toContain(name);
      expect(svg(kind, false), kind).toContain(rank);
      expect(svg(kind, true), kind).not.toContain(name);
    }
    // Tajne zablokowane: „???” i SECRET zamiast nazwy; zwykłe zablokowane: LOCKED.
    expect(svg('off-the-record', true)).toContain('???');
    expect(svg('off-the-record', true)).toContain('SECRET');
    expect(svg('dead-air', true)).toContain('LOCKED');
  });

  it('PROPS: żadna grupa klocków nie nadpisuje innego klocka (nazwy unikalne)', () => {
    const groups = [ODPRAWA_PROPS, ZAMKNIECIE_PROPS, PRZEGLADARKA_PROPS, PION_PROPS, EKRAN_PROPS, PION_OKNA_PROPS, TROFEA_PROPS, KEYART_PROPS, HELPDESK_PROPS];
    const groupNames = groups.flatMap((group) => Object.keys(group));
    expect(new Set(groupNames).size).toBe(groupNames.length);
    // 25 klocków podstawowych zdefiniowanych w props.ts (window…paper, textBox): razem z grupami każda nazwa dokładnie raz.
    expect(Object.keys(PROPS).length).toBe(25 + groupNames.length);
  });

  it('trophyBadge: wersja zablokowana nie zdradza nazwy (tajne: „???” i SECRET), zdobyta ma nazwę i rangę po angielsku', () => {
    const svg = (kind: 'curious' | 'perfect' | 'first', locked: boolean) => PROPS.trophyBadge({ kind, locked }).svg as string;
    expect(svg('curious', true)).toContain('???');
    expect(svg('curious', true)).not.toContain('CURIOUS DETECTIVE');
    expect(svg('perfect', true)).not.toContain('FLAWLESS CASE');
    expect(svg('first', true)).not.toContain('FIRST CASE CLOSED');
    expect(svg('curious', false)).toContain('CURIOUS DETECTIVE');
    expect(svg('perfect', false)).toContain('LEGENDARY');
    expect(svg('first', false)).toContain('FIRST CASE CLOSED');
  });

  it('D-104: reportPortrait (jeszcze bez sceny w module) renderuje się z domyślnymi parametrami i ma wszystkie sloty raportu', () => {
    const report = PROPS.reportPortrait({});
    expect(report.svg.length).toBeGreaterThan(0);
    expect(Object.keys(report.parts ?? {}).sort()).toEqual(['slot-czas', 'slot-dowody', 'slot-liscik', 'slot-pieczec', 'slot-podpis', 'slot-wnioski', 'slot-xp']);
  });

  it('D-098: stackedHalves - czytelny błąd dla nieznanego klocka i samego siebie (zamiast "is not a function"/pętli)', () => {
    expect(() => PROPS.stackedHalves({ prop: 'nieMaTakiego' })).toThrow(/Nieznany klocek "nieMaTakiego"/);
    expect(() => PROPS.stackedHalves({ prop: 'stackedHalves' })).toThrow(/nie może składać samego siebie/);
  });

  it('module.json (blok odprawa) ma te same współrzędne hotspotów i slotów co *.hotspots.json kompozytora', () => {
    const moduleJson = JSON.parse(readFileSync(join(assets, '..', 'module.json'), 'utf8'));
    const steps = moduleJson.blocks.find((block: { id: string }) => block.id === 'odprawa').steps as Record<string, any>[];
    const hotspot = (scene: string, id: string) => {
      const found = (JSON.parse(readFileSync(join(examples, `${scene}.hotspots.json`), 'utf8')) as Record<string, number | string>[]).find((h) => h.id === id);
      if (!found) throw new Error(`${scene}: brak ${id}`);
      const { x, y, w, h } = found as Record<string, number>;
      return { x, y, w, h };
    };
    const byKind = (kind: string) => steps.find((step) => step.kind === kind)!;
    expect(byKind('typewriter').hotspot).toEqual({ id: 'telefon', ...hotspot('odprawa-biurko', 'telefon') });
    expect(byKind('caseFile').hotspot).toEqual({ id: 'teczka', ...hotspot('odprawa-teczka', 'teczka') });
    expect(byKind('caseFile').slots).toEqual({ tasks: hotspot('odprawa-akta', 'slot-zadania') });
    expect(byKind('badge').slots).toEqual({
      photo: hotspot('odprawa-legitymacja', 'slot-zdjecie'),
      name: hotspot('odprawa-legitymacja', 'slot-imie'),
      number: hotspot('odprawa-legitymacja', 'slot-numer'),
    });
  });

  it('D-098: warianty pionowe w module.json (odprawa i raport zamknięcia) mają współrzędne z *-pion.hotspots.json kompozytora', () => {
    const moduleJson = JSON.parse(readFileSync(join(assets, '..', 'module.json'), 'utf8'));
    const steps = moduleJson.blocks.find((block: { id: string }) => block.id === 'odprawa').steps as Record<string, any>[];
    const rect = (scene: string, id: string) => {
      const found = (JSON.parse(readFileSync(join(examples, `${scene}.hotspots.json`), 'utf8')) as Record<string, number | string>[]).find((h) => h.id === id);
      if (!found) throw new Error(`${scene}: brak ${id}`);
      const { x, y, w, h } = found as Record<string, number>;
      return { x, y, w, h };
    };
    const byKind = (kind: string) => steps.find((step) => step.kind === kind)!.portrait;
    expect(byKind('typewriter').hotspot).toEqual({ id: 'telefon', ...rect('odprawa-biurko-pion', 'telefon') });
    expect(byKind('call').hotspot).toEqual({ id: 'rozlacz', ...rect('odprawa-rozmowa-pion', 'rozlacz') });
    expect(byKind('caseFile').hotspot).toEqual({ id: 'teczka', ...rect('odprawa-teczka-pion', 'teczka') });
    expect(byKind('caseFile').openHotspot).toEqual({ id: 'akta', ...rect('odprawa-akta-pion', 'akta') });
    expect(byKind('caseFile').slots).toEqual({ tasks: rect('odprawa-akta-pion', 'slot-zadania') });
    expect(byKind('badge').hotspot).toEqual({ id: 'legitymacja', ...rect('odprawa-legitymacja-pion', 'legitymacja') });
    expect(byKind('badge').slots).toEqual({
      photo: rect('odprawa-legitymacja-pion', 'slot-zdjecie'),
      name: rect('odprawa-legitymacja-pion', 'slot-imie'),
      number: rect('odprawa-legitymacja-pion', 'slot-numer'),
    });
    const closing = moduleJson.blocks.find((block: { type: string }) => block.type === 'SUMMARY').closing.portrait;
    const report = (id: string) => rect('zamkniecie-raport-pion', id);
    expect(closing.slots).toEqual({
      evidence: report('slot-dowody'),
      time: report('slot-czas'),
      xp: report('slot-xp'),
      lessons: report('slot-wnioski'),
      signature: report('podpis'),
      stamp: report('slot-pieczec'),
      note: report('slot-liscik'),
    });
  });

  it('D-116: warianty pionowe scen (korytarz, biuro-anny) w module.json mają prostokąty z *-pion.hotspots.json kompozytora, te same id co scena pozioma', () => {
    const moduleJson = JSON.parse(readFileSync(join(assets, '..', 'module.json'), 'utf8'));
    for (const scene of ['korytarz', 'biuro-anny']) {
      const block = moduleJson.blocks.find((b: { id: string }) => b.id === scene);
      const built = JSON.parse(readFileSync(join(examples, `${scene}-pion.hotspots.json`), 'utf8')) as { id: string; x: number; y: number; w: number; h: number }[];
      const expected = built.map(({ id, x, y, w, h }) => ({ id, x, y, width: w, height: h }));
      const byId = (list: { id: string }[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
      expect(byId(block.portraitHotspots), scene).toEqual(byId(expected));
      expect(block.portraitHotspots.map((h: { id: string }) => h.id).sort(), scene).toEqual(block.hotspots.map((h: { id: string }) => h.id).sort());
    }
  });

  it('module.json (scena pulpitu w monitorze) ma te same współrzędne hotspotów co pulpit.hotspots.json; „outlook” i „przegladarka” bez zmian, „gra” nowa', () => {
    const moduleJson = JSON.parse(readFileSync(join(assets, '..', 'module.json'), 'utf8'));
    const office = moduleJson.blocks.find((block: { id: string }) => block.id === 'biuro-anny');
    const desktop = office.hotspots.find((h: { id: string }) => h.id === 'monitor').media.scene.hotspots as Record<string, unknown>[];
    const built = JSON.parse(readFileSync(join(examples, 'pulpit.hotspots.json'), 'utf8')) as Record<string, number | string>[];
    // Pozycje ikon po owinięciu pulpitu ramką monitora (D-101, wrap-in-monitor.ts) - nowa ikona nie może ich przesunąć.
    expect(built.find((h) => h.id === 'outlook')).toEqual({ id: 'outlook', x: 8.1, y: 9.6, w: 15.9, h: 22 });
    expect(built.find((h) => h.id === 'przegladarka')).toEqual({ id: 'przegladarka', x: 8.3, y: 31.3, w: 15.6, h: 21.6 });
    expect(built.find((h) => h.id === 'gra')).toEqual({ id: 'gra', x: 26.3, y: 31.3, w: 15.6, h: 21.6 });
    for (const b of built.filter((h) => !String(h.id).startsWith('slot-'))) {
      const inModule = desktop.find((h) => h.id === b.id);
      expect(inModule, String(b.id)).toBeDefined();
      expect({ x: inModule!.x, y: inModule!.y, w: inModule!.width, h: inModule!.height }, String(b.id)).toEqual({ x: b.x, y: b.y, w: b.w, h: b.h });
    }
    // D-116: ekran monitora (okienka easter egga tylko w nim) = slot-ekran kompozytora (wnętrze ramki screenFrame).
    const slot = built.find((h) => h.id === 'slot-ekran')!;
    expect(office.hotspots.find((h: { id: string }) => h.id === 'monitor').media.scene.screen).toEqual({ x: slot.x, y: slot.y, w: slot.w, h: slot.h });
  });
});
