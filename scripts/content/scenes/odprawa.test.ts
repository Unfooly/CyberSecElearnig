import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composeScene } from './compose.js';
import { ODPRAWA_PROPS } from './props-odprawa.js';
import { PROPS } from './props.js';
import type { SceneSpec } from './types.js';

// Sceny odprawy (BRIEFING, feat/briefing-scenes): SVG w module i *.hotspots.json to WYNIK kompozytora ze źródeł JSON -
// build ze źródła musi dać identyczny plik (inaczej ktoś poprawił SVG ręcznie albo zmienił klocek bez przebudowania scen), a
// współrzędne hotspotów/slotów w module.json (przepisane ręcznie) muszą być równe *.hotspots.json - osobny test niżej.
const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, 'examples');
const assets = join(here, '..', '..', '..', 'packages', 'content', 'modules', 'wyludzone-haslo', 'assets', 'scenes');
const scenes = readdirSync(examples)
  .filter((file) => /^odprawa-[a-z-]+\.json$/.test(file) && !file.endsWith('.hotspots.json'))
  .map((file) => file.replace(/\.json$/, ''));
const lf = (s: string) => s.replace(/\r\n/g, '\n');

describe('sceny odprawy (props-odprawa.ts)', () => {
  it('klocki odprawy są zarejestrowane w PROPS kompozytora', () => {
    for (const name of Object.keys(ODPRAWA_PROPS)) expect(PROPS[name], name).toBe(ODPRAWA_PROPS[name as keyof typeof ODPRAWA_PROPS]);
  });

  it('jest sześć scen odprawy', () => {
    expect(scenes.sort()).toEqual([
      'odprawa-akta',
      'odprawa-biurko',
      'odprawa-biurko-static',
      'odprawa-legitymacja',
      'odprawa-rozmowa',
      'odprawa-teczka',
    ]);
  });

  it.each(scenes)('%s: build ze źródła daje identyczne SVG i hotspoty', (name) => {
    const spec = JSON.parse(readFileSync(join(examples, `${name}.json`), 'utf8')) as SceneSpec;
    const res = composeScene(spec);
    expect(res.svg).toBe(lf(readFileSync(join(assets, `${name}.svg`), 'utf8')));
    expect(res.hotspots).toEqual(JSON.parse(readFileSync(join(examples, `${name}.hotspots.json`), 'utf8')));
  });

  it('wersja statyczna biurka nie ma animacji SMIL, animowana ma', () => {
    const build = (name: string) => composeScene(JSON.parse(readFileSync(join(examples, `${name}.json`), 'utf8')) as SceneSpec).svg;
    expect(build('odprawa-biurko-static')).not.toMatch(/<animate/);
    expect(build('odprawa-biurko')).toMatch(/<animate/);
  });

  it('module.json (blok odprawa) ma te same współrzędne hotspotów i slotów co *.hotspots.json kompozytora', () => {
    const moduleJson = JSON.parse(readFileSync(join(assets, '..', '..', 'module.json'), 'utf8'));
    const steps = moduleJson.blocks.find((block: { id: string }) => block.id === 'odprawa').steps as Record<string, any>[];
    const hotspot = (scene: string, id: string) => {
      const found = (JSON.parse(readFileSync(join(examples, `${scene}.hotspots.json`), 'utf8')) as { id: string }[]).find((h) => h.id === id);
      if (!found) throw new Error(`${scene}: brak ${id}`);
      const { x, y, w, h } = found as unknown as Record<string, number>;
      return { x, y, w, h };
    };
    const byKind = (kind: string) => steps.find((step) => step.kind === kind)!;
    expect(byKind('typewriter').hotspot).toEqual({ id: 'telefon', ...hotspot('odprawa-biurko', 'telefon') });
    expect(hotspot('odprawa-biurko-static', 'telefon')).toEqual(hotspot('odprawa-biurko', 'telefon'));
    expect(byKind('caseFile').hotspot).toEqual({ id: 'teczka', ...hotspot('odprawa-teczka', 'teczka') });
    expect(byKind('caseFile').slots).toEqual({ tasks: hotspot('odprawa-akta', 'slot-zadania') });
    expect(byKind('badge').slots).toEqual({
      photo: hotspot('odprawa-legitymacja', 'slot-zdjecie'),
      name: hotspot('odprawa-legitymacja', 'slot-imie'),
      number: hotspot('odprawa-legitymacja', 'slot-numer'),
    });
  });

  it('SVG odprawy nie zawiera skryptów, zdarzeń ani odwołań zewnętrznych', () => {
    for (const name of scenes) {
      const svg = composeScene(JSON.parse(readFileSync(join(examples, `${name}.json`), 'utf8')) as SceneSpec).svg;
      expect(svg, name).not.toMatch(/<script|\son\w+=|href=|foreignObject|javascript:/i);
    }
  });
});
