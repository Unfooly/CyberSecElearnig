import { resolveContentOrigin } from '@/lib/security-headers';

// Adresy zasobów modułów szkoleniowych (ilustracje, audio). W treści są ścieżkami WZGLĘDNYMI; klient składa bazę + ścieżkę. Ścieżka jest
// sprawdzana TYM SAMYM wzorcem co schemat treści (packages/content, common.ts) - test zgodności w content-assets.test.ts - więc treść
// nie może wskazać obcego hosta, schematu (`javascript:`), ścieżki bezwzględnej ani `..`, nawet gdyby walidacja importu została ominięta.

export type AssetKind = 'image' | 'audio';

const EXTENSIONS: Record<AssetKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg'],
  audio: ['mp3'],
};

// Bez schematu (brak ":"), hosta ("//"), ścieżki bezwzględnej, ".." i backslasha.
const ASSET_PATH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Lokalny katalog zasobów (development): apps/web/public/content, serwowany przez samą aplikację. */
export const LOCAL_CONTENT_BASE = '/content';

/**
 * Baza adresów zasobów z CONTENT_BASE_URL: origin (walidowany jak w CSP: https, konkretny host, bez wildcardów) plus opcjonalny prefiks
 * ścieżki, bez końcowego "/". Wartość pusta albo niepoprawna daje lokalny katalog. Czytane po stronie serwera i przekazywane do
 * komponentów klienckich jako prop (bez NEXT_PUBLIC: konfiguracja z env w czasie działania, spójna z CSP w middleware).
 */
export function contentAssetBase(raw: string | undefined, development = false): string {
  const origin = resolveContentOrigin(raw, development);
  if (!origin) return LOCAL_CONTENT_BASE;
  const { pathname } = new URL(raw!.trim());
  const prefix = pathname.replace(/\/+$/, '');
  if (prefix !== '' && !/^(\/[A-Za-z0-9._-]+)+$/.test(prefix)) return origin;
  return `${origin}${prefix}`;
}

/** Pełny adres zasobu albo null, gdy ścieżka jest niepoprawna (klient nie ładuje nic, zamiast ryzykować adres spoza bazy). */
export function contentAssetUrl(base: string, path: string | undefined | null, kind: AssetKind): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 300) return null;
  if (!ASSET_PATH.test(path)) return null;
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (!path.includes('.') || !EXTENSIONS[kind].includes(extension)) return null;
  return `${base.replace(/\/+$/, '')}/${path}`;
}
