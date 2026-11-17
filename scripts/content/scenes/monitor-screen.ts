// Wspólny monitor quizu (szablon modułu, D-164): prostokąt ekranu liczony AUTOMATYCZNIE z białego obszaru grafiki, nie wpisywany ręcznie.
// Nowa grafika od właściciela (docelowo 1920×1080) = jedno uruchomienie tego skryptu, który zapisuje manifest dla odtwarzacza i plik WebP:
//
//   npx tsx scenes/monitor-screen.ts            (źródło: scenes/monitor/monitor.png)
//
// Manifest: apps/web/src/lib/player-monitor.json ({ width, height, screen: { left, top, width, height } } w % obrazu, 2 miejsca po
// przecinku), obraz: apps/web/public/player/monitor.webp. Test (monitor-screen.test.ts) liczy prostokąt ze źródła jeszcze raz i porównuje
// z manifestem - podmiana grafiki bez ponownego uruchomienia skryptu wywala CI.
//
// Dekoder PNG własny (zlib z Node, bez zależności): RGBA/RGB 8 bitów bez przeplotu - tak eksportują narzędzia graficzne; inny format to
// czytelny błąd. WebP robi `sharp` (zależność Next w głównym node_modules) - tylko przy generowaniu, nie w teście.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bajty na piksel, wierszami. */
  data: Uint8Array;
}

export interface MonitorManifest {
  width: number;
  height: number;
  /** Ekran monitora w procentach wymiarów obrazu. */
  screen: { left: number; top: number; width: number; height: number };
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const MONITOR_SOURCE = join(HERE, 'monitor', 'monitor.png');
const REPO = resolve(HERE, '..', '..', '..');
export const MONITOR_MANIFEST = join(REPO, 'apps', 'web', 'src', 'lib', 'player-monitor.json');
export const MONITOR_WEBP = join(REPO, 'apps', 'web', 'public', 'player', 'monitor.webp');

/** PNG 8 bitów, RGB albo RGBA, bez przeplotu -> RGBA. */
export function decodePng(buffer: Buffer): RgbaImage {
  const SIGNATURE = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== SIGNATURE) throw new Error('To nie jest plik PNG.');
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const color = body[9];
      const interlace = body[12];
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
        throw new Error(`Obsługiwany jest PNG 8-bitowy RGB/RGBA bez przeplotu (jest: głębia ${depth}, typ koloru ${color}, przeplot ${interlace}).`);
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`Nieznany filtr PNG ${filter} w wierszu ${y}.`);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, data: rgba };
}

/** Biały ekran: piksele jasne we wszystkich kanałach i nieprzezroczyste. */
const isWhite = (image: RgbaImage, index: number) =>
  image.data[index * 4] >= 235 && image.data[index * 4 + 1] >= 235 && image.data[index * 4 + 2] >= 235 && image.data[index * 4 + 3] >= 250;

/**
 * Prostokąt ekranu: spójny biały obszar zawierający środek obrazu (wypełnianie od środka, 4-sąsiedztwo), jego obrys w procentach.
 * Środek obrazu musi być biały (monitor wyśrodkowany) - inaczej błąd, a nie zgadywanie.
 */
export function findScreenRect(image: RgbaImage): MonitorManifest {
  const { width, height } = image;
  const start = Math.floor(height / 2) * width + Math.floor(width / 2);
  if (!isWhite(image, start)) throw new Error('Środek grafiki monitora nie jest biały - ekran musi być białym prostokątem na środku obrazu.');
  const seen = new Uint8Array(width * height);
  const stack = [start];
  seen[start] = 1;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  while (stack.length > 0) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    count++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const next = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
    for (const n of next) {
      if (n >= 0 && !seen[n] && isWhite(image, n)) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  // Biały obszar ma być prostokątem (ekran), nie plamą przeciekającą przez ramkę na jasne tło.
  if (count < boxWidth * boxHeight * 0.97) throw new Error('Biały obszar wokół środka nie jest prostokątem - sprawdź, czy ekran jest zamknięty ramką.');
  const pct = (value: number, total: number) => Math.round((value / total) * 10000) / 100;
  return {
    width,
    height,
    screen: { left: pct(minX, width), top: pct(minY, height), width: pct(boxWidth, width), height: pct(boxHeight, height) },
  };
}

async function main(): Promise<void> {
  const source = process.argv[2] ? resolve(process.argv[2]) : MONITOR_SOURCE;
  const manifest = findScreenRect(decodePng(readFileSync(source)));
  mkdirSync(dirname(MONITOR_WEBP), { recursive: true });
  const sharp = createRequire(join(REPO, 'package.json'))('sharp') as (input: string) => { webp: (o: object) => { toFile: (f: string) => Promise<unknown> } };
  await sharp(source).webp({ quality: 85 }).toFile(MONITOR_WEBP);
  writeFileSync(MONITOR_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Ekran monitora: ${JSON.stringify(manifest.screen)} (obraz ${manifest.width}×${manifest.height}) -> ${MONITOR_MANIFEST}, ${MONITOR_WEBP}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
