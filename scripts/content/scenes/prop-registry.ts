import type { PropFn } from './types.js';

/**
 * Rejestr wszystkich klocków kompozytora dla klocków, które składają INNE klocki (warianty pionowe, D-098: stackedHalves,
 * badgeWalletPortrait). Zamiast cyklicznego importu PROPS z props.ts (props.ts importuje props-odprawa.ts) - props.ts wypełnia
 * rejestr po zbudowaniu PROPS, a klocek sięga do niego dopiero w chwili wywołania. Kolejność importów modułów nie ma znaczenia.
 */
export const PROP_REGISTRY: Record<string, PropFn<any>> = Object.create(null);

/** Klocek z rejestru po nazwie - czytelny błąd dla nieznanej nazwy (albo rejestru jeszcze niewypełnionego: props.ts nie zaimportowany). */
export function registeredProp(name: string, caller: string): PropFn<any> {
  if (name === caller) throw new Error(`Klocek "${caller}" nie może składać samego siebie.`);
  const fn = PROP_REGISTRY[name];
  if (typeof fn !== 'function') throw new Error(`Nieznany klocek "${name}" (w "${caller}") - czy props.ts został zaimportowany?`);
  return fn;
}
