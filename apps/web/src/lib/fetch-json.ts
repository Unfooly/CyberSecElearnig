import { apiFetch } from '@/lib/api-fetch';

export type FetchResult<T> = { ok: true; data: T } | { ok: false; status: number };

/**
 * fetch() + parsowanie JSON z jednolitą obsługą błędów - nigdy nie rzuca.
 * Błąd sieci (backend nieosiągalny) albo niepoprawny JSON w odpowiedzi jest
 * traktowany jak status 503 (awaria serwera), nie jak "sesja wygasła" -
 * odróżnienie tego od prawdziwego 401 jest odpowiedzialnością wywołującego.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit,
): Promise<FetchResult<T>> {
  try {
    // Adres klienta dla limitów po stronie API (tylko za zaufanym proxy).
    const response = await apiFetch(url, init);
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, status: 503 };
  }
}
