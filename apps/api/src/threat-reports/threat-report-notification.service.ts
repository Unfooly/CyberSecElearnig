import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export const THREAT_REPORT_NOTIFICATION_JOB = 'threat-report-notification';
// Co 5 minut (UTC). Opóźnienie pierwszego maila to do 5 minut; okno między mailami pilnuje NOTIFY_WINDOW_MS.
const NOTIFICATION_CRON = '*/5 * * * *';
/** Maksymalnie jeden mail zbiorczy na organizację w tym oknie (decyzja właściciela produktu 2026-09-20). */
export const NOTIFY_WINDOW_MS = 15 * 60 * 1000;
const ORG_PAGE_SIZE = 200;
const MAX_CLAIM = 1000;

export type NotificationOutcome = 'SENT' | 'NOTHING' | 'DEFERRED' | 'FAILED';

export interface NotificationRunResult {
  organizations: number;
  sent: number;
  deferred: number;
  failed: number;
}

/**
 * Powiadomienia mailowe o nowych zgłoszeniach (prawdziwych, nie symulacyjnych) dla ORG_ADMIN-ów organizacji.
 *
 * Zbiorczo: JEDEN mail na organizację w oknie 15 minut (okno liczone od ostatniego wysłanego maila, stan w bazie), z liczbą
 * nowych zgłoszeń i linkiem do skrzynki - BEZ treści zgłoszeń i bez danych zgłaszających (mail idzie zewnętrznym dostawcą).
 * Zgłoszenia w oknie czekają na następny mail. Maile idą przez EmailService (transakcyjny), nigdy przez transport symulacji.
 *
 * Race-safe i idempotentne: organizacja jest serializowana blokadą doradczą, zgłoszenia są zajmowane atomowo
 * (`notifiedAt IS NULL` w samym UPDATE), stan okna w jednej transakcji z zajęciem. Wysyłka po zatwierdzeniu transakcji;
 * gdy NIKT nie dostał maila, zajęcie i stan są cofane (następny bieg ponawia). Awaria procesu między zajęciem a wysyłką
 * gubi jeden mail (at-most-once; zgłoszenia zostają w skrzynce). Tabela organizations jest globalna (bez RLS), reszta idzie
 * przez runInOrgContext - zadanie NIE używa żadnej furtki omijającej RLS.
 *
 * Skala (świadoma decyzja): co 5 minut przechodzimy po WSZYSTKICH organizacjach i dla każdej robimy krótką transakcję (blokada +
 * odczyt), także gdy nie ma nowych zgłoszeń. Tani prefiltr "czy w ogóle są niepowiadomione zgłoszenia" wymagałby zapytania
 * międzyorganizacyjnego (nowy wyjątek od Zasady nr 1, CLAUDE.md) - nie robimy tego. Przy tysiącach organizacji zamiast pętli
 * lepsza będzie kolejka opóźniona per organizacja uruchamiana przy zgłoszeniu (backlog).
 */
@Injectable()
export class ThreatReportNotificationService implements OnModuleInit {
  private readonly logger = new Logger(ThreatReportNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerRecurring({ name: THREAT_REPORT_NOTIFICATION_JOB, cron: NOTIFICATION_CRON, handler: () => this.run() });
  }

  async run(now: Date = new Date()): Promise<NotificationRunResult> {
    const result: NotificationRunResult = { organizations: 0, sent: 0, deferred: 0, failed: 0 };
    let afterId: string | null = null;
    for (;;) {
      const page: { id: string }[] = await this.prisma.organization.findMany({
        where: afterId ? { id: { gt: afterId } } : {},
        select: { id: true },
        orderBy: { id: 'asc' },
        take: ORG_PAGE_SIZE,
      });
      if (page.length === 0) break;
      afterId = page[page.length - 1].id;
      for (const { id } of page) {
        result.organizations += 1;
        try {
          const outcome = await this.notifyOrganization(id, now);
          if (outcome === 'SENT') result.sent += 1;
          else if (outcome === 'DEFERRED') result.deferred += 1;
          else if (outcome === 'FAILED') result.failed += 1;
        } catch (error) {
          result.failed += 1;
          this.logger.error(`Powiadomienie o zgłoszeniach nie powiodło się (organizacja ${id}): ${(error as Error).name}`);
        }
      }
    }
    if (result.sent + result.failed > 0) {
      this.logger.log(`Powiadomienia o zgłoszeniach: wysłano ${result.sent}, odroczono ${result.deferred}, błędy ${result.failed}`);
    }
    return result;
  }

  async notifyOrganization(organizationId: string, now: Date): Promise<NotificationOutcome> {
    const claim = await this.claim(organizationId, now);
    if (claim.outcome !== 'CLAIMED') {
      return claim.outcome;
    }

    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const frontendUrl = (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    let sent = 0;
    for (const email of claim.adminEmails) {
      // Osobny try na admina: błąd jednego nie odbiera maila pozostałym.
      try {
        const accepted = await this.emailService.send({
          to: email,
          subject: claim.count === 1 ? 'Nowe zgłoszenie podejrzanej wiadomości' : `Nowe zgłoszenia podejrzanych wiadomości (${claim.count})`,
          templateName: 'threat-report-notification',
          templateData: { organizationName: organization?.name ?? 'Twoja organizacja', count: claim.count, reportsUrl: `${frontendUrl}/reports` },
        });
        if (accepted !== false) sent += 1;
      } catch (error) {
        this.logger.error(`Błąd wysyłki powiadomienia o zgłoszeniach (organizacja ${organizationId}): ${(error as Error).name}`);
      }
    }

    if (sent === 0) {
      // Nikt nie dostał maila: zwalniamy zajęcie i okno, następny bieg ponowi. Gdy choć jeden admin dostał, zajęcie zostaje
      // (ponowna wysyłka dublowałaby mail).
      await this.release(organizationId, claim.ids, now, claim.previousLastSentAt);
      return 'FAILED';
    }
    return 'SENT';
  }

  private claim(organizationId: string, now: Date) {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Serializacja per organizacja (równoległe biegi/instancje): drugi bieg zobaczy już zaktualizowane okno.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`threat-notify:${organizationId}`}))`;
      const state = await tx.threatReportNotificationState.findUnique({ where: { organizationId } });
      if (state && now.getTime() - state.lastSentAt.getTime() < NOTIFY_WINDOW_MS) {
        return { outcome: 'DEFERRED' as const };
      }
      const pending = await tx.threatReport.findMany({
        where: { organizationId, kind: 'REAL', notifiedAt: null, createdAt: { lte: now } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_CLAIM,
      });
      if (pending.length === 0) {
        return { outcome: 'NOTHING' as const };
      }
      const admins = await tx.user.findMany({ where: { organizationId, role: 'ORG_ADMIN', status: 'ACTIVE' }, select: { email: true } });
      if (admins.length === 0) {
        return { outcome: 'NOTHING' as const }; // brak adresata: zgłoszenia zostają niepowiadomione, do skrzynki i tak trafiają
      }
      const ids = pending.map((row) => row.id);
      const claimed = await tx.threatReport.updateMany({ where: { id: { in: ids }, organizationId, notifiedAt: null }, data: { notifiedAt: now } });
      if (claimed.count === 0) {
        return { outcome: 'NOTHING' as const };
      }
      await tx.threatReportNotificationState.upsert({
        where: { organizationId },
        create: { organizationId, lastSentAt: now },
        update: { lastSentAt: now },
      });
      return { outcome: 'CLAIMED' as const, ids, count: claimed.count, adminEmails: admins.map((admin) => admin.email), previousLastSentAt: state?.lastSentAt ?? null };
    });
  }

  private async release(organizationId: string, ids: string[], now: Date, previousLastSentAt: Date | null): Promise<void> {
    await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      await tx.threatReport.updateMany({ where: { id: { in: ids }, organizationId, notifiedAt: now }, data: { notifiedAt: null } });
      if (previousLastSentAt) {
        await tx.threatReportNotificationState.updateMany({ where: { organizationId, lastSentAt: now }, data: { lastSentAt: previousLastSentAt } });
      } else {
        // Brak poprzedniego okna: przywracamy "nigdy nie wysyłano" bez DELETE (rola aplikacji go nie ma) - data z odległej przeszłości.
        await tx.threatReportNotificationState.updateMany({ where: { organizationId, lastSentAt: now }, data: { lastSentAt: new Date(0) } });
      }
    });
  }
}
