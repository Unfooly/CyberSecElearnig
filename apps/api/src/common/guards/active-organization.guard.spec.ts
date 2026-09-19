import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ActiveOrganizationGuard, ORGANIZATION_PENDING_ERROR } from './active-organization.guard';

function contextWith(headers: Record<string, string | undefined>, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('ActiveOrganizationGuard (fail-closed)', () => {
  let allowed: boolean | undefined;
  let verifyAsync: jest.Mock;
  let findUnique: jest.Mock;
  let guard: ActiveOrganizationGuard;

  beforeEach(() => {
    allowed = undefined;
    verifyAsync = jest.fn().mockResolvedValue({ sub: 'u1', organizationId: 'o1', role: 'ORG_ADMIN', email: 'a@firma.pl' });
    findUnique = jest.fn().mockResolvedValue({ status: 'ACTIVE' });
    guard = new ActiveOrganizationGuard(
      { getAllAndOverride: () => allowed } as unknown as Reflector,
      { verifyAsync } as unknown as JwtService,
      { get: () => 'secret' } as unknown as ConfigService,
      { organization: { findUnique } } as unknown as PrismaService,
    );
  });

  const bearer = { authorization: 'Bearer token-value' };

  it('organizacja ACTIVE przechodzi', async () => {
    await expect(guard.canActivate(contextWith(bearer))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'o1' }, select: { status: true } });
  });

  it('organizacja PENDING dostaje 403 z kodem ORGANIZATION_PENDING_DOMAIN_VERIFICATION', async () => {
    findUnique.mockResolvedValue({ status: 'PENDING_DOMAIN_VERIFICATION' });

    const promise = guard.canActivate(contextWith(bearer));

    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toMatchObject({ response: ORGANIZATION_PENDING_ERROR });
  });

  it('domyślnie BLOKUJE: brak dekoratora = blokada (fail-closed)', async () => {
    findUnique.mockResolvedValue({ status: 'PENDING_DOMAIN_VERIFICATION' });
    allowed = undefined;

    await expect(guard.canActivate(contextWith(bearer))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('trasa oznaczona @AllowPendingOrganization przepuszcza PENDING - bez zapytania do bazy', async () => {
    findUnique.mockResolvedValue({ status: 'PENDING_DOMAIN_VERIFICATION' });
    allowed = true;

    await expect(guard.canActivate(contextWith(bearer))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('brak organizacji w bazie (np. usunięta przez sprzątanie) => 403', async () => {
    findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(contextWith(bearer))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SUPER_ADMIN (operator platformy) jest pominięty - bez zapytania do bazy', async () => {
    verifyAsync.mockResolvedValue({ sub: 's1', organizationId: 'o-super', role: 'SUPER_ADMIN', email: 's@unfooly.test' });

    await expect(guard.canActivate(contextWith(bearer))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['brak nagłówka', {}],
    ['nagłówek bez Bearer', { authorization: 'Basic abc' }],
    ['pusty Bearer', { authorization: 'Bearer ' }],
  ])('%s: przepuszcza (401 zwróci JwtAuthGuard tam, gdzie wymagane), bez bazy', async (_label, headers) => {
    await expect(guard.canActivate(contextWith(headers))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([['bearer token-value'], ['BEARER token-value'], ['Bearer\ttoken-value']])(
    'schemat "%s" (passport akceptuje) jest rozpoznany tak samo - PENDING nie ominie guarda',
    async (authorization) => {
      findUnique.mockResolvedValue({ status: 'PENDING_DOMAIN_VERIFICATION' });

      await expect(guard.canActivate(contextWith({ authorization }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(verifyAsync).toHaveBeenCalledWith('token-value', expect.anything());
    },
  );

  it('nieprawidłowy podpis/wygasły token: przepuszcza (odrzuci go JwtAuthGuard), bez bazy', async () => {
    verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(guard.canActivate(contextWith(bearer))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('kontekst nie-HTTP jest pomijany', async () => {
    await expect(guard.canActivate(contextWith(bearer, 'rpc'))).resolves.toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('status czytany jest z bazy na KAŻDYM żądaniu (bez cache) - po weryfikacji domeny następne żądanie przechodzi', async () => {
    findUnique.mockResolvedValueOnce({ status: 'PENDING_DOMAIN_VERIFICATION' }).mockResolvedValueOnce({ status: 'ACTIVE' });

    await expect(guard.canActivate(contextWith(bearer))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(contextWith(bearer))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
