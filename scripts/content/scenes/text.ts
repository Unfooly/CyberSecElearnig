import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

// Tekst sceny jako krzywe (D-135, i18n-3): kompozytor zamienia każdy <text> na <path> z konturów czcionki z repo (Plus Jakarta Sans,
// Caveat - OFL, `fonts/`), więc grafika wygląda tak samo w każdej przeglądarce i nie zależy od czcionek systemu ani od sieci (SVG w <img>
// i tak nie ładuje czcionek strony). Ten sam tekst = te same bajty: stała precyzja współrzędnych (PATH_DECIMALS), bez losowości.

export type FontFamily = 'sans' | 'hand';
export type Anchor = 'start' | 'middle' | 'end';

export interface TextStyle {
  size: number;
  bold?: boolean;
  /** 'sans' - Plus Jakarta Sans (domyślnie); 'hand' - Caveat (pismo odręczne). */
  family?: FontFamily;
  /** letter-spacing w jednostkach sceny (jak atrybut SVG). */
  spacing?: number;
  anchor?: Anchor;
}

/** Miejsca po przecinku we współrzędnych konturów - stała, żeby wynik był bajt w bajt powtarzalny. */
export const PATH_DECIMALS = 2;

/** Nazwa rodziny w atrybucie font-family elementu <text> klocka -> rodzina czcionki z repo. */
export const FONT_FAMILY_ATTR: Record<string, FontFamily> = { 'Plus Jakarta Sans': 'sans', Caveat: 'hand' };

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fonts');
const FONT_FILES: Record<FontFamily, { regular: string; bold: string }> = {
  sans: { regular: 'PlusJakartaSans-Regular.ttf', bold: 'PlusJakartaSans-Bold.ttf' },
  hand: { regular: 'Caveat-Regular.ttf', bold: 'Caveat-Bold.ttf' },
};
const fonts = new Map<string, opentype.Font>();

export function loadFont(family: FontFamily = 'sans', bold = false): opentype.Font {
  const file = FONT_FILES[family][bold ? 'bold' : 'regular'];
  let font = fonts.get(file);
  if (!font) {
    const buffer = readFileSync(join(FONT_DIR, file));
    font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    fonts.set(file, font);
  }
  return font;
}

interface Layout {
  glyphs: opentype.Glyph[];
  /** Pozycja x każdego glifu względem początku tekstu. */
  xs: number[];
  width: number;
}

function layout(text: string, style: TextStyle): Layout {
  const font = loadFont(style.family, style.bold);
  const scale = style.size / font.unitsPerEm;
  const spacing = style.spacing ?? 0;
  // Przy letter-spacing przeglądarka wyłącza ligatury („fi”) i dodaje odstęp po każdym znaku - tu tak samo.
  // opentype.js 1.3.4: stringToGlyphs(s, options) przyjmuje `features` (typy @types/opentype.js 1.3.8 go nie znają).
  const toGlyphs = font.stringToGlyphs as unknown as (s: string, options: { features: Record<string, boolean> }) => opentype.Glyph[];
  const glyphs = toGlyphs.call(font, text, { features: { liga: spacing === 0, rlig: true } });
  // Tylko zwykła spacja może nie mieć konturu - inny znak bez glifu (np. U+202F) narysowałby się jako pusty prostokąt.
  const missing = [...text].filter((char) => char !== ' ' && font.charToGlyphIndex(char) === 0);
  if (missing.length > 0) {
    throw new Error(`Czcionka ${FONT_FILES[style.family ?? 'sans'][style.bold ? 'bold' : 'regular']} nie ma znaków: ${[...new Set(missing)].map((c) => `"${c}" (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`).join(', ')} - w tekście „${text}”`);
  }
  const xs: number[] = [];
  let x = 0;
  glyphs.forEach((glyph, i) => {
    xs.push(x);
    x += (glyph.advanceWidth ?? 0) * scale + spacing;
    const next = glyphs[i + 1];
    if (next) x += font.getKerningValue(glyph, next) * scale;
  });
  // Jak przeglądarka: letter-spacing po każdym znaku (także ostatnim) wchodzi w szerokość liczoną dla text-anchor.
  return { glyphs, xs, width: x };
}

/** Szerokość tekstu (z kerningiem i letter-spacing) w jednostkach sceny. */
export function measureText(text: string, style: TextStyle): number {
  return layout(text, style).width;
}

/** Kontur tekstu jako atrybut `d` ścieżki; (x, y) jak w <text>: linia bazowa, zakotwiczenie wg `anchor`. */
export function textPathData(text: string, x: number, y: number, style: TextStyle): string {
  const { glyphs, xs, width } = layout(text, style);
  const shift = style.anchor === 'middle' ? -width / 2 : style.anchor === 'end' ? -width : 0;
  const path = new opentype.Path();
  glyphs.forEach((glyph, i) => {
    path.extend(glyph.getPath(x + shift + xs[i], y, style.size));
  });
  return path.toPathData(PATH_DECIMALS);
}

/** Prostokąt slotu tekstu i styl - lokalne jednostki klocka. */
export interface FitBox {
  /** Nazwa slotu w komunikacie błędu (np. "dymek", "lines"). */
  slot: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rozmiar docelowy; dopasowanie zmniejsza go w krokach FIT_STEP aż do `minSize` (z PropContext). */
  size: number;
  minSize: number;
  /** Odstęp linii jako wielokrotność rozmiaru (domyślnie 1.25). */
  lineHeight?: number;
  align?: Anchor;
  valign?: 'top' | 'middle';
  maxLines?: number;
  bold?: boolean;
  family?: FontFamily;
  fill: string;
  /** Do komunikatu błędu: scena, element, język. */
  where: string;
}

/** Krok zmniejszania czcionki przy dopasowaniu (stały - wynik powtarzalny). */
export const FIT_STEP = 0.5;

/**
 * Pionowy zasięg linii w em (code review i18n-3): nad linią bazową do najwyższego glifu z akcentami (Ż, Ś - ok. 0,98 em), pod nią do
 * najniższego wydłużenia (g, ą - ok. 0,24 em) - większa z wartości hhea czcionki i granic glifów EXTREME_GLYPHS, nie wysokość
 * wersalików. Slot liczony tak nie wypuści akcentów pierwszej linii nad prostokąt ani ogonków ostatniej pod niego.
 */
export function verticalExtent(family: FontFamily = 'sans', bold = false): { ascent: number; descent: number } {
  const font = loadFont(family, bold);
  // hhea bywa ciaśniejsze niż same glify (Plus Jakarta Sans: descender 0,222 em, „ą” do 0,237 em) - bierzemy większą z wartości.
  const bounds = [...EXTREME_GLYPHS].map((char) => font.charToGlyph(char).getBoundingBox());
  const top = Math.max(font.ascender, ...bounds.map((box) => box.y2));
  const bottom = Math.min(font.descender, ...bounds.map((box) => box.y1));
  return { ascent: top / font.unitsPerEm, descent: -bottom / font.unitsPerEm };
}

/** Znaki o największym zasięgu w pionie w tekstach PL/EN: akcenty nad wersalikami i ogonki/wydłużenia pod linią. */
export const EXTREME_GLYPHS = 'ŻŹŚĆŃÓŁĘĄÉÈÊÁÀÂÜÖÄąęgjpyqç';

export class TextFitError extends Error {}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Zawija akapity słowami w linie o szerokości ≤ maxWidth; null, gdy jakieś słowo samo jest szersze. */
function wrap(paragraphs: string[], style: TextStyle, maxWidth: number): string[] | null {
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let line = '';
    // Tylko zwykłe spacje/tabulatory/nowe linie - twarda spacja (U+00A0, „z kolei”) łączy słowa jak w przeglądarce.
    for (const word of paragraph.split(/[ \t\n\r]+/).filter(Boolean)) {
      if (measureText(word, style) > maxWidth) return null;
      const candidate = line ? `${line} ${word}` : word;
      if (measureText(candidate, style) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Tekst w slocie (D-135): zawija słowami i zmniejsza czcionkę od `size` do `minSize`, aż całość zmieści się w prostokącie.
 * Nie mieści się nawet przy `minSize` = TextFitError z nazwą sceny, slotu i języka - nigdy nie zmniejsza poniżej minimum ani nie ucina.
 * Zwraca elementy <text> (kompozytor zamienia je potem na krzywe). Lista = osobne akapity.
 */
export function fitText(value: string | string[], box: FitBox): string {
  const paragraphs = (Array.isArray(value) ? value : [value]).map((p) => p.trim());
  const lineHeight = box.lineHeight ?? 1.25;
  const { ascent, descent } = verticalExtent(box.family, box.bold);
  const floor = Math.max(box.minSize, 0.5);
  if (box.size < floor) {
    throw new TextFitError(`${box.where}, slot "${box.slot}": rozmiar ${box.size} poniżej minimum ${floor.toFixed(1)} (w jednostkach klocka) - powiększ tekst albo slot`);
  }
  for (let size = box.size; size >= floor - 1e-9; size = Math.round((size - FIT_STEP) * 100) / 100) {
    const style: TextStyle = { size, bold: box.bold, family: box.family, anchor: box.align ?? 'start' };
    const lines = wrap(paragraphs, style, box.w);
    if (!lines) continue;
    if (box.maxLines !== undefined && lines.length > box.maxLines) continue;
    const step = size * lineHeight;
    const height = size * ascent + (lines.length - 1) * step + size * descent;
    if (height > box.h) continue;
    const top = box.valign === 'middle' ? box.y + (box.h - height) / 2 : box.y;
    const x = box.align === 'middle' ? box.x + box.w / 2 : box.align === 'end' ? box.x + box.w : box.x;
    return lines
      .map((line, i) => {
        const y = Math.round((top + size * ascent + i * step) * 100) / 100;
        const attrs = [
          `x="${Math.round(x * 100) / 100}"`,
          `y="${y}"`,
          `font-size="${size}"`,
          `fill="${escText(box.fill)}"`,
          ...(box.bold ? ['font-weight="bold"'] : []),
          ...(box.align && box.align !== 'start' ? [`text-anchor="${box.align}"`] : []),
          ...(box.family === 'hand' ? ['font-family="Caveat"'] : []),
        ];
        return `<text ${attrs.join(' ')}>${escText(line)}</text>`;
      })
      .join('');
  }
  const preview = paragraphs.join(' / ');
  throw new TextFitError(
    `${box.where}, slot "${box.slot}": tekst „${preview.length > 60 ? `${preview.slice(0, 60)}…` : preview}” nie mieści się w ${box.w}×${box.h} nawet przy minimalnym rozmiarze ${floor.toFixed(1)} - skróć tekst albo powiększ slot`,
  );
}

const ATTR = /([a-zA-Z-]+)="([^"]*)"/g;
const TEXT_ELEMENT = /<text\b([^>]*)>([^<]*)<\/text>/g;
/** Atrybuty <text>, które rozumie zamiana na krzywe; inny atrybut = błąd (nie gubimy po cichu wyglądu). */
const KNOWN_ATTRS = new Set(['x', 'y', 'font-size', 'fill', 'font-weight', 'text-anchor', 'letter-spacing', 'opacity', 'font-family', 'class']);

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Parametry elementu <text> potrzebne do konturu (do zamiany i do kontroli rozmiaru w kompozytorze). */
export interface TextElement {
  text: string;
  x: number;
  y: number;
  style: TextStyle;
  /** Atrybuty przenoszone na <path>: fill, opacity, class (animacje). */
  paint: string;
}

export function parseTextElement(attrs: string, content: string): TextElement {
  const values: Record<string, string> = {};
  for (const [, name, value] of attrs.matchAll(ATTR)) {
    if (!KNOWN_ATTRS.has(name)) throw new Error(`Atrybut <text> "${name}" nie jest obsługiwany przy zamianie tekstu na krzywe (tekst „${unescape(content)}”)`);
    values[name] = value;
  }
  // Rozmiar zawsze na samym <text> (atrybuty dziedziczone z <g> nie są czytane) - brak = błąd, nie cicha wartość domyślna.
  if (!(Number(values['font-size']) > 0)) throw new Error(`<text> bez font-size (tekst „${unescape(content)}”) - rozmiar musi być na elemencie`);
  const family = values['font-family'] === undefined ? 'sans' : FONT_FAMILY_ATTR[values['font-family']];
  if (!family) throw new Error(`Nieznana czcionka "${values['font-family']}" (dozwolone: ${Object.keys(FONT_FAMILY_ATTR).join(', ')})`);
  const anchor = (values['text-anchor'] ?? 'start') as Anchor;
  if (!['start', 'middle', 'end'].includes(anchor)) throw new Error(`Nieznane text-anchor "${anchor}"`);
  const paint = ['fill', 'opacity', 'class']
    .filter((name) => values[name] !== undefined)
    .map((name) => ` ${name}="${values[name]}"`)
    .join('');
  return {
    text: unescape(content),
    x: Number(values.x ?? 0),
    y: Number(values.y ?? 0),
    style: {
      size: Number(values['font-size']),
      bold: values['font-weight'] === 'bold',
      family,
      spacing: values['letter-spacing'] === undefined ? 0 : Number(values['letter-spacing']),
      anchor,
    },
    paint,
  };
}

/** Zamienia każdy <text> we fragmencie SVG na <path> z konturem (ten sam układ współrzędnych - transformy rodziców działają dalej). */
export function outlineText(svg: string): string {
  const out = svg.replace(TEXT_ELEMENT, (_, attrs: string, content: string) => {
    const element = parseTextElement(attrs, content);
    if (element.text.trim() === '') return '';
    return `<path d="${textPathData(element.text, element.x, element.y, element.style)}"${element.paint}/>`;
  });
  if (/<text\b|<tspan\b/.test(out)) throw new Error('Zostały elementy <text>/<tspan>, których nie da się zamienić na krzywe (zagnieżdżony tekst)');
  return out;
}
