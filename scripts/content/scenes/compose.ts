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

// Animacje scen (CSS w SVG, klasy a-* na elementach klocków): działają też w <img>, bez skryptów. Zatrzymuje je
// prefers-reduced-motion ORAZ fragment "#static" w adresie obrazu (id="static" na <svg> + :target) - odtwarzacz dopisuje go
// przy reduced-motion (apps/web, content-assets.ts), więc jeden plik wystarcza zamiast osobnego wariantu statycznego.
const ANIM_CSS = `<style>
.a-blink{animation:a-blink 1.2s ease-in-out infinite}
.a-blink-slow{animation:a-blink 3s ease-in-out infinite}
.a-glow{animation:a-glow 5s ease-in-out infinite}
.a-pulse{animation:a-pulse 2.2s ease-in-out infinite}
.a-steam{animation:a-steam 2.8s ease-in-out infinite;transform-box:fill-box;transform-origin:center bottom}
.a-sway{animation:a-sway 6s ease-in-out infinite;transform-box:fill-box;transform-origin:center bottom}
.a-flutter{animation:a-flutter 4.5s ease-in-out infinite;transform-box:fill-box;transform-origin:center top}
.a-bounce{animation:a-bounce 2.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.a-ring{animation:a-ring 1.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.a-wave{animation:a-wave 1.2s ease-out infinite}
.a-grow{animation:a-grow .9s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.a-shimmer{animation:a-shimmer 3.5s ease-in-out infinite}
.d1{animation-delay:.35s}.d2{animation-delay:.7s}
@keyframes a-blink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes a-glow{0%,100%{opacity:1}50%{opacity:.65}}
@keyframes a-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes a-steam{0%{opacity:0;transform:translateY(6px)}40%{opacity:.9}100%{opacity:0;transform:translateY(-10px)}}
@keyframes a-sway{0%,100%{transform:rotate(0)}50%{transform:rotate(1.6deg)}}
@keyframes a-flutter{0%,100%{transform:rotate(0)}50%{transform:rotate(-1.4deg)}}
@keyframes a-bounce{0%,70%,100%{transform:scale(1)}80%{transform:scale(1.18)}90%{transform:scale(.95)}}
@keyframes a-ring{0%,100%{transform:rotate(0)}10%{transform:rotate(-2.5deg)}20%{transform:rotate(2.5deg)}30%{transform:rotate(-2.5deg)}40%{transform:rotate(0)}}
@keyframes a-wave{0%{opacity:0}30%{opacity:1}100%{opacity:0}}
@keyframes a-grow{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes a-shimmer{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
#static:target *{animation:none!important}
</style>`;

// Jednorazowe animacje wejścia (D-090, B-116): dopisywane do <style> TYLKO w scenach, które ich używają - reszta scen (i ich
// opublikowane pliki) się nie zmienia. Stempel spada: scale 1.4 -> 1 z obrotem -12deg, lekkie przestrzelenie krzywej (350 ms, po 0,5 s).
// reduced-motion / #static: animation:none z ANIM_CSS - stempel stoi od razu (opacity domyślna 1).
const ONCE_CSS: Record<string, string> = {
  'a-stamp':
    '.a-stamp{animation:a-stamp .35s cubic-bezier(.3,1.4,.6,1) .5s both;transform-box:fill-box;transform-origin:center}\n' +
    '@keyframes a-stamp{from{opacity:0;transform:scale(1.4) rotate(-12deg)}to{opacity:1;transform:none}}\n',
};

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
    `<svg xmlns="http://www.w3.org/2000/svg" id="static" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, Helvetica, sans-serif">`,
    ANIM_CSS,
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
  let svg = parts.join('\n');
  const once = Object.entries(ONCE_CSS)
    // Pełna nazwa klasy w liście klas (nie "a-stamp-cos" - myślnik to granica słowa dla \b).
    .filter(([cls]) => new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`).test(svg))
    .map(([, css]) => css)
    .join('');
  if (once) {
    // Do pierwszego <style> (ANIM_CSS). Reguły zatrzymujące (reduced-motion, #static) mają !important, więc wygrywają niezależnie od
    // kolejności. Brak kotwicy = błąd builda (inaczej klasa zostałaby po cichu bez reguł).
    if (!svg.includes('</style>')) throw new Error('Brak <style> w scenie - nie da się dopisać animacji jednorazowych');
    svg = svg.replace('</style>', `${once}</style>`);
  }
  return { svg, hotspots, width: W, height: H };
}

/** Podgląd HTML z zaznaczonymi hotspotami — do sprawdzenia oka, nie do repo. */
export function previewHtml(res: ComposeResult, svgPath: string): string {
  const boxes = res.hotspots
    .map(h => `<div style="position:absolute;left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%;border:2px dashed #E5484D;box-sizing:border-box"><span style="background:#E5484D;color:#fff;font:11px sans-serif;padding:1px 4px">${h.id}</span></div>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#fff"><div style="position:relative;width:1200px"><img src="${svgPath}" style="width:1200px;display:block">${boxes}</div></body></html>`;
}
