import type { Metadata } from 'next';
import LegalPage, { PLACEHOLDER } from '../_legal/LegalPage';

// noindex: treść robocza, nie ma trafiać do wyszukiwarek przed uzupełnieniem.
export const metadata: Metadata = {
  title: 'Regulamin - Unfooly',
  robots: { index: false, follow: false },
};

export default function TermsPage() {
  return (
    <LegalPage title="Regulamin">
      <section>
        <h2>1. Postanowienia ogólne</h2>
        <p>
          Regulamin określa zasady korzystania z platformy Unfooly (szkolenia z cyberbezpieczeństwa i symulacje
          phishingowe) świadczonej przez {PLACEHOLDER} (nazwa, adres, NIP, KRS usługodawcy).
        </p>
      </section>
      <section>
        <h2>2. Rejestracja i konto organizacji</h2>
        <p>
          Konto organizacji zakłada osoba upoważniona do reprezentowania firmy, podając służbowy adres e-mail w domenie
          firmowej i dane firmy. Aktywacja organizacji wymaga potwierdzenia adresu e-mail oraz udowodnienia kontroli nad
          domeną (rekord DNS). {PLACEHOLDER} (zasady dotyczące organizacji niezweryfikowanych i ich usuwania).
        </p>
      </section>
      <section>
        <h2>3. Zakres usługi, licencje i płatności</h2>
        <p>{PLACEHOLDER} (zakres usługi, liczba licencji, cennik, fakturowanie, okres rozliczeniowy).</p>
      </section>
      <section>
        <h2>4. Obowiązki użytkownika</h2>
        <p>{PLACEHOLDER} (zakaz nadużyć, symulacje phishingowe wyłącznie wobec własnych pracowników, zgody pracowników).</p>
      </section>
      <section>
        <h2>5. Odpowiedzialność, reklamacje, rozwiązanie umowy</h2>
        <p>{PLACEHOLDER}</p>
      </section>
      <section>
        <h2>6. Postanowienia końcowe</h2>
        <p>{PLACEHOLDER} (prawo właściwe, sąd, zmiany regulaminu, data wejścia w życie).</p>
      </section>
    </LegalPage>
  );
}
