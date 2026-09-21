import { createHash } from 'node:crypto';

// Nazwa pliku audio zawiera skrót jego wejścia, więc plik jest niemutowalny i idempotentny: ten sam tekst, model, język i głos to ten sam klucz
// (skrypt robi HEAD przed generowaniem i nie pali minut ElevenLabs), a zmiana któregokolwiek z nich to NOWY plik (stary zostaje, bo moduły w
// starszych wersjach kursu wskazują na niego; D-051: wersje treści są niemutowalne).

export interface NarrationInputs {
  text: string;
  model: string;
  language: string;
  voiceId: string;
}

/** Skrót wejścia syntezy: 16 znaków hex (64 bity: kolizje w obrębie jednego modułu są praktycznie niemożliwe). JSON zamiast sklejania: bez niejednoznaczności separatorów. */
export function narrationHash(input: NarrationInputs): string {
  const payload = JSON.stringify([input.text, input.model, input.language, input.voiceId]);
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}

/** Skrót zawartości pliku (zasoby modułów: wersjonowana nazwa `nazwa.<hash8>.svg`). */
export function contentHash(bytes: Uint8Array, length = 8): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, length);
}

// Te same wzorce co identyfikatory w schemacie treści (packages/content: idSchema) i ścieżki zasobów: klucze obiektów nie mogą wyjść poza
// swój prefiks (bez "..", "/", "\", schematu ani znaków specjalnych), niezależnie od tego, skąd pochodzi slug czy id bloku.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const RESERVED_SLUGS = new Set(['audio', 'mascot']);

export function assertSlug(slug: string): string {
  if (!ID.test(slug) || RESERVED_SLUGS.has(slug.toLowerCase())) {
    throw new Error(`Niepoprawny slug modułu "${slug}": litery, cyfry, "-" i "_" (max 64), bez nazw zastrzeżonych (${[...RESERVED_SLUGS].join(', ')}).`);
  }
  return slug;
}

// Jak w schemacie treści (idSchema): nazwy z Object.prototype są zastrzeżone.
const RESERVED_IDS = new Set(['constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'toJSON']);

export function assertBlockId(blockId: string): string {
  if (!ID.test(blockId) || RESERVED_IDS.has(blockId)) throw new Error(`Niepoprawny identyfikator bloku "${blockId}".`);
  return blockId;
}

export function assertVersion(version: string): string {
  if (!VERSION.test(version) || version.includes('..')) throw new Error(`Niepoprawna wersja partii audio "${version}" (np. v1).`);
  return version;
}

/** Klucz pliku audio względem bazy zasobów: `audio/<slug>/<wersja>/<blockId>/<hash>.mp3`. */
export function audioKey(parts: { slug: string; version: string; blockId: string; hash: string }): string {
  if (!/^[0-9a-f]{16}$/.test(parts.hash)) throw new Error('Niepoprawny skrót nagrania.');
  return `audio/${assertSlug(parts.slug)}/${assertVersion(parts.version)}/${assertBlockId(parts.blockId)}/${parts.hash}.mp3`;
}

/** Klucz sidecara (czasy `cues` i `durationMs`, których nie da się odczytać z mp3) obok nagrania. */
export function sidecarKey(audioObjectKey: string): string {
  if (!audioObjectKey.endsWith('.mp3')) throw new Error('Klucz audio musi kończyć się na .mp3.');
  return `${audioObjectKey.slice(0, -'.mp3'.length)}.json`;
}

/** Klucz manifestu partii: `audio/<slug>/<wersja>/manifest.json`. */
export function manifestKey(slug: string, version: string): string {
  return `audio/${assertSlug(slug)}/${assertVersion(version)}/manifest.json`;
}
