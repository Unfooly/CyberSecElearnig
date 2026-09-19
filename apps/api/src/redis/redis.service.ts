import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { redisConnectionFromUrl } from '../jobs/redis-connection';

// Po błędzie pomijamy Redis na krótko (bezpiecznik), zamiast płacić limit czasu przy każdym żądaniu.
const CIRCUIT_OPEN_MS = 5000;

/**
 * Wspólny klient Redisa dla krótkich operacji w ścieżce żądania (limity, itp.) -
 * osobny od połączeń BullMQ. Ustawiony FAIL-FAST: bez kolejki offline i z krótkimi
 * limitami czasu, żeby awaria Redisa nie zawieszała żądań (wołający ma rezerwę).
 *
 * Stan "incydentu" (Redis niedostępny) jest TUTAJ, wspólny dla wszystkich wołających:
 * log `error` raz na incydent, `info` po powrocie, oraz bezpiecznik - po błędzie Redis
 * jest pomijany przez CIRCUIT_OPEN_MS (`isAvailable()`), potem następna próba sprawdza go ponownie.
 *
 * `client` jest null, gdy brak REDIS_URL (wtedy wołający używa rezerwy). Klucze
 * tej aplikacji mają wspólny prefiks (REDIS_KEY_PREFIX, domyślnie "unfooly") -
 * unikalny per środowisko, jeśli Redis jest współdzielony.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis | null;
  readonly keyPrefix: string;
  private down = false;
  private closing = false;
  private circuitOpenUntil = 0;

  constructor(config: ConfigService) {
    this.keyPrefix = config.get<string>('REDIS_KEY_PREFIX') ?? 'unfooly';
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      this.client = null;
      if (config.get<string>('NODE_ENV') === 'production') {
        // Cichy brak REDIS_URL na produkcji = limity per instancja i bez trwałości.
        this.logger.warn('Brak REDIS_URL na produkcji - limiter maili rejestracji działa tylko w pamięci procesu.');
      }
      return;
    }
    const options = {
      ...(redisConnectionFromUrl(url) as RedisOptions),
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 500,
      retryStrategy: (times: number) => (this.closing ? null : Math.min(times * 500, 10_000)),
    };
    this.client = new Redis(options);
    // Błędy połączenia (NOAUTH, TLS, zły host...) zgłaszamy jako incydent, także gdy nikt akurat nie woła Redisa.
    this.client.on('error', (error) => this.reportFailure(error));
    this.client.on('ready', () => this.reportSuccess());
  }

  // Krótkie oczekiwanie na połączenie przy starcie (bez kolejki offline pierwsze komendy
  // przed połączeniem padłyby na rezerwę). Awaria Redisa nie blokuje startu API.
  async onModuleInit(): Promise<void> {
    await this.waitUntilReady(2000);
  }

  /** Czy warto teraz wołać Redis: klient gotowy i bezpiecznik zamknięty. */
  isAvailable(now = Date.now()): boolean {
    return !!this.client && this.client.status === 'ready' && now >= this.circuitOpenUntil;
  }

  /** Wołający zgłasza błąd operacji: raz na incydent log error, bezpiecznik otwiera się na krótko. */
  reportFailure(error: Error): void {
    if (this.closing) {
      return; // zamykanie aplikacji: brak fałszywych alarmów
    }
    this.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    if (this.down) {
      return;
    }
    this.down = true;
    this.logger.error(`Redis niedostępny (${error.message}) - funkcje z rezerwą w pamięci procesu działają w trybie awaryjnym.`);
  }

  /** Udana operacja albo zdarzenie `ready`: kończy incydent (log info raz). */
  reportSuccess(): void {
    if (!this.down) {
      return;
    }
    this.down = false;
    this.circuitOpenUntil = 0;
    this.logger.log('Redis znów dostępny - wrócono do trybu normalnego.');
  }

  /** Czeka na połączenie (do `timeoutMs`); false, gdy się nie udało. */
  async waitUntilReady(timeoutMs = 2000): Promise<boolean> {
    const client = this.client;
    if (!client) {
      return false;
    }
    if (client.status === 'ready') {
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const finish = (value: boolean) => {
        clearTimeout(timer);
        client.off('ready', onReady);
        client.off('end', onEnd);
        resolve(value);
      };
      const onReady = () => finish(true);
      const onEnd = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref();
      client.once('ready', onReady);
      client.once('end', onEnd);
    });
  }

  key(...parts: string[]): string {
    return [this.keyPrefix, ...parts].join(':');
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (!this.client) {
      return;
    }
    try {
      await Promise.race([this.client.quit(), new Promise((resolve) => setTimeout(resolve, 2000).unref())]);
    } catch (error) {
      this.logger.warn(`Zamknięcie klienta Redis: ${(error as Error).message}`);
    } finally {
      this.client.disconnect();
    }
  }
}
