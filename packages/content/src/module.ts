import { z } from 'zod';
import { blockSchema } from './blocks';
import { CONTENT_LOCALES, COURSE_CATEGORIES, idSchema, imagePathSchema, ltext } from './common';
import { Delocalize } from './localize';

/**
 * Wersja formatu modułu z silnikiem scen (bieżąca). Wersja 1 to "legacy": bloki bez `id`, zapisane przed silnikiem (patrz
 * withLegacyIds). Wersja 3 dodaje pola "śledztwa" (evidence, note.kind, required, dialog `lines`, `character.avatar`). Wersja 4
 * dodaje metadane modułu (subtitle, level, objectives), `character.opening`, reakcje maskotki (`reactions`) i blok NARRATIVE.
 * Wersja 5 dodaje blok BRIEFING (z zadaniami sprawy w kroku caseFile), rolę głosu nagrań, nagranie media audio z potoku
 * TTS i blok DOSSIER - teczkę sprawy (D-081, D-082, D-083). Wszystkie pola
 * v3/v4/v5 są opcjonalne, więc starszy moduł nadal się waliduje, ale NIE może używać pól z nowszej wersji (semantics.ts:
 * V3_FEATURES/V4_FEATURES i sprawdzenia na poziomie modułu/typu bloku).
 * Wersja 6 (moduł 2, D-114) dodaje format wielojęzyczny (`{ pl, en? }` w polach tekstowych i narracji - localize.ts), warstwę
 * tekstu `textLayer`, rodzaje notatek call/log/web i role głosu karol/pawel/oszust.
 */
export const MODULE_SCHEMA_VERSION = 6;
export const SUPPORTED_SCHEMA_VERSIONS = [2, 3, 4, 5, 6] as const;

export const MODULE_LEVELS = ['basic', 'intermediate', 'advanced'] as const;

export const moduleSchema = z
  .object({
    schemaVersion: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    // Stabilny klucz modułu (import robi po nim upsert kursu).
    slug: idSchema,
    title: ltext(200),
    // schemaVersion 4: krótki podtytuł pod tytułem (karta kursu/SUMMARY).
    subtitle: ltext(300).optional(),
    category: z.enum(COURSE_CATEGORIES),
    // schemaVersion 4: poziom trudności modułu.
    level: z.enum(MODULE_LEVELS).optional(),
    durationMinutes: z.number().int().min(1).max(600),
    mandatory: z.boolean().default(false),
    // schemaVersion 4: cele szkoleniowe (lista tekstów), np. do katalogu kursów. Zadania sprawy (odhaczane w notatniku) to
    // co innego: `tasks` kroku caseFile bloku BRIEFING (blocks.ts, D-081).
    objectives: z.array(ltext(200)).max(6).optional(),
    // Miniatura modułu 16:9 do katalogu i karty kursu (plik z assets/ modułu, potok --assets; D-084) - addytywnie w v5.
    thumbnail: imagePathSchema.optional(),
    // Tryb prosty (D-132, moduł 3 i kolejne, addytywnie w v6): ostrzejsza walidacja (semantics.ts simpleModeErrors) i odtwarzacz dla osób
    // nietechnicznych - ocena każdego kliknięcia od razu, podpowiedź po 2 błędach, tekst min. 16 px, bez wyniku w blokach.
    simpleMode: z.boolean().optional(),
    // Języki kursu (D-133): w których językach kurs jest kompletny - gracz w innym języku dostaje `pl` z plakietką „Available in Polish
    // only”. Zawsze z `pl`; brak pola = ['pl'] (częściowe tłumaczenie pól nie czyni kursu dwujęzycznym). Kompletność języków sprawdza
    // walidacja (i18n-2).
    locales: z
      .array(z.enum(CONTENT_LOCALES))
      .min(1)
      .refine((list) => list.includes('pl'), 'locales: kurs zawsze ma język "pl"')
      .refine((list) => new Set(list).size === list.length, 'locales: powtórzony język')
      .optional(),
    blocks: z.array(blockSchema).min(1).max(200),
  })
  .strict();

/** Języki kursu z module.json (D-133): pole `locales` albo `['pl']`. */
export function moduleLocales(contentModule: { locales?: readonly (typeof CONTENT_LOCALES)[number][] }): (typeof CONTENT_LOCALES)[number][] {
  // Kolejność CONTENT_LOCALES (nie kolejność z pliku) - ['en','pl'] i ['pl','en'] to ten sam kurs i ten sam skrót wersji.
  return contentModule.locales ? CONTENT_LOCALES.filter((locale) => contentModule.locales!.includes(locale)) : ['pl'];
}

/** Moduł tak, jak jest zapisany (wszystkie języki) - to trafia do wersji kursu i do skrótu treści. */
export type ContentModule = z.infer<typeof moduleSchema>;
/** Moduł rozwinięty do jednego języka (localizeContent) - kształt dla walidacji semantycznej i odtwarzacza. */
export type ResolvedModule = Delocalize<ContentModule>;

export class ContentValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Niepoprawny moduł treści:\n - ${issues.join('\n - ')}`);
    this.name = 'ContentValidationError';
  }
}

// Pełna walidacja modułu (parseModule: schemat + relacje między polami + wzorce RE2) jest w semantics.ts, eksportowana z
// `@cyberszkolo/content/dist/node` (kod tylko dla Node).

/**
 * Bloki "legacy" (wersja 1, sprzed silnika) nie mają `id`. Dajemy im deterministyczne `b<indeks>`, żeby cały kod (progress
 * kluczowany id bloku, notatki) działał jednolicie. Nie waliduje kształtu bloków (zapisane przed silnikiem); bezpieczeństwo
 * zapewnia biała lista pól w toClientBlock.
 */
export function withLegacyIds(blocks: unknown[]): Record<string, unknown>[] {
  return blocks.map((block, index) => {
    const object = typeof block === 'object' && block !== null && !Array.isArray(block) ? (block as Record<string, unknown>) : {};
    return { ...object, id: `b${index}` };
  });
}
