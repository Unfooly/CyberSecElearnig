import { createHash } from 'node:crypto';

// Część tylko dla Node (natywny moduł re2, node:crypto): NIE importować w apps/web. Izomorficzne API: `@cyberszkolo/content`.
export * from './regex';
export * from './semantics';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** Skrót SHA-256 treści (kanoniczny JSON: klucze posortowane) - decyduje, czy import tworzy nową wersję kursu. */
export function hashContent(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
