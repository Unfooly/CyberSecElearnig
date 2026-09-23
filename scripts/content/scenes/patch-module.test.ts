import { describe, expect, it } from 'vitest';
import { patchHotspotCoords, resolveTargetHotspots, type ContentModuleLike } from './patch-module.js';

const computed = [
  { id: 'drzwi', x: 43.8, y: 36.6, w: 12.4, h: 42.8 },
  { id: 'outlook', x: 4.2, y: 5, w: 17.7, h: 28.1 },
];

describe('patchHotspotCoords', () => {
  it('pisze width/height (NIE w/h) - regresja realnego buga: schemat treści nazywa te pola width/height (packages/content/src/blocks.ts), nie w/h jak Hotspot z compose.ts', () => {
    const hotspots = [{ id: 'drzwi', label: 'Drzwi', x: 1, y: 1, width: 1, height: 1 }];
    const patched = patchHotspotCoords(hotspots, computed);
    expect(patched).toBe(1);
    expect(hotspots[0]).toMatchObject({ x: 43.8, y: 36.6, width: 12.4, height: 42.8 });
    expect(hotspots[0]).not.toHaveProperty('w');
    expect(hotspots[0]).not.toHaveProperty('h');
  });

  it('rzuca, gdy hotspot z module.json nie istnieje w wyliczonej scenie', () => {
    const hotspots = [{ id: 'nieznany', x: 0, y: 0, width: 1, height: 1 }];
    expect(() => patchHotspotCoords(hotspots, computed)).toThrow(/nieznany/);
  });
});

describe('resolveTargetHotspots', () => {
  const mod: ContentModuleLike = {
    blocks: [
      { id: 'inny', type: 'NARRATIVE' },
      {
        id: 'biuro-anny',
        type: 'SCENE_HOTSPOTS',
        hotspots: [
          { id: 'drzwi', x: 1, y: 1, width: 1, height: 1 },
          { id: 'monitor', x: 1, y: 1, width: 1, height: 1, media: { kind: 'scene', scene: { hotspots: [{ id: 'outlook', x: 1, y: 1, width: 1, height: 1 }] } } },
        ],
      },
    ],
  };

  it('bez --nested zwraca hotspoty najwyższego poziomu bloku', () => {
    expect(resolveTargetHotspots(mod, 'biuro-anny').map((h) => h.id)).toEqual(['drzwi', 'monitor']);
  });

  it('z --nested zwraca hotspoty WEWNĄTRZ zagnieżdżonej sceny (media.kind: scene)', () => {
    expect(resolveTargetHotspots(mod, 'biuro-anny', 'monitor').map((h) => h.id)).toEqual(['outlook']);
  });

  it('rzuca dla nieznanego bloku, bloku innego typu i hotspotu bez zagnieżdżonej sceny', () => {
    expect(() => resolveTargetHotspots(mod, 'nieistniejacy')).toThrow(/nie istnieje/);
    expect(() => resolveTargetHotspots(mod, 'inny')).toThrow(/SCENE_HOTSPOTS/);
    expect(() => resolveTargetHotspots(mod, 'biuro-anny', 'drzwi')).toThrow(/media.kind/);
  });
});
