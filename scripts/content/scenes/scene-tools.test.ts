import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAME_ID, cropZoom, wrapInMonitor } from './scene-tools.js';
import type { SceneSpec } from './types.js';

// Narzędzia D-101 (crop-zooms.ts, wrap-in-monitor.ts): zmieniają tylko tło, kadr i przesunięcia; drugi przebieg nic nie zmienia.
// Sceny modułu 1 (źródła per cel: scenes/examples/<slug>/, B-128).
const examples = join(dirname(fileURLToPath(import.meta.url)), 'examples', 'wyludzone-haslo');
const scene = (name: string) => JSON.parse(readFileSync(join(examples, `${name}.json`), 'utf8')) as SceneSpec;

/** Treść sceny bez tego, co narzędzia wolno zmienić (tło, kadr, położenie elementów, ramka monitora). */
function content(spec: SceneSpec) {
  return spec.items.filter((item) => item.id !== FRAME_ID).map(({ x: _x, y: _y, ...rest }) => rest);
}

describe('cropZoom (crop-zooms.ts)', () => {
  const before: SceneSpec = { width: 800, height: 1000, background: { flat: true, wall: '#2B2440' }, items: [{ id: 'kubek', prop: 'mug', x: 55, y: 60, scale: 3, params: { label: ['A', 'B'] } }] };

  it('przezroczyste tło, ciasny kadr, element w rogu kadru; treść bez zmian', () => {
    const after = cropZoom(before);
    expect(after.background).toEqual({ flat: true, wall: 'none' });
    expect(after.width).toBeLessThan(800);
    expect(after.items[0]).toMatchObject({ x: 36, y: 36 + 34 * 3 });
    expect(content(after)).toEqual(content(before));
  });

  it('idempotentne: drugi przebieg nic nie zmienia (także na zbliżeniu z modułu)', () => {
    expect(cropZoom(cropZoom(before))).toEqual(cropZoom(before));
    const fromModule = scene('kalendarz-zoom');
    expect(cropZoom(fromModule)).toEqual(fromModule);
  });

  it('scena z więcej niż jednym elementem albo nieznany klocek - błąd (skrypt kończy się kodem != 0)', () => {
    expect(() => cropZoom({ ...before, items: [...before.items, { ...before.items[0], id: 'drugi' }] })).toThrow(/dokładnie 1/);
    expect(() => cropZoom({ ...before, items: [{ ...before.items[0], prop: 'nie-ma' }] })).toThrow(/nieznany klocek/);
  });
});

describe('wrapInMonitor (wrap-in-monitor.ts)', () => {
  const before: SceneSpec = {
    width: 1200,
    height: 800,
    background: { flat: true, wall: '#4E40B8' },
    items: [{ id: 'outlook', prop: 'desktopIcon', x: 60, y: 50, hotspot: true, params: { icon: 'outlook' } }],
  };

  it('ramka monitora z tapetą w dawnym kolorze tła, elementy przesunięte o ramkę, tło przezroczyste; treść bez zmian', () => {
    const after = wrapInMonitor(before);
    expect(after.background).toEqual({ flat: true, wall: 'none' });
    expect(after.items[0]).toMatchObject({ id: FRAME_ID, prop: 'screenFrame', params: { sw: 1200, sh: 800, wallpaper: '#4E40B8' } });
    expect(after.items[1]).toMatchObject({ id: 'outlook', x: 60 + 58, y: 50 + 58 });
    expect(content(after)).toEqual(content(before));
  });

  it('idempotentne: owinięta scena (także pulpit z modułu) wraca bez zmian', () => {
    const once = wrapInMonitor(before);
    expect(wrapInMonitor(once)).toBe(once);
    const desktop = scene('pulpit');
    expect(wrapInMonitor(desktop)).toBe(desktop);
  });

  it('scena bez koloru tła (wall "none") - błąd od razu w narzędziu, nie dopiero przy buildzie', () => {
    expect(() => wrapInMonitor({ ...before, background: { flat: true, wall: 'none' } })).toThrow(/nie ma z czego zrobić tapety/);
  });
});
