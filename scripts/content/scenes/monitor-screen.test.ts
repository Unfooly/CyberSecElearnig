import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MONITOR_MANIFEST, MONITOR_SOURCE, MONITOR_WEBP, decodePng, findScreenRect, type RgbaImage } from './monitor-screen';

/** Filtr PNG wiersza (1 Sub, 2 Up, 3 Average, 4 Paeth) - odwrotność tego, co robi dekoder; niezależna implementacja do testu. */
function filterRow(filter: number, row: Uint8Array, prev: Uint8Array | null): Buffer {
  const out = Buffer.alloc(row.length + 1);
  out[0] = filter;
  for (let x = 0; x < row.length; x++) {
    const a = x >= 4 ? row[x - 4] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= 4 ? prev[x - 4] : 0;
    let predictor = 0;
    if (filter === 1) predictor = a;
    else if (filter === 2) predictor = b;
    else if (filter === 3) predictor = Math.floor((a + b) / 2);
    else if (filter === 4) {
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[x + 1] = (row[x] - predictor + 256) & 0xff;
  }
  return out;
}

/** Minimalny PNG RGBA z obrazu - do testów dekodera i wykrywania; `filters` - filtr kolejnych wierszy (cyklicznie), domyślnie 0. */
function encodePng(image: RgbaImage, filters: number[] = [0]): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  const stride = image.width * 4;
  for (let y = 0; y < image.height; y++) {
    const row = image.data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? image.data.subarray((y - 1) * stride, y * stride) : null;
    rows.push(filterRow(filters[y % filters.length], row, prev));
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** Ciemny obraz 100×50 z białym prostokątem. */
function monitorImage(rect: { x: number; y: number; w: number; h: number }, leak = false): RgbaImage {
  const width = 100;
  const height = 50;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([30, 20, 40, 255], i * 4);
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) data.set([255, 255, 255, 255], (y * width + x) * 4);
  // Przeciek: biały pasek od ekranu do krawędzi - obszar przestaje być prostokątem.
  if (leak) for (let y = 0; y < rect.y; y++) data.set([255, 255, 255, 255], (y * width + 10) * 4);
  return { width, height, data };
}

describe('monitor quizu: prostokąt ekranu z białego obszaru (D-164)', () => {
  it('dekoder PNG + wykrywanie: obrys białego prostokąta w procentach', () => {
    const decoded = decodePng(encodePng(monitorImage({ x: 20, y: 10, w: 60, h: 25 })));
    expect(findScreenRect(decoded)).toEqual({ width: 100, height: 50, screen: { left: 20, top: 20, width: 60, height: 50 } });
  });

  it('dekoder odtwarza piksele bajt w bajt przy filtrach Sub, Up, Average i Paeth (szum, żeby filtry miały co przewidywać)', () => {
    const width = 23;
    const height = 17;
    const data = new Uint8Array(width * height * 4);
    let seed = 7;
    for (let i = 0; i < data.length; i++) {
      // Park-Miller: iloczyn mieści się w 2^53 (zwykłe liczby JS), więc bajty są naprawdę zróżnicowane.
      seed = (seed * 48271) % 2147483647;
      data[i] = seed % 256;
    }
    for (const filters of [[1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
      expect(Array.from(decodePng(encodePng({ width, height, data }, filters)).data)).toEqual(Array.from(data));
    }
  });

  it('środek nie jest biały albo biel przecieka poza ekran - czytelny błąd zamiast zgadywania', () => {
    expect(() => findScreenRect(monitorImage({ x: 0, y: 0, w: 10, h: 10 }))).toThrow(/Środek grafiki monitora nie jest biały/);
    expect(() => findScreenRect(monitorImage({ x: 10, y: 10, w: 80, h: 30 }, true))).toThrow(/nie jest prostokątem/);
    expect(() => decodePng(Buffer.from('nie png'))).toThrow(/PNG/);
  });

  it('manifest odtwarzacza i WebP odpowiadają grafice źródłowej (podmiana grafiki bez uruchomienia skryptu wywala CI)', () => {
    const manifest = JSON.parse(readFileSync(MONITOR_MANIFEST, 'utf8'));
    expect(manifest).toEqual(findScreenRect(decodePng(readFileSync(MONITOR_SOURCE))));
    expect(existsSync(MONITOR_WEBP)).toBe(true);
  });
});
