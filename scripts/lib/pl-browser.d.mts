export const POLISH_CONTEXT: Readonly<{ locale: string; timezoneId: string }>;
export function withPolishLocale<T extends Record<string, unknown>>(options?: T): T & { locale: string; timezoneId: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- opcje kontekstu Playwrighta (BrowserContextOptions) bez zależności od playwright
export function launchPolishBrowser<B extends { newContext: (options?: any) => unknown; newPage: (options?: any) => unknown }>(
  chromium: { launch: (options?: unknown) => Promise<B> },
  launchOptions?: unknown,
): Promise<B>;
