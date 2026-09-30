import type { Metadata } from 'next';
import { NEUTRAL_ICONS } from '@/lib/site-metadata';

// Layout stron lądowania symulacji phishingowej (/t/*, B-141): żadnej marki serwisu w HTML. Zeruje wszystko, co dziedziczy się z
// layoutu głównego - manifest (nazwa i opis serwisu), ikony, opis i kartę podglądu linku - i podstawia generyczną ikonę dokumentu
// osadzoną w adresie `data:` (bez dodatkowego żądania). Trasa `[[...token]]` obejmuje cały prefiks /t, więc żaden adres pod /t nie
// wpada w stronę 404 aplikacji z metadanymi serwisu; nagłówek CSP tych stron nie wymienia magazynu treści (middleware.ts).
// Inaczej skaner poczty, podgląd linku w komunikatorze albo uważny odbiorca rozpoznałby po ikonie lub manifeście, że to ćwiczenie.
// Tytuł jest neutralny („Weryfikacja konta”) także po kliknięciu - treść szkoleniowa pojawia się w treści strony, nie w <title>.
// Test: src/lib/site-metadata.test.ts; na buildzie produkcyjnym HTML nie zawiera „unfooly”, manifest.webmanifest ani /icon.
export const metadata: Metadata = {
  title: 'Weryfikacja konta',
  description: null,
  manifest: null,
  icons: NEUTRAL_ICONS,
  openGraph: null,
  twitter: null,
  robots: { index: false, follow: false },
};

export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
