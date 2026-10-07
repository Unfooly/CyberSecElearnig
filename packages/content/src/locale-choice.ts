import { CONTENT_LOCALES, ContentLocale, DEFAULT_CONTENT_LOCALE } from './common';

// Wybór języka szkoleń (D-133, i18n-1). Kolejność: (1) język zapisany na koncie („Język szkoleń”), (2) język przeglądarki - nagłówek
// Accept-Language po stronie serwera albo navigator.languages po stronie klienta, pierwszy obsługiwany, (3) EN. Obsługiwane języki to
// CONTENT_LOCALES (jedna stała). Dopasowanie po języku bazowym: pl-PL -> pl, en-GB -> en. Izomorficzne - API (nagłówek przekazany przez BFF)
// i web (strona lądowania /t bez konta, przełączniki) liczą to samo.

/** Język, gdy ani konto, ani przeglądarka nie wskazuje obsługiwanego (decyzja właściciela: EN). */
export const FALLBACK_PLAYER_LOCALE: ContentLocale = 'en';

/** Język bazowy znacznika BCP 47 (`pl-PL` -> `pl`), jeśli obsługiwany. */
export function baseLocale(tag: string): ContentLocale | null {
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  return (CONTENT_LOCALES as readonly string[]).includes(base) ? (base as ContentLocale) : null;
}

/**
 * Języki z nagłówka Accept-Language w kolejności preferencji (wagi `q`, przy równej wadze - kolejność w nagłówku). `*` i wpisy z q=0
 * pomijane; zły format wpisu - pominięty (nagłówek pochodzi od klienta).
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .slice(0, 500)
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p)).find(Boolean);
      return { tag: tag.trim(), q: q ? Number(q[1]) : 1, index };
    })
    .filter((entry) => /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(entry.tag) && entry.q > 0 && Number.isFinite(entry.q))
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}

/** Pierwszy obsługiwany język z listy preferencji przeglądarki albo null. */
export function pickSupportedLocale(preferred: readonly string[]): ContentLocale | null {
  for (const tag of preferred) {
    const locale = baseLocale(tag);
    if (locale) return locale;
  }
  return null;
}

/** Język szkoleń gracza: konto > przeglądarka > EN. */
export function choosePlayerLocale(account: string | null | undefined, browser: readonly string[]): ContentLocale {
  const fromAccount = account ? baseLocale(account) : null;
  return fromAccount ?? pickSupportedLocale(browser) ?? FALLBACK_PLAYER_LOCALE;
}

/**
 * Język treści kursu: wybrany język gracza, jeśli kurs go ma, inaczej `pl` (każdy kurs ma polski) z plakietką „Available in Polish only”.
 * Nigdy nie mieszamy języków w obrębie kursu - cały kurs w jednym języku.
 */
export function courseContentLocale(player: ContentLocale, courseLocales: readonly string[]): { locale: ContentLocale; fallback: boolean } {
  if (courseLocales.includes(player)) return { locale: player, fallback: false };
  return { locale: DEFAULT_CONTENT_LOCALE, fallback: player !== DEFAULT_CONTENT_LOCALE };
}
