// Lint SVG zasobów modułów: pliki trafiają do PUBLICZNEGO magazynu (D-060) i w kliencie są renderowane wyłącznie przez `<img>`
// (CLAUDE.md, silnik szkoleń pkt 4), co samo w sobie nie wykonuje <script> ani atrybutów on*=. Odrzucamy mimo to SVG z aktywną treścią -
// obrona w głąb na wypadek otwarcia klucza R2 wprost jako dokument najwyższego poziomu (nie przez <img>): wtedy przeglądarka WYKONA
// <script>. Druga linia obrony jest po stronie Cloudflare (CSP sandbox + X-Content-Type-Options na content.unfooly.com, docs/content-
// -pipeline.md) i działa niezależnie od tego lintu; ten lint to trzecia linia.
//
// To sprawdzenia na SUROWYM TEKŚCIE (regexy), nie parser XML: nie rozwiązują deklaracji namespace ani nie wykrywają każdej możliwej
// sztuczki (komentarze XML rozcinające nazwę tagu, CDATA, UTF-7 bez BOM - B-084, pełny lint parserem XML, P3, D-058). Zamykają jednak
// znane obejścia regexów na literałach: prefiks przestrzeni nazw (<x:script>), numeryczne encje w adresie (&#106;avascript:) i - w
// assets.ts, przed wywołaniem lintSvg - zły odczyt kodowania (plik musi być ścisłym UTF-8, bez BOM UTF-16/32).

export interface SvgViolation {
  rule: string;
  detail: string;
}

// Nazwa elementu z opcjonalnym prefiksem przestrzeni nazw (np. <svg:script>, <x:use> gdy "x" jest zdefiniowane na namespace SVG): w XML
// element z prefiksem powiązanym z namespace SVG to DOKŁADNIE ten sam element co bez prefiksu, więc lint musi łapać oba zapisy.
const NS_PREFIX = '(?:[A-Za-z_][\\w.-]*:)?';
const SCRIPT_TAG = new RegExp(`<\\s*${NS_PREFIX}script\\b`, 'i');
const FOREIGN_OBJECT_TAG = new RegExp(`<\\s*${NS_PREFIX}foreignObject\\b`, 'i');
const EVENT_HANDLER_ATTR = /\son[a-z]+\s*=/i;
// "javascript:" z ewentualnymi białymi/sterującymi znakami między literami (typowe obejście filtrów w atrybutach href/xlink:href/style).
const JAVASCRIPT_SCHEME = /j[\s\x00-\x1f]*a[\s\x00-\x1f]*v[\s\x00-\x1f]*a[\s\x00-\x1f]*s[\s\x00-\x1f]*c[\s\x00-\x1f]*r[\s\x00-\x1f]*i[\s\x00-\x1f]*p[\s\x00-\x1f]*t[\s\x00-\x1f]*:/i;
// Globalny: tag może mieć JEDNOCZEŚNIE `href` i `xlink:href` (poprawny SVG, żadnej obfuskacji - starsze przeglądarki/narzędzia honorują
// xlink:href jako zapasowy adres, gdy `href` nie jest wspierane). Pojedyncze dopasowanie sprawdzałoby tylko pierwszy z nich na tagu i
// przepuściłoby zewnętrzny host schowany w drugim - hrefsOf poniżej musi zebrać WSZYSTKIE wystąpienia, nie tylko pierwsze.
const HREF_ATTR = /(?:xlink:href|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Punkt kodowy spoza zakresu Unicode (np. spreparowane `&#99999999999;`) nie rzuca z `lintSvg`, tylko zostaje zastąpiony swoim zapisem
 * dziesiętnym (nie da się z niego odtworzyć żadnej litery - poza zakresem nie zdekoduje go też żadna przeglądarka, więc to nie omija lintu).
 */
function toChar(codePoint: number): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return String(codePoint);
  }
}

/**
 * Dekoduje numeryczne referencje znaków (`&#106;`, `&#x6a;`, średnik opcjonalny - HTML go dopuszcza pomijać) PRZED każdym sprawdzeniem:
 * inaczej `&#106;avascript:` (litera "j" jako encja) omija dosłowne dopasowanie `javascript:`. Nazwane encje (`&amp;` itp.) nie są
 * dekodowane - nie służą do ukrywania nazw tagów/atrybutów ani schematu adresu, więc nie są potrzebne do tej obrony.
 */
function decodeNumericEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => toChar(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => toChar(parseInt(dec, 10)));
}

function hrefsOf(svg: string, tagName: string): string[] {
  const tag = new RegExp(`<\\s*${NS_PREFIX}${tagName}\\b[^>]*>`, 'gi');
  const values: string[] = [];
  for (const match of svg.matchAll(tag)) {
    for (const found of match[0].matchAll(HREF_ATTR)) values.push(found[1] ?? found[2] ?? '');
  }
  return values;
}

/**
 * Adres z jawnym schematem SIECIOWYM (http:, https:, ftp:, ...) albo protokołowo-względny (`//host/...`): odwołanie do zasobu POZA tym
 * plikiem SVG. `data:` jest wyłączony celowo - to WBUDOWANA treść (bez żadnego żądania sieciowego), nie zewnętrzny host.
 */
const isExternalRef = (value: string) => (/^[a-z][a-z0-9+.-]*:/i.test(value.trim()) && !/^data:/i.test(value.trim())) || value.trim().startsWith('//');

export function lintSvg(source: string): SvgViolation[] {
  // Wszystkie sprawdzenia na wersji z rozkodowanymi encjami: encja mogłaby ukryć nazwę tagu/atrybutu albo schemat adresu (obrona w głąb,
  // nie parser XML - fałszywy alarm na dosłownym tekście "&#106;..." w treści SVG jest akceptowalnym kosztem tej warstwy).
  const decoded = decodeNumericEntities(source);
  const violations: SvgViolation[] = [];
  if (SCRIPT_TAG.test(decoded)) violations.push({ rule: 'script', detail: 'element <script> (także z prefiksem przestrzeni nazw)' });
  if (FOREIGN_OBJECT_TAG.test(decoded)) violations.push({ rule: 'foreign-object', detail: 'element <foreignObject>' });
  if (EVENT_HANDLER_ATTR.test(decoded)) violations.push({ rule: 'event-handler', detail: 'atrybut zdarzenia on... (np. onclick)' });
  if (JAVASCRIPT_SCHEME.test(decoded)) violations.push({ rule: 'javascript-scheme', detail: 'adres javascript: w atrybucie' });
  for (const value of hrefsOf(decoded, 'use')) {
    if (isExternalRef(value)) violations.push({ rule: 'use-external-href', detail: `<use href="${value}"> wskazuje na zewnętrzny host` });
  }
  for (const value of hrefsOf(decoded, 'image')) {
    if (isExternalRef(value)) violations.push({ rule: 'image-external-href', detail: `<image href="${value}"> wskazuje na zewnętrzny host` });
  }
  return violations;
}

export function formatSvgViolations(violations: SvgViolation[]): string {
  return violations.map((violation) => `  - ${violation.detail}`).join('\n');
}
