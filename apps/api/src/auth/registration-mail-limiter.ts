import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';

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

/** Okno w pamięci procesu - REZERWA na czas awarii Redisa (limit obowiązuje wtedy per instancja). */
class InMemoryWindow {
  private readonly lastSent = new Map<string, number>();

  tryAcquire(key: string, now: number): boolean {
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

/**
 * Limit wiadomości wywołanych rejestracją: co najwyżej jedna na skrzynkę w
 * oknie 10 minut. Chroni skrzynkę ofiary przed zalewem (rejestracja jest
 * publiczna, a przy istniejącym koncie idzie mail do właściciela), bez
 * ujawniania czegokolwiek w odpowiedzi HTTP - pominięcie wysyłki jest ciche.
 *
 * Stan w Redisie (`SET key NX PX 600000` - atomowe, wspólne dla wszystkich instancji
 * api, przeżywa restart). Klucz to SHA-256 znormalizowanego adresu: adresy nie leżą
 * w Redisie jawnie. Czas wygasania liczy Redis (nie zegar aplikacji).
 *
 * Awaria Redisa: FAIL-OPEN z rezerwą w pamięci procesu (limit per instancja) - mail
 * ma wyjść, a skrzynka i tak jest chroniona (mniej szczelnie). Stan incydentu, logi
 * (error raz na incydent, info po powrocie) i bezpiecznik (krótka przerwa w wołaniu
 * Redisa po błędzie) prowadzi RedisService. Uwaga: `SET`, który wygasł po stronie
 * klienta (timeout), mógł się wykonać w Redisie - rezerwa dopuści wtedy drugi mail
 * (świadomy kompromis fail-open).
 */
@Injectable()
export class RegistrationMailLimiter {
  private readonly fallback = new InMemoryWindow();
  /** Przestrzeń kluczy w Redisie; podklasa dla innego rodzaju wiadomości ma własną, więc jej okno nie zjada okna rejestracji. */
  protected readonly namespace: string = 'reg-mail';

  constructor(@Optional() private readonly redis?: RedisService) {}

  /**
   * true = wolno wysłać (i od razu rejestruje wysyłkę); false = zbyt wcześnie.
   * `now` dotyczy WYŁĄCZNIE rezerwy w pamięci (testy); w Redisie czas liczy sam Redis.
   */
  async tryAcquire(email: string, now = Date.now()): Promise<boolean> {
    const normalized = mailLimiterKey(email);
    const redis = this.redis;
    if (!redis?.client || !redis.isAvailable()) {
      // Brak Redisa w konfiguracji, niegotowy klient albo otwarty bezpiecznik: rezerwa.
      return this.fallback.tryAcquire(normalized, now);
    }

    const key = redis.key(this.namespace, createHash('sha256').update(normalized).digest('hex'));
    try {
      const result = await redis.client.set(key, '1', 'PX', WINDOW_MS, 'NX');
      redis.reportSuccess();
      return result === 'OK';
    } catch (error) {
      redis.reportFailure(error as Error);
      return this.fallback.tryAcquire(normalized, now);
    }
  }
}

/**
 * Ten sam limit "jedna wiadomość na skrzynkę na 10 minut" dla wiadomości "ktoś próbował dodać Cię do organizacji", ale w OSOBNEJ
 * przestrzeni kluczy: organizacja zapraszająca cudzy adres nie może zużyć okna skrzynki i w ten sposób wyciszyć maila
 * rejestracyjnego/aktywacyjnego właściciela.
 */
@Injectable()
export class InviteNoticeMailLimiter extends RegistrationMailLimiter {
  protected override readonly namespace: string = 'invite-notice';
}
