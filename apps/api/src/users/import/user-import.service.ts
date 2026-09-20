import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserImportRowStatus } from '@prisma/client';
import { Role } from '@cyberszkolo/shared';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { KeyedMutex } from '../../common/keyed-mutex';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { loadSeatUsage, SeatUsage } from '../seats';
import { ImportFileError, ParsedImport, parseImportFile } from './csv-import';

const err = (code: string, message: string) => ({ code, message });
export const IMPORT_FILE_INVALID = 'IMPORT_FILE_INVALID';
const NOT_FOUND = 'Nie znaleziono podglądu importu (mógł wygasnąć albo został anulowany).';
const FORBIDDEN = 'Brak uprawnień do tego zasobu';

/** Podgląd jest ważny 24 h; potem kasuje go job sprzątania (dane osobowe z pliku nie zostają w bazie bez końca). */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
/** Ile błędów zwraca podgląd od razu (resztę pobiera się stronicowaniem wierszy). */
export const PREVIEW_ERRORS_LIMIT = 200;
export const PREVIEW_SAMPLE_LIMIT = 20;
const INSERT_CHUNK = 1000;
export const MAX_ROWS_PAGE_SIZE = 100;
export const DEFAULT_ROWS_PAGE_SIZE = 50;

export interface ImportSeats extends SeatUsage {
  /** Ile nowych kont utworzyłby import (wiersze poprawne i nowe). */
  required: number;
  /** Ile miejsc brakuje (0 = mieści się). */
  missing: number;
  ok: boolean;
}

export interface ImportSummary {
  id: string;
  fileName: string | null;
  delimiter: string;
  createdAt: Date;
  expiresAt: Date;
  totalRows: number;
  validCount: number;
  existingCount: number;
  errorCount: number;
  skippedEmpty: number;
  ignoredColumns: string[];
  seats: ImportSeats;
}

export interface ImportRowView {
  line: number;
  email: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  status: UserImportRowStatus;
  reason: string | null;
}

export interface ImportPreview extends ImportSummary {
  errors: { line: number; email: string; reason: string }[];
  errorsTruncated: boolean;
  sample: ImportRowView[];
}

export interface ImportRowsPage {
  items: ImportRowView[];
  total: number;
  page: number;
  pageSize: number;
}

const ROW_SELECT = { line: true, email: true, firstName: true, lastName: true, departmentName: true, status: true, reason: true } as const;

/** Nazwa pliku do wyświetlenia: bez ścieżki i znaków sterujących, do 200 znaków. */
export function safeFileName(name: string | undefined): string | null {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '').trim();
  return cleaned ? Array.from(cleaned).slice(0, 200).join('') : null;
}

/**
 * Import pracowników z CSV, KROK 1 - podgląd. Plik jest w całości rozebrany i zwalidowany per wiersz (błąd jednego wiersza
 * nie zatrzymuje reszty), adresy z kontem W TEJ organizacji są oznaczone jako istniejące (pomijane, nic nie nadpisujemy), a
 * wynik zapisany jako partia, na której pracuje krok potwierdzenia (commit 5/5). KROK 1 NIE TWORZY KONT ani nie wysyła maili.
 *
 * Ochrona wyliczania kont: NIE sprawdzamy adresów w INNYCH organizacjach (wymagałoby to furtki omijającej RLS i pozwalało
 * sprawdzać, kto ma konto na platformie). Taki adres wyjdzie dopiero przy potwierdzeniu jako ogólny błąd "Nie można użyć tego
 * adresu e-mail" i nie zużyje licencji.
 *
 * Zakres i dostęp: tylko ORG_ADMIN (rola i status z bazy), każde zapytanie z jawnym organizationId w runInOrgContext (RLS).
 */
@Injectable()
export class UserImportService {
  private readonly previewLock = new KeyedMutex();

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async preview(user: AuthenticatedUser, file: { buffer: Buffer; originalname?: string } | undefined, now: Date = new Date()): Promise<ImportPreview> {
    if (!file?.buffer) {
      throw new BadRequestException(err(IMPORT_FILE_INVALID, 'Brak pliku CSV w żądaniu.'));
    }
    let parsed: ParsedImport;
    try {
      parsed = parseImportFile(file.buffer);
    } catch (error) {
      if (error instanceof ImportFileError) {
        throw new BadRequestException(err(IMPORT_FILE_INVALID, error.message));
      }
      throw error;
    }

    // Kolejka w procesie (bez zajmowania połączeń z puli) + blokada w bazie: jedna aktywna partia podglądu na organizację.
    const created = await this.previewLock.run(user.organizationId, () =>
      this.tenantPrisma.runInOrgContext(
        user.organizationId,
        async (tx) => {
          const actor = await this.requireAdmin(tx, user);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user-import:${user.organizationId}`}))`;
          // Nowy podgląd zastępuje poprzedni (ogranicza ilość przechowywanych danych osobowych).
          await tx.userImportBatch.deleteMany({ where: { organizationId: user.organizationId } });

          const existing = new Set(
            (await tx.user.findMany({ where: { organizationId: user.organizationId }, select: { email: true } })).map((row) => row.email.toLowerCase()),
          );
          const rows = parsed.rows.map((row) => {
            if (row.error) return { ...row, status: 'ERROR' as const, reason: row.error };
            if (existing.has(row.email)) return { ...row, status: 'EXISTING' as const, reason: 'Konto z tym adresem już istnieje w organizacji - pominięto' };
            return { ...row, status: 'VALID' as const, reason: null };
          });
          const count = (status: UserImportRowStatus) => rows.filter((row) => row.status === status).length;
          const batch = await tx.userImportBatch.create({
            data: {
              organizationId: user.organizationId,
              createdByUserId: user.userId,
              createdByEmail: actor.email,
              fileName: safeFileName(file.originalname),
              delimiter: parsed.delimiter,
              totalRows: rows.length,
              validCount: count('VALID'),
              existingCount: count('EXISTING'),
              errorCount: count('ERROR'),
              skippedEmpty: parsed.skippedEmpty,
              ignoredColumns: parsed.ignoredColumns,
              expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
              createdAt: now,
            },
          });
          for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
            await tx.userImportRow.createMany({
              data: rows.slice(start, start + INSERT_CHUNK).map((row) => ({
                organizationId: user.organizationId,
                batchId: batch.id,
                line: row.line,
                email: row.email,
                firstName: row.firstName,
                lastName: row.lastName,
                departmentName: row.departmentName,
                status: row.status,
                reason: row.reason,
              })),
            });
          }
          const seats = await loadSeatUsage(tx, user.organizationId);
          return { batch, seats, rows };
        },
        { maxWait: 15_000, timeout: 60_000 },
      ),
    );

    const errorRows = created.rows.filter((row) => row.status === 'ERROR');
    return {
      ...this.summary(created.batch, created.seats),
      errors: errorRows.slice(0, PREVIEW_ERRORS_LIMIT).map((row) => ({ line: row.line, email: row.email, reason: row.reason as string })),
      errorsTruncated: errorRows.length > PREVIEW_ERRORS_LIMIT,
      sample: created.rows
        .filter((row) => row.status === 'VALID')
        .slice(0, PREVIEW_SAMPLE_LIMIT)
        .map((row) => ({ line: row.line, email: row.email, firstName: row.firstName, lastName: row.lastName, departmentName: row.departmentName, status: row.status, reason: null })),
    };
  }

  /** Podsumowanie partii ze ŚWIEŻYM stanem miejsc (liczba kont mogła się zmienić od podglądu). */
  async get(user: AuthenticatedUser, batchId: string, now: Date = new Date()): Promise<ImportSummary> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      const batch = await this.findBatch(tx, user.organizationId, batchId, now);
      return this.summary(batch, await loadSeatUsage(tx, user.organizationId));
    });
  }

  async rows(user: AuthenticatedUser, batchId: string, query: { status?: UserImportRowStatus; page?: number; pageSize?: number }, now: Date = new Date()): Promise<ImportRowsPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_ROWS_PAGE_SIZE;
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      await this.findBatch(tx, user.organizationId, batchId, now);
      const where: Prisma.UserImportRowWhereInput = { organizationId: user.organizationId, batchId, ...(query.status ? { status: query.status } : {}) };
      const [total, items] = await Promise.all([
        tx.userImportRow.count({ where }),
        tx.userImportRow.findMany({ where, orderBy: { line: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, select: ROW_SELECT }),
      ]);
      return { items, total, page, pageSize };
    });
  }

  /** Anulowanie podglądu: partia i jej wiersze są usuwane (kaskada). Idempotentne dla wygasłej partii tej organizacji nie jest - 404. */
  async cancel(user: AuthenticatedUser, batchId: string): Promise<void> {
    await this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      const deleted = await tx.userImportBatch.deleteMany({ where: { id: batchId, organizationId: user.organizationId } });
      if (deleted.count === 0) {
        throw new NotFoundException(NOT_FOUND);
      }
    });
  }

  // ---- wspólne -----------------------------------------------------------------------------------------------------

  private async findBatch(tx: Prisma.TransactionClient, organizationId: string, batchId: string, now: Date) {
    const batch = await tx.userImportBatch.findFirst({ where: { id: batchId, organizationId } });
    // Wygasła partia (job sprzątania mógł jeszcze jej nie skasować) jest dla użytkownika "nieistniejąca".
    if (!batch || batch.expiresAt.getTime() <= now.getTime()) {
      throw new NotFoundException(NOT_FOUND);
    }
    return batch;
  }

  private summary(
    batch: { id: string; fileName: string | null; delimiter: string; createdAt: Date; expiresAt: Date; totalRows: number; validCount: number; existingCount: number; errorCount: number; skippedEmpty: number; ignoredColumns: string[] },
    usage: SeatUsage,
  ): ImportSummary {
    const missing = Math.max(0, batch.validCount - usage.available);
    return {
      id: batch.id,
      fileName: batch.fileName,
      delimiter: batch.delimiter,
      createdAt: batch.createdAt,
      expiresAt: batch.expiresAt,
      totalRows: batch.totalRows,
      validCount: batch.validCount,
      existingCount: batch.existingCount,
      errorCount: batch.errorCount,
      skippedEmpty: batch.skippedEmpty,
      ignoredColumns: batch.ignoredColumns,
      seats: { ...usage, required: batch.validCount, missing, ok: missing === 0 },
    };
  }

  /** Użytkownik wywołujący z BAZY: musi istnieć w organizacji, być ACTIVE i mieć rolę ORG_ADMIN (rola z tokenu nie wystarcza). */
  private async requireAdmin(tx: Prisma.TransactionClient, user: AuthenticatedUser): Promise<{ email: string }> {
    const record = await tx.user.findFirst({ where: { id: user.userId, organizationId: user.organizationId }, select: { email: true, role: true, status: true } });
    if (!record || record.status !== 'ACTIVE' || record.role !== Role.ORG_ADMIN) {
      throw new ForbiddenException(FORBIDDEN);
    }
    return { email: record.email };
  }
}
