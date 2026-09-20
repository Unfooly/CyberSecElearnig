import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { REFRESH_TOKEN_CLEANUP_JOB } from '../src/auth/refresh-token-cleanup.service';
import { THREAT_REPORT_RETENTION_JOB } from '../src/threat-reports/threat-report-retention.service';
import { CAMPAIGN_RECONCILE_JOB } from '../src/phishing/campaigns/campaign-reconcile.service';
import { PENDING_ORGANIZATION_CLEANUP_JOB } from '../src/organizations/pending-organization-cleanup.service';
import { Queue } from 'bullmq';
import { JobsService, MAINTENANCE_QUEUE } from '../src/jobs/jobs.service';
import { redisConnectionFromUrl } from '../src/jobs/redis-connection';

// Prawdziwy Redis (REDIS_URL), ale izolowany prefiks kluczy - nie dotyka
// kolejek deweloperskich.
describe('JobsService - BullMQ (e2e, Redis)', () => {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const prefix = `unfooly-test-${Date.now()}`;
  const services: JobsService[] = [];

  const config = (values: Record<string, string>) =>
    ({ get: (key: string) => ({ REDIS_URL: redisUrl, JOBS_QUEUE_PREFIX: prefix, ...values })[key] }) as unknown as ConfigService;

  afterAll(async () => {
    for (const service of services) {
      await service.onModuleDestroy();
    }
    const queue = new Queue(MAINTENANCE_QUEUE, { connection: redisConnectionFromUrl(redisUrl), prefix });
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('jest wyłączony w NODE_ENV=test, chyba że BACKGROUND_JOBS_ENABLED=true', () => {
    expect(new JobsService(config({ NODE_ENV: 'test' })).isEnabled()).toBe(false);
    expect(new JobsService(config({ NODE_ENV: 'test', BACKGROUND_JOBS_ENABLED: 'true' })).isEnabled()).toBe(true);
    expect(new JobsService(config({ NODE_ENV: 'production' })).isEnabled()).toBe(true);
    expect(new JobsService(config({ NODE_ENV: 'production', BACKGROUND_JOBS_ENABLED: 'false' })).isEnabled()).toBe(false);
  });

  it('dwie instancje API rejestrujące to samo zadanie dają JEDNO powtarzalne zadanie, a worker je wykonuje', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const make = () => {
      const service = new JobsService(config({ NODE_ENV: 'test', BACKGROUND_JOBS_ENABLED: 'true' }));
      service.registerRecurring({ name: 'test-job', cron: '* * * * * *', handler });
      services.push(service);
      return service;
    };

    const first = make();
    const second = make();
    first.onApplicationBootstrap();
    second.onApplicationBootstrap();
    await Promise.all([first.whenStarted(), second.whenStarted()]);

    const queue = new Queue(MAINTENANCE_QUEUE, { connection: redisConnectionFromUrl(redisUrl), prefix });
    const schedulers = await queue.getJobSchedulers();
    await queue.close();
    expect(schedulers.map((s) => s.key)).toEqual(['test-job']);

    const deadline = Date.now() + 8000;
    while (handler.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(handler).toHaveBeenCalled();
  });

  it('Redis niedostępny: bootstrap wraca natychmiast (API startuje), a zamknięcie nie wisi', async () => {
    const service = new JobsService(
      config({ NODE_ENV: 'test', BACKGROUND_JOBS_ENABLED: 'true', REDIS_URL: 'redis://127.0.0.1:1' }),
    );
    service.registerRecurring({ name: 'down-job', cron: '0 3 * * *', handler: jest.fn() });

    const startedAt = Date.now();
    service.onApplicationBootstrap();
    expect(Date.now() - startedAt).toBeLessThan(500);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const closingAt = Date.now();
    await service.onModuleDestroy();
    await service.whenStarted();

    expect(Date.now() - closingAt).toBeLessThan(5000);
  }, 20_000);

  it('nieznane zadanie w kolejce kończy się błędem (nie po cichu)', async () => {
    const service = new JobsService(config({ NODE_ENV: 'test', BACKGROUND_JOBS_ENABLED: 'true', JOBS_QUEUE_PREFIX: `${prefix}-unknown` }));
    service.registerRecurring({ name: 'known-job', cron: '0 3 * * *', handler: jest.fn() });
    services.push(service);
    service.onApplicationBootstrap();
    await service.whenStarted();
    const queue = new Queue(MAINTENANCE_QUEUE, { connection: redisConnectionFromUrl(redisUrl), prefix: `${prefix}-unknown` });
    await queue.add('unregistered-job', {}, { attempts: 1 });

    const deadline = Date.now() + 8000;
    let failed = 0;
    while (failed === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      failed = await queue.getFailedCount();
    }
    await service.onModuleDestroy();
    await queue.obliterate({ force: true });
    await queue.close();

    expect(failed).toBe(1);
  }, 20_000);

  it('aplikacja z włączonymi zadaniami planuje zadania cykliczne (uzgadnianie kampanii i dzienne sprzątania: organizacje PENDING, refresh tokeny, retencja zgłoszeń)', async () => {
    const appPrefix = `${prefix}-app`;
    process.env.BACKGROUND_JOBS_ENABLED = 'true';
    process.env.JOBS_QUEUE_PREFIX = appPrefix;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      await app.get(JobsService).whenStarted();

      const queue = new Queue(MAINTENANCE_QUEUE, { connection: redisConnectionFromUrl(redisUrl), prefix: appPrefix });
      const schedulers = await queue.getJobSchedulers();
      await queue.obliterate({ force: true });
      await queue.close();
      await app.close();

      expect(schedulers.map((s) => [s.key, s.pattern]).sort()).toEqual(
        [
          [CAMPAIGN_RECONCILE_JOB, '*/5 * * * *'],
          [PENDING_ORGANIZATION_CLEANUP_JOB, '0 3 * * *'],
          [REFRESH_TOKEN_CLEANUP_JOB, '30 3 * * *'],
          [THREAT_REPORT_RETENTION_JOB, '30 3 * * *'],
        ].sort(),
      );
    } finally {
      delete process.env.BACKGROUND_JOBS_ENABLED;
      delete process.env.JOBS_QUEUE_PREFIX;
    }
  });

  it('parsuje REDIS_URL (hasło, baza, TLS)', () => {
    expect(redisConnectionFromUrl('redis://:s%40k@redis.example:6380/2')).toMatchObject({
      host: 'redis.example',
      port: 6380,
      password: 's@k',
      db: 2,
      maxRetriesPerRequest: null,
    });
    expect(redisConnectionFromUrl('rediss://h')).toMatchObject({ host: 'h', port: 6379, tls: {} });
    expect(() => redisConnectionFromUrl('http://x')).toThrow();
    expect(() => redisConnectionFromUrl('redis://h/abc')).toThrow();
  });
});
