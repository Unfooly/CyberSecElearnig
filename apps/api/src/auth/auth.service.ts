import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { Role } from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Ten sam komunikat dla "e-mail już istnieje" i innych błędów rejestracji —
// celowo nie potwierdza, czy podany adres jest już w systemie (patrz audyt
// bezpieczeństwa modułu auth, ryzyko enumeracji kont na platformie
// antyphishingowej).
const REGISTRATION_FAILED_MESSAGE =
  'Nie udało się utworzyć konta z podanymi danymi. Jeśli masz już konto, zaloguj się.';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
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
