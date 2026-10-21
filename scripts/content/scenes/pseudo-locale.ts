// Generator `xx` jest jeden - w packages/content (także dla podglądu odtwarzacza); tu tylko tabela `strings` sceny (D-143).
import { PSEUDO_EXPANSION, PSEUDO_LOCALE, pseudoLocalize as pseudoLocalizeText } from '../../../packages/content/src/pseudo-locale.js';
// Import cykliczny z compose.ts jest bezpieczny: LANGUAGE_NEUTRAL czytamy dopiero przy wywołaniu, nie przy ładowaniu modułu.
import { LANGUAGE_NEUTRAL } from './compose.js';
import type { SceneString } from './types.js';

export { PSEUDO_EXPANSION, PSEUDO_LOCALE };

/** Napis sceny w `xx`; tekst bez języka w rozumieniu kompozytora (LANGUAGE_NEUTRAL: cyfry, maski „12 3XX”, „№ 1”) bez zmian. */
export const pseudoLocalize = (text: string): string => pseudoLocalizeText(text, LANGUAGE_NEUTRAL);

/** Tabela `strings` w `xx` z tabeli PL (listy napisów - każdy osobno). Wynik tylko w pamięci (`composePseudoScene`). */
export function pseudoTable(pl: Record<string, SceneString>): Record<string, SceneString> {
  return Object.fromEntries(Object.entries(pl).map(([key, value]) => [key, Array.isArray(value) ? value.map(pseudoLocalize) : pseudoLocalize(value)]));
}
