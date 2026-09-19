import { PhishingMailTransport, PhishingSendResult, PhishingTransportError } from './phishing-mail-transport';

/**
 * Transport "brak konfiguracji": każda wysyłka to trwały błąd (bez ponawiania) z kodem przyczyny. API nie
 * wywraca się przy starcie - uruchomienie kampanii jest blokowane wcześniej czytelnym błędem (409), a to
 * jest ostatnia linia obrony (nic nie może wyjść, gdy konfiguracja jest niepełna lub niebezpieczna).
 */
export class NotConfiguredPhishingTransport extends PhishingMailTransport {
  readonly name = 'none';

  constructor(readonly reason: string) {
    super();
  }

  // Parametr wiadomości pomijamy celowo: żadna treść nie jest tu w ogóle odczytywana.
  async send(): Promise<PhishingSendResult> {
    throw new PhishingTransportError(`Transport symulacji nieskonfigurowany (${this.reason}).`, false, `NOT_CONFIGURED_${this.reason}`);
  }
}
