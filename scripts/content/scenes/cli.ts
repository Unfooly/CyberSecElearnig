/**
 * Kompozytor scen: scena JSON → SVG + hotspots.json (+ opcjonalnie podmiana
 * współrzędnych hotspotów w module.json po id).
 *
 *   tsx src/cli.ts build <scena.json> --out <katalog>
 *     [--module <module.json> --block <blockId> [--nested <hotspotId>]] [--preview]
 *   tsx src/cli.ts props            # lista klocków
 *
 * --nested <hotspotId>: podmienia współrzędne WEWNĄTRZ zagnieżdżonej sceny (media.kind:
 * "scene") hotspotu <hotspotId> bloku --block, zamiast hotspotów najwyższego poziomu tego
 * bloku (B-086/D-071) - scena z pliku <scena.json> to wtedy zawartość media.scene, nie
 * scena głównego bloku.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { composeScene, previewHtml } from './compose.js';
import { patchHotspotCoords, resolveTargetHotspots, type ContentModuleLike } from './patch-module.js';
import { PROPS } from './props.js';
import type { SceneSpec } from './types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];

if (cmd === 'props') {
  console.log(Object.keys(PROPS).sort().join('\n'));
  process.exit(0);
}

if (cmd !== 'build') {
  console.error('Użycie: build <scena.json> --out <katalog> [--module <module.json> --block <blockId> [--nested <hotspotId>]] [--preview]');
  process.exit(2);
}

const sceneFile = process.argv[3];
const outDir = arg('--out') ?? '.';
const spec = JSON.parse(readFileSync(sceneFile, 'utf8')) as SceneSpec;
const res = composeScene(spec);
const name = basename(sceneFile).replace(/\.json$/, '');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${name}.svg`), res.svg);
writeFileSync(join(outDir, `${name}.hotspots.json`), JSON.stringify(res.hotspots, null, 2) + '\n');
if (process.argv.includes('--preview')) writeFileSync(join(outDir, `${name}.preview.html`), previewHtml(res, `${name}.svg`));

const modulePath = arg('--module');
const blockId = arg('--block');
const nestedId = arg('--nested');
if (nestedId && !(modulePath && blockId)) {
  console.error('--nested wymaga --module i --block.');
  process.exit(2);
}
if (modulePath && !blockId) {
  console.error('--module wymaga --block.');
  process.exit(2);
}
if (modulePath && blockId) {
  const mod = JSON.parse(readFileSync(modulePath, 'utf8')) as ContentModuleLike;
  const targetHotspots = resolveTargetHotspots(mod, blockId, nestedId);
  const patched = patchHotspotCoords(targetHotspots, res.hotspots);
  writeFileSync(modulePath, JSON.stringify(mod, null, 2) + '\n');
  console.log(`Zaktualizowano ${patched} hotspotów w ${modulePath} (blok ${blockId}${nestedId ? `, zagnieżdżona scena "${nestedId}"` : ''})`);
}

console.log(`OK: ${name}.svg (${res.width}×${res.height}), hotspoty: ${res.hotspots.map(h => h.id).join(', ') || 'brak'}`);
