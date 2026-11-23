/**
 * Scena ze zdjęciami (D-208): wkleja zdjęcia w okna `foto-1`…`foto-N` klocka `photoBoard` i zapisuje gotową scenę jako WebP obok SVG.
 * SVG sceny zostaje źródłem prawdy dla układu i tekstu (kompozytor: tekst jako krzywe, `minTextPx`, pseudo-lokalizacja, hotspoty), ale
 * sam nie osadza obrazów (bez `href` - odprawa.test.ts). Zdjęcie wypełnia kwadratowe okno (kadr środka, `cover`) z zaokrąglonymi rogami.
 *
 * Przepis sceny: `scenes/photos/<cel>/<scena>.json` (ścieżki względem scripts/content) - scena, jej SVG, wynik WebP, zdjęcia w kolejności
 * `foto-1`…`foto-N` i skróty SHA-256 wejść i wyniku, które ten skrypt dopisuje (photo-fill.test.ts wykrywa nieaktualny WebP: zmiana SVG,
 * zdjęcia albo pliku wynikowego bez ponownego uruchomienia). Uruchom z katalogu scripts/content, po buildzie SVG (`tsx scenes/cli.ts build`):
 *   npx tsx scenes/photo-fill.ts scenes/photos/<cel>/<scena>.json
 * Potem publikacja `--assets`. Przy wersji językowej (EN) przepis i WebP per język - dziś tylko `pl`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTO_RX } from './props-naskroty.js';
import { PROPS } from './props.js';
import type { SceneSpec } from './types.js';

type Rect = { x: number; y: number; w: number; h: number };

/** Przepis sceny ze zdjęciami (scenes/photos/<cel>/<scena>.json). */
export interface PhotoRecipe {
  scene: string;
  svg: string;
  out: string;
  photos: string[];
  scale: number;
  /** Skróty SHA-256 (hex) z ostatniego uruchomienia: svg, zdjęcia (w kolejności `photos`) i wynik. */
  sha256?: { svg: string; photos: string[]; out: string };
}

/** Katalog scripts/content - względem niego są ścieżki przepisu. */
export const CONTENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** SHA-256 pliku (hex); tekst SVG z końcami linii LF - ten sam skrót po checkoucie na Windows (CRLF) i na CI (LF). */
export const sha256 = (file: string) => {
  const data = readFileSync(join(CONTENT_ROOT, file));
  return createHash('sha256').update(file.endsWith('.svg') ? data.toString('utf8').replace(/\r\n/g, '\n') : data).digest('hex');
};

/** Okna zdjęć klocka `photoBoard` sceny we współrzędnych sceny, w kolejności `foto-1`…`foto-N`. */
export function photoSlots(spec: SceneSpec): Rect[] {
  const board = spec.items.filter((item) => item.prop === 'photoBoard');
  if (board.length !== 1) throw new Error(`photo-fill: scena musi mieć dokładnie jeden klocek photoBoard (jest ${board.length})`);
  const item = board[0];
  // Kompozytor rysuje element jako translate(x y) scale(s); `pad` zmienia tylko hotspot, nie rysunek.
  if ((item.scale ?? 1) !== 1) throw new Error('photo-fill: photoBoard bez skali (okna zdjęć w jednostkach sceny)');
  const parts = PROPS.photoBoard(item.params ?? {}).parts ?? {};
  const slots: Rect[] = [];
  for (let i = 1; parts[`foto-${i}`]; i += 1) {
    const p = parts[`foto-${i}`];
    slots.push({ x: item.x + p.x, y: item.y + p.y, w: p.w, h: p.h });
  }
  return slots;
}

type SharpChain = {
  resize: (w: number, h: number, o?: object) => SharpChain;
  composite: (layers: object[]) => SharpChain;
  png: () => SharpChain;
  webp: (o: object) => SharpChain;
  toBuffer: () => Promise<Buffer>;
  toFile: (f: string) => Promise<{ width: number; height: number; size: number }>;
};

async function main() {
  const recipeFile = process.argv[2];
  if (!recipeFile) {
    console.error('Użycie (z katalogu scripts/content): npx tsx scenes/photo-fill.ts scenes/photos/<cel>/<scena>.json');
    process.exit(2);
  }
  const recipe = JSON.parse(readFileSync(recipeFile, 'utf8')) as PhotoRecipe;
  const at = (file: string) => join(CONTENT_ROOT, file);
  const spec = JSON.parse(readFileSync(at(recipe.scene), 'utf8')) as SceneSpec;
  const slots = photoSlots(spec);
  if (slots.length !== recipe.photos.length) throw new Error(`photo-fill: ${slots.length} okien zdjęć, a przepis ma ${recipe.photos.length} zdjęć`);
  const scale = recipe.scale;
  if (!(scale > 0)) throw new Error('photo-fill: "scale" przepisu musi być dodatnie');

  const sharp = createRequire(join(CONTENT_ROOT, '..', '..', 'package.json'))('sharp') as (input: Buffer | string, o?: object) => SharpChain;
  // Domyślny rozmiar sceny jak w kompozytorze (compose.ts).
  const W = Math.round((spec.width ?? 1600) * scale), H = Math.round((spec.height ?? 1000) * scale);
  const base = await sharp(readFileSync(at(recipe.svg)), { density: 72 * scale }).resize(W, H).png().toBuffer();
  const layers = await Promise.all(
    slots.map(async (slot, i) => {
      const w = Math.round(slot.w * scale), h = Math.round(slot.h * scale), r = Math.round(PHOTO_RX * scale);
      const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
      const input = await sharp(at(recipe.photos[i])).resize(w, h, { fit: 'cover', position: 'centre' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
      return { input, left: Math.round(slot.x * scale), top: Math.round(slot.y * scale) };
    }),
  );
  const info = await sharp(base).composite(layers).webp({ quality: 82 }).toFile(at(recipe.out));
  recipe.sha256 = { svg: sha256(recipe.svg), photos: recipe.photos.map(sha256), out: sha256(recipe.out) };
  writeFileSync(recipeFile, JSON.stringify(recipe, null, 2) + '\n');
  console.log(`OK: ${recipe.out} (${info.width}×${info.height}, ${Math.round(info.size / 1024)} kB), zdjęć: ${layers.length}; przepis zaktualizowany`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
