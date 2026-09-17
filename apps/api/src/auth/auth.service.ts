import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { Role } from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Ten sam komunikat dla "e-mail już istnieje" i innych błędów rejestracji —
// celowo nie potwierdza, czy podany adres jest już w systemie (patrz audyt
// bezpieczeństwa modułu auth, ryzyko enumeracji kont na platformie
// antyphishingowej).
const REGISTRATION_FAILED_MESSAGE =
  'Nie udało się utworzyć konta z podanymi danymi. Jeśli masz już konto, zaloguj się.';

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

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const BCRYPT_ROUNDS = 12;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

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
          data: { id: organizationId, name: dto.organizationName },
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
      // Unikalność e-maila jest wymuszona na poziomie bazy (constraint
      // działa niezależnie od RLS), więc nie potrzebujemy osobnego
      // pre-checku przez bypass RLS — łapiemy naruszenie i zwracamy ten sam
      // ogólny komunikat co dla każdego innego błędu rejestracji.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new BadRequestException(REGISTRATION_FAILED_MESSAGE);
      }
      throw error;
    }

    return this.issueTokens({
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role as Role,
      email: user.email,
    });
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
    if (!user) {
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
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = this.hashResetToken(rawToken);

      await this.tenantPrisma.runInOrgContext(user.organizationId, async (tx) => {
        // Nowe żądanie unieważnia poprzednie, nieużyte linki tego usera -
        // w danym momencie może być ważny tylko jeden.
        await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
        await tx.passwordResetToken.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
          },
        });
      });

      const frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      await this.emailService.send({
        to: user.email,
        subject: 'Reset hasła',
        templateName: 'password-reset',
        templateData: { resetUrl: `${frontendUrl}/reset-password?token=${rawToken}` },
      });
    }

    // Zawsze ten sam komunikat i status, niezależnie od tego, czy `user`
    // istniał - patrz FORGOT_PASSWORD_RESPONSE_MESSAGE.
    return { message: FORGOT_PASSWORD_RESPONSE_MESSAGE };
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

      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
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
