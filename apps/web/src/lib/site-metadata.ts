import type { Metadata } from 'next';

// Wspólne metadane podglądu linku (Open Graph / Twitter) dla całego serwisu (D-126, zamyka B-110): jedna grafika serwisu, bez danych
// kursów. Strony za logowaniem (np. /courses/<id>) dziedziczą te wartości z layoutu - niezalogowany (także bot podglądu linków) nigdy nie
// dostaje w meta tytułu ani miniatury kursu. Adres obrazu jest względny; bezwzględny robi z niego `metadataBase` (SITE_URL) w layoucie.
export const SITE_NAME = 'Unfooly';
export const SITE_TITLE = 'Unfooly - szkolenia z cyberbezpieczeństwa';
export const SITE_DESCRIPTION = 'Platforma szkoleń z cyberbezpieczeństwa i symulacji phishingowych';

// Grafika 1200×630 z kompozytora scen (scripts/content/scenes/examples/og/og-unfooly.json), PNG: scripts/render-og-image.mjs.
export const OG_IMAGE = { url: '/og/og-unfooly.png', width: 1200, height: 630, alt: 'Unfooly - szkolenia z cyberbezpieczeństwa' } as const;

/** Open Graph i karta Twittera z grafiką serwisu; strona publiczna podaje własny tytuł, opis i adres. */
export function socialMetadata({ title = SITE_TITLE, description = SITE_DESCRIPTION, url }: { title?: string; description?: string; url?: string } = {}): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'pl_PL',
      title,
      description,
      ...(url ? { url } : {}),
      images: [{ ...OG_IMAGE }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [OG_IMAGE.url],
    },
  };
}
