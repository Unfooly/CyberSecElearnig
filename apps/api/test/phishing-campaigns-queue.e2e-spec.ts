import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { JobsService, MAINTENANCE_QUEUE } from '../src/jobs/jobs.service';
import { redisConnectionFromUrl } from '../src/jobs/redis-connection';
import { CampaignSenderService } from '../src/phishing/campaigns/campaign-sender.service';
import { BullPhishingSendQueue } from '../src/phishing/campaigns/phishing-send-queue';
import { PhishingConfigService } from '../src/phishing/phishing-config.service';
import { PhishingMailMessage, PhishingMailTransport } from '../src/phishing/transport/phishing-mail-transport';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, createVerifiedUser } from './helpers/auth';

// JEDEN test z prawdziwym BullMQ i Redisem (własny JOBS_QUEUE_PREFIX): realne opóźnienie ~300 ms, deduplikacja po
// jobId, usuwanie zadań i wysyłka przez prawdziwego workera do atrapy transportu. Reszta logiki testowana bez czekania.
describe('Kampanie: kolejka BullMQ (e2e, Redis)', () => {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const prefix = `unfooly-test-phishing-${Date.now()}`;
  const domainSuffix = 'phishing-queue-e2e.test';
  const suffix = Date.now();

  let moduleClose: () => Promise<void>;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let jobs: JobsService;
  let sender: CampaignSenderService;
  const sent: PhishingMailMessage[] = [];
  let organizationId: string;
  let userIds: string[];

  const config = { get: (key: string) => ({ NODE_ENV: 'test', BACKGROUND_JOBS_ENABLED: 'true', REDIS_URL: redisUrl, JOBS_QUEUE_PREFIX: prefix })[key] } as unknown as ConfigService;

  beforeAll(async () => {
    process.env.PHISHING_EMAIL_DOMAIN = 'symulacje.example.test';
    process.env.PHISHING_LANDING_BASE_URL = 'https://landing.example.test';
    const transport = new (class extends PhishingMailTransport {
      readonly name = 'fake';
      async send(message: PhishingMailMessage) {
        sent.push(message);
        return { providerMessageId: 'q-1' };
      }
    })();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PhishingMailTransport).useValue(transport).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    moduleClose = () => app.close();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    // Własna instancja JobsService (prefiks testowy) + prawdziwy sender zarejestrowany w niej.
    jobs = new JobsService(config);
    sender = new CampaignSenderService(tenantPrisma, transport, app.get(PhishingConfigService), jobs);
    sender.onModuleInit();
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();

    const credentials = { email: `q-${suffix}@q.${domainSuffix}`, password: DEFAULT_TEST_PASSWORD };
    ({ organizationId } = await createVerifiedUser(app, tenantPrisma, credentials));
    userIds = [];
    for (const label of ['u1', 'u2', 'u3']) {
      const user = await tenantPrisma.runInOrgContext(organizationId, async (tx) =>
        tx.user.create({
          data: { organizationId, email: `${label}-${suffix}@q.${domainSuffix}`, passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4), role: 'EMPLOYEE', status: 'ACTIVE', emailVerifiedAt: new Date() },
        }),
      );
      userIds.push(user.id);
    }
  }, 60_000);

  afterAll(async () => {
    await jobs.onModuleDestroy();
    const queue = new Queue(MAINTENANCE_QUEUE, { connection: redisConnectionFromUrl(redisUrl), prefix });
    await queue.obliterate({ force: true });
    await queue.close();
    delete process.env.PHISHING_EMAIL_DOMAIN;
    delete process.env.PHISHING_LANDING_BASE_URL;
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await moduleClose();
  });

  async function campaignWithRecipients() {
    const now = Date.now();
    const campaign = await tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaign.create({
        data: {
          organizationId,
          name: 'Kolejka',
          audienceType: 'USERS',
          templateName: 'Kurier',
          subject: 'Paczka',
          bodyHtml: '<p><a href="{{trackingLink}}">Odbierz</a></p>',
          lessonHtml: '<p>To była symulacja</p>',
          senderName: 'Kurier',
          senderLocalPart: 'kurier',
          windowStart: new Date(now - 60_000),
          windowEnd: new Date(now + 3_600_000),
          createdByEmail: 'q@q.test',
        },
      }),
    );
    const recipients = await tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const created = [];
      for (const userId of userIds) {
        created.push(await tx.phishingCampaignRecipient.create({ data: { organizationId, campaignId: campaign.id, userId, scheduledAt: new Date(now + 300) } }));
      }
      return created;
    });
    return { campaign, recipients };
  }

  const wait = async (predicate: () => boolean | Promise<boolean>, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  it('opóźnione zadanie NIE rusza przed czasem, potem prawdziwy worker wysyła dokładnie raz; dublet o tym samym jobId jest ignorowany', async () => {
    const { campaign, recipients } = await campaignWithRecipients();
    const queue = new BullPhishingSendQueue(jobs);
    const [target] = recipients;
    const startedAt = Date.now();

    await queue.enqueue([{ organizationId, recipientId: target.id, delayMs: 300 }]);
    await queue.enqueue([{ organizationId, recipientId: target.id, delayMs: 300 }]); // dublet (np. zadanie uzgadniające)
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent).toHaveLength(0); // jeszcze przed terminem

    await wait(() => sent.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 700)); // czas na ewentualny drugi (błędny) mail

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
    expect(sent).toHaveLength(1);
    const row = await tenantPrisma.runInOrgContext(organizationId, (tx) => tx.phishingCampaignRecipient.findFirstOrThrow({ where: { id: target.id, organizationId } }));
    expect(row.sentAt).not.toBeNull();
    expect(row.sendAttempts).toBe(1);
    expect(campaign.id).toBe(row.campaignId);
  }, 30_000);

  it('zakończone zadanie zostaje w Redisie i blokuje zwykłe dodanie (dedup po jobId), ale reconcile (replaceFinished) je odtwarza', async () => {
    const { recipients } = await campaignWithRecipients();
    const queue = new BullPhishingSendQueue(jobs);
    const target = recipients[2];
    await queue.enqueue([{ organizationId, recipientId: target.id, delayMs: 0 }]);
    await wait(() => sent.some((m) => m.toEmail.startsWith('u3-')));
    const mailsAfterFirst = sent.length;
    // Odbiorca wraca do stanu "otwarty" (jak po awarii zapisu wyniku), a zadanie w Redisie jest już "completed".
    await tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaignRecipient.update({ where: { id: target.id }, data: { claimedAt: null, sentAt: null, tokenHash: null, providerMessageId: null, sendAttempts: 0 } }),
    );

    await queue.enqueue([{ organizationId, recipientId: target.id, delayMs: 0 }]); // zwykłe dodanie: zignorowane przez dedup
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(sent.length).toBe(mailsAfterFirst);

    await queue.enqueue([{ organizationId, recipientId: target.id, delayMs: 0 }], { replaceFinished: true });
    await wait(() => sent.length > mailsAfterFirst);

    expect(sent.length).toBe(mailsAfterFirst + 1);
  }, 30_000);

  it('usunięcie zadania z kolejki (anulowanie) przed terminem: mail nie wychodzi', async () => {
    const { recipients } = await campaignWithRecipients();
    const queue = new BullPhishingSendQueue(jobs);
    const before = sent.length;
    const target = recipients[1];

    await queue.enqueue([{ organizationId, recipientId: target.id, delayMs: 1500 }]);
    await queue.remove([target.id]);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(sent.length).toBe(before);
    const row = await tenantPrisma.runInOrgContext(organizationId, (tx) => tx.phishingCampaignRecipient.findFirstOrThrow({ where: { id: target.id, organizationId } }));
    expect(row).toMatchObject({ claimedAt: null, sentAt: null });
  }, 30_000);

  it('kolejka niedostępna: enqueue rzuca (wołający zostawia sprawę zadaniu uzgadniającemu), a nieznane zadanie nie wysyła nic', async () => {
    const offline = new JobsService(config);

    await expect(new BullPhishingSendQueue(offline).enqueue([{ organizationId, recipientId: 'x', delayMs: 0 }])).rejects.toThrow(/niedostępna/);
  });
});
