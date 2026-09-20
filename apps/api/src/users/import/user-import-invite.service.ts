import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { JobsService } from '../../jobs/jobs.service';
import { MailResult } from '../../email/interfaces/send-email-options.interface';
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

type RowOutcome = { status: 'SENT' | 'FAILED' | 'SKIPPED' | 'UNCERTAIN'; reason: string | null };
interface ClaimedRow {
  id: string;
  userId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  addressTaken: boolean;
}

const FAILED_REASON = 'Nie udało się wysłać zaproszenia';
const UNCERTAIN_REASON = 'Wynik wysyłki nieznany - zaproszenie mogło dotrzeć i nie wysyłamy go ponownie';

/**
 * Wynik wysyłki -> wynik wiersza (ten sam podział co w wysyłce kampanii, docs/phishing-simulations.md): SENT = dostawca przyjął;
 * REJECTED = PEWNE niepowodzenie (nic nie wyszło) => FAILED; UNCERTAIN (timeout, HTTP 5xx, zerwane połączenie) => UNCERTAIN, bez
 * ponawiania. Powody nie odsyłają do "Wyślij ponownie" (dla wiersza z zajętym adresem konta nie ma, więc taka wskazówka byłaby sondą).
 */
export function rowOutcomeOf(result: MailResult): RowOutcome {
  if (result.status === 'SENT') return { status: 'SENT', reason: null };
  if (result.status === 'REJECTED') return { status: 'FAILED', reason: `${FAILED_REASON} (${result.code})` };
  return { status: 'UNCERTAIN', reason: `${UNCERTAIN_REASON} (${result.code})` };
}

/**
 * Kolejka zaproszeń z importu CSV, wysyłana Z TEMPEM (decyzja właściciela produktu 2026-09-20): import 5000 osób rozkłada się na
 * kolejne dni w ramach dobowego limitu zaproszeń organizacji (INVITE_DAILY_LIMIT_PER_ORG = 300, wspólny z zaproszeniami ręcznymi -
 * limit anty-spamowy zostaje), a w jednym biegu (co 5 minut) idzie najwyżej INVITE_PER_RUN zaproszeń na organizację.
 *
 * Wysyłka jednego zaproszenia jak w kampaniach phishingowych, "co najwyżej raz":
 *  1. REZERWACJA pojemności (pod blokadą doradczą organizacji): wiersze wybrane do biegu dostają tylko znacznik czasu rezerwacji
 *     (`inviteClaimedAt` = `now` biegu), zostają PENDING - liczą się do tempa, ale nikt jeszcze nie zaczął ich wysyłać;
 *  2. ZAJĘCIE tuż przed wysyłką KAŻDEGO zaproszenia (atomowe `updateMany` PENDING -> SENDING, `inviteSendingAt` = początek TEJ
 *     wysyłki): tylko jeden wykonawca dostaje count = 1. Wiek zajęcia to czas jednej wysyłki, nie czas oczekiwania w biegu, więc
 *     wolny dostawca albo długi bieg nie zamieni żywej wysyłki w "niepewną";
 *  3. WYSYŁKA poza transakcją, z timeoutem dostawcy; wynik: SENT / FAILED (pewne) / UNCERTAIN (mogło dotrzeć).
 * Zajęcie bez wyniku starsze niż INVITE_STALE_CLAIM_MS (proces padł w trakcie wysyłki) jest domykane jako UNCERTAIN
 * (INTERRUPTED_UNKNOWN); rezerwacja bez zajęcia po awarii po prostu wygasa i wiersz wraca do kolejki (nic nie wyszło). Niepewne
 * zaproszenia blokują "Wyślij zaproszenie ponownie" (UsersService). Konto, które w międzyczasie aktywowano albo usunięto, jest
 * pomijane. Błąd jednego wiersza nie blokuje reszty; logi bez danych osobowych. Dane klienckie tylko przez runInOrgContext (bez
 * furtki omijającej RLS); tabela organizations jest globalna - skan organizacji jak w innych zadaniach.
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
    const claim = await this.reserve(organizationId, now);
    if (!claim || claim.rows.length === 0) {
      return 0;
    }

    const context = await this.users.buildInviteContext(organizationId, claim.invitedBy ?? undefined);
    let sent = 0;
    for (const row of claim.rows) {
      // ZAJĘCIE tuż przed wysyłką tego zaproszenia; count != 1 = ktoś inny już je wziął albo zatrzymano wysyłkę - nie ruszamy go.
      const startedAt = new Date();
      const started = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
        tx.userImportRow.updateMany({
          where: { id: row.id, organizationId, inviteStatus: 'PENDING' },
          data: { inviteStatus: 'SENDING', inviteSendingAt: startedAt },
        }),
      );
      if (started.count !== 1) continue;

      let outcome: RowOutcome;
      try {
        outcome = await this.sendOne(organizationId, row, context);
      } catch (error) {
        this.logger.error(`Zaproszenie z importu nie zostało przetworzone (organizacja ${organizationId}): ${(error as Error).name}`);
        outcome = { status: 'FAILED', reason: `${FAILED_REASON} (INTERNAL)` };
      }
      if (outcome.status === 'SENT') sent += 1;
      await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
        // Warunek SENDING i znacznik TEGO zajęcia: wynik zapisujemy tylko dla wiersza, który nadal jest zajęty przez tę wysyłkę.
        tx.userImportRow.updateMany({
          where: { id: row.id, organizationId, inviteStatus: 'SENDING', inviteSendingAt: startedAt },
          data: { inviteStatus: outcome.status, inviteReason: outcome.reason, inviteSentAt: outcome.status === 'SENT' ? new Date() : null },
        }),
      );
    }

    await this.tenantPrisma.runInOrgContext(organizationId, (tx) => completeBatchIfDone(tx, organizationId, claim.batchId, new Date()));
    return sent;
  }

  private async sendOne(organizationId: string, row: ClaimedRow, context: { organizationName: string | null; invitedBy: string | null }): Promise<RowOutcome> {
    if (row.addressTaken) {
      return this.processTakenAddress(organizationId, row, context);
    }
    const account = row.userId
      ? await this.tenantPrisma.runInOrgContext(organizationId, (tx) => tx.user.findFirst({ where: { id: row.userId as string, organizationId }, select: { id: true, email: true, firstName: true, status: true } }))
      : null;
    if (!account || account.status !== 'INVITED') {
      return { status: 'SKIPPED', reason: 'Konto zostało w międzyczasie aktywowane albo usunięte' };
    }
    return rowOutcomeOf(await this.users.sendInviteEmailClassified(organizationId, account.id, account.email, account.firstName, context));
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
    row: ClaimedRow,
    context: { organizationName: string | null; invitedBy: string | null },
  ): Promise<RowOutcome> {
    if ((await this.claims.claimForOrganization(organizationId, row.email)) === 'TAKEN') {
      return rowOutcomeOf(await this.users.notifyAddressTaken(organizationId, row.email, context));
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
        return rowOutcomeOf(await this.users.notifyAddressTaken(organizationId, row.email, context));
      }
      throw error;
    }
    if (!account) {
      // Powód ogólny (jak każda awaria po naszej stronie): konkretny ("brak licencji") byłby możliwy tylko dla adresu, który przy
      // potwierdzeniu był zajęty, więc zdradzałby, że taki adres miał konto w innej organizacji.
      return { status: 'FAILED', reason: `${FAILED_REASON} (INTERNAL)` };
    }
    return rowOutcomeOf(await this.users.sendInviteEmailClassified(organizationId, account.id, account.email, account.firstName, context));
  }

  private reserve(organizationId: string, now: Date) {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Serializacja biegów (kilka instancji API): pojemność i rezerwacja wierszy w jednej, wyłącznej sekcji organizacji.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import-invites:${organizationId}`}))`;
      const batch = await tx.userImportBatch.findFirst({ where: { organizationId, status: 'PROCESSING' }, orderBy: { confirmedAt: 'asc' }, select: { id: true, confirmedByEmail: true } });
      if (!batch) {
        return null;
      }
      // Proces padł w trakcie wysyłki (zajęcie starsze niż INVITE_STALE_CLAIM_MS, znacznik jest z początku TEJ wysyłki, a nie z
      // rezerwacji): mail mógł wyjść - wynik niepewny, nie ponawiamy po cichu.
      await tx.userImportRow.updateMany({
        where: {
          organizationId,
          batchId: batch.id,
          inviteStatus: 'SENDING',
          // Obrona w głąb: SENDING bez znacznika początku wysyłki (nie powinno się zdarzyć po backfillu migracji) liczymy od rezerwacji,
          // żeby taki wiersz nie wisiał w nieskończoność i nie blokował pojemności ani domknięcia partii.
          OR: [
            { inviteSendingAt: { lt: new Date(now.getTime() - INVITE_STALE_CLAIM_MS) } },
            { inviteSendingAt: null, inviteClaimedAt: { lt: new Date(now.getTime() - INVITE_STALE_CLAIM_MS) } },
            { inviteSendingAt: null, inviteClaimedAt: null },
          ],
        },
        data: { inviteStatus: 'UNCERTAIN', inviteReason: `${UNCERTAIN_REASON} (INTERRUPTED_UNKNOWN)` },
      });
      if (await completeBatchIfDone(tx, organizationId, batch.id, now)) {
        return { batchId: batch.id, invitedBy: batch.confirmedByEmail, rows: [] as ClaimedRow[] };
      }
      const windowStart = new Date(now.getTime() - INVITE_RUN_INTERVAL_MINUTES * 60_000);
      const [tokens, inFlight, claimedRecently] = await Promise.all([
        // Ruch zaproszeń = tokeny + powiadomienia "ktoś próbował Cię dodać" (jeden dobowy limit).
        countInviteTraffic(tx, organizationId, new Date(now.getTime() - DAY_MS)),
        tx.userImportRow.count({ where: { organizationId, batchId: batch.id, inviteStatus: 'SENDING' } }),
        // Tempo: zaproszenia zarezerwowane/zajęte w oknie jednego biegu (ściśle później niż now - interwał) liczą się do tempa tego biegu.
        tx.userImportRow.count({ where: { organizationId, batchId: batch.id, inviteClaimedAt: { gt: windowStart } } }),
      ]);
      const capacity = inviteCapacity(INVITE_DAILY_LIMIT_PER_ORG, tokens, inFlight, claimedRecently);
      if (capacity === 0) {
        return { batchId: batch.id, invitedBy: batch.confirmedByEmail, rows: [] as ClaimedRow[] };
      }
      const pending: ClaimedRow[] = await tx.userImportRow.findMany({
        // Wiersze niedawno zarezerwowane przez inny bieg (okno tempa) pomijamy; rezerwacja, która wygasła (awaria przed zajęciem), wraca do kolejki.
        where: { organizationId, batchId: batch.id, inviteStatus: 'PENDING', OR: [{ inviteClaimedAt: null }, { inviteClaimedAt: { lte: windowStart } }] },
        orderBy: { line: 'asc' },
        take: capacity,
        select: { id: true, userId: true, email: true, firstName: true, lastName: true, departmentName: true, addressTaken: true },
      });
      if (pending.length === 0) {
        return { batchId: batch.id, invitedBy: batch.confirmedByEmail, rows: [] as ClaimedRow[] };
      }
      // Rezerwacja = sam znacznik czasu; status zostaje PENDING do chwili zajęcia tuż przed wysyłką (zatrzymanie importu nadal
      // pomija niewysłane wiersze, a awaria po rezerwacji niczego nie zostawia "w trakcie").
      await tx.userImportRow.updateMany({ where: { id: { in: pending.map((row) => row.id) }, organizationId, inviteStatus: 'PENDING' }, data: { inviteClaimedAt: now } });
      return { batchId: batch.id, invitedBy: batch.confirmedByEmail, rows: pending };
    });
  }
}
