import { P } from './palette.js';
import { esc, PROPS } from './props.js';
import type { ComposeResult, Hotspot, SceneSpec } from './types.js';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Nadaje lokalnym id (clipPath itp.) unikalny sufiks per element sceny. */
function scopeIds(svg: string, itemId: string): string {
  const safe = itemId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return svg
    .replace(/id="([a-zA-Z0-9_-]+)"/g, (_, id) => `id="${id}-${safe}"`)
    .replace(/url\(#([a-zA-Z0-9_-]+)\)/g, (_, id) => `url(#${id}-${safe})`);
}

export function validateScene(spec: SceneSpec): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const it of spec.items) {
    if (!PROPS[it.prop]) errors.push(`Nieznany klocek "${it.prop}" (element ${it.id})`);
    if (ids.has(it.id)) errors.push(`Powtórzone id elementu "${it.id}"`);
    ids.add(it.id);
    if (!/^[a-z0-9-]+$/.test(it.id)) errors.push(`Id "${it.id}" ma być kebab-case`);
    if (it.scale !== undefined && !(it.scale > 0 && it.scale <= 10)) errors.push(`Skala poza zakresem (${it.id})`);
  }
  return errors;
}

export function composeScene(spec: SceneSpec): ComposeResult {
  const errors = validateScene(spec);
  if (errors.length) throw new Error(errors.join('\n'));

  const W = spec.width ?? 1600, H = spec.height ?? 1000;
  const floorY = spec.background?.floorY ?? Math.round(H * 0.78);
  const wall = spec.background?.wall ?? P.wall;
  const floor = spec.background?.floor ?? P.floor;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="${esc(wall)}"/>`,
  ];
  if (!spec.background?.flat) {
    parts.push(`<rect y="${floorY}" width="${W}" height="${H - floorY}" fill="${esc(floor)}"/>`);
    parts.push(`<rect y="${floorY - 10}" width="${W}" height="14" fill="${P.wall2}"/>`);
  }
  const hotspots: Hotspot[] = [];
  const seen = new Set<string>();

  const pushHotspot = (id: string, x: number, y: number, w: number, h: number, pad: number) => {
    if (seen.has(id)) throw new Error(`Powtórzone id hotspotu "${id}"`);
    seen.add(id);
    const x0 = Math.max(0, x - pad), y0 = Math.max(0, y - pad);
    const x1 = Math.min(W, x + w + pad), y1 = Math.min(H, y + h + pad);
    hotspots.push({ id, x: r1((x0 / W) * 100), y: r1((y0 / H) * 100), w: r1(((x1 - x0) / W) * 100), h: r1(((y1 - y0) / H) * 100) });
  };

  for (const it of spec.items) {
    const fn = PROPS[it.prop];
    const out = fn(it.params ?? {});
    const s = it.scale ?? 1;
    const pad = it.pad ?? 8;
    parts.push(`<g id="item-${it.id}" transform="translate(${it.x} ${it.y}) scale(${s})">${scopeIds(out.svg, it.id)}</g>`);

    if (it.hotspot === true) {
      pushHotspot(it.id, it.x, it.y, out.w * s, out.h * s, pad);
    } else if (typeof it.hotspot === 'string') {
      const p = out.parts?.[it.hotspot];
      if (!p) throw new Error(`Klocek "${it.prop}" nie ma części "${it.hotspot}" (element ${it.id})`);
      pushHotspot(it.id, it.x + p.x * s, it.y + p.y * s, p.w * s, p.h * s, pad);
    }
    for (const [part, hid] of Object.entries(it.partHotspots ?? {})) {
      const p = out.parts?.[part];
      if (!p) throw new Error(`Klocek "${it.prop}" nie ma części "${part}" (element ${it.id})`);
      pushHotspot(hid, it.x + p.x * s, it.y + p.y * s, p.w * s, p.h * s, pad);
    }
  }
  parts.push('</svg>');
  return { svg: parts.join('\n'), hotspots, width: W, height: H };
}

/** Podgląd HTML z zaznaczonymi hotspotami — do sprawdzenia oka, nie do repo. */
export function previewHtml(res: ComposeResult, svgPath: string): string {
  const boxes = res.hotspots
    .map(h => `<div style="position:absolute;left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%;border:2px dashed #E5484D;box-sizing:border-box"><span style="background:#E5484D;color:#fff;font:11px sans-serif;padding:1px 4px">${h.id}</span></div>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#fff"><div style="position:relative;width:1200px"><img src="${svgPath}" style="width:1200px;display:block">${boxes}</div></body></html>`;
}
