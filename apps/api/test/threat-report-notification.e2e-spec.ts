import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { renderTemplate } from '../src/email/templates';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { NOTIFY_WINDOW_MS, ThreatReportNotificationService } from '../src/threat-reports/threat-report-notification.service';
import { DEFAULT_TEST_PASSWORD, createVerifiedUser } from './helpers/auth';

const MIN = 60_000;
const T0 = new Date('2027-03-01T10:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

interface Org {
  organizationId: string;
  adminEmails: string[];
}

// Powiadomienia o nowych zgłoszeniach: zbiorczo, max 1 mail / 15 min na organizację, bez treści zgłoszeń. Zegar zamrożony
// (parametr `now`), maile przechwytywane przez EmailService (transakcyjny), nie transport symulacji.
describe('Powiadomienia o zgłoszeniach (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let notifier: ThreatReportNotificationService;
  let owner: PrismaClient;
  let sendSpy: jest.SpyInstance;

  const suffix = Date.now();
  const domainSuffix = 'threat-notify-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label.split('-')[0]}.${domainSuffix}`;
  let orgA: Org;
  let orgB: Org;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    notifier = app.get(ThreatReportNotificationService);
    sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    orgA = await newOrg('a', ['a-admin2']);
    orgB = await newOrg('b', []);
  }, 90_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  beforeEach(() => {
    sendSpy.mockReset();
    sendSpy.mockResolvedValue(true);
  });

  // Czysty stan między testami (rola aplikacji nie ma DELETE): zgłoszenia i stan okna.
  afterEach(async () => {
    const organizationIds = [orgA.organizationId, orgB.organizationId];
    await owner.threatReport.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await owner.threatReportNotificationState.deleteMany({ where: { organizationId: { in: organizationIds } } });
  });

  async function newOrg(label: string, extraAdmins: string[]): Promise<Org> {
    const { organizationId } = await createVerifiedUser(app, tenantPrisma, { email: email(label), password: DEFAULT_TEST_PASSWORD });
    for (const extra of extraAdmins) {
      await tenantPrisma.runInOrgContext(organizationId, async (tx) =>
        tx.user.create({
          data: { organizationId, email: email(extra), passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4), role: 'ORG_ADMIN', status: 'ACTIVE', emailVerifiedAt: new Date() },
        }),
      );
    }
    return { organizationId, adminEmails: [email(label), ...extraAdmins.map(email)] };
  }

  const report = (org: Org, overrides: { kind?: 'REAL' | 'SIMULATION'; createdAt?: Date; notifiedAt?: Date | null } = {}) => {
    const kind = overrides.kind ?? 'REAL';
    return tenantPrisma.runInOrgContext(org.organizationId, (tx) =>
      tx.threatReport.create({
        data: {
          organizationId: org.organizationId,
          kind,
          senderText: 'Obcy <obcy@zlosliwa.example>',
          subject: 'TEMAT-TAJNY-ZGŁOSZENIA',
          ...(kind === 'REAL' ? { body: 'TREŚĆ-TAJNA-ZGŁOSZENIA' } : { matchMethod: 'TOKEN' as const }),
          createdAt: overrides.createdAt ?? at(-MIN),
          notifiedAt: overrides.notifiedAt ?? null,
        },
      }),
    );
  };
  const notifiedAt = (org: Org) =>
    tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.threatReport.findMany({ where: { organizationId: org.organizationId }, select: { id: true, notifiedAt: true } }));
  const mailsTo = () => sendSpy.mock.calls.map(([options]) => options as { to: string; subject: string; templateName: string; templateData: { count: number } });

  it('brak zgłoszeń: nic nie jest wysyłane', async () => {
    expect(await notifier.notifyOrganization(orgA.organizationId, T0)).toBe('NOTHING');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('nowe zgłoszenia: JEDEN mail zbiorczy do każdego aktywnego ORG_ADMIN, z liczbą zgłoszeń i bez ich treści; zgłoszenia oznaczone jako powiadomione', async () => {
    await report(orgA);
    await report(orgA);
    await report(orgA);

    expect(await notifier.notifyOrganization(orgA.organizationId, T0)).toBe('SENT');

    const mails = mailsTo();
    expect(mails.map((mail) => mail.to).sort()).toEqual([...orgA.adminEmails].sort());
    expect(mails.every((mail) => mail.templateName === 'threat-report-notification' && mail.templateData.count === 3)).toBe(true);
    expect(mails[0].subject).toContain('(3)');
    expect(JSON.stringify(sendSpy.mock.calls)).not.toMatch(/TEMAT-TAJNY|TREŚĆ-TAJNA|zlosliwa\.example/); // żadnych danych ze zgłoszeń
    expect((await notifiedAt(orgA)).every((row) => row.notifiedAt?.getTime() === T0.getTime())).toBe(true);
  });

  it('zgłoszenia symulacyjne NIE wywołują powiadomień', async () => {
    await report(orgA, { kind: 'SIMULATION' });

    expect(await notifier.notifyOrganization(orgA.organizationId, T0)).toBe('NOTHING');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('okno 15 minut: kolejne zgłoszenia w oknie czekają (DEFERRED), po 15 minutach idzie JEDEN mail tylko o nowych', async () => {
    await report(orgA);
    await notifier.notifyOrganization(orgA.organizationId, T0);
    sendSpy.mockClear();

    await report(orgA, { createdAt: at(2 * MIN) });
    await report(orgA, { createdAt: at(5 * MIN) });
    const inside = await notifier.notifyOrganization(orgA.organizationId, at(NOTIFY_WINDOW_MS - 1));
    const insideAgain = await notifier.notifyOrganization(orgA.organizationId, at(10 * MIN));

    expect([inside, insideAgain]).toEqual(['DEFERRED', 'DEFERRED']);
    expect(sendSpy).not.toHaveBeenCalled();
    expect((await notifiedAt(orgA)).filter((row) => row.notifiedAt === null)).toHaveLength(2);

    const after = await notifier.notifyOrganization(orgA.organizationId, at(NOTIFY_WINDOW_MS));

    expect(after).toBe('SENT');
    expect(mailsTo().every((mail) => mail.templateData.count === 2)).toBe(true);
    expect((await notifiedAt(orgA)).every((row) => row.notifiedAt !== null)).toBe(true);
  });

  it('w dowolnym oknie 15 minut idzie co najwyżej jeden mail: seria biegów co minutę przez godzinę = 4 maile, nie 60', async () => {
    let created = 0;
    for (let minute = 0; minute <= 60; minute += 1) {
      if (minute % 3 === 0) {
        await report(orgA, { createdAt: at(minute * MIN - 1000) });
        created += 1;
      }
      await notifier.notifyOrganization(orgA.organizationId, at(minute * MIN));
    }

    const rounds = mailsTo().length / orgA.adminEmails.length;
    expect(rounds).toBe(5); // minuty 0, 15, 30, 45, 60
    expect(mailsTo().reduce((sum, mail) => sum + mail.templateData.count, 0) / orgA.adminEmails.length).toBe(created);
  });

  it('RÓWNOLEGŁE biegi (kilka instancji/jobów naraz): dokładnie jedna runda maili, wszystkie zgłoszenia zajęte raz', async () => {
    await report(orgA);
    await report(orgA);

    const outcomes = await Promise.all(Array.from({ length: 6 }, () => notifier.notifyOrganization(orgA.organizationId, T0)));

    expect(outcomes.filter((outcome) => outcome === 'SENT')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'DEFERRED')).toHaveLength(5);
    expect(sendSpy).toHaveBeenCalledTimes(orgA.adminEmails.length);
  });

  it('awaria wysyłki do WSZYSTKICH adminów: zajęcie i okno cofnięte (FAILED), następny bieg ponawia bez czekania 15 minut', async () => {
    await report(orgA);
    sendSpy.mockResolvedValue(false);

    expect(await notifier.notifyOrganization(orgA.organizationId, T0)).toBe('FAILED');

    expect((await notifiedAt(orgA))[0].notifiedAt).toBeNull();
    sendSpy.mockResolvedValue(true);
    sendSpy.mockClear();
    expect(await notifier.notifyOrganization(orgA.organizationId, at(MIN))).toBe('SENT'); // jedna minuta później, nie 15
    expect(sendSpy).toHaveBeenCalledTimes(orgA.adminEmails.length);
  });

  it('wyjątek transportu też liczy się jako niedostarczenie (FAILED, bez utraty zgłoszenia)', async () => {
    await report(orgA);
    sendSpy.mockRejectedValue(new Error('smtp down'));

    expect(await notifier.notifyOrganization(orgA.organizationId, T0)).toBe('FAILED');

    expect((await notifiedAt(orgA))[0].notifiedAt).toBeNull();
  });

  it('część adminów dostała mail: zajęcie zostaje (bez dubla przy następnym biegu), wynik SENT', async () => {
    await report(orgA);
    sendSpy.mockImplementation(async (options: { to: string }) => options.to === orgA.adminEmails[0]);

    expect(await notifier.notifyOrganization(orgA.organizationId, T0)).toBe('SENT');
    sendSpy.mockClear();
    sendSpy.mockResolvedValue(true);

    expect(await notifier.notifyOrganization(orgA.organizationId, at(NOTIFY_WINDOW_MS + MIN))).toBe('NOTHING');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('adres tylko AKTYWNYCH adminów; organizacja bez aktywnego admina: zgłoszenia zostają niepowiadomione (brak adresata)', async () => {
    const solo = await newOrg('c', []);
    sendSpy.mockClear(); // rejestracja organizacji wysłała własny mail (aktywacja) - liczymy tylko powiadomienia
    await tenantPrisma.runInOrgContext(solo.organizationId, (tx) => tx.user.updateMany({ where: { organizationId: solo.organizationId }, data: { status: 'INVITED' } }));
    await report(solo);

    expect(await notifier.notifyOrganization(solo.organizationId, T0)).toBe('NOTHING');

    expect(sendSpy).not.toHaveBeenCalled();
    expect((await notifiedAt(solo))[0].notifiedAt).toBeNull();
    await owner.threatReport.deleteMany({ where: { organizationId: solo.organizationId } });
  });

  it('izolacja A/B: zgłoszenie w B powiadamia wyłącznie adminów B (liczba tylko z B), A nie dostaje nic', async () => {
    await report(orgB);
    await report(orgA, { notifiedAt: at(-2 * MIN) }); // stare, już powiadomione

    const result = await notifier.run(T0);

    expect(result.failed).toBe(0);
    const recipients = mailsTo().map((mail) => mail.to);
    for (const address of orgB.adminEmails) expect(recipients).toContain(address);
    for (const address of orgA.adminEmails) expect(recipients).not.toContain(address);
    expect(mailsTo().filter((mail) => orgB.adminEmails.includes(mail.to)).every((mail) => mail.templateData.count === 1)).toBe(true);
  });

  it('zgłoszenia sprzed migracji (notifiedAt ustawione) nie generują maila', async () => {
    await report(orgA, { notifiedAt: at(-30 * MIN) });

    expect(await notifier.notifyOrganization(orgA.organizationId, T0)).toBe('NOTHING');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('run() przechodzi po wszystkich organizacjach i błąd jednej nie blokuje pozostałych', async () => {
    await report(orgA);
    await report(orgB);
    const original = notifier.notifyOrganization.bind(notifier);
    jest.spyOn(notifier, 'notifyOrganization').mockImplementation(async (organizationId: string, now: Date) => {
      if (organizationId === orgA.organizationId) throw new Error('baza');
      return original(organizationId, now);
    });

    const result = await notifier.run(T0);

    jest.restoreAllMocks();
    sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const rowsB = await notifiedAt(orgB);
    expect(rowsB[0].notifiedAt).not.toBeNull();
    expect((await notifiedAt(orgA))[0].notifiedAt).toBeNull(); // A ponowi w następnym biegu
  });

  describe('szablon maila', () => {
    it('zawiera liczbę, nazwę organizacji i link do skrzynki, a dane od użytkownika są escapowane; brak treści zgłoszeń', () => {
      const rendered = renderTemplate('threat-report-notification', { organizationName: '<img src=x onerror=alert(1)>', count: 3, reportsUrl: 'https://app.example/reports' });

      expect(rendered).not.toBeNull();
      expect(rendered!.html).toContain('(3)');
      expect(rendered!.html).toContain('https://app.example/reports');
      expect(rendered!.html).not.toContain('<img src=x');
      expect(rendered!.text).toContain('https://app.example/reports');
      expect(rendered!.text).toContain('nie zawiera treści zgłoszeń');
    });

    it('liczba jest liczbą całkowitą >= 1 (śmieci nie trafiają do maila)', () => {
      const rendered = renderTemplate('threat-report-notification', { organizationName: 'Firma', count: 'abc<script>', reportsUrl: 'https://app.example/reports' });

      expect(rendered!.html).not.toContain('<script>');
      expect(rendered!.text).toContain('Pracownik zgłosił podejrzaną wiadomość');
    });
  });
});
