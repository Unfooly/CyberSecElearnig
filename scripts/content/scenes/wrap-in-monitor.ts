/**
 * Owija scenę „ekranową” (pulpit, okno aplikacji na monitorze) w ramkę monitora z przezroczystym tłem (D-101) - przekształcenie
 * `wrapInMonitor` (scene-tools.ts). Tapeta = dotychczasowy kolor tła sceny; wszystkie elementy przesuwają się o (PAD + bezel), hotspoty
 * przeliczą się przy buildzie. Idempotentne: scena już owinięta (element „ramka-ekranu”) jest pomijana.
 * Uruchom z katalogu scripts/content:  npx tsx scenes/wrap-in-monitor.ts scenes/examples <scena1> [scena2 ...]
 * Potem build do assets, przeliczenie hotspotów w module.json (współrzędne z *.hotspots.json) i publikacja --assets.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME_ID, wrapInMonitor } from './scene-tools.js';
import type { SceneSpec } from './types.js';

const [dir, ...names] = process.argv.slice(2);
if (!dir || names.length === 0) {
  console.error('Użycie: npx tsx scenes/wrap-in-monitor.ts <katalog-examples> <scena> [scena ...]');
  process.exit(1);
}

for (const n of names) {
  const p = join(dir, n.endsWith('.json') ? n : `${n}.json`);
  try {
    const spec = JSON.parse(readFileSync(p, 'utf8')) as SceneSpec;
    if (spec.items.some((item) => item.id === FRAME_ID)) {
      console.log(`${n}: już owinięta`);
      continue;
    }
    const d = wrapInMonitor(spec);
    writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
    console.log(`${n}: ${d.width}×${d.height}, ramka monitora, tło przezroczyste`);
  } catch (error) {
    console.error(`${n}: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
