import type { Metadata } from 'next';
import LandingClient from './_components/LandingClient';

// Strona lądowania symulacji phishingowej (publiczna, bez logowania i bez cookie). Renderowanie strony (GET) NIE liczy
// kliknięcia i nie woła API - robi to dopiero JS w przeglądarce (LandingClient), którego skanery linków w skrzynkach
// zwykle nie uruchamiają. Token z adresu nie jest tu w ogóle weryfikowany: każda wartość daje tę samą stronę
// (brak enumeracji tokenów). Zawartość jest ogólna - bez marek i logo prawdziwych firm.
// Metadane: strona NIE dziedziczy z layoutu opisu serwisu ani karty podglądu linku (D-126) - `null` zeruje dziedziczenie. Inaczej link z
// maila symulacji wklejony w komunikator (albo pobrany przez skaner poczty) pokazałby „Unfooly… symulacji phishingowych” i zdradził ćwiczenie.
export const metadata: Metadata = {
  title: 'Weryfikacja konta',
  description: null,
  openGraph: null,
  twitter: null,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function TrackingLandingPage({ params }: { params: { token: string } }) {
  return <LandingClient token={params.token} />;
}
