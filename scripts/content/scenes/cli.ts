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
if (modulePath && blockId) {
  const mod = JSON.parse(readFileSync(modulePath, 'utf8'));
  const block = (mod.blocks as any[]).find(b => b.id === blockId);
  if (!block || block.type !== 'SCENE_HOTSPOTS') throw new Error(`Blok ${blockId} nie istnieje albo nie jest SCENE_HOTSPOTS`);
  let targetHotspots: any[] = block.hotspots;
  if (nestedId) {
    const outer = (block.hotspots as any[]).find(h => h.id === nestedId);
    if (!outer || outer.media?.kind !== 'scene') throw new Error(`Hotspot "${nestedId}" nie istnieje w bloku ${blockId} albo nie ma media.kind:"scene"`);
    targetHotspots = outer.media.scene.hotspots;
  }
  const byId = new Map(res.hotspots.map(h => [h.id, h]));
  let patched = 0;
  for (const hs of targetHotspots) {
    const h = byId.get(hs.id);
    if (!h) throw new Error(`Hotspot "${hs.id}" z module.json nie istnieje w scenie`);
    // module.json (packages/content/src/blocks.ts) nazywa te pola "width"/"height", nie "w"/"h" jak Hotspot (types.ts).
    Object.assign(hs, { x: h.x, y: h.y, width: h.w, height: h.h });
    patched++;
  }
  writeFileSync(modulePath, JSON.stringify(mod, null, 2) + '\n');
  console.log(`Zaktualizowano ${patched} hotspotów w ${modulePath} (blok ${blockId}${nestedId ? `, zagnieżdżona scena "${nestedId}"` : ''})`);
}

console.log(`OK: ${name}.svg (${res.width}×${res.height}), hotspoty: ${res.hotspots.map(h => h.id).join(', ') || 'brak'}`);
