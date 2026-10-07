import { P } from './palette.js';
import { esc, PROPS } from './props.js';
import { outlineText, parseTextElement } from './text.js';
import type { ComposeResult, Hotspot, PropContext, SceneLocale, SceneSpec, SceneString } from './types.js';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Języki scen ze `strings` - jak CONTENT_LOCALES w packages/content (pl zawsze, w tej kolejności). */
export const SCENE_LOCALES: readonly SceneLocale[] = ['pl', 'en'];

/**
 * Obszar sceny na telefonie 390×844 w pionie (D-135), zmierzony w odtwarzaczu (dev harness, 2026-10-07): scena/wariant pionowy
 * dopasowany do szerokości ma 364 px, obszar bloku - 631 px wysokości. 'contain' = cała scena w tym prostokącie, 'panorama' = pełna
 * wysokość (scena pozioma przewijana w bok). Zmiana układu odtwarzacza = ponowny pomiar i zmiana tych liczb.
 */
export const PHONE_SCENE_BOX = { width: 364, height: 631 } as const;
/** Minimalny rozmiar tekstu do czytania na telefonie (px ekranu) i na ekranie telefonu narysowanym w scenie. */
export const MIN_TEXT_PX = 14;
export const MIN_PHONE_SCREEN_TEXT_PX = 16;
/** Klocki, które są ekranem telefonu (tekst min. 16 px); element może to nadpisać polem `phoneScreen`. */
export const PHONE_SCREEN_PROPS = new Set(['smartphone', 'phoneTop', 'phoneFaceUp', 'phoneHomeTiles', 'phoneLying', 'incomingCallScreen', 'mfaListZoom']);

/**
 * Parametry klocków dopasowywane do slotu przez `fitText` (zawijanie + zmniejszanie do minimum, błąd gdy się nie mieści) - tylko tu
 * wolno w scenie ze `strings` podać `{ "$t": … }`. Klocek z tekstem o stałym rozmiarze nie gwarantuje, że dłuższy tekst innego
 * języka zmieści się w jego kształcie. Nowy klocek z tekstem do tłumaczenia = `fitText` + wpis tutaj.
 */
export const FIT_PARAMS: Record<string, string[]> = { textBox: ['text'] };

/** Tekst, który nie musi pochodzić ze `strings`: same cyfry i znaki liczb/maski (godzina, kwota, „12 3XX XX 41”). */
const LANGUAGE_NEUTRAL = /^[\d\s.,:;/+\-–—%()#*×xX]*$/;

/** Skala sceny na telefonie (px ekranu na jednostkę sceny). */
export function phoneScale(spec: SceneSpec): number {
  const W = spec.width ?? 1600, H = spec.height ?? 1000;
  return spec.phone === 'panorama' ? PHONE_SCENE_BOX.height / H : Math.min(PHONE_SCENE_BOX.width / W, PHONE_SCENE_BOX.height / H);
}

const isRef = (value: unknown): value is { $t: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as { $t?: unknown }).$t === 'string';

/** Klucze `{ "$t": … }` użyte w parametrach (głęboko). */
function refsIn(value: unknown, out: string[] = []): string[] {
  if (isRef(value)) out.push(value.$t);
  else if (Array.isArray(value)) value.forEach((v) => refsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => refsIn(v, out));
  return out;
}

function resolveRefs(value: unknown, table: Record<string, SceneString>): unknown {
  if (isRef(value)) return table[value.$t];
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, table));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, table)]));
  return value;
}

/** Języki sceny ze `strings` w kolejności SCENE_LOCALES; [] dla sceny bez `strings`. */
export function sceneLocales(spec: SceneSpec): SceneLocale[] {
  return spec.strings ? SCENE_LOCALES.filter((locale) => spec.strings![locale] !== undefined) : [];
}

/** Kompletność `strings`: pl obecny, tylko znane języki, te same klucze w każdym języku, każdy klucz użyty, każde odwołanie istnieje. */
export function validateStrings(spec: SceneSpec): string[] {
  const errors: string[] = [];
  const used = spec.items.flatMap((it) => refsIn(it.params ?? {}));
  if (!spec.strings) {
    if (used.length > 0) errors.push(`Odwołania { "$t": … } (${[...new Set(used)].join(', ')}) bez "strings" w scenie`);
    if (spec.items.some((it) => it.decorative)) errors.push('"decorative" ma sens tylko w scenie ze "strings"');
    return errors;
  }
  const unknown = Object.keys(spec.strings).filter((locale) => !SCENE_LOCALES.includes(locale as SceneLocale));
  if (unknown.length > 0) errors.push(`Nieznane języki w "strings": ${unknown.join(', ')} (dozwolone: ${SCENE_LOCALES.join(', ')})`);
  if (!spec.strings.pl) errors.push('"strings" musi mieć język "pl"');
  const locales = sceneLocales(spec);
  const keys = new Set(locales.flatMap((locale) => Object.keys(spec.strings![locale]!)));
  for (const locale of locales) {
    const table = spec.strings[locale]!;
    for (const key of keys) {
      const value = table[key];
      if (value === undefined) errors.push(`strings.${locale}: brak klucza "${key}"`);
      else if (Array.isArray(value) ? value.some((v) => typeof v !== 'string') : typeof value !== 'string') errors.push(`strings.${locale}.${key}: napis albo lista napisów`);
      else if ((Array.isArray(value) ? value : [value]).some((v) => v.trim() === '') || (Array.isArray(value) && value.length === 0)) {
        errors.push(`strings.${locale}.${key}: pusty napis (brak tłumaczenia dałby pusty dymek)`);
      }
    }
  }
  for (const it of spec.items) {
    for (const [param, value] of Object.entries(it.params ?? {})) {
      if (refsIn(value).length > 0 && !(FIT_PARAMS[it.prop] ?? []).includes(param)) {
        errors.push(`Element "${it.id}": parametr "${param}" klocka "${it.prop}" nie jest dopasowywany do slotu (fitText) - tekst dłuższy w innym języku wyszedłby poza grafikę; użyj textBox albo dodaj dopasowanie do klocka (FIT_PARAMS)`);
      }
    }
  }
  for (const key of new Set(used)) if (!keys.has(key)) errors.push(`Odwołanie do nieistniejącego klucza "${key}"`);
  for (const key of keys) if (!used.includes(key)) errors.push(`Klucz "${key}" w "strings" nie jest nigdzie użyty`);
  return errors;
}

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const SCALE = new RegExp(`scale\\(\\s*(${NUMBER})(?:[\\s,]+(${NUMBER}))?\\s*\\)`, 'g');

/**
 * Skala z atrybutu transform (scale(s) / scale(sx sy) - mniejsza oś, wartość bezwzględna: odbicie lustrzane nie zmienia rozmiaru);
 * translate/rotate nie zmieniają rozmiaru tekstu. `scale(`, którego nie da się odczytać w całości, matrix i skew - błąd (nie pomijamy
 * po cichu transformu, który mógłby zmniejszyć tekst poniżej minimum).
 */
export function transformScale(attrs: string): number {
  const transform = attrs.match(/\btransform="([^"]*)"/)?.[1];
  if (!transform) return 1;
  if (/matrix\(|skew/.test(transform)) throw new Error(`Nieobsługiwany transform "${transform}" (kontrola rozmiaru tekstu zna tylko translate/scale/rotate)`);
  const parsed = [...transform.matchAll(SCALE)];
  if (parsed.length !== (transform.match(/scale\(/g) ?? []).length) throw new Error(`Nieczytelne scale() w transform "${transform}"`);
  let scale = 1;
  for (const [, sx, sy] of parsed) scale *= Math.min(Math.abs(Number(sx)), Math.abs(Number(sy ?? sx)));
  return scale;
}

/**
 * Każdy <text> fragmentu z rozmiarem w jednostkach fragmentu (po transformach zagnieżdżonych <g>). Konstrukcje, które też skalują,
 * a których ta kontrola nie śledzi (zagnieżdżony <svg viewBox>, <use>/<symbol>), to błąd; transform na samym <text> odrzuca
 * parseTextElement (nieznany atrybut). Inne elementy nie zawierają tekstu, więc ich transform nie zmienia jego rozmiaru.
 */
export function textsWithScale(svg: string): { text: string; size: number }[] {
  if (/<(svg|use|symbol)\b/.test(svg)) throw new Error('Klocek w scenie ze "strings" nie może używać <svg>/<use>/<symbol> (kontrola rozmiaru tekstu ich nie śledzi)');
  const out: { text: string; size: number }[] = [];
  const stack = [1];
  for (const match of svg.matchAll(/<(\/?)(g|text)\b([^>]*?)(\/?)>([^<]*)/g)) {
    const [, close, tag, attrs, selfClosing, content] = match;
    if (tag === 'g') {
      if (close) stack.pop();
      else if (!selfClosing) stack.push(stack[stack.length - 1] * transformScale(attrs));
    } else if (!close) {
      const element = parseTextElement(attrs, content);
      out.push({ text: element.text, size: element.style.size * stack[stack.length - 1] });
    }
  }
  return out;
}

const words = (value: unknown): string[] =>
  typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : Array.isArray(value) ? value.flatMap(words) : value && typeof value === 'object' ? Object.values(value).flatMap(words) : [];

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
  if (spec.phone !== undefined && !['contain', 'panorama'].includes(spec.phone)) errors.push(`Nieznane "phone": ${spec.phone} (contain | panorama)`);
  errors.push(...validateStrings(spec));
  return errors;
}

export interface ComposeOptions {
  /** Język wyniku - wymagany dla sceny ze `strings`. */
  locale?: SceneLocale;
  /** Nazwa sceny w komunikatach błędów (plik bez .json). */
  name?: string;
}

/**
 * Scena ze `strings` (D-135): parametry z odwołaniami w języku `locale`, kontekst z dolną granicą czcionki dla `fitText`, a po
 * renderze kontrola, że każdy tekst pochodzi ze `strings` (albo jest samymi cyframi) i - poza `decorative` - ma na telefonie
 * co najmniej MIN_TEXT_PX (MIN_PHONE_SCREEN_TEXT_PX na ekranie telefonu). Błąd nazywa scenę, element i język.
 */
function renderItem(spec: SceneSpec, it: SceneSpec['items'][number], options: ComposeOptions, errors: string[]) {
  const fn = PROPS[it.prop];
  const s = it.scale ?? 1;
  const where = `scena ${options.name ?? '(bez nazwy)'}, element "${it.id}"${options.locale ? `, język ${options.locale}` : ''}`;
  if (!spec.strings) return fn(it.params ?? {}, { minFontSize: 0, where });

  const table = spec.strings[options.locale!]!;
  const minPx = (it.phoneScreen ?? PHONE_SCREEN_PROPS.has(it.prop)) ? MIN_PHONE_SCREEN_TEXT_PX : MIN_TEXT_PX;
  const toLocal = phoneScale(spec) * s;
  const context: PropContext = { minFontSize: it.decorative ? 0 : minPx / toLocal, where };
  const out = fn(resolveRefs(it.params ?? {}, table) as Record<string, unknown>, context);

  // Dozwolone słowa = słowa tekstów, do których element się odwołuje. Szczelne, dopóki FIT_PARAMS mają tylko klocki bez własnych
  // etykiet (textBox); klocek z etykietami w FIT_PARAMS wymaga sprawdzania etykiet osobno (etykieta ze słów napisu by przeszła).
  const allowed = new Set(refsIn(it.params ?? {}).flatMap((key) => words(table[key])).map((word) => word.toLocaleLowerCase(options.locale)));
  for (const { text, size } of textsWithScale(out.svg)) {
    const foreign = text.split(/\s+/).filter((word) => word && !LANGUAGE_NEUTRAL.test(word) && !allowed.has(word.toLocaleLowerCase(options.locale)));
    if (foreign.length > 0) errors.push(`${where}: tekst „${text}” nie pochodzi ze "strings" (${foreign.join(' ')}) - przekaż go parametrem { "$t": … }`);
    const px = size * toLocal;
    // Także same cyfry (kwota, numer - bywają wskazówką w ćwiczeniu); tekst tła do pominięcia - tylko przez "decorative".
    if (!it.decorative && px < minPx - 0.01) {
      errors.push(`${where}: tekst „${text}” ma na telefonie ${px.toFixed(1)} px (minimum ${minPx} px) - powiększ go albo oznacz element "decorative"`);
    }
  }
  return out;
}

export function composeScene(spec: SceneSpec, options: ComposeOptions = {}): ComposeResult {
  const errors = validateScene(spec);
  if (errors.length) throw new Error(errors.join('\n'));
  if (spec.strings && !options.locale) throw new Error(`Scena ${options.name ?? ''} ma "strings" - podaj język (${sceneLocales(spec).join(', ')})`);
  if (options.locale && !(spec.strings && spec.strings[options.locale])) throw new Error(`Scena ${options.name ?? ''} nie ma tekstów w języku "${options.locale}"`);

  const W = spec.width ?? 1600, H = spec.height ?? 1000;
  const floorY = spec.background?.floorY ?? Math.round(H * 0.78);
  const wall = spec.background?.wall ?? P.wall;
  const floor = spec.background?.floor ?? P.floor;

  // wall: 'none' - przezroczyste tło (D-101: grafiki otwierane kliknięciem leżą na scenie bez prostokąta tła).
  const transparent = wall === 'none';
  if (transparent && !spec.background?.flat) throw new Error('background.wall "none" wymaga flat: true (podłoga na przezroczystym tle nie ma sensu)');
  const parts: string[] = [
    // Bez font-family: tekst jest konturami (D-135), grafika nie zależy od czcionek systemu.
    `<svg xmlns="http://www.w3.org/2000/svg" id="static" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    ANIM_CSS,
    ...(transparent ? [] : [`<rect width="${W}" height="${H}" fill="${esc(wall)}"/>`]),
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

  const itemErrors: string[] = [];
  for (const it of spec.items) {
    const out = renderItem(spec, it, options, itemErrors);
    const s = it.scale ?? 1;
    const pad = it.pad ?? 8;
    parts.push(`<g id="item-${it.id}" transform="translate(${it.x} ${it.y}) scale(${s})">${outlineText(scopeIds(out.svg, it.id))}</g>`);

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
  if (itemErrors.length) throw new Error(itemErrors.join('\n'));
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
  return { svg, hotspots, width: W, height: H, ...(options.locale ? { locale: options.locale } : {}) };
}

/**
 * Wszystkie wyniki sceny: bez `strings` - jeden (jak dotąd); ze `strings` - jeden na język. Hotspoty nie zależą od tekstu, ale
 * sprawdzamy, że są identyczne we wszystkich językach (prostokąty hotspotów są wspólne w module, D-134).
 */
export function composeSceneLocales(spec: SceneSpec, name?: string): ComposeResult[] {
  const locales = sceneLocales(spec);
  if (locales.length === 0) return [composeScene(spec, { name })];
  const results = locales.map((locale) => composeScene(spec, { locale, name }));
  const reference = JSON.stringify(results[0].hotspots);
  const different = results.filter((result) => JSON.stringify(result.hotspots) !== reference).map((result) => result.locale);
  if (different.length > 0) throw new Error(`Scena ${name ?? ''}: hotspoty różnią się między językami (${different.join(', ')}) - prostokąty muszą być wspólne`);
  return results;
}

/** Podgląd HTML z zaznaczonymi hotspotami — do sprawdzenia oka, nie do repo. */
export function previewHtml(res: ComposeResult, svgPath: string): string {
  const boxes = res.hotspots
    .map(h => `<div style="position:absolute;left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%;border:2px dashed #E5484D;box-sizing:border-box"><span style="background:#E5484D;color:#fff;font:11px sans-serif;padding:1px 4px">${h.id}</span></div>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#fff"><div style="position:relative;width:1200px"><img src="${svgPath}" style="width:1200px;display:block">${boxes}</div></body></html>`;
}
