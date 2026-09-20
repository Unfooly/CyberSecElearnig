import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export const THREAT_REPORT_RETENTION_JOB = 'threat-report-retention';
// Codziennie o 03:30 UTC.
const RETENTION_CRON = '30 3 * * *';
/** Po tylu dniach czyścimy treść prawdziwych zgłoszeń (wpis w docs/legal/privacy-policy-checklist.md). */
export const CONTENT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const ORG_PAGE_SIZE = 200;

export interface RetentionResult {
  organizations: number;
  purged: number;
  failed: number;
}

/**
 * Retencja treści zgłoszeń: po 90 dniach body, headers i comment PRAWDZIWYCH zgłoszeń są zerowane (zostaje rekord:
 * temat, nadawca, status, daty - potrzebny do statystyk). Zgłoszenia symulacyjne nie mają treści od początku.
 *
 * Idempotentne i race-safe: warunek (contentPurgedAt IS NULL i wiek) jest w samym UPDATE. Tabela organizations jest
 * globalna (bez RLS), więc lista organizacji nie wymaga żadnej furtki omijającej RLS; czyszczenie idzie w kontekście
 * każdej organizacji osobno (runInOrgContext), a błąd jednej nie blokuje reszty (log bez danych osobowych).
 */
@Injectable()
export class ThreatReportRetentionService implements OnModuleInit {
  private readonly logger = new Logger(ThreatReportRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerRecurring({ name: THREAT_REPORT_RETENTION_JOB, cron: RETENTION_CRON, handler: () => this.run() });
  }

  async run(now: Date = new Date()): Promise<RetentionResult> {
    const cutoff = new Date(now.getTime() - CONTENT_RETENTION_DAYS * DAY_MS);
    const result: RetentionResult = { organizations: 0, purged: 0, failed: 0 };
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
          result.purged += await this.purgeOrganization(organizationId, cutoff, now);
        } catch (error) {
          result.failed += 1;
          this.logger.error(`Retencja treści zgłoszeń nie powiodła się (organizacja ${organizationId}): ${(error as Error).name}`);
        }
      }
    }
    this.logger.log(`Retencja treści zgłoszeń: wyczyszczono ${result.purged} w ${result.organizations} organizacjach (błędy: ${result.failed})`);
    return result;
  }

  private async purgeOrganization(organizationId: string, cutoff: Date, now: Date): Promise<number> {
    const { count } = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.threatReport.updateMany({
        where: { organizationId, kind: 'REAL', contentPurgedAt: null, createdAt: { lte: cutoff } },
        data: { body: null, headers: null, comment: null, contentPurgedAt: now },
      }),
    );
    return count;
  }
}
