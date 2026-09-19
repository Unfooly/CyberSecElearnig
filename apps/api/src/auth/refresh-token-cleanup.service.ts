import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export const REFRESH_TOKEN_CLEANUP_JOB = 'refresh-token-cleanup';
// Codziennie o 03:30 UTC (po sprzątaniu organizacji PENDING o 03:00).
const CLEANUP_CRON = '30 3 * * *';
// Wiersze po terminie ważności trzymamy jeszcze dobę (diagnostyka reuse tuż po wygaśnięciu).
const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Usuwa refresh tokeny po terminie ważności (7 dni + doba). Bez tego tabela rosłaby bez końca
 * (każdy login i każda rotacja dodaje wiersz). Kasuje wyłącznie wygasłe wiersze wszystkich
 * organizacji - przez runCrossOrgQuery. UWAGA: bypass działa w USING, a DELETE sprawdza tylko USING
 * (WITH CHECK dotyczy INSERT/UPDATE), więc pod bypassem TEN DELETE mógłby skasować dowolne wiersze
 * refresh_tokens - ochroną jest wyłącznie jawny warunek `where: { expiresAt: { lt } }` poniżej
 * (test e2e: ważne tokeny i tokeny innych organizacji po terminie/przed terminem zachowane wg daty).
 * Nie dodawaj tu kolejnych zapytań bez jawnego `where`.
 */
@Injectable()
export class RefreshTokenCleanupService implements OnModuleInit {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerRecurring({ name: REFRESH_TOKEN_CLEANUP_JOB, cron: CLEANUP_CRON, handler: () => this.run() });
  }

  async run(now: Date = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - RETENTION_MS);
    const result = await this.tenantPrisma.runCrossOrgQuery((tx) =>
      tx.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    );
    this.logger.log(`Sprzątanie refresh tokenów: usunięto ${result.count}`);
    return { deleted: result.count };
  }
}
