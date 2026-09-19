import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@cyberszkolo/shared';
import type { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ALLOW_PENDING_ORGANIZATION_KEY } from '../decorators/allow-pending-organization.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_ORGANIZATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }

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
    if (payload.role === Role.SUPER_ADMIN) {
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
