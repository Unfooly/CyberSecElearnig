import { z } from 'zod';
import { blockSchema } from './blocks';
import { COURSE_CATEGORIES, idSchema, text } from './common';

/**
 * Wersja formatu modułu z silnikiem scen (bieżąca). Wersja 1 to "legacy": bloki bez `id`, zapisane przed silnikiem (patrz
 * withLegacyIds). Wersja 3 dodaje pola "śledztwa" (evidence, note.kind, required, dialog `lines`, `character.avatar`); wszystkie
 * opcjonalne, więc moduły w wersji 2 nadal się walidują, ale NIE mogą używać pól z wersji 3 (semantics.ts: V3_FEATURES).
 */
export const MODULE_SCHEMA_VERSION = 3;
export const SUPPORTED_SCHEMA_VERSIONS = [2, 3] as const;

export const moduleSchema = z
  .object({
    schemaVersion: z.union([z.literal(2), z.literal(3)]),
    // Stabilny klucz modułu (import robi po nim upsert kursu).
    slug: idSchema,
    title: text(200),
    category: z.enum(COURSE_CATEGORIES),
    durationMinutes: z.number().int().min(1).max(600),
    mandatory: z.boolean().default(false),
    blocks: z.array(blockSchema).min(1).max(200),
  })
  .strict();

export type ContentModule = z.infer<typeof moduleSchema>;

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
