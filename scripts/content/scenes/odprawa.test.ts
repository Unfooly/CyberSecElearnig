import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composeScene } from './compose.js';
import { ODPRAWA_PROPS, ZAMKNIECIE_PROPS } from './props-odprawa.js';
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
  it('klocki odprawy i zamknięcia sprawy są zarejestrowane w PROPS kompozytora', () => {
    for (const name of Object.keys(ODPRAWA_PROPS)) expect(PROPS[name], name).toBe(ODPRAWA_PROPS[name as keyof typeof ODPRAWA_PROPS]);
    for (const name of Object.keys(ZAMKNIECIE_PROPS)) expect(PROPS[name], name).toBe(ZAMKNIECIE_PROPS[name as keyof typeof ZAMKNIECIE_PROPS]);
  });

  it('każde źródło ma swoją scenę w module (10 scen modułu z zbliżeniem tablicy, 5 odprawy, 3 zamknięcia sprawy, miniatura)', () => {
    expect(scenes).toHaveLength(19);
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

  it('SVG scen nie zawiera skryptów, zdarzeń ani odwołań zewnętrznych', () => {
    for (const name of scenes) {
      expect(build(name).svg, name).not.toMatch(/<script|\son\w+=|href=|foreignObject|javascript:|@import|url\((?!#)/i);
    }
  });
});
