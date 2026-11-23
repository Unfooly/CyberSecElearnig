import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { photoSlots, sha256, type PhotoRecipe } from './photo-fill.js';
import { PROPS } from './props.js';
import type { SceneSpec } from './types.js';

// Tablica skutków modułu 4 ze zdjęciami (D-208): układ i tekst z kompozytora, zdjęcia wkleja photo-fill.ts do WebP.
const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, 'examples', 'na-skroty');
const assets = join(here, '..', '..', '..', 'packages', 'content', 'modules', 'na-skroty', 'assets', 'scenes', 'pl');
const spec = (name: string) => JSON.parse(readFileSync(join(examples, `${name}.json`), 'utf8')) as SceneSpec;
const inside = (inner: { x: number; y: number; w: number; h: number }, outer: { x: number; y: number; w: number; h: number }) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

describe('photoBoard i photo-fill (D-208)', () => {
  it.each([
    [{}, 'left'],
    [{ w: 860, h: 1400, cols: 2, gap: 30, photo: 'top' }, 'top'],
  ] as const)('klocek: 4 karty, kwadratowe okno zdjęcia i tytuł wewnątrz karty, bez nakładania (%j)', (params, photo) => {
    const parts = PROPS.photoBoard(params).parts!;
    for (let i = 1; i <= 4; i += 1) {
      const card = parts[`karta-${i}`], foto = parts[`foto-${i}`], title = parts[`slot-tytul-${i}`];
      expect(foto.w).toBe(foto.h);
      expect(inside(foto, card) && inside(title, card)).toBe(true);
      if (photo === 'left') expect(title.x).toBeGreaterThanOrEqual(foto.x + foto.w);
      else expect(title.y).toBeGreaterThanOrEqual(foto.y + foto.h);
    }
  });

  it('za mało miejsca na tytuł - błąd z nazwą klocka', () => {
    expect(() => PROPS.photoBoard({ w: 600, h: 1400, photo: 'left' })).toThrow(/photoBoard: za mało miejsca na tytuł/);
  });

  it.each(['tablica-skutki', 'tablica-skutki-pion'])('%s: 4 okna zdjęć w scenie, gotowy WebP obok SVG', (name) => {
    const scene = spec(name);
    const slots = photoSlots(scene);
    expect(slots).toHaveLength(4);
    for (const slot of slots) expect(inside(slot, { x: 0, y: 0, w: scene.width ?? 1600, h: scene.height ?? 1000 })).toBe(true);
    expect(existsSync(join(assets, `${name}.webp`)), `${name}.webp - uruchom scenes/photo-fill.ts`).toBe(true);
  });

  // Wykrywanie nieaktualnego WebP (uwaga z review D-208): przepis zapisuje skróty SVG, zdjęć i wyniku z ostatniego uruchomienia.
  it.each(['tablica-skutki', 'tablica-skutki-pion'])('%s: przepis aktualny - SVG, zdjęcia i WebP jak przy ostatnim photo-fill', (name) => {
    const recipe = JSON.parse(readFileSync(join(here, 'photos', 'na-skroty', `${name}.json`), 'utf8')) as PhotoRecipe;
    const hint = `uruchom: npx tsx scenes/photo-fill.ts scenes/photos/na-skroty/${name}.json (z scripts/content), potem --assets`;
    expect(recipe.scene).toBe(`scenes/examples/na-skroty/${name}.json`);
    expect(recipe.photos).toHaveLength(photoSlots(spec(name)).length);
    expect(recipe.sha256, hint).toBeDefined();
    expect(sha256(recipe.svg), `SVG zmienione - ${hint}`).toBe(recipe.sha256!.svg);
    expect(recipe.photos.map(sha256), `zdjęcia zmienione - ${hint}`).toEqual(recipe.sha256!.photos);
    expect(sha256(recipe.out), `WebP nie z tego przepisu - ${hint}`).toBe(recipe.sha256!.out);
  });

  it('scena bez photoBoard albo ze skalą - błąd', () => {
    const scene = spec('tablica-skutki');
    expect(() => photoSlots({ ...scene, items: scene.items.filter((item) => item.prop !== 'photoBoard') })).toThrow(/dokładnie jeden klocek photoBoard/);
    expect(() => photoSlots({ ...scene, items: scene.items.map((item) => (item.prop === 'photoBoard' ? { ...item, scale: 0.5 } : item)) })).toThrow(/bez skali/);
  });
});
