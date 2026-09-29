import { createRequire } from 'node:module';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Writable } from 'node:stream';

// Pomoce współdzielone przez oba potoki (audio narracji i zasoby modułów): odczyt/zapis JSON w repo (idempotentny, atomowy) i dostęp do
// packages/content/dist (walidacja modułu, klasyfikacja pól client/secret). Wydzielone z pipeline.ts (PR 3, commit 4), bez zmiany logiki.

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const encode = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export const say = (out: Writable, line: string): void => void out.write(`${line}\n`);

export async function readJsonFile(path: string): Promise<Json | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Json;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Zapis pliku tylko przy zmianie treści (idempotencja: drugi przebieg nie dotyka plików ani czasów modyfikacji), przez plik tymczasowy. */
export async function writeIfChanged(path: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const current = await readFile(path);
    if (Buffer.compare(current, Buffer.from(bytes)) === 0) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return true;
}

const requireCjs = createRequire(import.meta.url);

/** Walidacja modułu (schemat + relacje między polami). Ładowane raz, do wywołania przy każdym uruchomieniu potoku (fail-closed). */
export const contentNode = requireCjs('../../../packages/content/dist/node.js') as { parseModule: (input: unknown) => unknown };

/** Klasyfikacja pól client/secret (packages/content/src/blocks.ts): co wolno wysłać do publicznego magazynu (audio, zasoby). */
export const contentIndex = requireCjs('../../../packages/content/dist/index.js') as {
  FIELD_CLASSIFICATION: Record<string, { client: string[]; secret: string[] }>;
  /** Role głosu nagrań (narration.voice, D-082) - jedno źródło listy dla schematu treści i voices.json. */
  VOICE_ROLES: readonly string[];
  /** Języki treści (schemaVersion 6, D-114) - klucze voices.json per rola. */
  CONTENT_LOCALES: readonly string[];
  /** Obiekt wielojęzyczny `{ pl, en? }` (dla narracji także `voice`) - packages/content/src/localize.ts. */
  isLocalizedValue: (value: unknown) => value is Json;
};
