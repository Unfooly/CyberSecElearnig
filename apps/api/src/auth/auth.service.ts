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
import { createHash, randomBytes } from 'crypto';
import { Role, UserStatus } from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EmailService } from '../email/email.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

// Ten sam komunikat niezależnie od tego, czy podany e-mail istnieje w
// systemie — wzorzec anty-enumeracyjny (jak w rejestracji, patrz RegistrationService).
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
// Link z maila rejestracyjnego (potwierdzenie skrzynki + ustawienie hasła): 24 h.
const REGISTRATION_ACTIVATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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

  // Rejestracja firmy (samoobsługowa) żyje w RegistrationService - AuthService
  // zostaje przy logowaniu, tokenach, weryfikacji e-maila i resecie hasła.

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
  async issuePasswordResetUrl(
    organizationId: string,
    userId: string,
    ttlMs: number = PASSWORD_RESET_TOKEN_TTL_MS,
  ): Promise<string> {
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
          expiresAt: new Date(Date.now() + ttlMs),
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
      await this.sendVerificationOrActivation(user);
    }
    // Zawsze ta sama odpowiedź - anty-enumeracja, jak przy forgotPassword.
    return { message: RESEND_VERIFICATION_RESPONSE_MESSAGE };
  }

  /**
   * Link dla NIEPOTWIERDZONEGO konta: zwykły link weryfikacyjny, a dla
   * zaproszonego (INVITED) - link aktywacyjny. Zaproszony nie ma własnego
   * hasła, więc "weryfikacją" jest ustawienie go linkiem aktywacyjnym;
   * odnawiamy TEN link (inaczej po wygaśnięciu zaproszenia użytkownik utknąłby
   * w pętli EMAIL_NOT_VERIFIED). Wspólne dla resendVerification i rejestracji
   * na adres istniejącego, niepotwierdzonego konta.
   */
  async sendVerificationOrActivation(user: {
    id: string;
    organizationId: string;
    email: string;
    firstName: string | null;
    status: string;
    role: string;
  }): Promise<void> {
    if (user.status === UserStatus.INVITED) {
      // Administrator organizacji założonej samoobsługowo (INVITED = hasło jeszcze
      // nie ustawione, PENDING = domena niezweryfikowana) dostaje link rejestracyjny,
      // a pracownik zaproszony przez admina - link zaproszenia.
      const organization = await this.tenantPrisma.runInOrgContext(user.organizationId, (tx) =>
        tx.organization.findUnique({ where: { id: user.organizationId }, select: { status: true } }),
      );
      if (user.role === Role.ORG_ADMIN && organization?.status === 'PENDING_DOMAIN_VERIFICATION') {
        await this.sendRegistrationActivation(user);
        return;
      }
      await this.sendActivationReminder(user);
    } else {
      await this.sendVerificationEmail(user.organizationId, user.id, user.email);
    }
  }

  /**
   * Rejestracja firmy: konto powstaje BEZ hasła klienta, a link z maila (24 h)
   * jest jednocześnie potwierdzeniem skrzynki i ekranem "ustaw hasło"
   * (POST /auth/reset-password aktywuje konto INVITED -> ACTIVE i ustawia
   * emailVerifiedAt). Dzięki temu nikt nie może założyć konta cudzym adresem ze
   * SWOIM hasłem i liczyć, że ofiara je "potwierdzi" (pre-hijacking).
   */
  async sendRegistrationActivation(user: { id: string; organizationId: string; email: string }): Promise<boolean> {
    const organization = await this.tenantPrisma.runInOrgContext(user.organizationId, (tx) =>
      tx.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } }),
    );
    const activationUrl = await this.issuePasswordResetUrl(
      user.organizationId,
      user.id,
      REGISTRATION_ACTIVATION_TOKEN_TTL_MS,
    );
    const accepted = await this.emailService.send({
      to: user.email,
      subject: 'Potwierdź adres e-mail i ustaw hasło',
      templateName: 'registration-activation',
      // Nazwa firmy pozwala właścicielowi skrzynki rozpoznać, że ktoś zapisał
      // go do obcej organizacji (pre-hijacking); w szablonie escapowana.
      templateData: { activationUrl, organizationName: organization?.name ?? null },
    });
    // Tylko jawne false = błąd (mocki testowe zwracają undefined).
    return accepted !== false;
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

  // Publiczne: używa też RegistrationService (link weryfikacyjny po rejestracji).
  async sendVerificationEmail(organizationId: string, userId: string, email: string): Promise<boolean> {
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
