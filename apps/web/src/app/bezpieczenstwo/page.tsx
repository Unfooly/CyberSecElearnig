import type { Metadata } from 'next';
import LegalPage, { PLACEHOLDER } from '../_legal/LegalPage';

// noindex: treść robocza, nie ma trafiać do wyszukiwarek przed uzupełnieniem.
export const metadata: Metadata = {
  title: 'Bezpieczeństwo - Unfooly',
  robots: { index: false, follow: false },
};

export default function SecurityPage() {
  return (
    <LegalPage title="Bezpieczeństwo">
      <section>
        <h2>Izolacja danych klientów</h2>
        <p>
          Dane każdej organizacji są logicznie oddzielone: każde zapytanie do bazy jest ograniczone do organizacji
          użytkownika, a dodatkowo egzekwuje to baza danych (Row-Level Security). {PLACEHOLDER} (opis do weryfikacji przez zespół techniczny).
        </p>
      </section>
      <section>
        <h2>Lokalizacja i hosting</h2>
        <p>{PLACEHOLDER} (region UE, dostawca infrastruktury, kopie zapasowe).</p>
      </section>
      <section>
        <h2>Uwierzytelnianie i dostęp</h2>
        <p>{PLACEHOLDER} (polityka haseł, sesje, role, logowanie jednokrotne - plany).</p>
      </section>
      <section>
        <h2>Zgłaszanie podatności</h2>
        <p>{PLACEHOLDER} (adres kontaktowy do zgłoszeń bezpieczeństwa, zasady odpowiedzialnego ujawniania).</p>
      </section>
    </LegalPage>
  );
}
