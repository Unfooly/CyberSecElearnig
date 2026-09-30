import LandingClient from './_components/LandingClient';

// Strona lądowania symulacji phishingowej (publiczna, bez logowania i bez cookie). Renderowanie strony (GET) NIE liczy
// kliknięcia i nie woła API - robi to dopiero JS w przeglądarce (LandingClient), którego skanery linków w skrzynkach
// zwykle nie uruchamiają. Token z adresu nie jest tu w ogóle weryfikowany: każda wartość daje tę samą stronę
// (brak enumeracji tokenów). Zawartość jest ogólna - bez marek i logo prawdziwych firm.
// Metadane (neutralny tytuł, noindex, bez manifestu, ikon, opisu i karty podglądu serwisu): ../layout.tsx (D-126, D-127).
//
// Trasa obejmuje CAŁY prefiks /t (`[[...token]]`): /t, /t/<token> i głębsze ścieżki dają tę samą neutralną stronę. Bez tego adres
// spoza /t/<token> (np. obcięty albo z dopisanym segmentem) wpadałby w stronę 404 aplikacji, która bierze metadane z layoutu
// głównego - z nazwą serwisu, manifestem i kartą podglądu (B-141). Token to wyłącznie pojedynczy segment; inne kształty adresu
// dostają pusty token, którego LandingClient nie wysyła do API (nie pasuje do wzorca tokenu).
export const dynamic = 'force-dynamic';

export default function TrackingLandingPage({ params }: { params: { token?: string[] } }) {
  const token = params.token?.length === 1 ? params.token[0] : '';
  return <LandingClient token={token} />;
}
