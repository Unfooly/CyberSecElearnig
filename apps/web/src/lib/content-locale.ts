import { CONTENT_LOCALES, type ContentLocale } from '@cyberszkolo/content';

// Język szkoleń (D-133): etykiety języków (każda w swoim języku - osoba, która nie zna języka interfejsu, rozpozna swój) i zapis
// ustawienia konta przez BFF (PATCH /api/users/me/preferences { contentLocale }). Wybór języka treści liczy API (konto > przeglądarka > EN).

export const LOCALE_LABEL: Record<ContentLocale, string> = { pl: 'Polski', en: 'English' };

export const SUPPORTED_CONTENT_LOCALES: readonly ContentLocale[] = CONTENT_LOCALES;

/** Zapis języka szkoleń na koncie; null - „wg przeglądarki”. Zwraca status HTTP (0 - błąd sieci). */
export async function saveContentLocale(locale: ContentLocale | null): Promise<number> {
  try {
    const response = await fetch('/api/users/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentLocale: locale }),
    });
    return response.status;
  } catch {
    return 0;
  }
}
