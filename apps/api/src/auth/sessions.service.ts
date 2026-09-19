import { Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, RefreshToken } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MAX_TOKENS_PER_GRACE_WINDOW,
  REFRESH_ROTATION_GRACE_MS,
  REFRESH_TOKEN_TTL_SECONDS,
  SESSION_REVOKED_KEY_MARGIN_SECONDS,
} from './token-config';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

type SessionSubject = Pick<JwtPayload, 'sub' | 'organizationId' | 'role' | 'email'>;

type RotationOutcome =
  | { kind: 'ok'; tokens: TokenPair }
  | { kind: 'invalid' }
  | { kind: 'reuse'; familyId: string };

const INVALID_REFRESH = 'Nieprawidłowy refresh token';

/**
 * Sesje użytkowników: wydawanie tokenów, rotacja refresh tokenów z wykrywaniem reuse,
 * wylogowanie i unieważnianie wszystkich sesji.
 *
 * - Refresh token to JWT (sekret JWT_REFRESH_SECRET) z `fid` (rodzina) i `jti`; w bazie
 *   leży tylko SHA-256 całego tokenu (tabela refresh_tokens, RLS).
 * - Rotacja: /auth/refresh oznacza użyty token (`usedAt`) i wydaje następny w tej samej rodzinie.
 *   Ponowne użycie tokenu po oknie łaski (REFRESH_ROTATION_GRACE_MS) = reuse => cała rodzina
 *   unieważniona (kradzież albo wyciek). W oknie łaski dostaje kolejny token (patrz token-config).
 * - Rotacja (claim + zapis nowego tokenu) i unieważnienie wszystkich sesji są SERYALIZOWANE blokadą
 *   wiersza użytkownika (`SELECT ... FOR SHARE` w rotacji, `UPDATE users` w unieważnieniu): token
 *   zajęty przed resetem hasła / "wyloguj wszędzie" nie może już wydać nowej, żywej rodziny.
 * - "Wyloguj wszędzie" i reset hasła: users.sessionsRevokedAt (źródło prawdy, transakcja RLS) +
 *   unieważnienie wszystkich refresh tokenów + odbicie w Redisie z TTL = życie access tokenu,
 *   które guard sprawdza jednym GET-em (access token wydany PRZED tą chwilą jest odrzucany).
 *   Redis jest tu tylko przyspieszeniem: przy jego awarii/utracie klucza guard jest fail-open (okno
 *   do TTL access tokenu), a operacja unieważnienia i tak się udaje.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** Nowa sesja (login): nowa rodzina refresh tokenów. */
  startSession(subject: SessionSubject): Promise<TokenPair> {
    return this.tenantPrisma.runInOrgContext(subject.organizationId, (tx) =>
      this.issueInTransaction(tx, subject, randomUUID()),
    );
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Podpisuje parę tokenów i zapisuje hash refresh tokenu (w rodzinie `familyId`) w PODANEJ transakcji tenanta. */
  private async issueInTransaction(tx: Prisma.TransactionClient, subject: SessionSubject, familyId: string): Promise<TokenPair> {
    const now = Date.now();
    const claims = { sub: subject.sub, organizationId: subject.organizationId, role: subject.role, email: subject.email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...claims, iatMs: now },
        { secret: this.configService.get<string>('JWT_SECRET'), expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      ),
      this.jwtService.signAsync(
        { ...claims, fid: familyId, jti: randomUUID() },
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: REFRESH_TOKEN_TTL_SECONDS },
      ),
    ]);

    await tx.refreshToken.create({
      data: {
        organizationId: subject.organizationId,
        userId: subject.sub,
        familyId,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return { accessToken, refreshToken };
  }

  private async verifyRefresh(refreshToken: string): Promise<JwtPayload | null> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      return null;
    }
  }

  /** Rotacja refresh tokenu (POST /auth/refresh). Każda porażka to ten sam 401. */
  async rotate(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefresh(refreshToken);
    // Tokeny sprzed wprowadzenia rodzin (bez `fid`) nie mają rekordu - wymagają ponownego logowania.
    if (!payload || !payload.fid) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const record = await this.tenantPrisma.runRefreshTokenLookup(this.hash(refreshToken));
    if (!record || record.revokedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    // Dane usera (rola, e-mail) z bazy, nie z tokenu; tokeny mają tylko zweryfikowani.
    const user = await this.tenantPrisma.runAuthLookup({ id: record.userId });
    if (!user || !user.emailVerifiedAt || user.organizationId !== record.organizationId) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    const subject: SessionSubject = {
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role as SessionSubject['role'],
      email: user.email,
    };

    const outcome = await this.tenantPrisma.runInOrgContext(record.organizationId, (tx) =>
      this.rotateInTransaction(tx, record, subject),
    );

    if (outcome.kind === 'ok') {
      return outcome.tokens;
    }
    if (outcome.kind === 'reuse') {
      // Rodzina została unieważniona (commit powyżej) - dopiero teraz 401.
      this.logger.warn(`Wykryto ponowne użycie refresh tokenu - rodzina sesji ${outcome.familyId} unieważniona.`);
    }
    throw new UnauthorizedException(INVALID_REFRESH);
  }

  private async rotateInTransaction(
    tx: Prisma.TransactionClient,
    record: RefreshToken,
    subject: SessionSubject,
  ): Promise<RotationOutcome> {
    // Blokada wiersza użytkownika: czeka na równoległe unieważnienie wszystkich sesji (jego UPDATE
    // trzyma blokadę wyłączną), a jeśli my ją mamy, unieważnienie poczeka na nasz commit - i
    // unieważni także nowo wydany token. Bez tego token zajęty tuż przed resetem hasła mógłby
    // wydać nową, ŻYWĄ rodzinę po commicie unieważnienia.
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${record.userId} FOR SHARE`;

    // Świeży stan po zdobyciu blokady (READ COMMITTED: widzi commit unieważnienia).
    const current = await tx.refreshToken.findUnique({ where: { id: record.id } });
    const now = new Date();
    if (!current || current.revokedAt || current.expiresAt <= now) {
      return { kind: 'invalid' };
    }

    if (!current.usedAt) {
      // Atomowe zajęcie tokenu: tylko jedno z równoległych żądań wygrywa.
      const claim = await tx.refreshToken.updateMany({
        where: { id: current.id, organizationId: current.organizationId, usedAt: null, revokedAt: null },
        data: { usedAt: now },
      });
      if (claim.count === 1) {
        return { kind: 'ok', tokens: await this.issueInTransaction(tx, subject, current.familyId) };
      }
      // Ktoś zdążył pierwszy (albo sesję właśnie unieważniono) - ocena od nowa na świeżym rekordzie.
      const reloaded = await tx.refreshToken.findUnique({ where: { id: current.id } });
      if (!reloaded || reloaded.revokedAt) {
        return { kind: 'invalid' };
      }
      return this.handleAlreadyUsed(tx, reloaded, subject, now);
    }
    return this.handleAlreadyUsed(tx, current, subject, now);
  }

  private async handleAlreadyUsed(
    tx: Prisma.TransactionClient,
    record: RefreshToken,
    subject: SessionSubject,
    now: Date,
  ): Promise<RotationOutcome> {
    const usedAt = record.usedAt?.getTime() ?? 0;
    if (now.getTime() - usedAt <= REFRESH_ROTATION_GRACE_MS) {
      // Okno łaski (równoległe odświeżenie): kolejny token w tej samej rodzinie - ale nie bez granic.
      // Ograniczamy liczbę tokenów rodziny wydanych w oknie (następca + rodzeństwo), żeby pętla
      // odtworzeń tego samego tokenu nie mnożyła żywych gałęzi; przekroczenie = traktujemy jak reuse.
      const recentInFamily = await tx.refreshToken.count({
        where: {
          organizationId: record.organizationId,
          familyId: record.familyId,
          createdAt: { gte: new Date(now.getTime() - REFRESH_ROTATION_GRACE_MS) },
        },
      });
      if (recentInFamily < MAX_TOKENS_PER_GRACE_WINDOW) {
        return { kind: 'ok', tokens: await this.issueInTransaction(tx, subject, record.familyId) };
      }
    }
    // Reuse poza oknem (albo nadużycie okna): ktoś używa już wymienionego tokenu => cała rodzina.
    await tx.refreshToken.updateMany({
      where: { organizationId: record.organizationId, familyId: record.familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    return { kind: 'reuse', familyId: record.familyId };
  }

  private revokeFamily(organizationId: string, familyId: string, at: Date) {
    return this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.refreshToken.updateMany({ where: { organizationId, familyId, revokedAt: null }, data: { revokedAt: at } }),
    );
  }

  /** POST /auth/logout: unieważnia rodzinę podanego refresh tokenu. Idempotentne, bez wyroczni (zawsze sukces). */
  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefresh(refreshToken);
    if (!payload?.fid) {
      return;
    }
    const record = await this.tenantPrisma.runRefreshTokenLookup(this.hash(refreshToken));
    if (record) {
      await this.revokeFamily(record.organizationId, record.familyId, new Date());
    }
  }

  /**
   * Zapisy "wyloguj wszędzie" w BIEŻĄCEJ transakcji tenanta (kolejność: najpierw baza, potem Redis -
   * wołający po commicie wywołuje publishRevocation). Zwraca chwilę unieważnienia. UPDATE wiersza
   * użytkownika bierze blokadę serializującą z rotacją (patrz rotateInTransaction); updateMany z
   * organizationId (zamiast update) nie rzuca dla usuniętego użytkownika.
   */
  async revokeAllInTransaction(tx: Prisma.TransactionClient, organizationId: string, userId: string): Promise<Date> {
    const at = new Date();
    await tx.user.updateMany({ where: { id: userId, organizationId }, data: { sessionsRevokedAt: at } });
    await tx.refreshToken.updateMany({ where: { organizationId, userId, revokedAt: null }, data: { revokedAt: at } });
    return at;
  }

  /** POST /auth/logout-all: baza (transakcja RLS), potem Redis. */
  async revokeAllSessions(organizationId: string, userId: string): Promise<void> {
    const at = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      this.revokeAllInTransaction(tx, organizationId, userId),
    );
    await this.publishRevocation(userId, at);
  }

  private revokedKey(userId: string): string | null {
    return this.redis?.client ? this.redis.key('sessions-revoked', userId) : null;
  }

  /**
   * Odbicie unieważnienia w Redisie (po zatwierdzeniu bazy). Gdy Redis padnie, operacja i tak
   * się udała (baza jest źródłem prawdy): access tokeny wydane wcześniej pozostają ważne do
   * wygaśnięcia (max ACCESS_TOKEN_TTL_SECONDS) - logujemy to.
   */
  async publishRevocation(userId: string, at: Date): Promise<void> {
    const redis = this.redis;
    const key = this.revokedKey(userId);
    if (!redis?.client || !key || !redis.isAvailable()) {
      this.logger.warn(
        `Unieważnienie sesji zapisane w bazie, ale Redis niedostępny - access tokeny pozostaną ważne do ${ACCESS_TOKEN_TTL_SECONDS} s.`,
      );
      return;
    }
    try {
      await redis.client.set(key, String(at.getTime()), 'EX', ACCESS_TOKEN_TTL_SECONDS + SESSION_REVOKED_KEY_MARGIN_SECONDS);
      redis.reportSuccess();
    } catch (error) {
      redis.reportFailure(error as Error);
      this.logger.warn(
        `Unieważnienie sesji zapisane w bazie, ale zapis w Redisie się nie udał - access tokeny pozostaną ważne do ${ACCESS_TOKEN_TTL_SECONDS} s.`,
      );
    }
  }

  /**
   * Czy access token wydany o `issuedAtMs` został unieważniony ("wyloguj wszędzie" / reset hasła).
   * Jeden GET z Redisa przez RedisService (bezpiecznik, commandTimeout 500 ms). FAIL-OPEN: gdy
   * Redis niedostępny (albo klucz zniknął - restart bez trwałości, eviction), zwraca false (incydent
   * loguje RedisService, raz na incydent). Dlatego Redis musi działać z trwałością i `noeviction`
   * (docker-compose.prod.yml).
   */
  async isAccessTokenRevoked(userId: string, issuedAtMs: number): Promise<boolean> {
    const redis = this.redis;
    const key = this.revokedKey(userId);
    if (!redis?.client || !key || !redis.isAvailable()) {
      return false;
    }
    try {
      const value = await redis.client.get(key);
      redis.reportSuccess();
      return value !== null && issuedAtMs < Number(value);
    } catch (error) {
      redis.reportFailure(error as Error);
      return false;
    }
  }
}
