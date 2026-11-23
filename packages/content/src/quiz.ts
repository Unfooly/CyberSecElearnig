/**
 * Quiz modułu w trybie prostym (D-207) - wspólna reguła dla API (próg, „Powtórz quiz”, /start) i dev harnessu odtwarzacza (numeracja
 * „Pytanie N z M”, layout-check), żeby obie strony liczyły to samo.
 */

/** Próg zaliczenia quizu w % (decyzja właściciela 2026-11-22: „75% jak w nagraniach”) - jeden dla modułów 3-5, bez pola w treści. */
export const QUIZ_PASS_PERCENT = 75;

/**
 * Indeksy bloków quizu: ciąg pytań (QUIZ) tuż przed raportem (SUMMARY na końcu) albo na samym końcu modułu - tylko w trybie prostym.
 * Pytanie w środku historii (np. moduł 4 „Program z internetu”) to ćwiczenie: nie liczy się do progu ani do numeracji. Brak quizu - [].
 */
export function finalQuizIndexes(blocks: readonly { type: string }[], simpleMode: boolean): number[] {
  if (!simpleMode || blocks.length === 0) return [];
  let end = blocks.length - 1;
  if (blocks[end].type === 'SUMMARY') end -= 1;
  const indexes: number[] = [];
  for (let index = end; index >= 0 && blocks[index].type === 'QUIZ'; index -= 1) indexes.unshift(index);
  return indexes;
}
