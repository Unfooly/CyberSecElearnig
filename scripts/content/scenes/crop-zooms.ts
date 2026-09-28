/**
 * Przezroczyste tło + ciasne kadrowanie zbliżeń przedmiotów (media image, D-101) - przekształcenie `cropZoom` (scene-tools.ts).
 * Zmienia TYLKO background, width/height oraz x/y jedynego elementu — treść zostaje nietknięta. Idempotentne.
 * Uruchom z katalogu scripts/content:  npx tsx scenes/crop-zooms.ts scenes/examples <plik1> <plik2> ...
 * Potem zwykły build tych scen do assets (cli.ts build ... --out <assets>/scenes) i publikacja --assets.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cropZoom } from './scene-tools.js';
import type { SceneSpec } from './types.js';

const [dir, ...names] = process.argv.slice(2);
if (!dir || names.length === 0) {
  console.error('Użycie: npx tsx scenes/crop-zooms.ts <katalog-examples> <scena> [scena ...]');
  process.exit(1);
}

for (const n of names) {
  const p = join(dir, n.endsWith('.json') ? n : `${n}.json`);
  try {
    const d = cropZoom(JSON.parse(readFileSync(p, 'utf8')) as SceneSpec);
    writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
    console.log(`${n}: ${d.width}×${d.height}, tło przezroczyste`);
  } catch (error) {
    // Pominięta scena nie może przejść niezauważona przy kilku plikach naraz - kod wyjścia != 0.
    console.error(`${n}: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
