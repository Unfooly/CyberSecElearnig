import { createHash } from 'node:crypto';
import { assertSafeKey } from './stores/key.js';

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
const RESERVED_SLUGS = new Set(['audio', 'mascot', 'assets']);

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

/**
 * Rozbija ścieżkę zasobu (względem katalogu assets/ modułu) na katalog, nazwę i rozszerzenie (małymi literami). Separator to WYŁĄCZNIE "/"
 * (bez normalizacji backslasha): ścieżka pochodzi z pola modułu (schemat treści - ASSET_PATH w common.ts - i tak odrzuca "\") albo z
 * assets.lock.json zapisanego przez ten sam skrypt, więc backslash tu nie jest wspieranym wejściem. `assetKey` poniżej i tak by go odrzucił
 * (assertSafeKey na złożonym kluczu), tak samo jak `readSource` w assets.ts (assertSafeKey na surowym `original`) - jedna reguła w obu miejscach.
 */
function splitAssetPath(relativePath: string): { dir: string; name: string; ext: string } {
  const lastSlash = relativePath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? relativePath.slice(0, lastSlash + 1) : '';
  const file = lastSlash >= 0 ? relativePath.slice(lastSlash + 1) : relativePath;
  const dot = file.lastIndexOf('.');
  if (dot <= 0) throw new Error(`Zasób "${relativePath}" musi mieć nazwę i rozszerzenie.`);
  return { dir, name: file.slice(0, dot), ext: file.slice(dot + 1).toLowerCase() };
}

/** Rozszerzenie pliku zasobu (małymi literami), np. "svg". */
export function assetExt(relativePath: string): string {
  return splitAssetPath(relativePath).ext;
}

/**
 * Klucz pliku zasobu względem bazy zasobów: `assets/<slug>/<ścieżka>/<nazwa>.<hash8>.<ext>` (wersjonowana nazwa: skrót TREŚCI pliku
 * wstawiony przed rozszerzeniem, np. `office.a1b2c3d4.svg` - decyzja właściciela, PR 3). Plik jest więc niemutowalny jak audio: ten sam
 * zasób to ten sam klucz (HEAD przed publikacją pomija już opublikowane), a zmiana treści to NOWY plik (stary zostaje dla starszych wersji).
 */
export function assetKey(parts: { slug: string; relativePath: string; hash8: string }): string {
  if (!/^[0-9a-f]{8}$/.test(parts.hash8)) throw new Error('Niepoprawny skrót zasobu.');
  const { dir, name, ext } = splitAssetPath(parts.relativePath);
  return assertSafeKey(`assets/${assertSlug(parts.slug)}/${dir}${name}.${parts.hash8}.${ext}`);
}
