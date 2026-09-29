import { CONTENT_LOCALES, ContentLocale, DEFAULT_CONTENT_LOCALE, Narration, NarrationBody, VoiceRole } from './common';

/**
 * Treść wielojęzyczna (schemaVersion 6, docs/modules/modul-2-glos-z-helpdesku.md rozdz. 10). Zapisana wersja kursu przechowuje
 * WSZYSTKIE języki (skrót treści je obejmuje); każdy konsument - walidacja semantyczna, ocena, toClientBlock, odtwarzacz - pracuje na
 * treści ROZWINIĘTEJ do jednego języka (`localizeContent`), czyli na zwykłych stringach i płaskiej narracji, jak w v5. Dla treści bez
 * pól wielojęzycznych (moduł 1) rozwinięcie jest tożsamością (ta sama struktura i kolejność kluczy - test module-1-golden.spec.ts).
 */
export type Localized<T> = { pl: T; en?: T };
export type LocalizedNarration = { voice?: VoiceRole; pl: NarrationBody; en?: NarrationBody };

/**
 * Typ treści po rozwinięciu języka: `Localized<T>` -> T, narracja wielojęzyczna -> `Narration` (płaska, z `voice`). Rozpoznanie
 * strukturalne (każdy typ z polem `pl`) - poprawne, bo żaden schemat treści nie ma pola `pl` poza polami wielojęzycznymi (test
 * „żaden schemat treści nie ma pola pl ani en” w localize.spec.ts).
 */
export type Delocalize<T> = T extends LocalizedNarration
  ? Narration
  : T extends Localized<infer U>
    ? Delocalize<U>
    : T extends readonly unknown[]
      ? { [K in keyof T]: Delocalize<T[K]> }
      : T extends object
        ? { [K in keyof T]: Delocalize<T[K]> }
        : T;

const LOCALE_KEYS = new Set<string>(CONTENT_LOCALES);
// Obok języków obiekt wielojęzyczny może mieć wyłącznie wspólną rolę głosu (narracja). Żaden schemat treści nie ma pola `pl` poza
// polami wielojęzycznymi (test w localize.spec.ts), więc rozpoznanie po kształcie jest jednoznaczne.
const SHARED_KEYS = new Set(['voice']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Czy wartość to obiekt wielojęzyczny (`{ pl, en? }`, dla narracji także `voice`). */
export function isLocalizedValue(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, 'pl')) return false;
  return Object.keys(value).every((key) => LOCALE_KEYS.has(key) || SHARED_KEYS.has(key));
}

export function isContentLocale(value: unknown): value is ContentLocale {
  return typeof value === 'string' && LOCALE_KEYS.has(value);
}

function resolve(value: unknown, locale: ContentLocale): unknown {
  if (Array.isArray(value)) return value.map((item) => resolve(item, locale));
  if (!isPlainObject(value)) return value;
  if (isLocalizedValue(value)) {
    // Fallback pole po polu: brak wybranego języka w TYM polu = `pl`. Tylko własne pole (nie z prototypu).
    const chosen = Object.prototype.hasOwnProperty.call(value, locale) && value[locale] !== undefined ? value[locale] : value.pl;
    const resolved = resolve(chosen, locale);
    if (value.voice !== undefined && isPlainObject(resolved)) return { voice: value.voice, ...resolved };
    return resolved;
  }
  // Object.fromEntries definiuje własne pola (także "__proto__" jako zwykły klucz), więc treść nie zmieni prototypu wyniku.
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, locale)]));
}

/** Rozwija treść (moduł, blok, dowolny fragment) do jednego języka. Nie zmienia wejścia. */
export function localizeContent<T>(value: T, locale: ContentLocale = DEFAULT_CONTENT_LOCALE): Delocalize<T> {
  // Język spoza CONTENT_LOCALES (np. z żądania w fazie EN: "constructor", "__proto__") to błąd programisty/wejścia, nie cichy `pl`.
  if (!isContentLocale(locale)) throw new Error(`Nieznany język treści: ${String(locale)}`);
  return resolve(value, locale) as Delocalize<T>;
}

/** Ścieżki (`a.b[2].c`) wszystkich pól wielojęzycznych w treści. */
export function localizedPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => localizedPaths(item, `${path}[${index}]`));
  if (!isPlainObject(value)) return [];
  if (isLocalizedValue(value)) return [path];
  return Object.entries(value).flatMap(([key, item]) => localizedPaths(item, path ? `${path}.${key}` : key));
}

/** Języki użyte w treści: zawsze `pl`, plus każdy język obecny w którymkolwiek polu wielojęzycznym. */
export function localesIn(value: unknown): ContentLocale[] {
  const found = new Set<ContentLocale>([DEFAULT_CONTENT_LOCALE]);
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isPlainObject(node)) return;
    if (isLocalizedValue(node)) {
      for (const key of Object.keys(node)) if (isContentLocale(key) && node[key] !== undefined) found.add(key);
      for (const key of CONTENT_LOCALES) visit(node[key]);
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  return CONTENT_LOCALES.filter((locale) => found.has(locale));
}

/** Pola wielojęzyczne bez tłumaczenia na `locale` (import ostrzega: „brak tłumaczenia EN: <ścieżka>”). */
export function missingTranslations(value: unknown, locale: ContentLocale, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => missingTranslations(item, locale, `${path}[${index}]`));
  if (!isPlainObject(value)) return [];
  if (isLocalizedValue(value)) {
    if (value[locale] === undefined) return [path];
    return missingTranslations(value[locale], locale, path);
  }
  return Object.entries(value).flatMap(([key, item]) => missingTranslations(item, locale, path ? `${path}.${key}` : key));
}
