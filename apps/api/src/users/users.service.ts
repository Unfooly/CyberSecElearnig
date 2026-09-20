import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { Role, UserStatus } from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { MailOutcome, MailResult } from '../email/interfaces/send-email-options.interface';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersListResponseDto } from './dto/users-list-response.dto';
import { DepartmentOptionDto } from './dto/department-option.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { InviteUserResponseDto } from './dto/invite-user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto, DEFAULT_PAGE_SIZE } from './dto/list-users-query.dto';
import { AVATAR_PRESETS } from './avatar-presets';
import { InviteNoticeMailLimiter } from '../auth/registration-mail-limiter';
import { AddressClaimService } from './address-claim.service';
import { INVITE_DAILY_LIMIT_PER_ORG } from './import/invite-pace';
import { countInviteTraffic } from './invite-traffic';
import { assertSeatsAvailable, lockSeats } from './seats';

const AVATAR_VALIDATION_MESSAGE =
  'avatarUrl musi być jednym z dostępnych presetów albo poprawnym adresem URL (https).';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Ochrona przed używaniem platformy jako kanału spamu: każde zaproszenie
// wysyła mail z NASZEJ domeny na dowolny adres. Limit dobowy na organizację
// (INVITE_DAILY_LIMIT_PER_ORG, liczony po wystawionych tokenach zaproszeń/resetów; wspólny
// z importem CSV, który wysyła zaproszenia w kolejce z tempem) i minimalny odstęp
// między ponownymi wysyłkami do tej samej osoby.
const INVITE_RESEND_COOLDOWN_MS = 2 * 60 * 1000;

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

/**
 * Wynik wysyłki dla wołającego: klasyfikacja z EmailService, a gdy jej brak (np. atrapa w testach), jawne `false` to pewne
 * niepowodzenie nieznanego rodzaju, a wszystko inne (true/undefined) to wysłano.
 */
function classifyMail(accepted: boolean | undefined, outcome: MailOutcome): MailResult {
  if (outcome.result) return outcome.result;
  return accepted === false ? { status: 'REJECTED', code: 'UNKNOWN' } : { status: 'SENT' };
}

/** Identyfikator w kształcie cuid (jak prawdziwe id kont), żeby odpowiedź dla zajętego adresu nie różniła się od odpowiedzi dla nowego. */
function lookalikeUserId(): string {
  return `c${Date.now().toString(36)}${randomBytes(9).toString('hex')}`.slice(0, 25);
}

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
    private readonly addressClaims: AddressClaimService,
    private readonly mailLimiter: InviteNoticeMailLimiter,
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
      user = await this.createInvitedUser(organizationId, dto, passwordHash);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION)) {
        throw error;
      }
      const recovered = await this.recoverTakenAddress(organizationId, dto, passwordHash, invitedBy);
      if ('response' in recovered) {
        return recovered.response;
      }
      user = recovered.user;
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

  private createInvitedUser(organizationId: string, dto: InviteUserDto, passwordHash: string): Promise<SelectedUser> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
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
  }

  /**
   * Adres zajęty (users.email jest unikalny globalnie). Trzy przypadki, bez sondy istnienia kont w INNYCH organizacjach:
   *  1) konto w TEJ organizacji: zwykły, ogólny błąd (administrator i tak widzi swoją listę);
   *  2) organizacja ma zweryfikowaną domenę adresu, a właścicielem jest nieaktywowane zaproszenie obcej organizacji: przejmujemy
   *     adres (cudze zaproszenie wygasa) i tworzymy konto normalnie;
   *  3) w każdym innym przypadku odpowiedź jest IDENTYCZNA jak dla nowego adresu ("zaproszenie wysłane"), konta nie powstaje, a
   *     właściciel adresu dostaje wiadomość "ktoś próbował Cię dodać" (limit dobowy liczy ją jak zaproszenie).
   * Dział i limit licencji były sprawdzone przed próbą zapisu, więc błędy walidacji są takie same jak dla nowego adresu.
   */
  private async recoverTakenAddress(
    organizationId: string,
    dto: InviteUserDto,
    passwordHash: string,
    invitedBy?: string,
  ): Promise<{ user: SelectedUser } | { response: InviteUserResponseDto }> {
    const own = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.user.findFirst({ where: { organizationId, email: dto.email }, select: { id: true } }),
    );
    if (own) {
      throw new BadRequestException(EMAIL_UNAVAILABLE_MESSAGE);
    }

    if ((await this.addressClaims.claimForOrganization(organizationId, dto.email)) === 'CLAIMED') {
      try {
        return { user: await this.createInvitedUser(organizationId, dto, passwordHash) };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION)) {
          throw error;
        }
        // Adres zajęty ponownie (wyścig): traktujemy jak zajęty.
      }
    }

    const context = await this.buildInviteContext(organizationId, invitedBy);
    await this.notifyAddressTaken(organizationId, dto.email, context);
    const department = dto.departmentId
      ? await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
          tx.department.findFirst({ where: { id: dto.departmentId, organizationId }, select: { id: true, name: true } }),
        )
      : null;
    return {
      response: {
        id: lookalikeUserId(),
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        status: UserStatus.INVITED,
        createdAt: new Date(),
        department,
        inviteEmailSent: true,
      },
    };
  }

  /**
   * Wiadomość do właściciela adresu, który ma konto w innej organizacji: "ktoś próbował dodać Cię do organizacji X". Zawsze zapisuje
   * wpis w dzienniku (dobowy limit zaproszeń), a sama wysyłka podlega limitowi "jedna wiadomość na skrzynkę na 10 minut" jak przy
   * rejestracji (ochrona skrzynki właściciela przed zalewem). Nigdy nie rzuca; false = mail nie wyszedł (nikt tego nie widzi).
   * Publiczne dla kolejki zaproszeń z importu.
   */
  async notifyAddressTaken(organizationId: string, email: string, context: InviteContext): Promise<MailResult> {
    try {
      await this.tenantPrisma.runInOrgContext(organizationId, (tx) => tx.inviteNotice.create({ data: { organizationId } }));
      if (!(await this.mailLimiter.tryAcquire(email))) {
        return { status: 'SENT' }; // pominięte po cichu (ochrona skrzynki) - dla wołającego wygląda jak zwykła wysyłka
      }
      const outcome: MailOutcome = {};
      const accepted = await this.emailService.send(
        {
          to: email,
          subject: context.organizationName ? `Ktoś próbował dodać Cię do organizacji ${context.organizationName}` : 'Ktoś próbował dodać Cię do organizacji',
          templateName: 'invite-address-taken',
          templateData: { organizationName: context.organizationName },
        },
        outcome,
      );
      return classifyMail(accepted, outcome);
    } catch (error) {
      this.logger.error(`Nie udało się wysłać powiadomienia o próbie dodania: ${(error as Error).name}`);
      return { status: 'REJECTED', code: 'INTERNAL' };
    }
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
    await this.assertInviteResultKnown(organizationId, target.id);
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
    const used = await this.tenantPrisma.runInOrgContext(organizationId, (tx) => countInviteTraffic(tx, organizationId, since));
    if (used + requested > INVITE_DAILY_LIMIT_PER_ORG) {
      throw new HttpException(
        `Przekroczono dobowy limit zaproszeń dla organizacji (${INVITE_DAILY_LIMIT_PER_ORG}). Spróbuj ponownie jutro.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Zaproszenie z importu o NIEPEWNYM wyniku (timeout, HTTP 5xx, zerwane połączenie, awaria po zajęciu) mogło dotrzeć: ponowna wysyłka
   * dałaby duplikat i unieważniła link, który osoba już ma, więc jest zablokowana (jak brak ponawiania RESULT_UNKNOWN w wysyłce
   * kampanii). Konto nieaktywowane wygasa po 30 dniach; administrator może je też usunąć i dodać ponownie.
   */
  private async assertInviteResultKnown(organizationId: string, userId: string): Promise<void> {
    const rows = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.userImportRow.findMany({
        where: { organizationId, userId, inviteStatus: { in: ['PENDING', 'SENDING', 'UNCERTAIN'] } },
        select: { inviteStatus: true },
        take: 10,
      }),
    );
    if (rows.some((row) => row.inviteStatus === 'UNCERTAIN')) {
      throw new ConflictException({
        code: 'INVITE_RESULT_UNKNOWN',
        message: 'Nie znamy wyniku wysyłki zaproszenia do tej osoby (mogło dotrzeć), więc nie wysyłamy go ponownie. Poproś ją o sprawdzenie skrzynki albo usuń konto i dodaj je ponownie.',
      });
    }
    // Zaproszenie czeka w kolejce importu albo właśnie jest wysyłane: ręczna wysyłka dałaby duplikat poza mechanizmem "co najwyżej raz"
    // (kolejny token unieważniłby link z pierwszej wiadomości).
    if (rows.length > 0) {
      throw new ConflictException({
        code: 'INVITE_QUEUED',
        message: 'Zaproszenie dla tej osoby czeka w kolejce importu albo właśnie jest wysyłane - wyślemy je automatycznie. Możesz zatrzymać wysyłkę importu, jeśli chcesz zaprosić ją ręcznie.',
      });
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
  /** Wysyła zaproszenie (nigdy nie rzuca; false = mail nie wyszedł albo wynik niepewny). */
  async sendInviteEmailSafely(
    organizationId: string,
    userId: string,
    email: string,
    firstName: string | null,
    context: InviteContext,
  ): Promise<boolean> {
    return (await this.sendInviteEmailClassified(organizationId, userId, email, firstName, context)).status === 'SENT';
  }

  /**
   * Wysyła zaproszenie i zwraca SKLASYFIKOWANY wynik (wysłano / pewne niepowodzenie / niepewne - jak w wysyłce kampanii). Nigdy nie
   * rzuca: awaria wystawienia tokenu to pewne niepowodzenie (mail nie został nawet zbudowany). Publiczne dla kolejki zaproszeń z importu.
   */
  async sendInviteEmailClassified(
    organizationId: string,
    userId: string,
    email: string,
    firstName: string | null,
    context: InviteContext,
  ): Promise<MailResult> {
    try {
      return await this.sendInviteEmail(organizationId, userId, email, firstName, context);
    } catch (error) {
      this.logger.error(
        `Konto ${userId} utworzone, ale nie udało się wysłać zaproszenia: ${(error as Error).name}`,
      );
      return { status: 'REJECTED', code: 'TOKEN' };
    }
  }

  // Dane do powiadomienia "Dodano Cię do organizacji X przez Y". Nazwa
  // organizacji jest kosmetyką maila - jej brak nie może blokować zaproszenia.
  /** Nazwa organizacji i zapraszający do treści maila. Publiczne dla kolejki zaproszeń z importu. */
  async buildInviteContext(organizationId: string, invitedBy?: string): Promise<InviteContext> {
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
  ): Promise<MailResult> {
    const activationUrl = await this.authService.issuePasswordResetUrl(organizationId, userId);
    const outcome: MailOutcome = {};
    const accepted = await this.emailService.send(
      {
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
      },
      outcome,
    );
    return classifyMail(accepted, outcome);
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
