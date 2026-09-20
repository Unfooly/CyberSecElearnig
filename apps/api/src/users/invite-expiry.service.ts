import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { NEVER_ACTIVATED, expireInvitedAccounts, invitedAccountsCutoff, InvitedAccountChangedError } from './invited-accounts';

export const INVITE_EXPIRY_JOB = 'invite-expiry';
// Raz na dobę (UTC), poza godzinami szczytu.
const EXPIRY_CRON = '20 4 * * *';
const ORG_PAGE_SIZE = 200;
// Jedna transakcja usuwa najwyżej tyle kont (import 5000 osób, które nikt nie aktywował, schodzi kolejnymi biegami pętli).
const BATCH_SIZE = 500;
const NOTICE_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

export interface InviteExpiryResult {
  organizations: number;
  expired: number;
  failed: number;
}

/**
 * Wygaszanie nieaktywowanych zaproszeń po INVITE_EXPIRY_DAYS (30) dniach: konto INVITED bez aktywacji nie blokuje adresu w
 * nieskończoność (squatting) i nie trzyma danych osobowych bez końca. Konto ORG_ADMIN nie wygasa (organizacja nie zostanie bez
 * administratora; niezweryfikowane organizacje sprząta osobny job). Administrator widzi w raporcie importu status "wygasło".
 *
 * Idempotentne i race-safe (warunek NEVER_ACTIVATED w samym DELETE; konto aktywowane w trakcie cofa transakcję), błąd jednej
 * organizacji nie blokuje reszty (log bez danych osobowych). Dane klienckie tylko przez runInOrgContext - bez furtki omijającej RLS.
 */
@Injectable()
export class InviteExpiryService implements OnModuleInit {
  private readonly logger = new Logger(InviteExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerRecurring({ name: INVITE_EXPIRY_JOB, cron: EXPIRY_CRON, handler: () => this.run() });
  }

  async run(now: Date = new Date()): Promise<InviteExpiryResult> {
    const result: InviteExpiryResult = { organizations: 0, expired: 0, failed: 0 };
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
      for (const { id: organizationId } of page) {
        result.organizations += 1;
        try {
          result.expired += await this.expireOrganization(organizationId, now);
        } catch (error) {
          result.failed += 1;
          this.logger.error(`Wygaszanie zaproszeń nie powiodło się (organizacja ${organizationId}): ${(error as Error).name}`);
        }
      }
    }
    if (result.expired + result.failed > 0) {
      this.logger.log(`Wygaszanie zaproszeń: wygasło ${result.expired}, błędy ${result.failed}`);
    }
    return result;
  }

  async expireOrganization(organizationId: string, now: Date): Promise<number> {
    // Dziennik powiadomień służy tylko do okna 24 h limitu dobowego: wpisy starsze niż NOTICE_RETENTION_MS są zbędne.
    await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.inviteNotice.deleteMany({ where: { organizationId, createdAt: { lt: new Date(now.getTime() - NOTICE_RETENTION_MS) } } }),
    );
    const cutoff = invitedAccountsCutoff(now);
    let total = 0;
    for (;;) {
      let expired = 0;
      try {
        expired = await this.tenantPrisma.runInOrgContext(
          organizationId,
          async (tx) => {
            const stale = await tx.user.findMany({
              where: { organizationId, ...NEVER_ACTIVATED, role: { not: 'ORG_ADMIN' }, createdAt: { lt: cutoff } },
              orderBy: { createdAt: 'asc' },
              take: BATCH_SIZE,
              select: { id: true },
            });
            return expireInvitedAccounts(tx, organizationId, stale.map((user) => user.id), now);
          },
          { maxWait: 15_000, timeout: 60_000 },
        );
      } catch (error) {
        // Konto aktywowane w trakcie: cofnięta paczka, ponowimy przy następnym biegu (dziś kończymy tę organizację).
        if (error instanceof InvitedAccountChangedError) return total;
        throw error;
      }
      total += expired;
      if (expired < BATCH_SIZE) return total;
    }
  }
}
