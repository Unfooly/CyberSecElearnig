import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@cyberszkolo/shared';
import type { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ALLOW_PENDING_ORGANIZATION_KEY } from '../decorators/allow-pending-organization.decorator';
import { SKIP_SESSION_CHECK_KEY } from '../decorators/skip-session-check.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { SessionsService } from '../../auth/sessions.service';

export const SESSION_REVOKED_ERROR = {
  code: 'SESSION_REVOKED',
  message: 'Sesja została unieważniona. Zaloguj się ponownie.',
};

export const ORGANIZATION_PENDING_ERROR = {
  code: 'ORGANIZATION_PENDING_DOMAIN_VERIFICATION',
  message: 'Organizacja czeka na weryfikację domeny e-mail. Dokończ weryfikację, aby korzystać z platformy.',
};

/**
 * GLOBALNY guard FAIL-CLOSED: użytkownik organizacji, której domena nie jest
 * jeszcze zweryfikowana (status != ACTIVE), dostaje 403 na KAŻDYM endpoincie,
 * chyba że handler/kontroler jawnie oznaczono @AllowPendingOrganization().
 * Nowy endpoint jest więc domyślnie zablokowany - nikt nie musi pamiętać o
 * dopisaniu blokady (to guard na poziomie API, nie ukrywanie przycisków w UI).
 *
 * Guard sam weryfikuje podpis JWT (JwtAuthGuard jest per-kontroler i
 * uruchamia się PO globalnych, więc `request.user` jeszcze nie istnieje).
 * Brak tokenu / zły token: przepuszczamy - odrzuci go JwtAuthGuard tam, gdzie
 * uwierzytelnienie jest wymagane, a trasy publiczne (rejestracja, logowanie)
 * nie dotyczą żadnej organizacji.
 *
 * Ten sam guard odrzuca (401 SESSION_REVOKED) access tokeny unieważnione przez "wyloguj
 * wszędzie" / reset hasła (SessionsService) - patrz komentarz przy sprawdzeniu.
 *
 * Status organizacji czytamy z bazy na KAŻDYM żądaniu (jedno zapytanie po
 * kluczu głównym, tabela organizations jest globalna bez RLS) - świadomie nie
 * z JWT (token żyje 15 min i po weryfikacji domeny/usunięciu organizacji
 * byłby nieaktualny) i bez cache. JwtStrategy.validate nie ładuje użytkownika
 * z bazy, więc nie ma istniejącego zapytania, do którego dałoby się to dołączyć.
 * SUPER_ADMIN (operator platformy) jest pominięty.
 */
@Injectable()
export class ActiveOrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_ORGANIZATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Ten sam ekstraktor co JwtStrategy - rozbieżny parser (np. "bearer" małymi
    // literami, tabulator) pozwoliłby ominąć guard przy uwierzytelnionym żądaniu.
    const request = context.switchToHttp().getRequest<Request>();
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
    if (!token) {
      return true;
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      return true;
    }

    // Unieważnienie sesji ("wyloguj wszędzie", reset hasła): access token wydany PRZED chwilą
    // unieważnienia jest odrzucany natychmiast - także na trasach dozwolonych dla PENDING i dla
    // SUPER_ADMIN. Jeden GET z Redisa (RedisService: bezpiecznik, commandTimeout 500 ms, fail-open).
    // Trasy publiczne (login, refresh, logout...) oznaczone @SkipSessionCheck() nie są blokowane
    // przez stary Bearer doklejony przez klienta.
    const skipSessionCheck = this.reflector.getAllAndOverride<boolean>(SKIP_SESSION_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const issuedAtMs = payload.iatMs ?? (payload.iat ?? 0) * 1000;
    if (!skipSessionCheck && (await this.sessions.isAccessTokenRevoked(payload.sub, issuedAtMs))) {
      throw new UnauthorizedException(SESSION_REVOKED_ERROR);
    }

    if (allowed || payload.role === Role.SUPER_ADMIN) {
      return true;
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: payload.organizationId },
      select: { status: true },
    });
    if (!organization || organization.status !== 'ACTIVE') {
      throw new ForbiddenException(ORGANIZATION_PENDING_ERROR);
    }
    return true;
  }
}
