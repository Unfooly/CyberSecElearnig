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

/** Zadanie jednorazowe (z danymi, opcjonalnie opóźnione) - np. wysyłka jednego maila kampanii. */
export interface TaskDefinition {
  name: string;
  handler: (data: unknown) => Promise<unknown>;
}

export interface EnqueueOptions {
  delayMs: number;
  /** Deduplikacja: dodanie zadania o tym samym id jest ignorowane, dopóki poprzednie istnieje. Bez ":". */
  jobId: string;
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
  private readonly tasks = new Map<string, TaskDefinition>();
  private queue?: Queue;
  private worker?: Worker;
  private destroyed = false;
  private ready = false;
  private retire?: () => void;
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

  /**
   * Rejestruje obsługę zadań jednorazowych o danej nazwie (enqueueDelayed). Wywoływane z onModuleInit.
   * Handler dostaje dane zadania i MUSI być idempotentny (ponowienia BullMQ, duplikaty po awarii Redisa).
   */
  registerTask(task: TaskDefinition): void {
    this.tasks.set(task.name, task);
  }

  /**
   * Dodaje zadanie jednorazowe z opóźnieniem. Rzuca, gdy kolejka nie jest gotowa (Redis niedostępny,
   * zadania wyłączone) - wołający decyduje, czy to błąd, czy zostawia sprawę zadaniu uzgadniającemu.
   */
  async enqueueDelayed(name: string, data: unknown, options: EnqueueOptions & { replaceFinished?: boolean }): Promise<void> {
    if (!this.queue || !this.ready) {
      throw new Error('Kolejka zadań niedostępna.');
    }
    if (options.replaceFinished) {
      // Zakończone/nieudane zadanie o tym samym id zostaje w Redisie (removeOnComplete/removeOnFail) i blokowałoby
      // dodanie nowego (deduplikacja po jobId). Zadanie oczekujące/w toku zostaje nietknięte (add jest wtedy no-op).
      const existing = await this.queue.getJob(options.jobId);
      if (existing && ['failed', 'completed'].includes(await existing.getState())) {
        await existing.remove().catch(() => undefined);
      }
    }
    await this.queue.add(name, data, { delay: Math.max(0, Math.round(options.delayMs)), jobId: options.jobId });
  }

  /** Dodaje wiele zadań jednorazowych jednym round-tripem (addBulk); dedup po jobId jak w enqueueDelayed. */
  async enqueueDelayedBulk(name: string, items: { data: unknown; options: EnqueueOptions }[]): Promise<void> {
    if (!this.queue || !this.ready) {
      throw new Error('Kolejka zadań niedostępna.');
    }
    if (items.length === 0) {
      return;
    }
    await this.queue.addBulk(items.map(({ data, options }) => ({ name, data, opts: { delay: Math.max(0, Math.round(options.delayMs)), jobId: options.jobId } })));
  }

  /** Usuwa oczekujące (opóźnione/czekające) zadania po id; zadania w toku i nieistniejące są pomijane. */
  async removeQueued(jobIds: string[]): Promise<void> {
    if (!this.queue || !this.ready) {
      throw new Error('Kolejka zadań niedostępna.');
    }
    for (const jobId of jobIds) {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove().catch(() => undefined); // zadanie w toku (zablokowane) nie da się usunąć - sendOne sam sprawdzi status kampanii
      }
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Kończy się, gdy harmonogram jest zaplanowany (albo serwis zamknięty). Dla testów. */
  whenStarted(): Promise<void> {
    return this.startup;
  }

  onApplicationBootstrap(): void {
    if (!this.isEnabled() || (this.jobs.size === 0 && this.tasks.size === 0)) {
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
    // Każda próba ma własną flagę: zamknięcie/porzucenie próby wyłącza ponawianie jej połączeń.
    const alive = { value: true };
    this.retire = () => {
      alive.value = false;
    };
    const connection = redisConnectionFromUrl(redisUrl, () => alive.value);
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
        const task = this.tasks.get(job.name);
        if (task) {
          return task.handler(job.data);
        }
        const definition = this.jobs.get(job.name);
        if (!definition) {
          throw new Error(`Nieznane zadanie: ${job.name}`);
        }
        return definition.handler();
      },
      // Kilka zadań równolegle: wolny/timeoutujący transport jednej wiadomości nie blokuje reszty kampanii
      // ani zadań cyklicznych (wszystkie handlery są idempotentne i race-safe).
      { connection, prefix, concurrency: 4 },
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
      // Zamknięcie aplikacji przerywa wyścig (this.stopped) - ten timer nie może jej wtedy przytrzymać.
      timer.unref();
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
    if (!wasReady) {
      this.retire?.();
    }
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
    if (!this.ready) {
      this.retire?.();
    }
    const worker = this.worker;
    const queue = this.queue;
    this.worker = undefined;
    this.queue = undefined;
    await this.closeBoth(worker, queue);
  }
}
