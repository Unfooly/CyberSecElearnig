// Renderuje grafikę og:image serwisu (D-126) z SVG kompozytora do PNG 1200×630 - boty podglądu linków nie obsługują SVG.
// Źródło: scripts/content/scenes/examples/og/og-unfooly.json -> apps/web/public/og/og-unfooly.svg (kompozytor, test odprawa.test.ts),
// wynik: apps/web/public/og/og-unfooly.png (statyczny plik aplikacji, bez magazynu treści). Po zmianie sceny, z katalogu repo:
//   (cd scripts/content && npx tsx scenes/cli.ts build scenes/examples/og/og-unfooly.json --out ../../apps/web/public/og)
//   node scripts/render-og-image.mjs
// Zrzut robi Chromium (Playwright) z `prefers-reduced-motion: reduce` - animacje klocków (klasy a-*) stoją, więc wynik jest powtarzalny.
// PNG jest potem zapisywany z paletą barw (sharp - zależność apps/api, dostępna z katalogu repo) - kilkukrotnie mniejszy plik; część komunikatorów pomija duże obrazy.
// Test pliku (wymiary, rozmiar): apps/web/src/lib/site-metadata.test.ts. Świeżości PNG względem SVG test nie sprawdza - to krok ręczny.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const WIDTH = 1200;
const HEIGHT = 630;
const dir = join(process.cwd(), 'apps', 'web', 'public', 'og');
const svg = readFileSync(join(dir, 'og-unfooly.svg'), 'utf8');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#C9AE8C">${svg}</body></html>`);
  const screenshot = await page.locator('svg').first().screenshot({ type: 'png' });
  const info = await sharp(screenshot).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toFile(join(dir, 'og-unfooly.png'));
  if (info.width !== WIDTH || info.height !== HEIGHT) throw new Error(`Zrzut ma ${info.width}×${info.height}, oczekiwane ${WIDTH}×${HEIGHT}.`);
  console.log(`OK: og-unfooly.png (${info.width}×${info.height}, ${Math.round(info.size / 1024)} KB)`);
} finally {
  await browser.close();
}
