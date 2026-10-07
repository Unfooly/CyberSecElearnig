import { baseLocale, choosePlayerLocale, courseContentLocale, parseAcceptLanguage, pickSupportedLocale } from './index';

// Wybór języka szkoleń (D-133): konto > przeglądarka (pierwszy obsługiwany, po języku bazowym) > EN.

const fromHeader = (header: string) => choosePlayerLocale(null, parseAcceptLanguage(header));

describe('wybór języka szkoleń', () => {
  it('Accept-Language: de-DE -> en (nieobsługiwany - domyślny EN); pl-PL -> pl; en-US,pl;q=0.8 -> en', () => {
    expect(fromHeader('de-DE')).toBe('en');
    expect(fromHeader('pl-PL')).toBe('pl');
    expect(fromHeader('en-US,pl;q=0.8')).toBe('en');
  });

  it('pierwszy OBSŁUGIWANY wg wag: de-DE,pl;q=0.9,en;q=0.8 -> pl; wagi przed kolejnością; q=0 i * pomijane', () => {
    expect(fromHeader('de-DE,pl;q=0.9,en;q=0.8')).toBe('pl');
    expect(fromHeader('en;q=0.5,pl')).toBe('pl');
    expect(fromHeader('pl;q=0,en')).toBe('en');
    expect(parseAcceptLanguage('*, pl-PL;q=0.7, x?y, en-GB;q=0.9')).toEqual(['en-GB', 'pl-PL']);
  });

  it('ustawienie konta wygrywa nad przeglądarką; brak konta i przeglądarki - EN', () => {
    expect(choosePlayerLocale('pl', parseAcceptLanguage('en-US'))).toBe('pl');
    expect(choosePlayerLocale('en', ['pl-PL'])).toBe('en');
    expect(choosePlayerLocale(null, [])).toBe('en');
    expect(choosePlayerLocale('xx', ['pl'])).toBe('pl');
  });

  it('dopasowanie po języku bazowym (navigator.languages)', () => {
    expect(baseLocale('en-GB')).toBe('en');
    expect(baseLocale('PL_pl')).toBe('pl');
    expect(baseLocale('de')).toBeNull();
    expect(pickSupportedLocale(['de-DE', 'fr', 'en-GB'])).toBe('en');
  });

  it('kurs bez języka gracza: PL z plakietką; kurs z językiem gracza - ten język; gracz PL - bez plakietki', () => {
    expect(courseContentLocale('en', ['pl'])).toEqual({ locale: 'pl', fallback: true });
    expect(courseContentLocale('en', ['pl', 'en'])).toEqual({ locale: 'en', fallback: false });
    expect(courseContentLocale('pl', ['pl'])).toEqual({ locale: 'pl', fallback: false });
  });
});
