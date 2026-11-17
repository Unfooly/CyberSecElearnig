import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MONITOR_MANIFEST, MONITOR_SOURCE, MONITOR_WEBP, decodePng, findScreenRect, type RgbaImage } from './monitor-screen';

/** Minimalny PNG RGBA (filtr 0) z obrazu - do testów dekodera i wykrywania. */
function encodePng(image: RgbaImage): Buffer {
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
  for (let y = 0; y < image.height; y++) rows.push(Buffer.from([0]), Buffer.from(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4)));
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
