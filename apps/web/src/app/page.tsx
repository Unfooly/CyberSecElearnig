import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@/lib/config';
import { decodeJwtPayload } from '@/lib/jwt';
import { homePathForRole } from '@/lib/home-path';
import {
  AudienceSection,
  ComplianceBand,
  FeaturesSection,
  FinalCta,
  Hero,
  HowSection,
  LandingFooter,
  LandingNav,
  PricingSection,
  WhySection,
} from './_landing/sections';

const TITLE = 'Unfooly — szkolenia z cyberbezpieczeństwa i symulacje phishingu dla firm';
const DESCRIPTION =
  'Unfooly: krótkie szkolenia security awareness, symulacje phishingu i raporty pod NIS2 i ISO 27001. Start w jeden dzień.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Unfooly',
    locale: 'pl_PL',
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    images: [{ url: '/brand/png/unfooly-wordmark-1600.png', alt: 'Unfooly' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/brand/png/unfooly-wordmark-1600.png'],
  },
};

export default function HomePage() {
  // Strona publiczna, ale zalogowany użytkownik nie potrzebuje reklamy -
  // kierujemy go do jego panelu. To wyłącznie UX (middleware nie obejmuje
  // "/"): decyzja z payloadu JWT bez weryfikacji podpisu, a prawdziwa
  // kontrola dostępu i tak działa na /dashboard i /courses. Sama obecność
  // refresh tokena wystarcza - middleware odświeży wygasły access token.
  const store = cookies();
  if (store.get(REFRESH_TOKEN_COOKIE)?.value) {
    const accessToken = store.get(ACCESS_TOKEN_COOKIE)?.value;
    const role = accessToken ? decodeJwtPayload(accessToken)?.role : undefined;
    // Ta sama tabela co po zalogowaniu (lib/home-path.ts).
    redirect(homePathForRole(role));
  }

  return (
    <div className="min-h-screen bg-paper">
      <LandingNav />
      <main>
        <Hero />
        <WhySection />
        <HowSection />
        <FeaturesSection />
        <ComplianceBand />
        <AudienceSection />
        <PricingSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
