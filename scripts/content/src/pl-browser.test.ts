import { describe, expect, it, vi } from 'vitest';
import { launchPolishBrowser, POLISH_CONTEXT, withPolishLocale } from '../../lib/pl-browser.mjs';

// Poprawki m3 (pkt e): zrzuty i e2e w polskim środowisku przeglądarki; jawne opcje przebiegu wygrywają.
describe('pl-browser', () => {
  it('domyślnie pl-PL i Europe/Warsaw, reszta opcji bez zmian', () => {
    expect(withPolishLocale({ viewport: { width: 390, height: 844 } })).toEqual({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw', viewport: { width: 390, height: 844 } });
    expect(withPolishLocale()).toEqual(POLISH_CONTEXT);
  });

  it('jawny locale przebiegu (np. test innego języka) nadpisuje domyślny', () => {
    expect(withPolishLocale({ locale: 'en-GB' }).locale).toBe('en-GB');
  });

  it('launchPolishBrowser: newContext i newPage dostają polskie opcje', async () => {
    const newContext = vi.fn(async (options: unknown) => options);
    const newPage = vi.fn(async (options: unknown) => options);
    const chromium = { launch: vi.fn(async () => ({ newContext, newPage })) };
    const browser = await launchPolishBrowser(chromium, { headless: true });

    expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
    await browser.newContext({ hasTouch: true });
    await browser.newPage();
    expect(newContext).toHaveBeenCalledWith({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw', hasTouch: true });
    expect(newPage).toHaveBeenCalledWith({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
  });
});
