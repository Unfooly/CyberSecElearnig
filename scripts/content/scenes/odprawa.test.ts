import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composeScene } from './compose.js';
import { ODPRAWA_PROPS, PION_PROPS, PRZEGLADARKA_PROPS, ZAMKNIECIE_PROPS } from './props-odprawa.js';
import { PROPS } from './props.js';
import type { SceneSpec } from './types.js';

// Sceny modułu 1 (scenes/, miniatura w assets/) to WYNIK kompozytora ze źródeł examples/*.json - build ze źródła musi dać
// identyczny plik (inaczej ktoś poprawił SVG ręcznie albo zmienił klocek bez przebudowania scen) i identyczne *.hotspots.json.
// Współrzędne hotspotów/slotów odprawy w module.json (przepisane ręcznie) muszą być równe *.hotspots.json - osobny test niżej.
const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, 'examples');
const assets = join(here, '..', '..', '..', 'packages', 'content', 'modules', 'wyludzone-haslo', 'assets');
const scenes = readdirSync(examples)
  .filter((file) => file.endsWith('.json') && !file.endsWith('.hotspots.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const build = (name: string) => composeScene(JSON.parse(readFileSync(join(examples, `${name}.json`), 'utf8')) as SceneSpec);
const svgPath = (name: string) => (existsSync(join(assets, 'scenes', `${name}.svg`)) ? join(assets, 'scenes', `${name}.svg`) : join(assets, `${name}.svg`));

describe('sceny modułu 1 z kompozytora', () => {
  it('klocki odprawy, zamknięcia sprawy i przeglądarki są zarejestrowane w PROPS kompozytora', () => {
    for (const name of Object.keys(ODPRAWA_PROPS)) expect(PROPS[name], name).toBe(ODPRAWA_PROPS[name as keyof typeof ODPRAWA_PROPS]);
    for (const name of Object.keys(ZAMKNIECIE_PROPS)) expect(PROPS[name], name).toBe(ZAMKNIECIE_PROPS[name as keyof typeof ZAMKNIECIE_PROPS]);
    for (const name of Object.keys(PRZEGLADARKA_PROPS)) expect(PROPS[name], name).toBe(PRZEGLADARKA_PROPS[name as keyof typeof PRZEGLADARKA_PROPS]);
    for (const name of Object.keys(PION_PROPS)) expect(PROPS[name], name).toBe(PION_PROPS[name as keyof typeof PION_PROPS]);
  });

  it('D-098: stackedHalves - czytelny błąd dla nieznanego klocka i samego siebie (zamiast "is not a function"/pętli)', () => {
    expect(() => PROPS.stackedHalves({ prop: 'nieMaTakiego' })).toThrow(/Nieznany klocek "nieMaTakiego"/);
    expect(() => PROPS.stackedHalves({ prop: 'stackedHalves' })).toThrow(/nie może składać samego siebie/);
  });

  it('każde źródło ma swoją scenę w module (11 scen modułu, 5 odprawy + 5 pionowych, 3 zamknięcia sprawy + 1 pionowa, miniatura)', () => {
    expect(scenes).toHaveLength(26);
    for (const name of scenes) expect(existsSync(svgPath(name)), name).toBe(true);
  });

  it.each(scenes)('%s: build ze źródła daje identyczne SVG i hotspoty', (name) => {
    const res = build(name);
    expect(res.svg).toBe(lf(readFileSync(svgPath(name), 'utf8')));
    const hotspotsFile = join(examples, `${name}.hotspots.json`);
    expect(res.hotspots).toEqual(existsSync(hotspotsFile) ? JSON.parse(readFileSync(hotspotsFile, 'utf8')) : []);
  });

  it('animacje: CSS w SVG, zatrzymywane przez reduced-motion i fragment #static (id="static" na <svg>), bez SMIL', () => {
    for (const name of scenes) {
      const svg = build(name).svg;
      expect(svg, name).toMatch(/^<svg [^>]*id="static"/);
      expect(svg, name).toContain('#static:target *{animation:none!important}');
      expect(svg, name).toContain('@media (prefers-reduced-motion: reduce){*{animation:none!important}}');
      expect(svg, name).not.toMatch(/<animate/);
    }
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

  it('module.json (scena pulpitu w monitorze) ma te same współrzędne hotspotów co pulpit.hotspots.json; „outlook” bez zmian', () => {
    const moduleJson = JSON.parse(readFileSync(join(assets, '..', 'module.json'), 'utf8'));
    const office = moduleJson.blocks.find((block: { id: string }) => block.id === 'biuro-anny');
    const desktop = office.hotspots.find((h: { id: string }) => h.id === 'monitor').media.scene.hotspots as Record<string, unknown>[];
    const built = JSON.parse(readFileSync(join(examples, 'pulpit.hotspots.json'), 'utf8')) as Record<string, number | string>[];
    // Pozycja ikony Poczty sprzed dodania przeglądarki - nowa ikona nie może jej przesunąć.
    expect(built.find((h) => h.id === 'outlook')).toEqual({ id: 'outlook', x: 4.2, y: 5, w: 17.7, h: 28.1 });
    for (const b of built) {
      const inModule = desktop.find((h) => h.id === b.id);
      expect(inModule, String(b.id)).toBeDefined();
      expect({ x: inModule!.x, y: inModule!.y, w: inModule!.width, h: inModule!.height }, String(b.id)).toEqual({ x: b.x, y: b.y, w: b.w, h: b.h });
    }
  });

  it('SVG scen nie zawiera skryptów, zdarzeń ani odwołań zewnętrznych', () => {
    for (const name of scenes) {
      expect(build(name).svg, name).not.toMatch(/<script|\son\w+=|href=|foreignObject|javascript:|@import|url\((?!#)/i);
    }
  });
});
