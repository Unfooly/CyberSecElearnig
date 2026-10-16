export const POLISH_CONTEXT: Readonly<{ locale: string; timezoneId: string }>;
export function withPolishLocale<T extends Record<string, unknown>>(options?: T): T & { locale: string; timezoneId: string };
export function launchPolishBrowser<B extends { newContext: (options?: unknown) => unknown; newPage: (options?: unknown) => unknown }>(
  chromium: { launch: (options?: unknown) => Promise<B> },
  launchOptions?: unknown,
): Promise<B>;
