import { pseudoLocalize } from '@cyberszkolo/content';

// Pseudo-lokalizacja treści w podglądzie odtwarzacza (D-143, dev harness `?pseudo=1`, layout-check sekcja `pseudo`): widoczne teksty
// bloku (po toClientBlock - tylko pola, które i tak idą do przeglądarki) w `xx` z PL, żeby sprawdzić układ dłuższego przekładu na
// 390×844, zanim powstanie EN. Moduły z `locales: ['pl']` mają teksty jako zwykłe napisy (nie `{ pl }`), więc rozpoznajemy je po
// kluczu i kształcie: identyfikatory, ścieżki plików, adresy, kolory i wartości wyliczeniowe zostają bez zmian. Tylko w pamięci
// procesu renderowania podglądu - nie trafia do treści, API ani plików. Napisy interfejsu odtwarzacza są po polsku w kodzie (D-133).
// „Bez języka” = bez liter (domyślne kryterium generatora) - np. numer „+48 500 XXX XXX” dostaje tu [ ], choć kompozytor (maska cyfr,
// LANGUAGE_NEUTRAL) zostawia go bez zmian; dla podglądu układu to bez znaczenia.

/**
 * Pola techniczne (identyfikatory, media, wartości sterujące, z którymi odtwarzacz porównuje, np. `speaker === 'player'`) - nigdy tekst
 * do czytania. Test `pseudo-content.test.ts` przepuszcza bloki modułów z `locales` i pilnuje, że zmieniają się tylko pola tekstowe -
 * nowe pole sterujące trzeba dopisać tutaj.
 */
const TECHNICAL_KEYS = new Set([
  'id', 'type', 'kind', 'blockId', 'fromBlock', 'image', 'imagePortrait', 'scene', 'portrait', 'src', 'audio', 'audioUrl', 'icon',
  'voice', 'layout', 'variant', 'phase', 'evidence', 'href', 'url', 'side', 'target', 'tone', 'mood', 'state', 'format', 'mode',
  'align', 'role', 'slot', 'speaker', 'channel', 'stamp', 'note', 'time',
]);
const NOT_TEXT = [
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/, // id w kebab-case (także jednowyrazowe małymi literami)
  /^[A-Z0-9_]+$/, // wartość wyliczeniowa
  /\.(?:svg|png|jpe?g|webp|gif|mp3|ogg|m4a|wav|json)(?:[?#].*)?$/i, // plik
  /^(?:https?:|mailto:|\/)/, // adres
  /^#[0-9a-f]{3,8}$/i, // kolor
];

const isText = (value: string) => /\p{L}/u.test(value) && !NOT_TEXT.some((pattern) => pattern.test(value));

/** Kopia wartości z widocznymi tekstami w `xx` (nie zmienia wejścia). */
export function pseudoLocalizeClientContent<T>(value: T, key?: string): T {
  if (typeof value === 'string') return (key !== undefined && TECHNICAL_KEYS.has(key) ? value : isText(value) ? pseudoLocalize(value) : value) as T;
  if (Array.isArray(value)) return value.map((item) => pseudoLocalizeClientContent(item, key)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, TECHNICAL_KEYS.has(name) ? item : pseudoLocalizeClientContent(item, name)]),
    ) as T;
  }
  return value;
}
