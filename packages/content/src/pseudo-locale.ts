/**
 * Pseudo-lokalizacja `xx` (D-143): sztuczny język z tekstów PL, żeby sprawdzić układ dłuższego tłumaczenia, zanim powstanie prawdziwe
 * (EN dopiero po akceptacji treści modułu przez właściciela). Tekst dłuższy o ~35% (sufiks `~`), łacińskie litery z akcentami (wyższe
 * glify, inne kształty), całość w [ ] - obcięty początek albo koniec widać od razu. Wynik istnieje WYŁĄCZNIE w pamięci: kontrola
 * grafik w kompozytorze (scripts/content, test w CI) i podgląd odtwarzacza w dev harness (`?pseudo=1`, layout-check). `xx` nie jest
 * językiem treści (CONTENT_LOCALES) - nie trafia do module.json, plików, repo ani R2.
 *
 * Plik bez importów: kompozytor (scripts/content) bierze go ścieżką względną, bez zależności od zbudowanego pakietu.
 */
export const PSEUDO_LOCALE = 'xx';

/** Docelowe wydłużenie tekstu (typowe dla przekładu z polskiego). */
export const PSEUDO_EXPANSION = 0.35;

// Litery z akcentami z Latin-1/Extended-A (fonty kompozytora je mają; polskie litery zostają bez zmian).
const ACCENTS: Record<string, string> = {
  a: 'á', c: 'ç', e: 'é', i: 'í', n: 'ñ', o: 'ö', s: 'š', u: 'ü', y: 'ý', z: 'ž',
  A: 'Á', C: 'Ç', E: 'É', I: 'Í', N: 'Ñ', O: 'Ö', S: 'Š', U: 'Ü', Y: 'Ý', Z: 'Ž',
};

/** Domyślnie bez zmian zostaje tekst bez liter (cyfry, znaki, „???”) - nie jest tłumaczony. */
const NO_LETTERS = /^[^\p{L}]*$/u;

/** Jeden napis w `xx`: litery z akcentami, sufiks `~` do ~135% długości, całość w [ ]. `neutral` - tekst do pozostawienia bez zmian. */
export function pseudoLocalize(text: string, neutral: RegExp = NO_LETTERS): string {
  if (neutral.test(text)) return text;
  const chars = [...text];
  const accented = chars.map((ch) => ACCENTS[ch] ?? ch).join('');
  // Nawiasy i spacja przed sufiksem liczą się do długości; co najmniej `~~~` (krótkie etykiety rosną w przekładzie najbardziej).
  const tildes = Math.max(3, Math.ceil(chars.length * (1 + PSEUDO_EXPANSION)) - chars.length - 3);
  // Sufiks w słowach po najwyżej 5 znaków: przekład wydłuża tekst, ale nie tworzy jednego nierozerwalnego słowa na pół ekranu.
  const groups = Array.from({ length: Math.ceil(tildes / SUFFIX_WORD) }, (_, index) => '~'.repeat(Math.min(SUFFIX_WORD, tildes - index * SUFFIX_WORD)));
  return `[${accented} ${groups.join(' ')}]`;
}

const SUFFIX_WORD = 5;
