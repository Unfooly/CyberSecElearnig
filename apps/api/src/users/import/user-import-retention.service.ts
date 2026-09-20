import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';

export const USER_IMPORT_RETENTION_JOB = 'user-import-retention';
// Co godzinę (UTC): podgląd ważny 24 h jest kasowany najpóźniej ok. godzinę po wygaśnięciu (dzienny bieg oznaczałby do ~48 h
// przechowywania danych osobowych z pliku). Zadanie jest tanie: jedno DELETE po indeksie expiresAt na organizację.
const RETENTION_CRON = '0 * * * *';
const ORG_PAGE_SIZE = 200;

export interface ImportRetentionResult {
  organizations: number;
  deleted: number;
  failed: number;
}

/**
 * Sprzątanie wygasłych podglądów importu: partia PREVIEW po `expiresAt` (24 h) jest kasowana razem z wierszami (kaskada) -
 * adresy e-mail i imiona z pliku nie zostają w bazie bez końca. Idempotentne, race-safe (warunek wygaśnięcia w samym DELETE),
 * błąd jednej organizacji nie blokuje reszty (log bez danych osobowych). Tabela organizations jest globalna (bez RLS), usuwanie
 * idzie w kontekście każdej organizacji (runInOrgContext) - zadanie NIE używa furtki omijającej RLS.
 */
@Injectable()
export class UserImportRetentionService implements OnModuleInit {
  private readonly logger = new Logger(UserImportRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerRecurring({ name: USER_IMPORT_RETENTION_JOB, cron: RETENTION_CRON, handler: () => this.run() });
  }

  async run(now: Date = new Date()): Promise<ImportRetentionResult> {
    const result: ImportRetentionResult = { organizations: 0, deleted: 0, failed: 0 };
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
          const { count } = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
            tx.userImportBatch.deleteMany({ where: { organizationId, expiresAt: { lte: now } } }),
          );
          result.deleted += count;
        } catch (error) {
          result.failed += 1;
          this.logger.error(`Sprzątanie podglądów importu nie powiodło się (organizacja ${organizationId}): ${(error as Error).name}`);
        }
      }
    }
    if (result.deleted + result.failed > 0) {
      this.logger.log(`Sprzątanie podglądów importu: usunięto ${result.deleted}, błędy ${result.failed}`);
    }
    return result;
  }
}
