import type { Metadata } from 'next';
import LegalPage, { PLACEHOLDER } from '../_legal/LegalPage';

// noindex: treść robocza, nie ma trafiać do wyszukiwarek przed uzupełnieniem.
export const metadata: Metadata = {
  title: 'Polityka prywatności - Unfooly',
  robots: { index: false, follow: false },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Polityka prywatności">
      <section>
        <h2>1. Administrator danych</h2>
        <p>Administratorem danych jest {PLACEHOLDER} (nazwa, adres, dane kontaktowe, inspektor ochrony danych - jeśli powołany).</p>
      </section>
      <section>
        <h2>2. Jakie dane przetwarzamy</h2>
        <ul>
          <li>Dane administratora konta: imię, nazwisko, służbowy adres e-mail.</li>
          <li>Dane firmy do faktury: pełna nazwa, NIP, adres.</li>
          <li>Dane pracowników organizacji: e-mail, imię i nazwisko, dział, postępy w szkoleniach, wyniki symulacji.</li>
          <li>Dane techniczne: adres IP, logi, ciasteczka sesyjne. {PLACEHOLDER}</li>
        </ul>
      </section>
      <section>
        <h2>3. Cele i podstawy prawne</h2>
        <p>{PLACEHOLDER} (wykonanie umowy, obowiązki prawne - faktury, prawnie uzasadniony interes - bezpieczeństwo).</p>
      </section>
      <section>
        <h2>4. Odbiorcy danych i transfer poza EOG</h2>
        <p>{PLACEHOLDER} (dostawca hostingu w UE, dostawca poczty, operator płatności; brak transferu poza EOG lub jego podstawa).</p>
      </section>
      <section>
        <h2>5. Okres przechowywania</h2>
        <p>
          Organizacje, które nie zweryfikują domeny w ciągu 14 dni od rejestracji, są usuwane wraz z danymi.{' '}
          {PLACEHOLDER} (pozostałe okresy przechowywania).
        </p>
      </section>
      <section>
        <h2>6. Prawa osób, których dane dotyczą</h2>
        <p>{PLACEHOLDER} (dostęp, sprostowanie, usunięcie, ograniczenie, przenoszenie, sprzeciw, skarga do PUODO).</p>
      </section>
    </LegalPage>
  );
}
