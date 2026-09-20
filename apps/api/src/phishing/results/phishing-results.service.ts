import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '@cyberszkolo/shared';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { KeyedMutex } from '../../common/keyed-mutex';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { JUSTIFICATION_MIN_LENGTH, PeopleFilter, SetPersonalResultsDto } from '../dto/results.dto';
import { isUncertainFailureCode } from '../transport/phishing-mail-transport';
import { departmentRows, MIN_GROUP_SIZE, NO_DEPARTMENT_LABEL, RecipientFacts, ResultRow, summaryRow } from './results-aggregation';
import { toCsv } from './results-csv';

const err = (code: string, message: string) => ({ code, message });
export const PERSONAL_RESULTS_DISABLED = err('PERSONAL_RESULTS_DISABLED', 'Wyniki osobowe są wyłączone. Włącz je w ustawieniach (wymaga uzasadnienia).');
export const JUSTIFICATION_REQUIRED = err('JUSTIFICATION_REQUIRED', `Uzasadnienie włączenia wyników osobowych jest wymagane (min. ${JUSTIFICATION_MIN_LENGTH} znaków).`);
export const PERSONAL_RESULTS_UNCHANGED = err('PERSONAL_RESULTS_UNCHANGED', 'Ustawienie ma już taką wartość.');

/** Okno (dni) wyników w przeglądzie i KPI dashboardu. */
export const RESULTS_WINDOW_DAYS = 90;
/** Bezpiecznik zapytań o odbiorców (5000 x kilka kampanii). */
const MAX_RECIPIENT_ROWS = 100_000;
const MAX_PEOPLE_ROWS = 5000;

export interface ResultsView {
  scope: 'ORGANIZATION' | 'DEPARTMENT';
  minGroupSize: number;
  campaign: { id: string; name: string; status: string; windowStart: Date; windowEnd: Date } | null;
  /** Liczba kampanii organizacji z okna przeglądu; null dla DEPARTMENT_MANAGER (metadane całej organizacji). */
  campaignsCount: number | null;
  /** Cała organizacja (tylko ORG_ADMIN; null, gdy za mało danych zwraca wiersz z insufficientData). */
  total: ResultRow | null;
  departments: ResultRow[];
}

export type DeliveryStatus = 'SENT' | 'FAILED' | 'UNCERTAIN' | 'PENDING';

export interface PersonResult {
  userId: string | null;
  name: string | null;
  email: string | null;
  departmentName: string | null;
  delivery: DeliveryStatus;
  failureCode: string | null;
  sentAt: Date | null;
  clickedAt: Date | null;
  submittedAt: Date | null;
}

export interface PersonalResultsSettingsView {
  personalResultsEnabled: boolean;
  justification: string | null;
  changedByEmail: string | null;
  updatedAt: Date | null;
}

export interface VisibilityAuditView {
  id: string;
  action: string;
  justification: string | null;
  campaignId: string | null;
  filter: string | null;
  rowCount: number | null;
  actorEmail: string;
  createdAt: Date;
}

const FACT_SELECT = { departmentId: true, departmentName: true, sentAt: true, clickedAt: true, submittedAt: true } as const;

/**
 * Wyniki symulacji. Trzy poziomy dostępu, egzekwowane W SERWISIE (nie tylko w kontrolerze/UI):
 *  1. AGREGATY per dział z progiem minimalnej liczebności (ORG_ADMIN: cała organizacja; DEPARTMENT_MANAGER: WYŁĄCZNIE
 *     własny dział, jako jeden wiersz z tym samym progiem) - wejście agregatora to fakty BEZ identyfikatorów osób.
 *  2. WYNIKI OSOBOWE (kto kliknął): tylko ORG_ADMIN i tylko przy włączonej fladze `personalResultsEnabled`, czytanej z
 *     bazy w tej samej transakcji co dane (nigdy z JWT/cache). Każdy wgląd i eksport zapisuje wiersz audytu W TEJ SAMEJ
 *     transakcji - nie da się odczytać danych bez śladu. DEPARTMENT_MANAGER nigdy nie dostaje wyników osobowych.
 *  3. Ustawienie flagi: tylko ORG_ADMIN, włączenie wymaga uzasadnienia; zmiana i audyt w jednej transakcji.
 * Każde zapytanie ma jawny warunek organizationId i idzie przez runInOrgContext (RLS jako druga linia obrony).
 */
@Injectable()
export class PhishingResultsService {
  private readonly toggleLock = new KeyedMutex();

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  // ---- agregaty ----------------------------------------------------------------------------------------------------

  /** Przegląd z ostatnich RESULTS_WINDOW_DAYS dni (wszystkie kampanie organizacji), z zakresem wynikającym z roli. */
  async overview(user: AuthenticatedUser, now: Date = new Date()): Promise<ResultsView> {
    const since = new Date(now.getTime() - RESULTS_WINDOW_DAYS * 24 * 3_600_000);
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      const campaignsCount = await tx.phishingCampaign.count({ where: { organizationId: user.organizationId, createdAt: { gte: since } } });
      const facts = await tx.phishingCampaignRecipient.findMany({
        where: { organizationId: user.organizationId, campaign: { organizationId: user.organizationId, createdAt: { gte: since } } },
        select: FACT_SELECT,
        orderBy: { id: 'asc' }, // deterministyczny wybór, gdyby limit został przekroczony
        take: MAX_RECIPIENT_ROWS,
      });
      return this.buildView(tx, user, facts, null, campaignsCount);
    });
  }

  /** Wyniki jednej kampanii per dział. */
  async campaignDepartments(user: AuthenticatedUser, campaignId: string): Promise<ResultsView> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      const campaign = await tx.phishingCampaign.findFirst({
        where: { id: campaignId, organizationId: user.organizationId },
        select: { id: true, name: true, status: true, windowStart: true, windowEnd: true },
      });
      if (!campaign) {
        throw new NotFoundException('Nie znaleziono kampanii.');
      }
      const facts = await tx.phishingCampaignRecipient.findMany({
        where: { organizationId: user.organizationId, campaignId },
        select: FACT_SELECT,
        orderBy: { id: 'asc' }, // deterministyczny wybór, gdyby limit został przekroczony
        take: MAX_RECIPIENT_ROWS,
      });
      return this.buildView(tx, user, facts, campaign, 1);
    });
  }

  /** KPI "podatność na phishing" dla dashboardu (cała organizacja; wartości tylko przy liczebności >= próg). */
  async susceptibilityKpi(organizationId: string, now: Date = new Date()): Promise<{ clickRate: number | null; submitRate: number | null }> {
    const since = new Date(now.getTime() - RESULTS_WINDOW_DAYS * 24 * 3_600_000);
    const facts = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingCampaignRecipient.findMany({
        where: { organizationId, campaign: { organizationId, createdAt: { gte: since } } },
        select: FACT_SELECT,
        orderBy: { id: 'asc' }, // deterministyczny wybór, gdyby limit został przekroczony
        take: MAX_RECIPIENT_ROWS,
      }),
    );
    const row = summaryRow('ALL', null, 'Cała organizacja', facts);
    return { clickRate: row.clickRate, submitRate: row.submitRate };
  }

  /** CSV agregatów per dział (ten sam zakres i progi co widok; bez danych osobowych). */
  departmentsCsv(view: ResultsView): string {
    const rows = view.departments.map((row) => [
      row.name,
      row.delivered,
      row.clicked,
      row.submitted,
      row.clickRate,
      row.submitRate,
      row.insufficientData ? `Za mało danych (mniej niż ${view.minGroupSize} osoby)` : '',
    ]);
    return toCsv(['Dział', 'Dostarczono', 'Kliknęło', 'Wysłało formularz', '% kliknęło', '% wysłało formularz', 'Uwagi'], rows);
  }

  private async buildView(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    facts: RecipientFacts[],
    campaign: ResultsView['campaign'],
    campaignsCount: number,
  ): Promise<ResultsView> {
    // Rola, status i dział z BAZY (nie z JWT): zdegradowany albo zdezaktywowany użytkownik traci dostęp od razu,
    // a nie dopiero po wygaśnięciu access tokenu.
    const actor = await this.loadActor(tx, user);
    if (actor.role === Role.ORG_ADMIN) {
      return {
        scope: 'ORGANIZATION',
        minGroupSize: MIN_GROUP_SIZE,
        campaign,
        campaignsCount,
        total: summaryRow('ALL', null, 'Cała organizacja', facts),
        departments: departmentRows(facts),
      };
    }
    if (actor.role !== Role.DEPARTMENT_MANAGER) {
      throw new ForbiddenException('Brak uprawnień do tego zasobu');
    }
    // Kierownik działu: tylko jego odbiorcy, jeden wiersz z progiem. Reszta organizacji i podział na inne działy nie
    // opuszczają serwisu - także metadane: liczba kampanii organizacji (null) i istnienie kampanii, w której jego dział
    // nie uczestniczył (404 jak dla nieistniejącej).
    if (!actor.departmentId) {
      if (campaign) throw new NotFoundException('Nie znaleziono kampanii.');
      return { scope: 'DEPARTMENT', minGroupSize: MIN_GROUP_SIZE, campaign, campaignsCount: null, total: null, departments: [] };
    }
    const own = facts.filter((fact) => fact.departmentId === actor.departmentId);
    if (campaign && own.length === 0) {
      throw new NotFoundException('Nie znaleziono kampanii.');
    }
    const row = summaryRow('DEPARTMENT', actor.departmentId, actor.department?.name ?? NO_DEPARTMENT_LABEL, own);
    return { scope: 'DEPARTMENT', minGroupSize: MIN_GROUP_SIZE, campaign, campaignsCount: null, total: null, departments: [row] };
  }

  /** Użytkownik wywołujący z BAZY: musi istnieć w organizacji i być ACTIVE; rola i dział pochodzą stąd, nie z tokenu. */
  private async loadActor(tx: Prisma.TransactionClient, user: AuthenticatedUser) {
    const record = await tx.user.findFirst({
      where: { id: user.userId, organizationId: user.organizationId },
      select: { email: true, role: true, status: true, departmentId: true, department: { select: { name: true } } },
    });
    if (!record || record.status !== 'ACTIVE') {
      throw new ForbiddenException('Brak uprawnień do tego zasobu');
    }
    return record;
  }

  // ---- wyniki osobowe (guard + audyt) ------------------------------------------------------------------------------

  /**
   * Wyniki osobowe kampanii. W JEDNEJ transakcji: rola ORG_ADMIN i status ACTIVE z bazy -> flaga z bazy pod blokadą
   * wiersza (FOR SHARE: równoległe wyłączenie flagi poczeka na zakończenie odczytu albo wygra i odczyt dostanie 403) ->
   * kampania istnieje -> odczyt -> WPIS AUDYTU (VIEWED/EXPORTED z zakresem i liczbą wierszy). Brak flagi = 403 bez
   * odczytu i bez wpisu; błąd zapisu audytu cofa całość, a dane opuszczają serwis dopiero po commicie transakcji, więc
   * nie da się ich dostać bez śladu.
   */
  async people(user: AuthenticatedUser, campaignId: string, filter: PeopleFilter = 'ALL', action: 'VIEWED' | 'EXPORTED' = 'VIEWED'): Promise<PersonResult[]> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      const actor = await this.loadActor(tx, user);
      if (actor.role !== Role.ORG_ADMIN) {
        throw new ForbiddenException('Brak uprawnień do tego zasobu');
      }
      const settings = await tx.$queryRaw<{ personalResultsEnabled: boolean }[]>`
        SELECT "personalResultsEnabled" FROM "phishing_result_settings" WHERE "organizationId" = ${user.organizationId} FOR SHARE`;
      if (!settings[0]?.personalResultsEnabled) {
        throw new ForbiddenException(PERSONAL_RESULTS_DISABLED);
      }
      const campaign = await tx.phishingCampaign.findFirst({ where: { id: campaignId, organizationId: user.organizationId }, select: { id: true } });
      if (!campaign) {
        throw new NotFoundException('Nie znaleziono kampanii.');
      }

      const recipients = await tx.phishingCampaignRecipient.findMany({
        where: { organizationId: user.organizationId, campaignId },
        select: { userId: true, departmentName: true, sentAt: true, failedAt: true, failureCode: true, clickedAt: true, submittedAt: true },
        take: MAX_PEOPLE_ROWS,
      });
      const userIds = recipients.map((recipient) => recipient.userId).filter((id): id is string => id !== null);
      const users = await tx.user.findMany({ where: { organizationId: user.organizationId, id: { in: userIds } }, select: { id: true, email: true, firstName: true, lastName: true } });
      const byId = new Map(users.map((entry) => [entry.id, entry]));

      const results = recipients.map((recipient): PersonResult => {
        const person = recipient.userId ? byId.get(recipient.userId) : undefined;
        const name = [person?.firstName, person?.lastName].filter(Boolean).join(' ');
        return {
          userId: recipient.userId,
          name: name || null,
          email: person?.email ?? null,
          departmentName: recipient.departmentName,
          delivery: this.delivery(recipient),
          failureCode: recipient.failureCode,
          sentAt: recipient.sentAt,
          clickedAt: recipient.clickedAt,
          submittedAt: recipient.submittedAt,
        };
      });
      const shown = results
        .filter((result) => this.matches(result, filter))
        .sort((a, b) => (a.name ?? a.email ?? '~').localeCompare(b.name ?? b.email ?? '~', 'pl'));
      // Ślad: kto, kiedy, którą kampanię, jaki zakres i ile osób zwrócono (w tej samej transakcji co odczyt).
      await tx.phishingResultVisibilityAudit.create({
        data: { organizationId: user.organizationId, action, campaignId, filter, rowCount: shown.length, actorUserId: user.userId, actorEmail: actor.email },
      });
      return shown;
    });
  }

  /** CSV wyników osobowych (audyt EXPORTED, ta sama ochrona co people()). */
  async peopleCsv(user: AuthenticatedUser, campaignId: string, filter: PeopleFilter = 'ALL'): Promise<string> {
    const results = await this.people(user, campaignId, filter, 'EXPORTED');
    return toCsv(
      ['Imię i nazwisko', 'E-mail', 'Dział', 'Dostarczenie', 'Kod', 'Wysłano', 'Kliknięcie', 'Wysłanie formularza'],
      results.map((result) => [
        result.name ?? '',
        result.email ?? '(usunięty pracownik)',
        result.departmentName ?? NO_DEPARTMENT_LABEL,
        result.delivery,
        result.failureCode ?? '',
        result.sentAt?.toISOString() ?? '',
        result.clickedAt?.toISOString() ?? '',
        result.submittedAt?.toISOString() ?? '',
      ]),
    );
  }

  private delivery(recipient: { sentAt: Date | null; failedAt: Date | null; failureCode: string | null; clickedAt: Date | null }): DeliveryStatus {
    if (recipient.sentAt) return 'SENT';
    if (recipient.failedAt) return recipient.failureCode && isUncertainFailureCode(recipient.failureCode) ? 'UNCERTAIN' : 'FAILED';
    return 'PENDING';
  }

  private matches(result: PersonResult, filter: PeopleFilter): boolean {
    switch (filter) {
      case 'PROBLEMS':
        return result.delivery === 'FAILED' || result.delivery === 'UNCERTAIN';
      case 'CLICKED':
        return result.clickedAt !== null;
      case 'SUBMITTED':
        return result.submittedAt !== null;
      default:
        return true;
    }
  }

  // ---- ustawienia i audyt ------------------------------------------------------------------------------------------

  async getSettings(organizationId: string): Promise<PersonalResultsSettingsView> {
    const row = await this.tenantPrisma.runInOrgContext(organizationId, (tx) => tx.phishingResultSettings.findUnique({ where: { organizationId } }));
    return { personalResultsEnabled: row?.personalResultsEnabled ?? false, justification: row?.justification ?? null, changedByEmail: row?.changedByEmail ?? null, updatedAt: row?.updatedAt ?? null };
  }

  /**
   * Włączenie/wyłączenie wyników osobowych. Włączenie wymaga uzasadnienia (>= 20 znaków). Ustawienie i wpis audytu
   * (ENABLED/DISABLED) w JEDNEJ transakcji; ustawienie tej samej wartości = 409 (bez dubli w dzienniku).
   */
  async setPersonalResults(user: AuthenticatedUser, dto: SetPersonalResultsDto): Promise<PersonalResultsSettingsView> {
    const justification = dto.justification?.trim() || null;
    if (dto.enabled && (justification?.length ?? 0) < JUSTIFICATION_MIN_LENGTH) {
      throw new BadRequestException(JUSTIFICATION_REQUIRED);
    }
    // KeyedMutex (w procesie) trzyma oczekujące przełączenia poza pulą połączeń (patrz komentarz w KeyedMutex); blokada
    // doradcza poniżej zostaje jedyną ochroną między instancjami API.
    await this.toggleLock.run(user.organizationId, () => this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      // Rola i status z bazy (nie z JWT) + blokada doradcza organizacji na czas zmiany: równoległe przełączenia się
      // serializują (jedno wygrywa, drugie dostaje 409 zamiast P2002/500 albo dubla wpisu ENABLED), a odczyty flagi
      // (FOR SHARE) czekają na zatwierdzenie zmiany.
      const actor = await this.loadActor(tx, user);
      if (actor.role !== Role.ORG_ADMIN) {
        throw new ForbiddenException('Brak uprawnień do tego zasobu');
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phishing-results:${user.organizationId}`}))`;
      const current = await tx.phishingResultSettings.findUnique({ where: { organizationId: user.organizationId } });
      if ((current?.personalResultsEnabled ?? false) === dto.enabled) {
        throw new ConflictException(PERSONAL_RESULTS_UNCHANGED);
      }
      const actorEmail = actor.email;
      await tx.phishingResultSettings.upsert({
        where: { organizationId: user.organizationId },
        create: { organizationId: user.organizationId, personalResultsEnabled: dto.enabled, justification, changedByEmail: actorEmail },
        update: { personalResultsEnabled: dto.enabled, justification, changedByEmail: actorEmail },
      });
      await tx.phishingResultVisibilityAudit.create({
        data: { organizationId: user.organizationId, action: dto.enabled ? 'ENABLED' : 'DISABLED', justification, actorUserId: user.userId, actorEmail },
      });
    }, { maxWait: 15_000, timeout: 30_000 }));
    return this.getSettings(user.organizationId);
  }

  async audit(organizationId: string, limit = 200): Promise<VisibilityAuditView[]> {
    return this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.phishingResultVisibilityAudit.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, action: true, justification: true, campaignId: true, filter: true, rowCount: true, actorEmail: true, createdAt: true },
      }),
    );
  }
}
