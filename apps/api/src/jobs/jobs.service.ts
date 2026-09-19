import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { redisConnectionFromUrl } from './redis-connection';

export const MAINTENANCE_QUEUE = 'maintenance';

// Jedna próba uruchomienia (połączenie + zaplanowanie) i przerwa między próbami.
const START_TIMEOUT_MS = 15_000;
const START_RETRY_DELAY_MS = 30_000;
const CLOSE_TIMEOUT_MS = 2_000;
// Czas, jaki worker ma na dokończenie trwającego zadania przy zamknięciu aplikacji.
const GRACEFUL_CLOSE_TIMEOUT_MS = 30_000;

export interface RecurringJob {
  /** Nazwa zadania = także identyfikator harmonogramu (jedno powtarzalne zadanie na nazwę). */
  name: string;
  /** Wyrażenie cron (UTC). */
  cron: string;
  handler: () => Promise<unknown>;
}

/**
 * Wspólna konfiguracja kolejki/workera BullMQ (Redis). Jeden worker w procesie
 * API obsługuje wszystkie zadania cykliczne; kolejne (np. OVERDUE, kampanie)
 * rejestrują się przez registerRecurring() w swoim module - bez zmian tutaj.
 *
 * Harmonogram to upsert (idempotentny): wiele instancji API albo restart nie
 * dubluje zadania. Zadania powinny być idempotentne (retry po błędzie).
 *
 * Wyłączone w testach (NODE_ENV=test) - włącza je BACKGROUND_JOBS_ENABLED=true,
 * wyłącza =false. Start idzie W TLE z ponawianiem: brak Redisa nie blokuje
 * startu API (BullMQ czeka na Redis bez limitu, więc await w bootstrapie
 * zawiesiłby aplikację) - błędy są logowane, a próby powtarzane.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly jobs = new Map<string, RecurringJob>();
  private queue?: Queue;
  private worker?: Worker;
  private destroyed = false;
  private ready = false;
  private wake?: () => void;
  private stop!: () => void;
  private readonly stopped = new Promise<void>((resolve) => {
    this.stop = resolve;
  });
  private startup: Promise<void> = Promise.resolve();

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    const flag = this.config.get<string>('BACKGROUND_JOBS_ENABLED');
    if (flag === 'true') return true;
    if (flag === 'false') return false;
    return this.config.get<string>('NODE_ENV') !== 'test';
  }

  /** Wywoływane z onModuleInit modułów; harmonogram startuje w onApplicationBootstrap. */
  registerRecurring(job: RecurringJob): void {
    this.jobs.set(job.name, job);
  }

  /** Kończy się, gdy harmonogram jest zaplanowany (albo serwis zamknięty). Dla testów. */
  whenStarted(): Promise<void> {
    return this.startup;
  }

  onApplicationBootstrap(): void {
    if (!this.isEnabled() || this.jobs.size === 0) {
      return;
    }
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.error('Brak REDIS_URL - zadania w tle nie zostały uruchomione.');
      return;
    }
    // Celowo bez await: patrz komentarz klasy.
    this.startup = this.startWithRetry(redisUrl);
  }

  private async startWithRetry(redisUrl: string): Promise<void> {
    while (!this.destroyed) {
      try {
        const attempt = this.start(redisUrl);
        attempt.catch(() => undefined); // po przerwaniu/timeoucie nie zostawiamy nieobsłużonego odrzucenia
        // Zamknięcie aplikacji przerywa oczekiwanie na (niedostępny) Redis.
        await Promise.race([this.withTimeout(attempt, START_TIMEOUT_MS), this.stopped]);
        return;
      } catch (error) {
        this.logger.error(`Nie udało się uruchomić zadań w tle (ponowię za ${START_RETRY_DELAY_MS / 1000} s): ${(error as Error).message}`);
        await this.closeConnections();
        await this.sleep(START_RETRY_DELAY_MS);
      }
    }
  }

  private async start(redisUrl: string): Promise<void> {
    const connection = redisConnectionFromUrl(redisUrl);
    const prefix = this.config.get<string>('JOBS_QUEUE_PREFIX') ?? 'unfooly';

    this.queue = new Queue(MAINTENANCE_QUEUE, {
      connection,
      prefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    });
    this.queue.on('error', (error) => this.logger.error(`Kolejka: ${error.message}`));

    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        const definition = this.jobs.get(job.name);
        if (!definition) {
          throw new Error(`Nieznane zadanie: ${job.name}`);
        }
        return definition.handler();
      },
      { connection, prefix, concurrency: 1 },
    );
    this.worker.on('error', (error) => this.logger.error(`Worker: ${error.message}`));
    this.worker.on('failed', (job, error) => this.logger.error(`Zadanie ${job?.name} nieudane: ${error.message}`));

    for (const job of this.jobs.values()) {
      await this.queue.upsertJobScheduler(job.name, { pattern: job.cron, tz: 'UTC' }, { name: job.name });
      this.logger.log(`Zaplanowano zadanie ${job.name} (${job.cron} UTC)`);
    }
    this.ready = true;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${ms} ms (Redis niedostępny?)`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private async closeConnections(): Promise<void> {
    const worker = this.worker;
    const queue = this.queue;
    this.worker = undefined;
    this.queue = undefined;
    await this.closeBoth(worker, queue);
  }

  // Zamknięcie z limitem czasu: przy niedostępnym Redisie close() BullMQ potrafi
  // czekać na połączenie w nieskończoność - nie może to blokować ani ponowień, ani
  // zamknięcia aplikacji. Przy timeoucie wymuszamy rozłączenie.
  private async closeBoth(worker: Worker | undefined, queue: Queue | undefined): Promise<void> {
    const wasReady = this.ready;
    this.ready = false;
    // Gdy start się nie powiódł (Redis niedostępny), nie ma czego domykać łagodnie -
    // od razu rozłączamy. Gdy działa: worker dokańcza bieżące zadanie (do limitu).
    const closing = [worker, queue].map((client) => {
      if (!client) return Promise.resolve();
      if (wasReady) {
        return this.withTimeout(client.close(), GRACEFUL_CLOSE_TIMEOUT_MS).catch(() => undefined);
      }
      // Nieudany start: wymuszone zamknięcie (Worker: force) + rozłączenie, żeby ioredis
      // przestał ponawiać połączenia z niedostępnym Redisem.
      const forced = client instanceof Worker ? client.close(true) : client.close();
      return this.withTimeout(forced, CLOSE_TIMEOUT_MS)
        .catch(() => undefined)
        .then(() => this.withTimeout(client.disconnect(), CLOSE_TIMEOUT_MS))
        .catch(() => undefined);
    });
    await Promise.all(closing);
  }

  /**
   * Zamknięcie (wymaga app.enableShutdownHooks() w main.ts - inaczej SIGTERM
   * nie dojdzie tu i trwający job zostałby ucięty): worker czeka na
   * dokończenie bieżącego zadania, potem zamykane są połączenia.
   */
  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.stop();
    this.wake?.();
    const worker = this.worker;
    const queue = this.queue;
    this.worker = undefined;
    this.queue = undefined;
    await this.closeBoth(worker, queue);
  }
}
