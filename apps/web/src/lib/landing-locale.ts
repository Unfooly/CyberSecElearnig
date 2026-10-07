import { headers } from 'next/headers';
import { type ContentLocale, choosePlayerLocale, parseAcceptLanguage } from '@cyberszkolo/content';

// Język strony lądowania symulacji (D-133): wyłącznie wg przeglądarki (Accept-Language, pierwszy obsługiwany, potem EN) - strona jest
// publiczna, bez konta. Liczony po stronie serwera (layout i strona), więc HTML z serwera i po hydracji jest ten sam. Teksty: landing-text.ts.

export function landingLocale(): ContentLocale {
  try {
    return choosePlayerLocale(null, parseAcceptLanguage(headers().get('accept-language')));
  } catch {
    return 'en';
  }
}
