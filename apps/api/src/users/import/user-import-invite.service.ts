import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { JobsService } from '../../jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AddressClaimService } from '../address-claim.service';
import { countInviteTraffic } from '../invite-traffic';
import { loadSeatUsage, lockSeats } from '../seats';
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
    private readonly claims: AddressClaimService,
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
        if (row.addressTaken) {
          outcome = await this.processTakenAddress(organizationId, row, context);
        } else if (!account || account.status !== 'INVITED') {
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

  /**
   * Wiersz, którego adres miał w chwili potwierdzenia konto w INNEJ organizacji (dla administratora nie do odróżnienia od pozostałych).
   * Jeśli organizacja ma zweryfikowaną domenę adresu, a właścicielem jest nieaktywowane zaproszenie obcej organizacji, adres jest
   * przejmowany (zaproszenie tamtej organizacji wygasa), konto powstaje teraz i idzie zwykłe zaproszenie. W każdym innym przypadku
   * właściciel adresu dostaje informację "ktoś próbował Cię dodać" - wynik dla wiersza to "wysłano" tak samo jak dla zwykłego
   * zaproszenia. Brak wolnej licencji przy przejęciu (zwolniła się i została zajęta) kończy wiersz błędem "nie wysłano".
   */
  private async processTakenAddress(
    organizationId: string,
    row: { id: string; email: string; firstName: string; lastName: string; departmentName: string | null },
    context: { organizationName: string | null; invitedBy: string | null },
  ): Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; reason: string | null }> {
    if ((await this.claims.claimForOrganization(organizationId, row.email)) === 'TAKEN') {
      const sent = await this.users.notifyAddressTaken(organizationId, row.email, context);
      return sent ? { status: 'SENT', reason: null } : { status: 'FAILED', reason: 'Nie udało się wysłać wiadomości - użyj "Wyślij zaproszenie ponownie" przy koncie' };
    }

    const placeholderHash = await bcrypt.hash(randomBytes(32).toString('hex'), 4);
    let account: { id: string; email: string; firstName: string | null } | null;
    try {
      account = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
        await lockSeats(tx, organizationId);
        if ((await loadSeatUsage(tx, organizationId)).available < 1) return null;
        const department = row.departmentName ? await tx.department.findFirst({ where: { organizationId, name: row.departmentName }, select: { id: true } }) : null;
        const created = await tx.user.create({
          data: { organizationId, email: row.email, passwordHash: placeholderHash, firstName: row.firstName, lastName: row.lastName, departmentId: department?.id ?? null, role: 'EMPLOYEE', status: 'INVITED' },
          select: { id: true, email: true, firstName: true },
        });
        await tx.userImportRow.updateMany({ where: { id: row.id, organizationId }, data: { userId: created.id, addressTaken: false } });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Adres zajęty ponownie (wyścig): zachowujemy się jak dla zajętego.
        const sent = await this.users.notifyAddressTaken(organizationId, row.email, context);
        return sent ? { status: 'SENT', reason: null } : { status: 'FAILED', reason: 'Nie udało się wysłać wiadomości - użyj "Wyślij zaproszenie ponownie" przy koncie' };
      }
      throw error;
    }
    if (!account) {
      return { status: 'FAILED', reason: 'Nie udało się utworzyć konta - brak wolnych licencji' };
    }
    return (await this.users.sendInviteEmailSafely(organizationId, account.id, account.email, account.firstName, context))
      ? { status: 'SENT', reason: null }
      : { status: 'FAILED', reason: 'Nie udało się wysłać wiadomości - użyj "Wyślij zaproszenie ponownie" przy koncie' };
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
        // Ruch zaproszeń = tokeny + powiadomienia "ktoś próbował Cię dodać" (jeden dobowy limit).
        countInviteTraffic(tx, organizationId, new Date(now.getTime() - DAY_MS)),
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
        select: { id: true, userId: true, email: true, firstName: true, lastName: true, departmentName: true, addressTaken: true },
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
