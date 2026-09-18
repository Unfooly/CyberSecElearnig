import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { Role, UserStatus } from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Ten sam komunikat dla "e-mail już istnieje" i innych błędów rejestracji —
// celowo nie potwierdza, czy podany adres jest już w systemie (patrz audyt
// bezpieczeństwa modułu auth, ryzyko enumeracji kont na platformie
// antyphishingowej).
const REGISTRATION_FAILED_MESSAGE =
  'Nie udało się utworzyć konta z podanymi danymi. Jeśli masz już konto, zaloguj się.';

// Odrębny komunikat od REGISTRATION_FAILED_MESSAGE (celowo NIE anty-
// enumeracyjny jak tamten) — domena e-maila jest już nazwą organizacji
// (`organizations.name`, unikalny constraint), więc "organizacja dla tej
// domeny już istnieje" to informacja na poziomie firmy, nie konkretnego
// konta; ten sam wzorzec UX co Slack/Notion przy rejestracji firmowej
// domeny drugi raz - patrz ustalenia z użytkownikiem w tej sesji.
const ORGANIZATION_ALREADY_EXISTS_MESSAGE =
  'Organizacja dla domeny Twojego adresu e-mail już istnieje w systemie. Poproś administratora tej organizacji o dodanie Cię jako pracownika, albo zaloguj się, jeśli masz już konto.';

// Ten sam komunikat niezależnie od tego, czy podany e-mail istnieje w
// systemie — analogiczny wzorzec anty-enumeracyjny co REGISTRATION_FAILED_MESSAGE.
const FORGOT_PASSWORD_RESPONSE_MESSAGE =
  'Jeśli podany adres e-mail istnieje w systemie, wysłaliśmy na niego link do zresetowania hasła.';

// Rozróżnienie "wygasł/nie istnieje" vs "już użyty" NIE jest enumeracją —
// token ma 256 bitów entropii (nie do odgadnięcia), więc to rozróżnienie nic
// nie ujawnia atakującemu, a realnemu userowi daje sygnał możliwego
// przejęcia konta (patrz ustalenia z użytkownikiem w tej sesji).
const TOKEN_INVALID_OR_EXPIRED = {
  code: 'TOKEN_INVALID_OR_EXPIRED',
  message: 'Link do resetowania hasła jest nieprawidłowy lub wygasł. Poproś o nowy.',
};
const TOKEN_ALREADY_USED = {
  code: 'TOKEN_ALREADY_USED',
  message:
    'Ten link został już wykorzystany. Jeśli to nie Ty zresetowałeś/aś hasło, skontaktuj się z administratorem.',
};

const VERIFICATION_TOKEN_INVALID_OR_EXPIRED = {
  code: 'TOKEN_INVALID_OR_EXPIRED',
  message: 'Link weryfikacyjny jest nieprawidłowy lub wygasł. Poproś o nowy.',
};
const VERIFICATION_TOKEN_ALREADY_USED = {
  code: 'TOKEN_ALREADY_USED',
  message: 'Ten link został już wykorzystany. Jeśli adres jest potwierdzony, po prostu się zaloguj.',
};

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Eksportowane - UsersService reużywa tej samej stałej przy hashowaniu
// losowego, nigdy nie ujawnianego hasła dla zaproszonych userów (zamiast
// duplikować liczbę rund gdzie indziej i ryzykować rozjazd).
export const BCRYPT_ROUNDS = 12;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const REGISTRATION_EMAIL_FAILED_MESSAGE =
  'Konto utworzone, ale nie udało się wysłać linku weryfikacyjnego. Użyj "Wyślij link ponownie" (na ekranie logowania) albo sprawdź, czy adres e-mail jest poprawny.';
const REGISTRATION_SUCCESS_MESSAGE =
  'Konto utworzone. Wysłaliśmy link weryfikacyjny na podany adres e-mail - potwierdź go, aby się zalogować.';
const RESEND_VERIFICATION_RESPONSE_MESSAGE =
  'Jeśli konto o podanym adresie czeka na potwierdzenie, wysłaliśmy nowy link weryfikacyjny.';
const EMAIL_NOT_VERIFIED = {
  code: 'EMAIL_NOT_VERIFIED',
  message: 'Adres e-mail nie został jeszcze potwierdzony. Kliknij link z wiadomości weryfikacyjnej.',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    // Sprawdzane raz, przy starcie - inaczej brak FRONTEND_URL wychodziłby
    // dopiero przy wysyłce linku, i to tylko dla istniejących kont (500 vs 200
    // = oracle enumeracji w forgotPassword).
    if (!this.configService.get<string>('FRONTEND_URL') && this.configService.get<string>('NODE_ENV') === 'production') {
      throw new Error('Brak FRONTEND_URL przy NODE_ENV=production.');
    }
  }

  async register(dto: RegisterDto): Promise<{ message: string; emailSent: boolean }> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const organizationName = this.deriveOrganizationNameFromEmail(dto.email);

    // Id generujemy przed transakcją, żeby kontekst RLS mógł iść przez
    // jedyny punkt prawdy (TenantPrismaService.runInOrgContext) zamiast
    // odtwarzać `set_config` ręcznie tutaj — organizacja jeszcze nie
    // istnieje, więc nie możemy poznać jej id inaczej niż wygenerować je
    // sami z góry.
    const organizationId = randomUUID();

    let user: { id: string; organizationId: string; role: string; email: string };
    try {
      user = await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
        await tx.organization.create({
          data: { id: organizationId, name: organizationName },
        });

        return tx.user.create({
          data: {
            organizationId,
            email: dto.email,
            passwordHash,
            role: Role.ORG_ADMIN,
          },
        });
      });
    } catch (error) {
      // Unikalność e-maila i unikalność nazwy organizacji (domeny) są
      // wymuszone na poziomie bazy (constraints działają niezależnie od RLS,
      // więc nie potrzebujemy osobnego pre-checku przez bypass RLS ani nie
      // martwimy się o TOCTOU przy dwóch równoległych rejestracjach tej samej
      // domeny — baza odrzuci drugą). `error.meta.target` mówi, który
      // constraint faktycznie odrzucił insert, więc możemy dać dwa różne,
      // trafne komunikaty zamiast jednego ogólnego dla obu przypadków.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        // meta.target to tablica kolumn (['name']) albo, zależnie od
        // silnika/adaptera, nazwa constraintu ('organizations_name_key') -
        // obsługujemy oba kształty.
        const target = error.meta?.target;
        const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '');
        if (/organizations_name_key|(^|,)name(,|$)/.test(targetText)) {
          throw new BadRequestException(ORGANIZATION_ALREADY_EXISTS_MESSAGE);
        }
        throw new BadRequestException(REGISTRATION_FAILED_MESSAGE);
      }
      throw error;
    }

    // Bez tokenów - logowanie jest zablokowane do potwierdzenia adresu
    // (emailVerifiedAt). Bez weryfikacji ktoś mógłby zająć cudzą domenę
    // (organizacja = domena e-maila) i spamować zaproszeniami z domeny
    // platformy.
    // Konto już istnieje - awaria wystawienia tokenu/wysyłki nie może zamienić
    // udanej rejestracji w 500 (ponowna rejestracja i tak trafiłaby na
    // "organizacja już istnieje"). Mówimy wprost, że mail nie wyszedł.
    let emailSent = false;
    try {
      emailSent = await this.sendVerificationEmail(user.organizationId, user.id, user.email);
    } catch (error) {
      this.logger.error(`Konto ${user.id} utworzone, ale wysyłka linku weryfikacyjnego nie powiodła się: ${(error as Error).message}`);
    }
    return { message: emailSent ? REGISTRATION_SUCCESS_MESSAGE : REGISTRATION_EMAIL_FAILED_MESSAGE, emailSent };
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.tenantPrisma.runAuthLookup({ email: dto.email });
    if (!user) {
      throw new UnauthorizedException('Nieprawidłowy e-mail lub hasło');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Nieprawidłowy e-mail lub hasło');
    }
    // Sprawdzane PO haśle - inaczej odpowiedź różniłaby się dla istniejących
    // i nieistniejących kont (enumeracja).
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(EMAIL_NOT_VERIFIED);
    }

    return this.issueTokens({
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role as Role,
      email: user.email,
    });
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Nieprawidłowy refresh token');
    }

    const user = await this.tenantPrisma.runAuthLookup({ id: payload.sub });
    // Tokeny dostają wyłącznie zweryfikowani, ale refresh sprawdza to jawnie -
    // gdyby kiedyś powstało "cofnięcie weryfikacji", stare tokeny nie mogą go obejść.
    if (!user || !user.emailVerifiedAt) {
      throw new UnauthorizedException('Nieprawidłowy refresh token');
    }

    return this.issueTokens({
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role as Role,
      email: user.email,
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.tenantPrisma.runAuthLookup({ email: dto.email });

    if (user) {
      const resetUrl = await this.issuePasswordResetUrl(user.organizationId, user.id);
      await this.emailService.send({
        to: user.email,
        subject: 'Reset hasła',
        templateName: 'password-reset',
        templateData: { resetUrl },
      });
    }

    // Zawsze ten sam komunikat i status, niezależnie od tego, czy `user`
    // istniał - patrz FORGOT_PASSWORD_RESPONSE_MESSAGE.
    return { message: FORGOT_PASSWORD_RESPONSE_MESSAGE };
  }

  /**
   * Generuje jednorazowy token resetu/aktywacji hasła i zwraca gotowy URL
   * (`{FRONTEND_URL}/reset-password?token=...`). Wydzielone z forgotPassword
   * (ten sam kod co dotychczas) żeby UsersService.inviteUser/importCsv mogły
   * reużyć DOKŁADNIE ten sam, przetestowany mechanizm zamiast duplikować go -
   * "zaproszenie" i "zapomniałem hasła" to ten sam PasswordResetToken flow,
   * różni się tylko treść e-maila (decyzja z tej sesji, patrz plan zadania
   * "Zarządzanie i zapraszanie pracowników").
   */
  async issuePasswordResetUrl(organizationId: string, userId: string): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawToken);

    await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Nowe żądanie unieważnia poprzednie, nieużyte linki tego usera -
      // w danym momencie może być ważny tylko jeden.
      await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
      await tx.passwordResetToken.create({
        data: {
          organizationId,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
        },
      });
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (!frontendUrl && this.configService.get<string>('NODE_ENV') === 'production') {
      // Fallback na localhost wysłałby użytkownikom linki, które nigdzie nie prowadzą.
      throw new Error('Brak FRONTEND_URL przy NODE_ENV=production.');
    }
    const baseUrl = frontendUrl ?? 'http://localhost:3000';
    return `${baseUrl}/reset-password?token=${rawToken}`;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashResetToken(dto.token);
    const record = await this.tenantPrisma.runPasswordResetTokenLookup(tokenHash);

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(TOKEN_INVALID_OR_EXPIRED);
    }
    if (record.usedAt) {
      throw new BadRequestException(TOKEN_ALREADY_USED);
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const usedAt = new Date();

    const claimed = await this.tenantPrisma.runInOrgContext(record.organizationId, async (tx) => {
      // Atomowe "sprawdź i oznacz" jednym UPDATE ... WHERE usedAt IS NULL,
      // zamiast osobnego SELECT (wyżej) + UPDATE - inaczej dwa równoległe
      // żądania z tym samym tokenem mogłyby OBA przejść check `usedAt ===
      // null` przed zapisem i oba zresetować hasło (TOCTOU, wykryte w
      // security review tej sesji). Wiersz jest zablokowany na czas tego
      // UPDATE, więc drugie równoległe żądanie zobaczy już zapisany usedAt
      // i zaktualizuje 0 wierszy.
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt },
      });
      if (claim.count === 0) {
        return claim;
      }

      // status: ACTIVE pokrywa dwa przypadki jednym polem - zwykły "zapomniałem
      // hasła" (user już ACTIVE, więc to no-op) i pierwsze ustawienie hasła po
      // zaproszeniu przez UsersService.inviteUser/importCsv (user był
      // INVITED - to jedyne miejsce, które go aktywuje).
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      });
      // Oznacza WSZYSTKIE POZOSTAŁE nieużyte tokeny tego usera jako zużyte,
      // nie tylko ten jeden - defensywnie, na wypadek gdyby jakimś trybem
      // istniał więcej niż jeden (forgotPassword normalnie na to nie pozwala).
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt },
      });
      return claim;
    });

    if (claimed.count === 0) {
      // Ktoś (albo równoległe żądanie z tym samym tokenem) zdążył go zużyć
      // między odczytem wyżej a tym UPDATE - traktujemy jak "już użyty", nie
      // jak cichy sukces.
      throw new BadRequestException(TOKEN_ALREADY_USED);
    }

    return { message: 'Hasło zostało zmienione. Zaloguj się nowym hasłem.' };
  }

  /**
   * Nazwa organizacji = domena e-maila (część po @), nie pole od klienta -
   * zgodnie z decyzją tej sesji (self-serve rejestracja bez pytania o nazwę
   * firmy). `organizations.name` ma unikalny constraint (migracja
   * organization_name_unique), więc druga rejestracja z tej samej domeny
   * dostaje 400 (ORGANIZATION_ALREADY_EXISTS_MESSAGE) zamiast tworzyć drugą
   * organizację o tej samej nazwie - też decyzja tej sesji, świadomie bez
   * osobnej flagi/wyjątku dla domen współdzielonych publicznie (gmail.com,
   * outlook.com); pierwsza osoba z takiej domeny "zajmuje" ją dla
   * pozostałych, co jest akceptowalnym kompromisem na tym etapie (platforma
   * B2B, docelowo firmowe domeny) - NIE buduj tu auto-join do istniejącej
   * organizacji (kto dołącza z jaką rolą, czy wymaga akceptacji admina) bez
   * wyraźnej, osobnej decyzji, bo to inna, większa funkcja.
   * `dto.email` jest już zwalidowane przez @IsEmail (RegisterDto), więc
   * split('@') zawsze da dokładnie dwie części.
   */
  private deriveOrganizationNameFromEmail(email: string): string {
    return email.split('@')[1].toLowerCase();
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    const tokenHash = this.hashResetToken(dto.token);
    const record = await this.tenantPrisma.runEmailVerificationTokenLookup(tokenHash);

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(VERIFICATION_TOKEN_INVALID_OR_EXPIRED);
    }
    if (record.usedAt) {
      throw new BadRequestException(VERIFICATION_TOKEN_ALREADY_USED);
    }

    const now = new Date();
    const claimed = await this.tenantPrisma.runInOrgContext(record.organizationId, async (tx) => {
      // Atomowy claim (UPDATE ... WHERE usedAt IS NULL) - jak w resetPassword,
      // zamyka wyścig dwóch równoległych użyć tego samego linku.
      const claim = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claim.count === 0) {
        return claim;
      }
      await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } });
      return claim;
    });

    if (claimed.count === 0) {
      throw new BadRequestException(VERIFICATION_TOKEN_ALREADY_USED);
    }
    return { message: 'Adres e-mail potwierdzony. Możesz się zalogować.' };
  }

  async resendVerification(dto: ResendVerificationDto): Promise<{ message: string }> {
    const user = await this.tenantPrisma.runAuthLookup({ email: dto.email });
    if (user && !user.emailVerifiedAt) {
      if (user.status === UserStatus.INVITED) {
        // Zaproszony nie ma własnego hasła - "weryfikacją" jest ustawienie go
        // linkiem aktywacyjnym, więc odnawiamy TEN link (inaczej po wygaśnięciu
        // zaproszenia użytkownik utknąłby w pętli EMAIL_NOT_VERIFIED).
        await this.sendActivationReminder(user);
      } else {
        await this.sendVerificationEmail(user.organizationId, user.id, user.email);
      }
    }
    // Zawsze ta sama odpowiedź - anty-enumeracja, jak przy forgotPassword.
    return { message: RESEND_VERIFICATION_RESPONSE_MESSAGE };
  }

  private async sendActivationReminder(user: {
    id: string;
    organizationId: string;
    email: string;
    firstName: string | null;
  }): Promise<void> {
    const organization = await this.tenantPrisma.runInOrgContext(user.organizationId, (tx) =>
      tx.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } }),
    );
    const activationUrl = await this.issuePasswordResetUrl(user.organizationId, user.id);
    await this.emailService.send({
      to: user.email,
      subject: organization ? `Dodano Cię do organizacji ${organization.name}` : 'Aktywuj swoje konto',
      templateName: 'user-invite',
      templateData: {
        activationUrl,
        firstName: user.firstName,
        organizationName: organization?.name ?? null,
        invitedBy: null,
      },
    });
  }

  private async sendVerificationEmail(organizationId: string, userId: string, email: string): Promise<boolean> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawToken);

    await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Nowy link unieważnia poprzednie, nieużyte.
      await tx.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } });
      await tx.emailVerificationToken.create({
        data: {
          organizationId,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
        },
      });
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (!frontendUrl && this.configService.get<string>('NODE_ENV') === 'production') {
      throw new Error('Brak FRONTEND_URL przy NODE_ENV=production.');
    }
    const baseUrl = frontendUrl ?? 'http://localhost:3000';
    const accepted = await this.emailService.send({
      to: email,
      subject: 'Potwierdź swój adres e-mail',
      templateName: 'email-verification',
      templateData: { verificationUrl: `${baseUrl}/verify-email?token=${rawToken}` },
    });
    // Tylko jawne false = błąd (mocki testowe zwracają undefined).
    return accepted !== false;
  }

  private hashResetToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private async issueTokens(payload: JwtPayload): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
