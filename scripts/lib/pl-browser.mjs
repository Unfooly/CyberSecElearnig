// Przeglądarka testów i zrzutów w polskim środowisku (poprawki m3, pkt e): layout-check, e2e i arkusze zrzutów robią zdjęcia polskiego
// interfejsu, więc kontekst Playwrighta ma `locale: 'pl-PL'` (nagłówek Accept-Language, `navigator.languages`, formaty Intl) i strefę
// Europe/Warsaw. Domyślne en-US dawało w zrzutach plakietkę „Available in Polish only” i język szkoleń wybrany z przeglądarki (D-133).
// Opcje podane wprost w `newContext` wygrywają - przebieg, który celowo sprawdza inny język, nadpisuje `locale`.
// Test: scripts/content/src/pl-browser.test.ts (krok CI „Testy scripts/content”).

export const POLISH_CONTEXT = Object.freeze({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });

export function withPolishLocale(options = {}) {
  return { ...POLISH_CONTEXT, ...options };
}

// `chromium.launch()` z `newContext` (także `browser.newPage()`, które tworzy własny kontekst) domyślnie w polskim środowisku.
export async function launchPolishBrowser(chromium, launchOptions) {
  const browser = await chromium.launch(launchOptions);
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = (options) => newContext(withPolishLocale(options));
  browser.newPage = (options) => newPage(withPolishLocale(options));
  return browser;
}
