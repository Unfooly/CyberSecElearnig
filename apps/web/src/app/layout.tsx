import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { SITE_URL } from '@/lib/landing-config';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Unfooly',
  description: 'Platforma szkoleń z cyberbezpieczeństwa i symulacji phishingowych',
};

// CSP z nonce (middleware.ts, security-headers.ts) jest generowane per żądanie, więc KAŻDA strona musi być renderowana dynamicznie:
// statyczny HTML miałby skrypty inline Next.js bez nonce i przeglądarka by je zablokowała (D-053).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={jakarta.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
