import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/bff';
import { API_URL } from '@/lib/config';
import { apiFetch } from '@/lib/api-fetch';
import { DEFAULT_LESSON_HTML, TRACKING_TOKEN_REGEX } from '@/lib/tracking';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Publiczny proxy śledzenia (strona lądowania -> apps/api). Celowo BEZ cookie/JWT i BEZ czytania ciała żądania:
 * wartości z formularza nie mogą trafić dalej ani do logów (request.json() nigdy nie jest wywoływane, do API
 * nie idzie żadne body). Ścieżka API jest STAŁA, a token trafia do niej tylko po walidacji formatu.
 *
 * Odpowiedź jest neutralna: token o złym formacie dostaje TĘ SAMĄ lekcję domyślną co token nieznany (bez pytania API),
 * a awaria API/limit nie ujawniają nic o tokenie (strona pokazuje wtedy lekcję domyślną po stronie klienta).
 */
export async function proxyTracking(kind: 'view' | 'submit', token: string): Promise<NextResponse> {
  // Zmienia stan (zapis w wynikach): tylko żądania z naszej własnej strony (jak reszta BFF).
  if (!isSameOriginRequest()) {
    return NextResponse.json({ message: 'Niedozwolone żądanie.' }, { status: 403, headers: NO_STORE });
  }
  if (!TRACKING_TOKEN_REGEX.test(token)) {
    return NextResponse.json({ lessonHtml: DEFAULT_LESSON_HTML }, { status: 200, headers: NO_STORE });
  }

  let backendResponse: Response;
  try {
    // Adres klienta dla limitu w apps/api dokłada apiFetch (tylko za zaufanym proxy).
    backendResponse = await apiFetch(`${API_URL}/t/${token}/${kind}`, { method: 'POST', cache: 'no-store' });
  } catch {
    // Bez logowania adresu ani tokenu (URL zawiera token).
    return NextResponse.json({ message: 'Usługa chwilowo niedostępna.' }, { status: 502, headers: NO_STORE });
  }
  if (!backendResponse.ok) {
    return NextResponse.json({ message: 'Usługa chwilowo niedostępna.' }, { status: backendResponse.status === 429 ? 429 : 502, headers: NO_STORE });
  }
  const data = await backendResponse.json().catch(() => null);
  // Przepuszczamy wyłącznie oczekiwany kształt (jedno pole tekstowe).
  const lessonHtml = typeof data?.lessonHtml === 'string' ? data.lessonHtml : DEFAULT_LESSON_HTML;
  return NextResponse.json({ lessonHtml }, { status: 200, headers: NO_STORE });
}
