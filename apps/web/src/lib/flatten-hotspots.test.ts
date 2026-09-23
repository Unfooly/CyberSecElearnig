import { describe, it, expect } from 'vitest';
import { flattenHotspots } from './flatten-hotspots';
import type { InnerSceneHotspot, SceneHotspot } from './courses-types';

const base = (id: string, overrides: Partial<SceneHotspot> = {}): SceneHotspot => ({
  id,
  label: id,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  content: id,
  ...overrides,
});

const inner = (id: string, overrides: Partial<InnerSceneHotspot> = {}): InnerSceneHotspot => ({
  id,
  label: id,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  content: id,
  ...overrides,
});

describe('flattenHotspots', () => {
  it('bez media.kind:"scene": zwraca tylko zewnętrzne hotspoty, w tej samej kolejności', () => {
    const hotspots = [base('a'), base('b')];
    expect(flattenHotspots(hotspots).map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('media.kind:"scene": wewnętrzne hotspoty dochodzą zaraz po bramce (zewnętrznym), zachowana kolejność', () => {
    const hotspots = [
      base('a', { media: { kind: 'scene', scene: { image: 'x.png', imageAlt: 'x', hotspots: [inner('a-1'), inner('a-2')] } } }),
      base('b'),
    ];
    expect(flattenHotspots(hotspots).map((h) => h.id)).toEqual(['a', 'a-1', 'a-2', 'b']);
  });

  it('kilka bramek naraz: każda dokłada swoje wewnętrzne hotspoty', () => {
    const hotspots = [
      base('a', { media: { kind: 'scene', scene: { image: 'x.png', imageAlt: 'x', hotspots: [inner('a-1')] } } }),
      base('b', { media: { kind: 'scene', scene: { image: 'y.png', imageAlt: 'y', hotspots: [inner('b-1')] } } }),
    ];
    expect(flattenHotspots(hotspots).map((h) => h.id)).toEqual(['a', 'a-1', 'b', 'b-1']);
  });

  it('media innego kind (image/audio/document) nie dokłada niczego - tylko "scene" ma hotspots', () => {
    const hotspots = [base('a', { media: { kind: 'image', src: 'x.png', alt: 'x' } })];
    expect(flattenHotspots(hotspots).map((h) => h.id)).toEqual(['a']);
  });

  it('pusta lista wejściowa daje pustą listę wyjściową', () => {
    expect(flattenHotspots([])).toEqual([]);
  });
});
