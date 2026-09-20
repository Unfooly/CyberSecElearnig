import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Role } from '@cyberszkolo/shared';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { MIN_GROUP_SIZE } from '../phishing/results/results-aggregation';
import { resolveResultsCacheTtlMs } from '../phishing/results/results-snapshot-cache';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AddNoteDto, ChangeStatusDto, DEFAULT_PAGE_SIZE, InboxQueryDto, ReportStatus } from './dto/inbox.dto';
import { maskTrackingTokens, sanitizePlainText } from './report-text';

const err = (code: string, message: string) => ({ code, message });
export const STATUS_UNCHANGED = err('STATUS_UNCHANGED', 'Zgłoszenie ma już ten status.');
export const STATUS_CONFLICT = err('STATUS_CONFLICT', 'Status zgłoszenia został w międzyczasie zmieniony. Odśwież widok.');
export const NOTE_INVALID = err('NOTE_INVALID', 'Notatka nie może być pusta.');
const NOT_FOUND = 'Nie znaleziono zgłoszenia.';
const FORBIDDEN = 'Brak uprawnień do tego zasobu';

interface Actor {
  email: string;
  role: string;
  departmentId: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Wiersz skrzynki ORG_ADMIN: temat i nadawca do triażu, BEZ treści i BEZ tożsamości zgłaszającego - ta jest wyłącznie w
 * szczegółach, których każdy wgląd jest audytowany (lista nie zostawia śladu, więc nie może ujawniać zgłaszającego).
 */
export interface AdminInboxItem {
  id: string;
  createdAt: Date;
  status: ReportStatus;
  subject: string | null;
  senderText: string | null;
  senderDomain: string | null;
  /** false = treść zgłoszenia została już usunięta (retencja 90 dni). */
  hasContent: boolean;
}

export interface ReportEventView {
  id: string;
  type: 'STATUS_CHANGED' | 'NOTE_ADDED';
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus | null;
  note: string | null;
  actorEmail: string;
  createdAt: Date;
}

/** Szczegóły zgłoszenia (treść, zgłaszający): zwracane WYŁĄCZNIE przez audytowany getForAdmin. */
export interface AdminReportDetail extends AdminInboxItem {
  reporter: { userId: string; name: string | null; email: string } | null;
  body: string | null;
  headers: string | null;
  comment: string | null;
  departmentName: string | null;
  events: ReportEventView[];
  /** Ostatnie wglądy w to zgłoszenie (kto i kiedy) - najnowsze pierwsze, do RECENT_VIEWS wpisów. */
  views: ReportViewEntry[];
  /** Podsumowanie wglądów per admin (liczba, pierwszy, ostatni): nie da się go "zakopać" wieloma odświeżeniami. */
  viewers: ReportViewer[];
}

export interface ReportViewEntry {
  id: string;
  actorEmail: string;
  createdAt: Date;
}

export interface ReportViewer {
  actorEmail: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
}

/**
 * Wynik zmiany statusu / dodania notatki: TYLKO status i historia zdarzeń - bez treści i zgłaszającego. Te operacje nie zapisują
 * wpisu wglądu, więc nie mogą być drogą do odczytu treści z pominięciem audytu.
 */
export interface ReportActionResult {
  id: string;
  status: ReportStatus;
  events: ReportEventView[];
}

const RECENT_VIEWS = 50;

/**
 * Widok kierownika działu (decyzje 1 i 2026-09-20): zgłoszenia WŁASNEGO działu jako sama informacja o zdarzeniu - data,
 * status (tylko zgłoszenia prawdziwe), DOMENA nadawcy i czy zgłoszenie było powiązane z symulacją. BEZ tematu, pełnego
 * nadawcy (dane osób trzecich), tożsamości zgłaszającego, treści, nagłówków, komentarza i notatek; bez zmiany statusu.
 * Dział czytany z bazy (nie z tokenu); dział z mniej niż MIN_GROUP_SIZE innymi osobami dostaje "za mało danych".
 */
export interface DepartmentInboxItem {
  id: string;
  createdAt: Date;
  /** null dla zgłoszenia symulacyjnego (status ma sens tylko w skrzynce prawdziwych zgłoszeń). */
  status: ReportStatus | null;
  senderDomain: string | null;
  isSimulation: boolean;
}

export interface DepartmentInbox extends Page<DepartmentInboxItem> {
  insufficientData: boolean;
  minGroupSize: number;
}

// Lista: wąski select BEZ treści, nagłówków i komentarza (do 100 wierszy na żądanie - bez ciągnięcia dużych pól z bazy).
const LIST_SELECT = {
  id: true,
  createdAt: true,
  status: true,
  subject: true,
  senderText: true,
  senderDomain: true,
  reporterUserId: true,
  reporterDepartmentId: true,
  contentPurgedAt: true,
} as const;

// Szczegóły: pełny zestaw (treść, nagłówki, komentarz).
const ADMIN_SELECT = { ...LIST_SELECT, body: true, headers: true, comment: true } as const;

/** Maksymalna liczba zdarzeń (notatek i zmian statusu) na zgłoszenie - dziennik jest append-only, więc rośnie tylko do tego limitu. */
export const MAX_EVENTS_PER_REPORT = 200;
export const EVENT_LIMIT = err('EVENT_LIMIT', 'Zgłoszenie ma już maksymalną liczbę wpisów w historii.');

/**
 * Skrzynka zgłoszeń (tylko zgłoszenia PRAWDZIWE; zgłoszenia dopasowane do symulacji nie trafiają do skrzynki - liczą się
 * wyłącznie w statystykach). Uprawnienia egzekwuje TEN serwis (kontroler to pierwsza linia): rola, status (ACTIVE) i dział
 * z bazy na każde żądanie. Każde zapytanie ma jawny organizationId i idzie przez runInOrgContext (RLS).
 */
@Injectable()
export class ThreatReportInboxService {
  private readonly visibilityDelayMs: number;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    config: ConfigService,
  ) {
    this.visibilityDelayMs = resolveResultsCacheTtlMs(config);
  }

  // ---- ORG_ADMIN ---------------------------------------------------------------------------------------------------

  async listForAdmin(user: AuthenticatedUser, query: InboxQueryDto): Promise<Page<AdminInboxItem>> {
    const { page, pageSize } = this.paging(query);
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      const where: Prisma.ThreatReportWhereInput = { organizationId: user.organizationId, kind: 'REAL', ...(query.status ? { status: query.status } : {}) };
      const [total, rows] = await Promise.all([
        tx.threatReport.count({ where }),
        tx.threatReport.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: LIST_SELECT }),
      ]);
      return { items: rows.map((row) => this.adminItem(row)), total, page, pageSize };
    });
  }

  /**
   * Szczegóły zgłoszenia (treść, nagłówki, komentarz, zgłaszający). Każdy wgląd jest AUDYTOWANY jak wgląd w wyniki osobowe:
   * wpis (kto, kiedy, które zgłoszenie) powstaje w tej samej transakcji co odczyt - dane opuszczają serwis dopiero po jej
   * zatwierdzeniu, więc nie da się ich odczytać bez śladu; błąd zapisu wpisu cofa całość.
   */
  async getForAdmin(user: AuthenticatedUser, reportId: string): Promise<AdminReportDetail> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      const actor = await this.requireAdmin(tx, user);
      const row = await tx.threatReport.findFirst({ where: { id: reportId, organizationId: user.organizationId, kind: 'REAL' }, select: ADMIN_SELECT });
      if (!row) {
        throw new NotFoundException(NOT_FOUND);
      }
      // Wpis wglądu PRZED odczytem reszty, w tej samej transakcji (błąd zapisu cofa odczyt).
      await tx.threatReportView.create({ data: { organizationId: user.organizationId, reportId, actorUserId: user.userId, actorEmail: actor.email } });
      const [reporters, department, events, views, viewers] = await Promise.all([
        this.reporters(tx, user.organizationId, [row.reporterUserId]),
        row.reporterDepartmentId ? tx.department.findFirst({ where: { id: row.reporterDepartmentId, organizationId: user.organizationId }, select: { name: true } }) : null,
        this.events(tx, user.organizationId, reportId),
        tx.threatReportView.findMany({
          where: { organizationId: user.organizationId, reportId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: RECENT_VIEWS,
          select: { id: true, actorEmail: true, createdAt: true },
        }),
        this.viewers(tx, user.organizationId, reportId),
      ]);
      const person = row.reporterUserId ? reporters.get(row.reporterUserId) : undefined;
      const name = [person?.firstName, person?.lastName].filter(Boolean).join(' ');
      return {
        ...this.adminItem(row),
        reporter: person ? { userId: person.id, name: name || null, email: person.email } : null,
        body: row.body,
        headers: row.headers,
        comment: row.comment,
        departmentName: department?.name ?? null,
        events,
        views,
        viewers,
      };
    });
  }

  /** Stan po zmianie statusu/notatce: tylko status i historia (bez treści i zgłaszającego), bez wpisu wglądu. */
  private actionResult(user: AuthenticatedUser, reportId: string): Promise<ReportActionResult> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      const row = await tx.threatReport.findFirst({ where: { id: reportId, organizationId: user.organizationId, kind: 'REAL' }, select: { id: true, status: true } });
      if (!row) {
        throw new NotFoundException(NOT_FOUND);
      }
      return { id: row.id, status: row.status, events: await this.events(tx, user.organizationId, reportId) };
    });
  }

  private events(tx: Prisma.TransactionClient, organizationId: string, reportId: string): Promise<ReportEventView[]> {
    return tx.threatReportEvent.findMany({
      where: { organizationId, reportId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, fromStatus: true, toStatus: true, note: true, actorEmail: true, createdAt: true },
    });
  }

  private async viewers(tx: Prisma.TransactionClient, organizationId: string, reportId: string): Promise<ReportViewer[]> {
    const groups = await tx.threatReportView.groupBy({
      by: ['actorEmail'],
      where: { organizationId, reportId },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    return groups
      .map((group) => ({ actorEmail: group.actorEmail, count: group._count._all, firstAt: group._min.createdAt as Date, lastAt: group._max.createdAt as Date }))
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  }

  /**
   * Zmiana statusu + wpis w dzienniku zdarzeń w JEDNEJ transakcji. Zmiana jest warunkowa (status musi być nadal taki, jaki
   * widział admin): równoległa zmiana daje 409 zamiast cichego nadpisania i dubla wpisu.
   */
  async changeStatus(user: AuthenticatedUser, reportId: string, dto: ChangeStatusDto): Promise<ReportActionResult> {
    await this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      const actor = await this.requireAdmin(tx, user);
      const report = await tx.threatReport.findFirst({ where: { id: reportId, organizationId: user.organizationId, kind: 'REAL' }, select: { status: true } });
      if (!report) {
        throw new NotFoundException(NOT_FOUND);
      }
      if (report.status === dto.status) {
        throw new ConflictException(STATUS_UNCHANGED);
      }
      const updated = await tx.threatReport.updateMany({
        where: { id: reportId, organizationId: user.organizationId, kind: 'REAL', status: report.status },
        data: { status: dto.status },
      });
      if (updated.count !== 1) {
        throw new ConflictException(STATUS_CONFLICT);
      }
      await this.assertEventCapacity(tx, user.organizationId, reportId);
      await tx.threatReportEvent.create({
        data: {
          organizationId: user.organizationId,
          reportId,
          type: 'STATUS_CHANGED',
          fromStatus: report.status,
          toStatus: dto.status,
          actorUserId: user.userId,
          actorEmail: actor.email,
        },
      });
    });
    return this.actionResult(user, reportId);
  }

  async addNote(user: AuthenticatedUser, reportId: string, dto: AddNoteDto): Promise<ReportActionResult> {
    // Czysty tekst; linki śledzące maskowane także tu (admin mógł wkleić link z maila).
    const note = maskTrackingTokens(sanitizePlainText(dto.note, { multiline: true }));
    if (!note) {
      throw new BadRequestException(NOTE_INVALID);
    }
    await this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      const actor = await this.requireAdmin(tx, user);
      const report = await tx.threatReport.findFirst({ where: { id: reportId, organizationId: user.organizationId, kind: 'REAL' }, select: { id: true } });
      if (!report) {
        throw new NotFoundException(NOT_FOUND);
      }
      await this.assertEventCapacity(tx, user.organizationId, reportId);
      await tx.threatReportEvent.create({
        data: { organizationId: user.organizationId, reportId, type: 'NOTE_ADDED', note: note.slice(0, 1000), actorUserId: user.userId, actorEmail: actor.email },
      });
    });
    return this.actionResult(user, reportId);
  }

  // ---- DEPARTMENT_MANAGER ------------------------------------------------------------------------------------------

  /**
   * Widok kierownika działu. Dwa zabezpieczenia przed identyfikacją zgłaszającego (poza brakiem jego tożsamości w odpowiedzi):
   *  - próg liczebności liczony wśród aktywnych osób działu BEZ samego kierownika (on wie, czy sam coś zgłaszał, więc nie
   *    powiększa zbioru anonimowości): dział z mniej niż MIN_GROUP_SIZE innymi osobami dostaje "za mało danych";
   *  - zgłoszenia są widoczne dopiero po upływie okna RESULTS_CACHE_TTL_SECONDS (domyślnie godzina - to samo opóźnienie co agregaty
   *    wyników): nowe zgłoszenie nie pojawia się "na żywo" zaraz po tym, jak ktoś powiedział, że zgłosił. `total` liczy tylko widoczne.
   */
  async listForManager(user: AuthenticatedUser, query: InboxQueryDto, now: Date = new Date()): Promise<DepartmentInbox> {
    const { page, pageSize } = this.paging(query);
    const visibleUntil = new Date(now.getTime() - this.visibilityDelayMs);
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      const actor = await this.loadActor(tx, user);
      if (actor.role !== Role.DEPARTMENT_MANAGER) {
        throw new ForbiddenException(FORBIDDEN);
      }
      const empty: DepartmentInbox = { items: [], total: 0, page, pageSize, insufficientData: false, minGroupSize: MIN_GROUP_SIZE };
      if (!actor.departmentId) {
        return empty;
      }
      const members = await tx.user.count({
        where: { organizationId: user.organizationId, departmentId: actor.departmentId, status: 'ACTIVE', id: { not: user.userId } },
      });
      if (members < MIN_GROUP_SIZE) {
        return { ...empty, insufficientData: true };
      }
      // Zgłoszenia prawdziwe i symulacyjne (kierownik widzi tylko, czy zgłoszenie było powiązane z symulacją); filtr statusu
      // dotyczy wyłącznie prawdziwych.
      const where: Prisma.ThreatReportWhereInput = {
        organizationId: user.organizationId,
        reporterDepartmentId: actor.departmentId,
        createdAt: { lte: visibleUntil },
        ...(query.status ? { kind: 'REAL', status: query.status } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.threatReport.count({ where }),
        tx.threatReport.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          // Wąski select (typy, nie konwencja): bez tematu, pełnego nadawcy, zgłaszającego, treści, nagłówków, komentarza i notatek.
          select: { id: true, createdAt: true, status: true, senderDomain: true, kind: true },
        }),
      ]);
      const items = rows.map((row): DepartmentInboxItem => ({
        id: row.id,
        createdAt: row.createdAt,
        status: row.kind === 'REAL' ? row.status : null,
        // Dla zgłoszenia symulacyjnego domeny nie podajemy: to nasza domena kampanii (nie niesie informacji poza "tak"), a
        // jej ujawnienie zdradzałoby kierownikowi, którą kampanię trwa.
        senderDomain: row.kind === 'SIMULATION' ? null : row.senderDomain,
        isSimulation: row.kind === 'SIMULATION',
      }));
      return { ...empty, items, total };
    });
  }

  // ---- wspólne -----------------------------------------------------------------------------------------------------

  /** Dziennik zgłoszenia jest append-only (bez DELETE), więc ograniczamy jego wzrost: max MAX_EVENTS_PER_REPORT wpisów. */
  private async assertEventCapacity(tx: Prisma.TransactionClient, organizationId: string, reportId: string): Promise<void> {
    const existing = await tx.threatReportEvent.count({ where: { organizationId, reportId } });
    if (existing >= MAX_EVENTS_PER_REPORT) {
      throw new ConflictException(EVENT_LIMIT);
    }
  }

  private paging(query: InboxQueryDto) {
    return { page: query.page ?? 1, pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE };
  }

  /** Użytkownik wywołujący z BAZY: musi istnieć w organizacji i być ACTIVE; rola i dział pochodzą stąd, nie z tokenu. */
  private async loadActor(tx: Prisma.TransactionClient, user: AuthenticatedUser): Promise<Actor> {
    const record = await tx.user.findFirst({
      where: { id: user.userId, organizationId: user.organizationId },
      select: { email: true, role: true, status: true, departmentId: true },
    });
    if (!record || record.status !== 'ACTIVE') {
      throw new ForbiddenException(FORBIDDEN);
    }
    return record;
  }

  private async requireAdmin(tx: Prisma.TransactionClient, user: AuthenticatedUser): Promise<Actor> {
    const actor = await this.loadActor(tx, user);
    if (actor.role !== Role.ORG_ADMIN) {
      throw new ForbiddenException(FORBIDDEN);
    }
    return actor;
  }

  private async reporters(tx: Prisma.TransactionClient, organizationId: string, ids: (string | null)[]) {
    const userIds = [...new Set(ids.filter((id): id is string => id !== null))];
    const users = userIds.length
      ? await tx.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, email: true, firstName: true, lastName: true } })
      : [];
    return new Map(users.map((entry) => [entry.id, entry]));
  }

  private adminItem(row: { id: string; createdAt: Date; status: ReportStatus; subject: string | null; senderText: string | null; senderDomain: string | null; contentPurgedAt: Date | null }): AdminInboxItem {
    return {
      id: row.id,
      createdAt: row.createdAt,
      status: row.status,
      subject: row.subject,
      senderText: row.senderText,
      senderDomain: row.senderDomain,
      hasContent: row.contentPurgedAt === null,
    };
  }
}
