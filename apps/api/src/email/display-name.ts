const DEFAULT_MAX = 50;

// Zakresy punktów kodowych zastępowanych spacją (liczbowo, żeby plik nie zawierał znaków niewidocznych): C0 i DEL/C1 (w tym CR, LF,
// tab, NEL), zero-width i znaczniki kierunku (200B-200F), separatory linii i akapitu (2028-2029), znaczniki bidi (202A-202E,
// 2066-2069) oraz BOM (FEFF).
const STRIPPED: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const isStripped = (codePoint: number) => STRIPPED.some(([from, to]) => codePoint >= from && codePoint <= to);

/**
 * Nazwa wpisywana przez OBCĄ stronę (np. nazwa organizacji podana przy rejestracji), którą wstawiamy do maila wysyłanego z naszej
 * domeny do osoby trzeciej: bez znaków sterujących, nowych linii, separatorów akapitu i znaków sterujących kierunkiem tekstu
 * (bidi), z jedną spacją między słowami i przycięta do `max` znaków (z wielokropkiem). Chroni przed długim tekstem
 * socjotechnicznym w treści i przed wstrzyknięciem nagłówków w temacie. Cięcie po punktach kodowych (nie rozcina par
 * zastępczych).
 */
export function displayName(value: unknown, max: number = DEFAULT_MAX): string {
  if (typeof value !== 'string') return '';
  const spaced = Array.from(value, (char) => (isStripped(char.codePointAt(0) as number) ? ' ' : char)).join('');
  const cleaned = spaced.replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : cleaned;
}
