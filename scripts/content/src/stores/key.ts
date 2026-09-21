// Wspólna walidacja klucza obiektu dla obu magazynów (lokalny katalog i R2). Klucz to ścieżka względna bazy zasobów; żaden klucz nie może wyjść
// poza katalog/bucket, niezależnie od tego, skąd pochodzi slug, id bloku czy nazwa pliku zasobu.

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Windows: nazwy urządzeń (także z rozszerzeniem: "aux.mp3") i końcowa kropka (obcinana przez system, kolizja z nazwą bez niej).
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

export function assertSafeKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 300) throw new Error('Niepoprawny klucz obiektu (długość).');
  const segments = key.split('/');
  for (const segment of segments) {
    // Bez pustych segmentów ("//", początkowy i końcowy "/"), bez ".", "..", backslasha, znaku ":" i "%" (kodowanie ukośnika), spacji.
    if (!SEGMENT.test(segment) || segment.includes('..') || segment.endsWith('.') || WINDOWS_DEVICE.test(segment)) {
      throw new Error(`Niepoprawny klucz obiektu: segment "${segment}".`);
    }
  }
  return key;
}

/** Stałe nagłówki obiektów (D-060). Pliki o nazwie z hashem są niemutowalne; manifest jest mutowalny, więc bez długiego cache. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const MUTABLE_CACHE = 'no-cache';

export const AUDIO_CONTENT_TYPE = 'audio/mpeg';
export const JSON_CONTENT_TYPE = 'application/json';
