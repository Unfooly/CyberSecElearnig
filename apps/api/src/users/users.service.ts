import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { isEmail } from 'class-validator';
import { Prisma } from '@prisma/client';
import { Role, UserStatus } from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersListResponseDto } from './dto/users-list-response.dto';
import { DepartmentOptionDto } from './dto/department-option.dto';
import { ImportCsvReportDto, ImportCsvRowError } from './dto/import-csv-report.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { InviteUserResponseDto } from './dto/invite-user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto, DEFAULT_PAGE_SIZE } from './dto/list-users-query.dto';
import { AVATAR_PRESETS } from './avatar-presets';
import { parseCsv } from './csv.util';
import { NAME_PATTERN } from './name-pattern';
import { assertSeatsAvailable, lockSeats } from './seats';

const AVATAR_VALIDATION_MESSAGE =
  'avatarUrl musi być jednym z dostępnych presetów albo poprawnym adresem URL (https).';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Twarda górna granica na pojedyncze żądanie /users/import-csv - endpoint
// robi do tylu zapisów w bazie w jednym synchronicznym request/response.
// Rozmiar pliku (2MB) jest egzekwowany osobno, na poziomie Multer
// (UsersController), zanim treść w ogóle trafi tutaj.
const MAX_CSV_IMPORT_ROWS = 500;

// Ochrona przed używaniem platformy jako kanału spamu: każde zaproszenie
// wysyła mail z NASZEJ domeny na dowolny adres. Limit dobowy na organizację
// (liczony po wystawionych tokenach zaproszeń/resetów) i minimalny odstęp
// między ponownymi wysyłkami do tej samej osoby.
const INVITE_DAILY_LIMIT_PER_ORG = 300;
const INVITE_RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_CSV_FIELD_LENGTH = 100;

// Jeden, ogólny komunikat - users.email jest globalnie unikalny, więc P2002
// może pochodzić od konta w CUDZEJ organizacji; konkretny komunikat "już
// istnieje" pozwalałby ORG_ADMIN-owi sprawdzać, kto ma konto na platformie.
const EMAIL_UNAVAILABLE_MESSAGE = 'Nie można użyć tego adresu e-mail.';

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

interface InviteContext {
  organizationName: string | null;
  invitedBy: string | null;
}

type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toUserResponseDto(user: SelectedUser): UserResponseDto {
  // Prisma generuje własne enumy Role/UserStatus ze schema.prisma,
  // strukturalnie identyczne z @cyberszkolo/shared, ale nominalnie odrębne -
  // stąd jawne rzutowanie (ten sam wzorzec co w reszcie modułu users).
  return { ...user, role: user.role as Role, status: user.status as UserStatus };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * organizationId pochodzi WYŁĄCZNIE z tokena JWT wywołującego (zob.
   * UsersController) — endpoint świadomie nie przyjmuje organizationId od
   * klienta, żeby wykluczyć klasę błędów typu "zapomniany filtr".
   */
  async findPaginated(organizationId: string, query: ListUsersQueryDto): Promise<UsersListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const search = query.search?.trim();

    const where: Prisma.UserWhereInput = {
      organizationId,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [users, total] = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      Promise.all([
        tx.user.findMany({
          where,
          select: USER_SELECT,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.user.count({ where }),
      ]),
    );

    return { items: users.map(toUserResponseDto), total, page, pageSize };
  }

  async listDepartments(organizationId: string): Promise<DepartmentOptionDto[]> {
    return this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.department.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async inviteUser(
    organizationId: string,
    dto: InviteUserDto,
    invitedBy?: string,
  ): Promise<InviteUserResponseDto> {
    await this.assertInviteQuota(organizationId, 1);
    const passwordHash = await this.hashRandomPassword();

    let user: SelectedUser;
    try {
      user = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
        // Limit licencji: blokada + sprawdzenie w tej samej transakcji co utworzenie konta (bez wyścigu równoległych zaproszeń).
        await lockSeats(tx, organizationId);
        await assertSeatsAvailable(tx, organizationId);
        if (dto.departmentId) {
          await this.assertDepartmentBelongsToOrg(tx, organizationId, dto.departmentId);
        }
        return tx.user.create({
          data: {
            organizationId,
            email: dto.email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            departmentId: dto.departmentId ?? null,
            role: dto.role,
            status: UserStatus.INVITED,
          },
          select: USER_SELECT,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new BadRequestException(EMAIL_UNAVAILABLE_MESSAGE);
      }
      throw error;
    }

    const inviteContext = await this.buildInviteContext(organizationId, invitedBy);
    const inviteEmailSent = await this.sendInviteEmailSafely(
      organizationId,
      user.id,
      user.email,
      user.firstName,
      inviteContext,
    );

    return { ...toUserResponseDto(user), inviteEmailSent };
  }

  /**
   * Każdy wiersz to osobna transakcja (dział + user razem, atomowo) - NIE
   * cały plik w jednej transakcji. Inaczej jeden zły wiersz (np. duplikat
   * e-maila w środku pliku) cofnąłby WSZYSTKIE poprawne wiersze, a
   * successCount/failedCount/errors z zadania wprost zakładają częściowy
   * sukces per wiersz.
   */
  async importCsv(
    organizationId: string,
    fileContent: string,
    invitedBy?: string,
  ): Promise<ImportCsvReportDto> {
    let rows: string[][];
    try {
      rows = parseCsv(fileContent);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    if (rows.length === 0) {
      throw new BadRequestException('Plik CSV jest pusty.');
    }

    const header = rows[0].map((column) => column.trim().toLowerCase());
    const emailIdx = header.indexOf('email');
    const firstNameIdx = header.indexOf('firstname');
    const lastNameIdx = header.indexOf('lastname');
    const departmentNameIdx = header.indexOf('departmentname');
    if (emailIdx === -1 || firstNameIdx === -1 || lastNameIdx === -1) {
      throw new BadRequestException(
        'Nagłówek CSV musi zawierać kolumny: email, firstName, lastName (departmentName opcjonalnie).',
      );
    }

    const dataRows = rows.slice(1);
    if (dataRows.length > MAX_CSV_IMPORT_ROWS) {
      throw new BadRequestException(`Plik zawiera zbyt wiele wierszy (limit: ${MAX_CSV_IMPORT_ROWS}).`);
    }

    await this.assertInviteQuota(organizationId, dataRows.length);
    const inviteContext = await this.buildInviteContext(organizationId, invitedBy);
    const errors: ImportCsvRowError[] = [];
    const seenEmails = new Set<string>();
    let successCount = 0;
    let emailFailedCount = 0;

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
      // +1 za nagłówek, +1 bo numeracja wierszy w komunikatach jest 1-indexed.
      const line = rowIndex + 2;
      const columns = dataRows[rowIndex];

      // Całkowicie pusty wiersz (np. końcowa pusta linia pliku) - pomijamy
      // po cichu, to nie jest błąd danych.
      if (columns.every((column) => column.trim() === '')) {
        continue;
      }

      const email = (columns[emailIdx] ?? '').trim().toLowerCase();
      const firstName = (columns[firstNameIdx] ?? '').trim();
      const lastName = (columns[lastNameIdx] ?? '').trim();
      const departmentName = departmentNameIdx !== -1 ? (columns[departmentNameIdx] ?? '').trim() : '';

      if (
        email.length > 254 ||
        firstName.length > MAX_CSV_FIELD_LENGTH ||
        lastName.length > MAX_CSV_FIELD_LENGTH ||
        departmentName.length > MAX_CSV_FIELD_LENGTH
      ) {
        errors.push({ line, email: email.slice(0, 254), reason: 'Zbyt długa wartość w polu' });
        continue;
      }
      if (!isEmail(email, { allow_utf8_local_part: false })) {
        errors.push({ line, email, reason: 'Nieprawidłowy format e-maila' });
        continue;
      }
      if (!firstName || !lastName) {
        errors.push({ line, email, reason: 'Brak imienia lub nazwiska' });
        continue;
      }
      if (!NAME_PATTERN.test(firstName) || !NAME_PATTERN.test(lastName)) {
        errors.push({ line, email, reason: 'Niedozwolone znaki w imieniu lub nazwisku' });
        continue;
      }
      const normalizedEmail = email.toLowerCase();
      if (seenEmails.has(normalizedEmail)) {
        errors.push({ line, email, reason: 'Zduplikowany e-mail w tym pliku' });
        continue;
      }

      try {
        // Hashowane PRZED transakcją - bcrypt jest CPU-bound i nie powinien
        // trzymać otwartej transakcji/połączenia do bazy dłużej niż trzeba,
        // zwłaszcza przy imporcie do tysiąca wierszy pod rząd.
        const passwordHash = await this.hashRandomPassword();

        const user = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
          // Limit licencji także w starym imporcie jednoetapowym (zastąpionym dwuetapowym w commicie 5/5).
          await lockSeats(tx, organizationId);
          await assertSeatsAvailable(tx, organizationId);
          let departmentId: string | null = null;
          if (departmentName) {
            const department = await tx.department.upsert({
              where: { organizationId_name: { organizationId, name: departmentName } },
              update: {},
              create: { organizationId, name: departmentName },
            });
            departmentId = department.id;
          }
          return tx.user.create({
            data: {
              organizationId,
              email,
              passwordHash,
              firstName,
              lastName,
              departmentId,
              role: Role.EMPLOYEE,
              status: UserStatus.INVITED,
            },
            select: USER_SELECT,
          });
        });

        seenEmails.add(normalizedEmail);
        const sent = await this.sendInviteEmailSafely(
          organizationId,
          user.id,
          user.email,
          user.firstName,
          inviteContext,
        );
        if (!sent) {
          emailFailedCount += 1;
        }
        successCount += 1;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_CONSTRAINT_VIOLATION
        ) {
          errors.push({ line, email, reason: EMAIL_UNAVAILABLE_MESSAGE });
        } else if (error instanceof HttpException && (error.getResponse() as { code?: string })?.code === 'SEAT_LIMIT') {
          errors.push({ line, email, reason: 'Brak wolnych licencji (limit planu)' });
        } else {
          errors.push({ line, email, reason: 'Nie udało się utworzyć konta' });
        }
      }
    }

    return { successCount, failedCount: errors.length, emailFailedCount, errors };
  }

  /**
   * Ponowne wysłanie zaproszenia dla konta, które nadal czeka na aktywację
   * (status INVITED) - nowy token unieważnia poprzedni link. Odpowiedź
   * mówi, czy mail faktycznie wyszedł.
   */
  async resendInvite(
    organizationId: string,
    targetId: string,
    invitedBy?: string,
  ): Promise<{ inviteEmailSent: boolean }> {
    const target = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.user.findFirst({ where: { id: targetId, organizationId } }),
    );
    if (!target) {
      throw new NotFoundException('Użytkownik nie istnieje w tej organizacji.');
    }
    if (target.status !== UserStatus.INVITED) {
      throw new BadRequestException('To konto jest już aktywne - zaproszenie nie jest potrzebne.');
    }

    await this.assertResendAllowed(organizationId, target.id);
    const context = await this.buildInviteContext(organizationId, invitedBy);
    const inviteEmailSent = await this.sendInviteEmailSafely(
      organizationId,
      target.id,
      target.email,
      target.firstName,
      context,
    );
    return { inviteEmailSent };
  }

  async updateUser(
    organizationId: string,
    requesterId: string,
    targetId: string,
    dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const user = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      if (dto.departmentId) {
        await this.assertDepartmentBelongsToOrg(tx, organizationId, dto.departmentId);
      }

      // Istnienie + przynależność do organizacji sprawdzone jawnie w kodzie
      // aplikacji (Zasada nr 1, CLAUDE.md) - RLS jest drugą linią obrony, nie
      // jedyną. Dzięki temu odróżniamy "nie istnieje" (404) od cichego "RLS
      // zablokował, update dotknął 0 wierszy" (co Prisma zgłosiłoby jako
      // P2025, mniej czytelne dla klienta API).
      const existing = await tx.user.findFirst({ where: { id: targetId, organizationId } });
      if (!existing) {
        throw new NotFoundException('Użytkownik nie istnieje w tej organizacji.');
      }

      // Zmiana roli: nie własnej (ORG_ADMIN nie może się sam zdegradować) i
      // nigdy tak, żeby organizacja została bez ORG_ADMIN-a.
      if (dto.role !== undefined && dto.role !== existing.role) {
        if (targetId === requesterId) {
          throw new BadRequestException('Nie możesz zmienić własnej roli.');
        }
        if (existing.role === Role.ORG_ADMIN) {
          await this.assertAnotherOrgAdminRemains(tx, organizationId, targetId);
        }
      }

      return tx.user.update({
        where: { id: targetId },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
        },
        select: USER_SELECT,
      });
    });

    return toUserResponseDto(user);
  }

  async deleteUser(organizationId: string, requesterId: string, targetId: string): Promise<void> {
    if (targetId === requesterId) {
      throw new BadRequestException('Nie możesz usunąć własnego konta.');
    }

    await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const existing = await tx.user.findFirst({ where: { id: targetId, organizationId } });
      if (!existing) {
        throw new NotFoundException('Użytkownik nie istnieje w tej organizacji.');
      }
      if (existing.role === Role.ORG_ADMIN) {
        await this.assertAnotherOrgAdminRemains(tx, organizationId, targetId);
      }
      // CASCADE (courseAssignments, userBadges, passwordResetTokens) - twarde
      // usunięcie kasuje też historię ukończonych szkoleń/odznak tej osoby.
      // Świadoma decyzja tego zadania (literalny opis - DELETE), nie
      // deaktywacja - patrz plan.
      await tx.user.delete({ where: { id: targetId } });
    });
  }

  /** Własny avatar (Topbar) - organizationId/userId wyłącznie z tokena JWT. */
  async getAvatar(organizationId: string, userId: string): Promise<{ avatarUrl: string | null }> {
    const user = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.user.findFirst({ where: { id: userId, organizationId }, select: { avatarUrl: true } }),
    );
    return { avatarUrl: user?.avatarUrl ?? null };
  }

  /**
   * organizationId i userId pochodzą WYŁĄCZNIE z tokena JWT wywołującego
   * (zob. UsersController) — user może zmienić WYŁĄCZNIE własny avatar.
   */
  async updateAvatar(organizationId: string, userId: string, avatarUrl: string): Promise<{ avatarUrl: string }> {
    this.assertValidAvatar(avatarUrl);

    // updateMany z jawnym organizationId (Zasada nr 1) - RLS jest drugą linią
    // obrony, nie jedyną.
    const result = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.user.updateMany({ where: { id: userId, organizationId }, data: { avatarUrl } }),
    );
    if (result.count === 0) {
      throw new NotFoundException('Użytkownik nie istnieje w tej organizacji.');
    }

    return { avatarUrl };
  }

  private async assertInviteQuota(organizationId: string, requested: number): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.passwordResetToken.count({ where: { organizationId, createdAt: { gte: since } } }),
    );
    if (used + requested > INVITE_DAILY_LIMIT_PER_ORG) {
      throw new HttpException(
        `Przekroczono dobowy limit zaproszeń dla organizacji (${INVITE_DAILY_LIMIT_PER_ORG}). Spróbuj ponownie jutro.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async assertResendAllowed(organizationId: string, userId: string): Promise<void> {
    const latest = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.passwordResetToken.findFirst({
        where: { organizationId, userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    );
    if (latest && Date.now() - latest.createdAt.getTime() < INVITE_RESEND_COOLDOWN_MS) {
      throw new HttpException(
        'Zaproszenie zostało wysłane przed chwilą. Poczekaj kilka minut przed ponowną wysyłką.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.assertInviteQuota(organizationId, 1);
  }

  private async assertAnotherOrgAdminRemains(
    tx: Prisma.TransactionClient,
    organizationId: string,
    excludedUserId: string,
  ): Promise<void> {
    const others = await tx.user.count({
      where: { organizationId, role: Role.ORG_ADMIN, id: { not: excludedUserId } },
    });
    if (others === 0) {
      throw new BadRequestException('Organizacja musi mieć co najmniej jednego administratora.');
    }
  }

  /**
   * Foreign key w Postgresie NIE jest świadome RLS przy walidacji
   * ograniczenia (constraint trigger sprawdza istnienie wiersza, nie
   * widoczność dla roli) - bez tego jawnego sprawdzenia złośliwy ORG_ADMIN
   * mógłby przypisać usera do działu innej organizacji, podając jej
   * departmentId. To realna luka w izolacji tenantów (Zasada nr 1), nie
   * teoretyczna - RLS na `departments` sam jej nie zamyka przy INSERT/UPDATE
   * przez FK.
   */
  private async assertDepartmentBelongsToOrg(
    tx: Prisma.TransactionClient,
    organizationId: string,
    departmentId: string,
  ): Promise<void> {
    const department = await tx.department.findFirst({ where: { id: departmentId, organizationId } });
    if (!department) {
      throw new BadRequestException('Wybrany dział nie istnieje w tej organizacji.');
    }
  }

  private async hashRandomPassword(): Promise<string> {
    // Nigdy nie ujawniane/komunikowane - zaproszony user ustawia właściwe
    // hasło przez token z AuthService.issuePasswordResetUrl. Losowe 32 bajty
    // (256 bit entropii) hashowane bcryptem tak samo jak prawdziwe hasła.
    const randomPassword = randomBytes(32).toString('hex');
    // Hasło ma 256 bit entropii i nikt go nigdy nie pozna, więc koszt bcrypt nie
    // wnosi bezpieczeństwa - minimalne rundy zamiast 12 (import 1000 wierszy
    // z BCRYPT_ROUNDS trwał minuty i blokował wątki libuv).
    return bcrypt.hash(randomPassword, 4);
  }

  // Konto już istnieje w bazie - awaria wystawienia tokenu/wysyłki nie może
  // zamienić udanego zapisu w 500 (klient ponowiłby i dostał "adres
  // niedostępny"). Logujemy i idziemy dalej; brak wysyłki widać w logach.
  private async sendInviteEmailSafely(
    organizationId: string,
    userId: string,
    email: string,
    firstName: string | null,
    context: InviteContext,
  ): Promise<boolean> {
    try {
      return await this.sendInviteEmail(organizationId, userId, email, firstName, context);
    } catch (error) {
      this.logger.error(
        `Konto ${userId} utworzone, ale nie udało się wysłać zaproszenia: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Dane do powiadomienia "Dodano Cię do organizacji X przez Y". Nazwa
  // organizacji jest kosmetyką maila - jej brak nie może blokować zaproszenia.
  private async buildInviteContext(organizationId: string, invitedBy?: string): Promise<InviteContext> {
    let organizationName: string | null = null;
    try {
      const organization = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
        tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      );
      organizationName = organization?.name ?? null;
    } catch (error) {
      this.logger.warn(`Nie udało się pobrać nazwy organizacji do zaproszenia: ${(error as Error).message}`);
    }
    return { organizationName, invitedBy: invitedBy ?? null };
  }

  private async sendInviteEmail(
    organizationId: string,
    userId: string,
    email: string,
    firstName: string | null,
    context: InviteContext,
  ): Promise<boolean> {
    const activationUrl = await this.authService.issuePasswordResetUrl(organizationId, userId);
    const accepted = await this.emailService.send({
      to: email,
      subject: context.organizationName
        ? `Dodano Cię do organizacji ${context.organizationName}`
        : 'Zaproszenie do Unfooly',
      templateName: 'user-invite',
      templateData: {
        activationUrl,
        firstName,
        organizationName: context.organizationName,
        invitedBy: context.invitedBy,
      },
    });
    // Tylko jawne false = błąd (testowe mocki zwracają undefined).
    return accepted !== false;
  }

  private assertValidAvatar(avatarUrl: string): void {
    if ((AVATAR_PRESETS as readonly string[]).includes(avatarUrl)) {
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(avatarUrl);
    } catch {
      throw new BadRequestException(AVATAR_VALIDATION_MESSAGE);
    }
    // Tylko https: http dawałoby mixed content, a zewnętrzny obrazek i tak
    // pozwala śledzić IP oglądających (dlatego <img> ma referrerPolicy).
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException(AVATAR_VALIDATION_MESSAGE);
    }
  }
}
