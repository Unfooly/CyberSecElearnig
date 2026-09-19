import { Injectable } from '@nestjs/common';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

/**
 * Klucz limitera: adres małymi literami, bez części "+tag" w części lokalnej -
 * ofiara+1@firma.pl, ofiara+2@firma.pl i ofiara@firma.pl to ta sama skrzynka,
 * więc muszą dzielić jeden limit (inaczej alias "+n" pozwalałby zalać skrzynkę).
 */
export function mailLimiterKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 0) {
    return normalized;
  }
  const local = normalized.slice(0, at).replace(/\+.*$/, '');
  return `${local}${normalized.slice(at)}`;
}

/**
 * Limit wiadomości wywołanych rejestracją: co najwyżej jedna na skrzynkę w
 * oknie 10 minut. Chroni skrzynkę ofiary przed zalewem (rejestracja jest
 * publiczna, a przy istniejącym koncie idzie mail do właściciela), bez
 * ujawniania czegokolwiek w odpowiedzi HTTP - pominięcie wysyłki jest ciche.
 *
 * Pamięć procesu (jak reszta throttlera w projekcie): przy więcej niż jednej
 * instancji api limit obowiązuje per instancja, znika po restarcie, a przy
 * zalewie tysiącami adresów najstarsze wpisy są wypierane. Docelowo Redis
 * (SET NX EX) razem z infrastrukturą BullMQ - patrz README, backlog.
 */
@Injectable()
export class RegistrationMailLimiter {
  private readonly lastSent = new Map<string, number>();

  /** true = wolno wysłać (i od razu rejestruje wysyłkę); false = zbyt wcześnie. */
  tryAcquire(email: string, now = Date.now()): boolean {
    const key = mailLimiterKey(email);
    const previous = this.lastSent.get(key);
    if (previous !== undefined && now - previous < WINDOW_MS) {
      return false;
    }
    if (this.lastSent.size >= MAX_ENTRIES) {
      this.evictExpired(now);
      if (this.lastSent.size >= MAX_ENTRIES) {
        // Nadal pełna (atak masowy): usuwamy najstarszy wpis, mapa nie rośnie bez granic.
        const oldest = this.lastSent.keys().next().value;
        if (oldest !== undefined) {
          this.lastSent.delete(oldest);
        }
      }
    }
    this.lastSent.set(key, now);
    return true;
  }

  private evictExpired(now: number): void {
    for (const [key, at] of this.lastSent) {
      if (now - at >= WINDOW_MS) {
        this.lastSent.delete(key);
      }
    }
  }
}
