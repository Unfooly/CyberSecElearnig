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

/** Wiersz skrzynki ORG_ADMIN: pełna tożsamość zgłaszającego (potrzebna do odpowiedzi), bez treści (ta jest w szczegółach). */
export interface AdminInboxItem {
  id: string;
  createdAt: Date;
  status: ReportStatus;
  subject: string | null;
  senderText: string | null;
  senderDomain: string | null;
  reporter: { userId: string; name: string | null; email: string } | null;
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

export interface AdminReportDetail extends AdminInboxItem {
  body: string | null;
  headers: string | null;
  comment: string | null;
  departmentName: string | null;
  events: ReportEventView[];
}

/**
 * Widok kierownika działu (decyzja 1): lista zgłoszeń WŁASNEGO działu BEZ tożsamości zgłaszającego, bez treści, nagłówków,
 * komentarza i notatek, bez możliwości zmiany statusu. Dział czytany z bazy (nie z tokenu). Dział mniejszy niż próg
 * (MIN_GROUP_SIZE aktywnych osób) nie dostaje listy ("za mało danych") - w takim dziale pojedyncze zgłoszenie
 * identyfikowałoby zgłaszającego, tak samo jak w wynikach symulacji.
 */
export interface DepartmentInboxItem {
  id: string;
  createdAt: Date;
  status: ReportStatus;
  subject: string | null;
  senderText: string | null;
  senderDomain: string | null;
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
      const reporters = await this.reporters(tx, user.organizationId, rows.map((row) => row.reporterUserId));
      return { items: rows.map((row) => this.adminItem(row, reporters)), total, page, pageSize };
    });
  }

  async getForAdmin(user: AuthenticatedUser, reportId: string): Promise<AdminReportDetail> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      const row = await tx.threatReport.findFirst({ where: { id: reportId, organizationId: user.organizationId, kind: 'REAL' }, select: ADMIN_SELECT });
      if (!row) {
        throw new NotFoundException(NOT_FOUND);
      }
      const [reporters, department, events] = await Promise.all([
        this.reporters(tx, user.organizationId, [row.reporterUserId]),
        row.reporterDepartmentId ? tx.department.findFirst({ where: { id: row.reporterDepartmentId, organizationId: user.organizationId }, select: { name: true } }) : null,
        tx.threatReportEvent.findMany({
          where: { organizationId: user.organizationId, reportId: row.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, type: true, fromStatus: true, toStatus: true, note: true, actorEmail: true, createdAt: true },
        }),
      ]);
      return { ...this.adminItem(row, reporters), body: row.body, headers: row.headers, comment: row.comment, departmentName: department?.name ?? null, events };
    });
  }

  /**
   * Zmiana statusu + wpis w dzienniku zdarzeń w JEDNEJ transakcji. Zmiana jest warunkowa (status musi być nadal taki, jaki
   * widział admin): równoległa zmiana daje 409 zamiast cichego nadpisania i dubla wpisu.
   */
  async changeStatus(user: AuthenticatedUser, reportId: string, dto: ChangeStatusDto): Promise<AdminReportDetail> {
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
    return this.getForAdmin(user, reportId);
  }

  async addNote(user: AuthenticatedUser, reportId: string, dto: AddNoteDto): Promise<AdminReportDetail> {
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
    return this.getForAdmin(user, reportId);
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
      const where: Prisma.ThreatReportWhereInput = {
        organizationId: user.organizationId,
        kind: 'REAL',
        reporterDepartmentId: actor.departmentId,
        createdAt: { lte: visibleUntil },
        ...(query.status ? { status: query.status } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.threatReport.count({ where }),
        tx.threatReport.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          // Wąski select: bez zgłaszającego, treści, nagłówków, komentarza i notatek (typy, nie konwencja).
          select: { id: true, createdAt: true, status: true, subject: true, senderText: true, senderDomain: true },
        }),
      ]);
      return { ...empty, items: rows, total };
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

  private adminItem(
    row: { id: string; createdAt: Date; status: ReportStatus; subject: string | null; senderText: string | null; senderDomain: string | null; reporterUserId: string | null; contentPurgedAt: Date | null },
    reporters: Map<string, { id: string; email: string; firstName: string | null; lastName: string | null }>,
  ): AdminInboxItem {
    const person = row.reporterUserId ? reporters.get(row.reporterUserId) : undefined;
    const name = [person?.firstName, person?.lastName].filter(Boolean).join(' ');
    return {
      id: row.id,
      createdAt: row.createdAt,
      status: row.status,
      subject: row.subject,
      senderText: row.senderText,
      senderDomain: row.senderDomain,
      reporter: person ? { userId: person.id, name: name || null, email: person.email } : null,
      hasContent: row.contentPurgedAt === null,
    };
  }
}
