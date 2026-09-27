// Render filmu Unfooly do MP4 (1920x1080, 30 fps) z unfooly-film.html.
// Uzycie (z katalogu repo): node docs/marketing/film/render-film.mjs [--out <plik.mp4>] [--fps 30]
// Wymaga: playwright (jest w repo), ffmpeg w PATH albo pakiet ffmpeg-static.
// Font Plus Jakarta Sans laduje sie z Google Fonts, wiec potrzebny jest internet.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const fps = Number(arg('--fps', 30));
const out = resolve(arg('--out', join(here, 'out', 'unfooly-film.mp4')));
const frames = join(here, 'out', 'frames');
rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });

const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + readFileSync(join(here, 'unfooly-film.html'), 'utf8') + '</body></html>';
const tmp = join(here, 'out', '_render.html'); writeFileSync(tmp, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('file://' + tmp.replace(/\\/g, '/') + '?record');
await page.evaluate(() => document.fonts.ready);
// document.fonts.check() zwraca true takze wtedy, gdy fontu w ogole nie ma (pusty zbior pasujacych) - wiec ladujemy go jawnie i
// sprawdzamy, ze przegladarka faktycznie ma wczytana twarz Plus Jakarta Sans 800.
const ok = await page.evaluate(async () => (await document.fonts.load('800 40px "Plus Jakarta Sans"')).some((f) => /Plus Jakarta Sans/i.test(f.family) && f.status === 'loaded'));
if (!ok) {
  console.error('Brak fontu Plus Jakarta Sans (Google Fonts niedostepne?) — przerywam, zeby nie renderowac z zastepczym fontem.');
  await browser.close();
  rmSync(tmp, { force: true });
  process.exit(1);
}
const T = await page.evaluate(() => window.__duration);
const n = Math.round(T * fps);
for (let i = 0; i < n; i++) {
  await page.evaluate(t => window.__render(t), i / fps);
  await page.screenshot({ path: join(frames, String(i).padStart(5, '0') + '.png') });
  if (i % fps === 0) process.stdout.write(`\r${Math.round(i / n * 100)}%`);
}
await browser.close();

let ff = 'ffmpeg';
if (spawnSync(ff, ['-version']).status !== 0) {
  try { ff = (await import('ffmpeg-static')).default; } catch { console.error('\nBrak ffmpeg (PATH) i pakietu ffmpeg-static.'); process.exit(1); }
}
mkdirSync(dirname(out), { recursive: true });
const r = spawnSync(ff, ['-y', '-framerate', String(fps), '-i', join(frames, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
// plakat do <video poster>: klatka z planszy koncowej (logo), 1,5 s przed koncem filmu
const posterFrame = Math.max(0, Math.min(n - 1, Math.round((T - 1.5) * fps)));
const p = spawnSync(ff, ['-y', '-i', join(frames, String(posterFrame).padStart(5, '0') + '.png'), '-frames:v', '1', '-update', '1', '-q:v', '3', out.replace(/\.mp4$/, '-poster.jpg')], { stdio: 'inherit' });
if (p.status !== 0) { console.error('\nNie udalo sie zapisac plakatu.'); process.exit(p.status ?? 1); }
rmSync(frames, { recursive: true, force: true }); rmSync(tmp, { force: true });
console.log('\nGotowe:', out);
