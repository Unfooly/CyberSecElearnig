import type { Metadata } from 'next';

// Wspólne metadane podglądu linku (Open Graph / Twitter) dla całego serwisu (D-126, zamyka B-110): jedna grafika serwisu, bez danych
// kursów. Strony za logowaniem (np. /courses/<id>) dziedziczą te wartości z layoutu - niezalogowany (także bot podglądu linków) nigdy nie
// dostaje w meta tytułu ani miniatury kursu. Adres obrazu jest względny; bezwzględny robi z niego `metadataBase` (SITE_URL) w layoucie.
export const SITE_NAME = 'Unfooly';
export const SITE_TITLE = 'Unfooly - szkolenia z cyberbezpieczeństwa';
export const SITE_DESCRIPTION = 'Platforma szkoleń z cyberbezpieczeństwa i symulacji phishingowych';

// Grafika 1200×630 z kompozytora scen (scripts/content/scenes/examples/og/og-unfooly.json), PNG: scripts/render-og-image.mjs.
export const OG_IMAGE = { url: '/og/og-unfooly.png', width: 1200, height: 630, alt: 'Unfooly - szkolenia z cyberbezpieczeństwa' } as const;

// Manifest i ikony serwisu jako zwykłe pola metadanych (pliki w public/), NIE pliki-konwencje Next (app/icon.svg, app/manifest.ts):
// te drugie są doklejane do każdej strony i segment niżej nie może ich wyłączyć, a strona lądowania symulacji (/t/*) musi być bez
// marki (B-141). Adresy plików bez zmian: /favicon.ico, /icon.svg, /manifest.webmanifest.
export const SITE_MANIFEST = '/manifest.webmanifest';
export const SITE_ICONS: NonNullable<Metadata['icons']> = {
  icon: [
    { url: '/favicon.ico', sizes: '16x16', type: 'image/x-icon' },
    { url: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
};

// Strona lądowania symulacji phishingowej (/t/*): generyczna ikona dokumentu, bez manifestu, opisu i karty podglądu serwisu.
// Ikona jest osadzona w adresie `data:` - bez dodatkowego żądania (host lądowania przepuszcza przez WAF tylko /t/*, /api/t/* i
// /_next/*, docs/deploy-test.md), a przeglądarka nie sięga po /favicon.ico serwisu. PNG dla przeglądarek bez ikon SVG.
const NEUTRAL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
  '<path d="M8 3h11l6 6v18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#FFFFFF" stroke="#6B7280" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M19 3v6h6" fill="none" stroke="#6B7280" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M10.5 15h11M10.5 19.5h11M10.5 24h7" stroke="#9CA3AF" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>';
// Ten sam dokument jako PNG 32×32 (paleta barw, 351 bajtów).
const NEUTRAL_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAYFBMVEVMaXF/f39rcn9rcYBqcYBoc39qcn9qcYBrcn9mcIRrcYBqcn9qcn9qcYBtbZFrcoD///+co6/KztTR1Nri5OiepbH4+fmFi5bz8/XU19zS1tvP09jc3eGOk57d3+Ld3uLer/6MAAAAD3RSTlMABorT1xbE5eYZh4aIiQdY4+B7AAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAiklEQVQ4y8XT2Q6DIBCFYVwq2O3ghlWrff+3rImKyGAv1Mb/li8TmATGjunpC8xFFwJ8LAqIEOikziUAaYISYfwTvIiwgCTCAsNbVkE7ilUwzTkB5EWiK/ItYP8dVJ3pauUAVWJUuSY0qa5Rf11Uv4ONYN8dBD7W+RvcBHfQbibwHtw65lfvoG/NvgdOI3eHqyckAAAAAElFTkSuQmCC';
export const NEUTRAL_ICONS: NonNullable<Metadata['icons']> = {
  icon: [
    { url: `data:image/png;base64,${NEUTRAL_ICON_PNG_BASE64}`, sizes: '32x32', type: 'image/png' },
    { url: `data:image/svg+xml,${encodeURIComponent(NEUTRAL_ICON_SVG)}`, sizes: 'any', type: 'image/svg+xml' },
  ],
};

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
