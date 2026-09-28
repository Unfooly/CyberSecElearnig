import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composeScene } from './compose.js';

// D-101 (reguła na przyszłość, CLAUDE.md): każda grafika otwierana kliknięciem (zbliżenie przedmiotu, dokument, okno, ekran) ma
// przezroczyste tło - przedmioty/dokumenty/okna przez crop-zooms.ts (wall: 'none', ciasny kadr), ekrany komputera przez
// wrap-in-monitor.ts (ramka monitora). Test przechodzi po WSZYSTKICH modułach: media.src (image), media.image (zbliżenie nad audio),
// media.scene.image i to samo w scenie zagnieżdżonej. SVG nie może mieć prostokąta tła na całą scenę; ramka monitora (screenFrame) sama
// takiego prostokąta nie rysuje (jest przesunięta o margines), więc owinięte ekrany przechodzą tę samą kontrolę bez wyjątku.

const modulesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'content', 'modules');

type Media = { kind?: string; src?: string; image?: string; scene?: { image?: string; hotspots?: Hotspot[] } };
type Hotspot = { id: string; media?: Media };

/** Ścieżki grafik otwieranych kliknięciem w bloku SCENE_HOTSPOTS (z miejscem w treści - do komunikatu). */
function clickOpenedImages(blocks: { id: string; type: string; hotspots?: Hotspot[] }[]): { where: string; path: string }[] {
  const found: { where: string; path: string }[] = [];
  const fromMedia = (where: string, media: Media | undefined) => {
    if (!media) return;
    if (media.kind === 'image' && media.src) found.push({ where: `${where}.media.src`, path: media.src });
    if (media.kind === 'audio' && media.image) found.push({ where: `${where}.media.image`, path: media.image });
    if (media.kind === 'scene' && media.scene?.image) {
      found.push({ where: `${where}.media.scene.image`, path: media.scene.image });
      for (const inner of media.scene.hotspots ?? []) fromMedia(`${where}.media.scene.hotspots[${inner.id}]`, inner.media);
    }
  };
  for (const block of blocks.filter((b) => b.type === 'SCENE_HOTSPOTS')) {
    for (const hotspot of block.hotspots ?? []) fromMedia(`${block.id}.hotspots[${hotspot.id}]`, hotspot.media);
  }
  return found;
}

/**
 * Prostokąt tła na całą scenę: dowolny <rect> w początku viewBox o jego wymiarach albo 100% x 100%. SVG bez viewBox liczy się jako
 * błąd (nie da się sprawdzić, więc nie przechodzi po cichu). Tło rysowane <path> nie jest wykrywane - grafiki zbliżeń pochodzą z
 * kompozytora (tło = <rect>), a jego zachowanie pilnuje test composeScene niżej.
 */
function hasFullSceneBackground(svg: string): boolean {
  const viewBox = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!viewBox) return true;
  const [, minX, minY, width, height] = viewBox;
  return [...svg.matchAll(/<rect\b[^>]*>/g)].some(([rect]) => {
    const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(rect)?.[1];
    const x = Number(attr('x') ?? 0), y = Number(attr('y') ?? 0);
    const full = (value: string | undefined, size: string) => value === size || value === '100%';
    return full(attr('width'), width) && full(attr('height'), height) && x === Number(minX) && y === Number(minY);
  });
}

const modules = readdirSync(modulesDir).filter((slug) => existsSync(join(modulesDir, slug, 'module.json')));

describe('D-101: grafiki otwierane kliknięciem mają przezroczyste tło', () => {
  it.each(modules)('moduł %s', (slug) => {
    const dir = join(modulesDir, slug);
    const module = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8'));
    const lockPath = join(dir, 'assets.lock.json');
    const lock = existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, 'utf8')) as { entries: Record<string, { original: string; key: string }> }) : { entries: {} };
    const originalByKey = new Map(Object.values(lock.entries).map((entry) => [entry.key, entry.original]));
    const images = clickOpenedImages(module.blocks);
    const problems: string[] = [];
    for (const { where, path } of images) {
      // Opublikowany klucz -> plik źródłowy z locka; nieopublikowana ścieżka to już plik źródłowy (względem assets/).
      const original = originalByKey.get(path) ?? path.replace(new RegExp(`^assets/${slug}/`), '');
      if (!original.endsWith('.svg')) {
        problems.push(`${where}: ${original} - tylko SVG da się sprawdzić (grafika zbliżenia ma być SVG z kompozytora)`);
        continue;
      }
      const svg = readFileSync(join(dir, 'assets', original), 'utf8');
      if (hasFullSceneBackground(svg)) problems.push(`${where}: ${original} ma prostokąt tła na całą scenę albo brak viewBox (crop-zooms.ts / wrap-in-monitor.ts)`);
    }
    expect(problems).toEqual([]);
    // Moduł bez scen z grafikami też przechodzi, ale moduł 1 ma ich kilka - test nie może być ślepy.
    if (slug === 'wyludzone-haslo') expect(images.length).toBeGreaterThanOrEqual(9);
  });

  it('kompozytor: wall "none" nie rysuje tła, zwykły kolor - rysuje; "none" bez flat to błąd', () => {
    const item = { id: 'kubek', prop: 'mug', x: 10, y: 10 };
    expect(hasFullSceneBackground(composeScene({ width: 200, height: 200, background: { flat: true, wall: 'none' }, items: [item] }).svg)).toBe(false);
    expect(hasFullSceneBackground(composeScene({ width: 200, height: 200, background: { flat: true, wall: '#2B2440' }, items: [item] }).svg)).toBe(true);
    expect(() => composeScene({ width: 200, height: 200, background: { wall: 'none' }, items: [item] })).toThrow(/wymaga flat: true/);
  });

  it('wykrywanie tła: 100% x 100%, przesunięty viewBox i brak viewBox; ramka monitora na kolorowym tle NIE jest zwolniona', () => {
    expect(hasFullSceneBackground('<svg viewBox="0 0 10 10"><rect width="100%" height="100%"/></svg>')).toBe(true);
    expect(hasFullSceneBackground('<svg viewBox="-5 -5 10 10"><rect x="-5" y="-5" width="10" height="10"/></svg>')).toBe(true);
    expect(hasFullSceneBackground('<svg><rect width="3" height="3"/></svg>')).toBe(true);
    expect(hasFullSceneBackground('<svg viewBox="0 0 10 10"><rect x="1" y="1" width="10" height="10"/></svg>')).toBe(false);
    const framed = (wall: string) =>
      composeScene({ width: 400, height: 300, background: { flat: true, wall }, items: [{ id: 'ramka-ekranu', prop: 'screenFrame', x: 30, y: 30, params: { sw: 200, sh: 100 } }] }).svg;
    expect(hasFullSceneBackground(framed('none'))).toBe(false);
    expect(hasFullSceneBackground(framed('#4E40B8'))).toBe(true);
  });

  it('screenFrame: tapeta tylko jako kolor #rgb/#rrggbb (trafia do atrybutu)', () => {
    const frame = (wallpaper: string) => composeScene({ width: 400, height: 300, background: { flat: true, wall: 'none' }, items: [{ id: 'ramka-ekranu', prop: 'screenFrame', x: 0, y: 0, params: { sw: 200, sh: 100, wallpaper } }] });
    expect(frame('#4E40B8').svg).toContain('fill="#4E40B8"');
    expect(() => frame('red" onload="x')).toThrow(/nie jest kolorem/);
  });
});
