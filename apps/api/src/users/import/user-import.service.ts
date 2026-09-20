import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserImportBatchStatus, UserImportRowStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Role } from '@cyberszkolo/shared';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { KeyedMutex } from '../../common/keyed-mutex';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { toCsv } from '../../phishing/results/results-csv';
import { loadSeatUsage, lockSeats, seatLimitError, SeatUsage } from '../seats';
import { ImportFileError, ParsedImport, parseImportFile } from './csv-import';
import { dailyRemaining, estimateInviteCompletion, INVITE_DAILY_LIMIT_PER_ORG } from './invite-pace';

const err = (code: string, message: string) => ({ code, message });
export const IMPORT_FILE_INVALID = 'IMPORT_FILE_INVALID';
export const IMPORT_ALREADY_CONFIRMED = err('IMPORT_ALREADY_CONFIRMED', 'Ten import został już potwierdzony. Nie można go potwierdzić ani anulować ponownie - możesz zatrzymać wysyłkę zaproszeń.');
export const IMPORT_IN_PROGRESS = err('IMPORT_IN_PROGRESS', 'Poprzedni import nadal wysyła zaproszenia. Poczekaj na jego zakończenie albo zatrzymaj wysyłkę.');
export const IMPORT_NOTHING_TO_CONFIRM = err('IMPORT_NOTHING_TO_CONFIRM', 'W pliku nie ma żadnych nowych, poprawnych osób do dodania.');
export const IMPORT_NOT_RUNNING = err('IMPORT_NOT_RUNNING', 'Ten import nie wysyła już zaproszeń.');
const NOT_FOUND = 'Nie znaleziono importu (podgląd mógł wygasnąć albo został anulowany).';
const FORBIDDEN = 'Brak uprawnień do tego zasobu';

/** Po potwierdzeniu partia żyje najwyżej tyle, ile może trwać wysyłka (5000 osób / 300 dziennie ~ 17 dni, z zapasem). */
export const PROCESSING_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** Po zakończeniu wysyłki raport (adresy e-mail i imiona z pliku) jest dostępny 30 dni, potem partia jest kasowana. */
export const REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

/** Postęp po potwierdzeniu: konta i kolejka zaproszeń (limit dobowy organizacji rozkłada wysyłkę na kolejne dni). */
export interface ImportProgress {
  accountsCreated: number;
  accountsFailed: number;
  invites: { pending: number; sending: number; sent: number; failed: number; skipped: number };
  /** Ile zaproszeń wysłano z ilu do wysłania (utworzone konta). */
  invitesSent: number;
  invitesTotal: number;
  /** Ile jeszcze czeka na wysłanie (oczekujące + w trakcie). */
  remaining: number;
  dailyLimit: number;
  /** Ile zaproszeń dobowy limit pozwala wysłać jeszcze w ciągu 24 h (limit dzielą zaproszenia ręczne). */
  dailyRemaining: number;
  /** true = reszta nie zmieści się w dzisiejszym limicie i pójdzie w kolejnych dniach. */
  restTomorrow: boolean;
  /** Szacunek (nie obietnica); null, gdy nic nie czeka. */
  estimatedCompletionAt: Date | null;
  done: boolean;
}

export interface ImportSummary {
  id: string;
  status: UserImportBatchStatus;
  fileName: string | null;
  delimiter: string;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  completedAt: Date | null;
  /** null przed potwierdzeniem (podgląd). */
  progress: ImportProgress | null;
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
  /** Po potwierdzeniu (wiersze VALID): wynik konta i stan zaproszenia. */
  accountResult?: 'CREATED' | 'FAILED' | null;
  accountReason?: string | null;
  inviteStatus?: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | null;
  inviteReason?: string | null;
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

const ROW_SELECT = {
  line: true,
  email: true,
  firstName: true,
  lastName: true,
  departmentName: true,
  status: true,
  reason: true,
  accountResult: true,
  accountReason: true,
  inviteStatus: true,
  inviteReason: true,
} as const;

const VALIDATION_LABELS: Record<UserImportRowStatus, string> = { VALID: 'Poprawny', EXISTING: 'Konto już istnieje', ERROR: 'Błąd' };
const ACCOUNT_LABELS = { CREATED: 'Utworzono', FAILED: 'Nie utworzono' } as const;
const INVITE_LABELS = { PENDING: 'Oczekuje', SENDING: 'Wysyłanie', SENT: 'Wysłano', FAILED: 'Nie wysłano', SKIPPED: 'Pominięto' } as const;

/**
 * Domyka partię PROCESSING jako COMPLETED, gdy nie ma już zaproszeń oczekujących ani w trakcie wysyłki; od tej chwili raport jest
 * dostępny REPORT_TTL_MS (potem partia z wierszami jest kasowana). Warunkowe (status PROCESSING w samym UPDATE) - bezpieczne wobec
 * równoległych biegów. Zwraca true, gdy to wywołanie domknęło partię.
 */
export async function completeBatchIfDone(tx: Prisma.TransactionClient, organizationId: string, batchId: string, now: Date): Promise<boolean> {
  const open = await tx.userImportRow.count({ where: { organizationId, batchId, inviteStatus: { in: ['PENDING', 'SENDING'] } } });
  if (open > 0) return false;
  const done = await tx.userImportBatch.updateMany({
    where: { id: batchId, organizationId, status: 'PROCESSING' },
    data: { status: 'COMPLETED', completedAt: now, expiresAt: new Date(now.getTime() + REPORT_TTL_MS) },
  });
  return done.count === 1;
}

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
          // Nowy podgląd zastępuje poprzedni PODGLĄD (ogranicza ilość przechowywanych danych osobowych); partie już potwierdzone
          // (trwa wysyłka zaproszeń albo czeka raport) zostają nietknięte.
          await tx.userImportBatch.deleteMany({ where: { organizationId: user.organizationId, status: 'PREVIEW' } });

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

  /** Podsumowanie partii ze ŚWIEŻYM stanem miejsc (liczba kont mogła się zmienić od podglądu) i - po potwierdzeniu - postępem. */
  async get(user: AuthenticatedUser, batchId: string, now: Date = new Date()): Promise<ImportSummary> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, (tx) => this.loadSummary(tx, user, batchId, now));
  }

  /**
   * Ostatni potwierdzony import organizacji (trwający albo zakończony, jeszcze niewygasły) - kreator w UI po ponownym otwarciu
   * pokazuje jego postęp i pozwala pobrać raport. Podgląd (PREVIEW) nie jest "ostatnim importem". null, gdy nie ma czego pokazać.
   */
  async latest(user: AuthenticatedUser, now: Date = new Date()): Promise<{ batch: ImportSummary | null }> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      const batch = await tx.userImportBatch.findFirst({
        where: { organizationId: user.organizationId, status: { in: ['PROCESSING', 'COMPLETED'] }, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return { batch: batch ? await this.loadSummary(tx, user, batch.id, now) : null };
    });
  }

  private async loadSummary(tx: Prisma.TransactionClient, user: AuthenticatedUser, batchId: string, now: Date): Promise<ImportSummary> {
    await this.requireAdmin(tx, user);
    const batch = await this.findBatch(tx, user.organizationId, batchId, now);
    const seats = await loadSeatUsage(tx, user.organizationId);
    const progress = batch.status === 'PREVIEW' ? null : await this.progress(tx, user.organizationId, batch.id, batch.status === 'COMPLETED', now);
    return this.summary(batch, seats, progress);
  }

  /**
   * POTWIERDZENIE importu (krok 2). W JEDNEJ transakcji, pod blokadą miejsc organizacji: zajęcie partii (PREVIEW -> PROCESSING,
   * warunkowe: drugie potwierdzenie = 409), ponowne sprawdzenie istniejących kont (mogły się pojawić od podglądu), SPRAWDZENIE LIMITU
   * LICENCJI przed zapisem czegokolwiek (za mało miejsc = 409 SEAT_LIMIT z liczbą brakujących, partia zostaje podglądem, żadne konto
   * nie powstaje), utworzenie działów i kont (status INVITED) oraz wyników wierszy. Zaproszenia mailowe NIE idą w tym żądaniu - kolejkuje
   * je job z tempem (UserImportInviteService), rozkładając wysyłkę na kolejne dni w ramach dobowego limitu organizacji.
   *
   * Adres zajęty w INNEJ organizacji (unikalność globalna) nie przerywa importu: konto nie powstaje, wiersz dostaje ogólny powód i
   * nie zużywa licencji - bez ujawniania, kto ma konto na platformie.
   */
  async confirm(user: AuthenticatedUser, batchId: string, now: Date = new Date()): Promise<ImportSummary> {
    // bcrypt (CPU) POZA transakcją; jeden nieodwracalny hash dla wszystkich kont tej partii: hasło losowe, nigdzie nie zapisane -
    // konto INVITED aktywuje się wyłącznie linkiem z zaproszenia (reset hasła).
    const placeholderHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    return this.previewLock.run(user.organizationId, () =>
      this.tenantPrisma.runInOrgContext(
        user.organizationId,
        async (tx) => {
          const actor = await this.requireAdmin(tx, user);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user-import:${user.organizationId}`}))`;
          await lockSeats(tx, user.organizationId);
          const batch = await this.findBatch(tx, user.organizationId, batchId, now);
          if (batch.status !== 'PREVIEW') {
            throw new ConflictException(IMPORT_ALREADY_CONFIRMED);
          }
          const running = await tx.userImportBatch.findFirst({ where: { organizationId: user.organizationId, status: 'PROCESSING' }, select: { id: true } });
          if (running) {
            throw new ConflictException(IMPORT_IN_PROGRESS);
          }
          const claimed = await tx.userImportBatch.updateMany({ where: { id: batch.id, organizationId: user.organizationId, status: 'PREVIEW' }, data: { status: 'PROCESSING' } });
          if (claimed.count !== 1) {
            throw new ConflictException(IMPORT_ALREADY_CONFIRMED);
          }

          const valid = await tx.userImportRow.findMany({
            where: { organizationId: user.organizationId, batchId: batch.id, status: 'VALID' },
            orderBy: { line: 'asc' },
            select: { id: true, email: true, firstName: true, lastName: true, departmentName: true },
          });
          const existing = new Set((await tx.user.findMany({ where: { organizationId: user.organizationId }, select: { email: true } })).map((row) => row.email.toLowerCase()));
          const nowExisting = valid.filter((row) => existing.has(row.email));
          const toCreate = valid.filter((row) => !existing.has(row.email));
          if (toCreate.length === 0) {
            throw new ConflictException(IMPORT_NOTHING_TO_CONFIRM);
          }
          // LIMIT LICENCJI przed jakimkolwiek zapisem kont (wyjątek cofa całą transakcję, także zajęcie partii).
          const usage = await loadSeatUsage(tx, user.organizationId);
          if (toCreate.length > usage.available) {
            throw seatLimitError(usage, toCreate.length);
          }

          if (nowExisting.length > 0) {
            await tx.userImportRow.updateMany({
              where: { id: { in: nowExisting.map((row) => row.id) }, organizationId: user.organizationId },
              data: { status: 'EXISTING', reason: 'Konto z tym adresem pojawiło się w organizacji po podglądzie - pominięto' },
            });
          }

          const departmentIds = await this.ensureDepartments(tx, user.organizationId, [...new Set(toCreate.map((row) => row.departmentName).filter((name): name is string => !!name))]);
          for (let start = 0; start < toCreate.length; start += INSERT_CHUNK) {
            await tx.user.createMany({
              // skipDuplicates: adres zajęty w INNEJ organizacji (globalna unikalność) nie przerywa transakcji - wiersz dostanie ogólny powód.
              skipDuplicates: true,
              data: toCreate.slice(start, start + INSERT_CHUNK).map((row) => ({
                organizationId: user.organizationId,
                email: row.email,
                passwordHash: placeholderHash,
                firstName: row.firstName,
                lastName: row.lastName,
                departmentId: row.departmentName ? (departmentIds.get(row.departmentName) ?? null) : null,
                role: Role.EMPLOYEE,
                status: 'INVITED' as const,
              })),
            });
          }
          const created = new Map((await tx.user.findMany({ where: { organizationId: user.organizationId, email: { in: toCreate.map((row) => row.email) } }, select: { id: true, email: true } })).map((row) => [row.email.toLowerCase(), row.id]));

          const createdRows = toCreate.filter((row) => created.has(row.email));
          const failedRows = toCreate.filter((row) => !created.has(row.email));
          if (createdRows.length > 0) {
            const ids = createdRows.map((row) => row.id);
            const userIds = createdRows.map((row) => created.get(row.email) as string);
            await tx.$executeRaw`
              UPDATE "user_import_rows" AS r
              SET "accountResult" = 'CREATED', "userId" = v."userId", "inviteStatus" = 'PENDING'
              FROM (SELECT unnest(${ids}::text[]) AS "id", unnest(${userIds}::text[]) AS "userId") AS v
              WHERE r."id" = v."id" AND r."organizationId" = ${user.organizationId}`;
          }
          if (failedRows.length > 0) {
            await tx.userImportRow.updateMany({
              where: { id: { in: failedRows.map((row) => row.id) }, organizationId: user.organizationId },
              data: { accountResult: 'FAILED', accountReason: 'Nie można użyć tego adresu e-mail.' },
            });
          }

          const allDone = createdRows.length === 0;
          await tx.userImportBatch.update({
            where: { id: batch.id },
            data: {
              status: allDone ? 'COMPLETED' : 'PROCESSING',
              confirmedAt: now,
              confirmedByEmail: actor.email,
              completedAt: allDone ? now : null,
              expiresAt: new Date(now.getTime() + (allDone ? REPORT_TTL_MS : PROCESSING_TTL_MS)),
            },
          });
          return this.loadSummary(tx, user, batch.id, now);
        },
        { maxWait: 15_000, timeout: 120_000 },
      ),
    );
  }

  /** Zatrzymanie wysyłki: oczekujące zaproszenia są pomijane (konta zostają, można je zaprosić ręcznie); wysyłane już zostają. */
  async stopInvites(user: AuthenticatedUser, batchId: string, now: Date = new Date()): Promise<ImportSummary> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import-invites:${user.organizationId}`}))`;
      const batch = await this.findBatch(tx, user.organizationId, batchId, now);
      if (batch.status !== 'PROCESSING') {
        throw new ConflictException(IMPORT_NOT_RUNNING);
      }
      await tx.userImportRow.updateMany({
        where: { organizationId: user.organizationId, batchId, inviteStatus: 'PENDING' },
        data: { inviteStatus: 'SKIPPED', inviteReason: 'Wysyłka zatrzymana przez administratora' },
      });
      await completeBatchIfDone(tx, user.organizationId, batchId, now);
      return this.loadSummary(tx, user, batchId, now);
    });
  }

  /**
   * Raport CSV całego importu (walidacja, konto, zaproszenie). Komórki są escapowane przed formułami (adres e-mail może zaczynać się od
   * + albo -, nazwa działu od dowolnego znaku): `toCsv` dodaje apostrof przed = + - @ | oraz tabulator/CR. Dostępny w każdym stanie
   * partii (przed potwierdzeniem zawiera tylko wynik walidacji); tylko ORG_ADMIN.
   */
  async reportCsv(user: AuthenticatedUser, batchId: string, now: Date = new Date()): Promise<string> {
    return this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      await this.findBatch(tx, user.organizationId, batchId, now);
      const rows = await tx.userImportRow.findMany({ where: { organizationId: user.organizationId, batchId }, orderBy: { line: 'asc' }, take: 5000, select: ROW_SELECT });
      return toCsv(
        ['Wiersz', 'E-mail', 'Imię', 'Nazwisko', 'Dział', 'Walidacja', 'Powód walidacji', 'Konto', 'Powód (konto)', 'Zaproszenie', 'Powód (zaproszenie)'],
        rows.map((row) => [
          row.line,
          row.email,
          row.firstName,
          row.lastName,
          row.departmentName ?? '',
          VALIDATION_LABELS[row.status],
          row.reason ?? '',
          row.accountResult ? ACCOUNT_LABELS[row.accountResult] : row.status === 'VALID' ? '' : 'Nie utworzono',
          row.accountReason ?? '',
          row.inviteStatus ? INVITE_LABELS[row.inviteStatus] : '',
          row.inviteReason ?? '',
        ]),
      );
    });
  }

  private async ensureDepartments(tx: Prisma.TransactionClient, organizationId: string, names: string[]): Promise<Map<string, string>> {
    if (names.length === 0) return new Map();
    await tx.department.createMany({ data: names.map((name) => ({ organizationId, name })), skipDuplicates: true });
    const departments = await tx.department.findMany({ where: { organizationId, name: { in: names } }, select: { id: true, name: true } });
    return new Map(departments.map((department) => [department.name, department.id]));
  }

  private async progress(tx: Prisma.TransactionClient, organizationId: string, batchId: string, done: boolean, now: Date): Promise<ImportProgress> {
    const [accounts, invites, tokens] = await Promise.all([
      tx.userImportRow.groupBy({ by: ['accountResult'], where: { organizationId, batchId, accountResult: { not: null } }, _count: { _all: true } }),
      tx.userImportRow.groupBy({ by: ['inviteStatus'], where: { organizationId, batchId, inviteStatus: { not: null } }, _count: { _all: true } }),
      tx.passwordResetToken.count({ where: { organizationId, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    ]);
    const accountCount = (result: 'CREATED' | 'FAILED') => accounts.find((group) => group.accountResult === result)?._count._all ?? 0;
    const inviteCount = (status: string) => invites.find((group) => group.inviteStatus === status)?._count._all ?? 0;
    const counts = { pending: inviteCount('PENDING'), sending: inviteCount('SENDING'), sent: inviteCount('SENT'), failed: inviteCount('FAILED'), skipped: inviteCount('SKIPPED') };
    const remaining = counts.pending + counts.sending;
    const left = dailyRemaining(INVITE_DAILY_LIMIT_PER_ORG, tokens);
    return {
      accountsCreated: accountCount('CREATED'),
      accountsFailed: accountCount('FAILED'),
      invites: counts,
      invitesSent: counts.sent,
      invitesTotal: accountCount('CREATED'),
      remaining,
      dailyLimit: INVITE_DAILY_LIMIT_PER_ORG,
      dailyRemaining: left,
      restTomorrow: remaining > left,
      estimatedCompletionAt: estimateInviteCompletion(remaining, left, now),
      done: done && remaining === 0,
    };
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

  /** Anulowanie PODGLĄDU: partia i jej wiersze są usuwane (kaskada). Potwierdzonego importu nie da się anulować (konta już istnieją) - 409. */
  async cancel(user: AuthenticatedUser, batchId: string): Promise<void> {
    await this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
      await this.requireAdmin(tx, user);
      const deleted = await tx.userImportBatch.deleteMany({ where: { id: batchId, organizationId: user.organizationId, status: 'PREVIEW' } });
      if (deleted.count === 0) {
        const exists = await tx.userImportBatch.findFirst({ where: { id: batchId, organizationId: user.organizationId }, select: { id: true } });
        throw exists ? new ConflictException(IMPORT_ALREADY_CONFIRMED) : new NotFoundException(NOT_FOUND);
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
    batch: {
      id: string;
      status: UserImportBatchStatus;
      fileName: string | null;
      delimiter: string;
      createdAt: Date;
      expiresAt: Date;
      confirmedAt: Date | null;
      completedAt: Date | null;
      totalRows: number;
      validCount: number;
      existingCount: number;
      errorCount: number;
      skippedEmpty: number;
      ignoredColumns: string[];
    },
    usage: SeatUsage,
    progress: ImportProgress | null = null,
  ): ImportSummary {
    const missing = Math.max(0, batch.validCount - usage.available);
    return {
      id: batch.id,
      status: batch.status,
      confirmedAt: batch.confirmedAt,
      completedAt: batch.completedAt,
      progress,
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
