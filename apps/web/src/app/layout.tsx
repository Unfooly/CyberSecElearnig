import type { Metadata, Viewport } from 'next';
import { Courier_Prime, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { SITE_URL } from '@/lib/landing-config';
import { SITE_DESCRIPTION, SITE_ICONS, SITE_MANIFEST, SITE_NAME, socialMetadata } from '@/lib/site-metadata';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
});

// Font "maszynowy" WYŁĄCZNIE do numeru sprawy (odprawa) i treści dokumentów w teczce (docs/brand/BRAND.md, D-081). next/font
// pobiera plik przy buildzie i serwuje go z naszego originu - zero żądań do Google w przeglądarce (CSP font-src 'self').
// preload: false - używany na jednym ekranie odtwarzacza, nie ma powodu dociągać go na każdej stronie.
const typewriter = Courier_Prime({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-typewriter',
});

// Domyślne metadane każdej strony, także tych za logowaniem (D-126): wspólny podgląd linku serwisu, bez danych kursów. `metadataBase`
// zamienia względny adres grafiki na bezwzględny (wymóg Open Graph).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  // Pola, nie pliki-konwencje w app/: segment /t je wyłącza (B-141).
  manifest: SITE_MANIFEST,
  icons: SITE_ICONS,
  ...socialMetadata(),
};

// viewportFit: 'cover' (feat/player-stage, D-075 sąsiedztwo): pozwala treści wchodzić pod notch/wyspę/pasek gestów -
// BEZ tego env(safe-area-inset-*) zawsze zwraca 0, więc każdy dotychczasowy pb-[env(...)] (modale-bottom-sheety z
// PR #40/#41) był martwym kodem. Każdy element, który dotyka krawędzi ekranu (Topbar, modale, dolny pasek
// odtwarzacza), MUSI mieć własny safe-area padding od teraz - to ustawienie dotyczy całej aplikacji, nie tylko
// odtwarzacza.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// CSP z nonce (middleware.ts, security-headers.ts) jest generowane per żądanie, więc KAŻDA strona musi być renderowana dynamicznie:
// statyczny HTML miałby skrypty inline Next.js bez nonce i przeglądarka by je zablokowała (D-053).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${jakarta.variable} ${typewriter.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
