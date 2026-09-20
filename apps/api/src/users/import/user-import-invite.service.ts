import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { UsersService } from '../users.service';
import { INVITE_DAILY_LIMIT_PER_ORG, INVITE_RUN_INTERVAL_MINUTES, INVITE_STALE_CLAIM_MS, inviteCapacity } from './invite-pace';
import { completeBatchIfDone } from './user-import.service';

export const USER_IMPORT_INVITES_JOB = 'user-import-invites';
// Co 5 minut (UTC): INVITE_RUN_INTERVAL_MINUTES w invite-pace.ts.
const INVITES_CRON = '*/5 * * * *';
const ORG_PAGE_SIZE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InviteRunResult {
  organizations: number;
  sent: number;
  failed: number;
}

/**
 * Kolejka zaproszeń z importu CSV, wysyłana Z TEMPEM (decyzja właściciela produktu 2026-09-20): import 5000 osób rozkłada się na
 * kolejne dni w ramach dobowego limitu zaproszeń organizacji (INVITE_DAILY_LIMIT_PER_ORG = 300, wspólny z zaproszeniami ręcznymi -
 * limit anty-spamowy zostaje), a w jednym biegu (co 5 minut) idzie najwyżej INVITE_PER_RUN zaproszeń na organizację.
 *
 * Idempotentne i race-safe: zaproszenia są zajmowane atomowo (PENDING -> SENDING warunkiem w UPDATE), pojemność liczona pod
 * blokadą doradczą organizacji z uwzględnieniem już zajętych, a każdy wiersz ma wynik (SENT/FAILED/SKIPPED). AT-MOST-ONCE: zajęcie
 * starsze niż INVITE_STALE_CLAIM_MS bez wyniku (awaria między zajęciem a wynikiem) jest domykane jako FAILED ze stanem niepewnym -
 * nie ponawiamy po cichu (mail mógł wyjść), administrator użyje "Wyślij zaproszenie ponownie" przy koncie. Konto, które w międzyczasie
 * aktywowano albo usunięto, jest pomijane. Błąd jednego wiersza nie blokuje reszty; logi bez danych osobowych. Dane klienckie czytane
 * przez runInOrgContext (bez furtki omijającej RLS); tabela organizations jest globalna - skan organizacji jak w innych zadaniach.
 */
@Injectable()
export class UserImportInviteService implements OnModuleInit {
  private readonly logger = new Logger(UserImportInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly users: UsersService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerRecurring({ name: USER_IMPORT_INVITES_JOB, cron: INVITES_CRON, handler: () => this.run() });
  }

  async run(now: Date = new Date()): Promise<InviteRunResult> {
    const result: InviteRunResult = { organizations: 0, sent: 0, failed: 0 };
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
          result.sent += await this.processOrganization(id, now);
        } catch (error) {
          result.failed += 1;
          this.logger.error(`Wysyłka zaproszeń z importu nie powiodła się (organizacja ${id}): ${(error as Error).name}`);
        }
      }
    }
    if (result.sent + result.failed > 0) {
      this.logger.log(`Zaproszenia z importu: wysłano ${result.sent}, błędy ${result.failed}`);
    }
    return result;
  }

  /** Jeden bieg dla organizacji; zwraca liczbę zaproszeń wysłanych w tym biegu. */
  async processOrganization(organizationId: string, now: Date): Promise<number> {
    const claim = await this.claim(organizationId, now);
    if (!claim || claim.rows.length === 0) {
      return 0;
    }

    const context = await this.users.buildInviteContext(organizationId, claim.invitedBy ?? undefined);
    let sent = 0;
    for (const row of claim.rows) {
      let outcome: { status: 'SENT' | 'FAILED' | 'SKIPPED'; reason: string | null };
      try {
        const account = row.userId
          ? await this.tenantPrisma.runInOrgContext(organizationId, (tx) => tx.user.findFirst({ where: { id: row.userId as string, organizationId }, select: { id: true, email: true, firstName: true, status: true } }))
          : null;
        if (!account || account.status !== 'INVITED') {
          outcome = { status: 'SKIPPED', reason: 'Konto zostało w międzyczasie aktywowane albo usunięte' };
        } else if (await this.users.sendInviteEmailSafely(organizationId, account.id, account.email, account.firstName, context)) {
          outcome = { status: 'SENT', reason: null };
        } else {
          outcome = { status: 'FAILED', reason: 'Nie udało się wysłać wiadomości - użyj "Wyślij zaproszenie ponownie" przy koncie' };
        }
      } catch (error) {
        this.logger.error(`Zaproszenie z importu nie zostało przetworzone (organizacja ${organizationId}): ${(error as Error).name}`);
        outcome = { status: 'FAILED', reason: 'Błąd przetwarzania - użyj "Wyślij zaproszenie ponownie" przy koncie' };
      }
      if (outcome.status === 'SENT') sent += 1;
      await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
        // Warunek SENDING: wynik zapisujemy tylko dla wiersza, który nadal jest zajęty przez ten bieg.
        tx.userImportRow.updateMany({
          where: { id: row.id, organizationId, inviteStatus: 'SENDING' },
          data: { inviteStatus: outcome.status, inviteReason: outcome.reason, inviteSentAt: outcome.status === 'SENT' ? new Date() : null },
        }),
      );
    }

    await this.tenantPrisma.runInOrgContext(organizationId, (tx) => completeBatchIfDone(tx, organizationId, claim.batchId, new Date()));
    return sent;
  }

  private claim(organizationId: string, now: Date) {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Serializacja biegów (kilka instancji API): pojemność i zajęcie wierszy w jednej, wyłącznej sekcji organizacji.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import-invites:${organizationId}`}))`;
      const batch = await tx.userImportBatch.findFirst({ where: { organizationId, status: 'PROCESSING' }, orderBy: { confirmedAt: 'asc' }, select: { id: true, confirmedByEmail: true } });
      if (!batch) {
        return null;
      }
      // Awaria między zajęciem a wynikiem: stan niepewny (mail mógł wyjść) - domykamy jako FAILED, nie ponawiamy po cichu.
      await tx.userImportRow.updateMany({
        where: { organizationId, batchId: batch.id, inviteStatus: 'SENDING', inviteClaimedAt: { lt: new Date(now.getTime() - INVITE_STALE_CLAIM_MS) } },
        data: { inviteStatus: 'FAILED', inviteReason: 'Wysyłka przerwana - stan niepewny. Użyj "Wyślij zaproszenie ponownie" przy koncie' },
      });
      if (await completeBatchIfDone(tx, organizationId, batch.id, now)) {
        return { batchId: batch.id, invitedBy: batch.confirmedByEmail, rows: [] };
      }
      const [tokens, inFlight, claimedRecently] = await Promise.all([
        tx.passwordResetToken.count({ where: { organizationId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
        tx.userImportRow.count({ where: { organizationId, batchId: batch.id, inviteStatus: 'SENDING' } }),
        // Tempo: zaproszenia zajęte w oknie jednego biegu (ściśle później niż now - interwał) liczą się do tempa tego biegu.
        tx.userImportRow.count({ where: { organizationId, batchId: batch.id, inviteClaimedAt: { gt: new Date(now.getTime() - INVITE_RUN_INTERVAL_MINUTES * 60_000) } } }),
      ]);
      const capacity = inviteCapacity(INVITE_DAILY_LIMIT_PER_ORG, tokens, inFlight, claimedRecently);
      if (capacity === 0) {
        return { batchId: batch.id, invitedBy: batch.confirmedByEmail, rows: [] };
      }
      const pending = await tx.userImportRow.findMany({
        where: { organizationId, batchId: batch.id, inviteStatus: 'PENDING' },
        orderBy: { line: 'asc' },
        take: capacity,
        select: { id: true, userId: true },
      });
      if (pending.length === 0) {
        return { batchId: batch.id, invitedBy: batch.confirmedByEmail, rows: [] };
      }
      const claimed = await tx.userImportRow.updateMany({
        where: { id: { in: pending.map((row) => row.id) }, organizationId, inviteStatus: 'PENDING' },
        data: { inviteStatus: 'SENDING', inviteClaimedAt: now },
      });
      return { batchId: batch.id, invitedBy: batch.confirmedByEmail, rows: claimed.count === pending.length ? pending : [] };
    });
  }
}
