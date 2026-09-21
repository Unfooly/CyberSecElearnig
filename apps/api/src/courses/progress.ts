import { Prisma } from '@prisma/client';

// Postęp przypisania (CourseAssignment.progress). Nowy format (v: 2) jest kluczowany id BLOKU, nie indeksem, więc przeżywa
// zmiany kolejności między wersjami treści. Format sprzed silnika (klucz = indeks bloku) jest czytelny: przeliczamy go w
// locie (indeks i -> id "b<i>", te same id nadaje withLegacyIds), a każdy nowy zapis idzie już w formacie v2.

export interface BlockEntry {
  type: string;
  // Blok ukończony (dla TEXT_INPUT_GUIDED: rozwiązany albo wyczerpane próby; "Dalej" wymaga done).
  done: boolean;
  answeredAt: string;
  // Waga w wyniku modułu w chwili oceny (0 = blok eksploracyjny, poza wynikiem).
  weight: number;
  // Punkty 0..1; brak dla bloków nieocenianych.
  points?: number;
  correct?: boolean;
  // QUIZ/BRANCHING: indeks wybranej opcji (jak w formacie sprzed silnika).
  answer?: number;
  // EMAIL_ANALYSIS: zaznaczone kryteria, ORDERING: ułożona kolejność (id Z TREŚCI; klient dostaje je nieprzejrzyste, client-view.ts).
  selected?: string[];
  order?: string[];
  // TEXT_INPUT_GUIDED: zużyte próby i odsłonięte podpowiedzi.
  attempts?: number;
  hintsShown?: number;
}

export interface ProgressV2 {
  v: 2;
  blocks: Record<string, BlockEntry>;
  // Klucze notatek `<blockId>.<itemId>` (treść notatki rozwiązuje serwer z treści modułu - klient nigdy nie wysyła treści).
  notes: string[];
}

export function emptyProgress(): ProgressV2 {
  return { v: 2, blocks: {}, notes: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** Wpis bloku po id (własna właściwość: id "constructor" itp. nie trafia w prototyp). */
export function entryOf(progress: ProgressV2, blockId: string): BlockEntry | undefined {
  return has(progress.blocks, blockId) ? progress.blocks[blockId] : undefined;
}

function legacyEntry(raw: unknown): BlockEntry | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  const scored = typeof raw.correct === 'boolean';
  return {
    type: raw.type,
    done: true,
    answeredAt: typeof raw.answeredAt === 'string' ? raw.answeredAt : new Date(0).toISOString(),
    weight: scored ? 1 : 0,
    ...(scored ? { points: raw.correct ? 1 : 0, correct: raw.correct as boolean } : {}),
    ...(typeof raw.answer === 'number' ? { answer: raw.answer } : {}),
  };
}

/** Czyta progress z bazy w dowolnym z dwóch formatów i zwraca postać v2. */
export function readProgress(raw: Prisma.JsonValue | null | undefined): ProgressV2 {
  if (!isRecord(raw)) return emptyProgress();

  if (raw.v === 2) {
    const blocks: Record<string, BlockEntry> = {};
    if (isRecord(raw.blocks)) {
      for (const [id, entry] of Object.entries(raw.blocks)) {
        if (id !== '__proto__') blocks[id] = entry as unknown as BlockEntry;
      }
    }
    const notes = Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === 'string') : [];
    return { v: 2, blocks, notes };
  }

  const blocks: Record<string, BlockEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^\d+$/.test(key)) continue;
    const entry = legacyEntry(value);
    if (entry) blocks[`b${key}`] = entry;
  }
  return { v: 2, blocks, notes: [] };
}

/** Wynik modułu 0-100: średnia ważona punktów bloków ocenianych (waga > 0); null, gdy nic nie było oceniane. */
export function computeScore(progress: ProgressV2): number | null {
  let weighted = 0;
  let total = 0;
  for (const entry of Object.values(progress.blocks)) {
    if (!entry.done || entry.points === undefined || !(entry.weight > 0)) continue;
    weighted += entry.weight * entry.points;
    total += entry.weight;
  }
  return total === 0 ? null : Math.round((weighted / total) * 100);
}

export function toJson(progress: ProgressV2): Prisma.InputJsonValue {
  return progress as unknown as Prisma.InputJsonValue;
}
