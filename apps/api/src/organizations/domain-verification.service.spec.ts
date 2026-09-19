import { BadRequestException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { DnsTxtResolver } from './dns-txt-resolver';
import {
  DOMAIN_CHECK_TOO_FREQUENT,
  DOMAIN_VERIFICATION_FAILED,
  DomainVerificationService,
} from './domain-verification.service';

const TOKEN = 'a'.repeat(64);
const ROW = { id: 'd1', organizationId: 'o1', domain: 'firma.pl', verificationToken: TOKEN, verifiedAt: null, lastCheckedAt: null };

describe('DomainVerificationService', () => {
  let findFirst: jest.Mock;
  let updateMany: jest.Mock;
  let orgUpdate: jest.Mock;
  let resolveTxt: jest.Mock;
  let service: DomainVerificationService;

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue(ROW);
    // 1. wywołanie updateMany = claim cooldownu, 2. = ustawienie verifiedAt.
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    orgUpdate = jest.fn().mockResolvedValue({});
    resolveTxt = jest.fn().mockResolvedValue([[`unfooly-verify=${TOKEN}`]]);
    service = new DomainVerificationService(
      {
        runInOrgContext: (_id: string, fn: (tx: unknown) => unknown) =>
          fn({ organizationDomain: { findFirst, updateMany }, organization: { update: orgUpdate } }),
      } as unknown as TenantPrismaService,
      { resolveTxt } as unknown as DnsTxtResolver,
    );
  });

  const failure = async (): Promise<unknown> => {
    try {
      await service.check('o1');
    } catch (error) {
      return (error as BadRequestException).getResponse();
    }
    return undefined;
  };

  it('oczekiwany rekord: host _unfooly-verify.<domena>, wartość unfooly-verify=<token>', () => {
    expect(DomainVerificationService.expectedRecord('firma.pl', TOKEN)).toEqual({
      type: 'TXT',
      host: '_unfooly-verify.firma.pl',
      value: `unfooly-verify=${TOKEN}`,
    });
  });

  it('poprawny rekord: ustawia verifiedAt i przełącza organizację na ACTIVE', async () => {
    await expect(service.check('o1')).resolves.toEqual({ verified: true });

    expect(resolveTxt).toHaveBeenCalledWith('_unfooly-verify.firma.pl');
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 'd1', verifiedAt: null }, data: { verifiedAt: expect.any(Date) } });
    expect(orgUpdate).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'ACTIVE' } });
  });

  it('rekord rozbity na fragmenty TXT jest łączony przed porównaniem', async () => {
    const value = `unfooly-verify=${TOKEN}`;
    resolveTxt.mockResolvedValue([['inny rekord'], [value.slice(0, 20), value.slice(20)]]);

    await expect(service.check('o1')).resolves.toEqual({ verified: true });
  });

  it('domena już zweryfikowana: zwraca sukces bez zapytania DNS', async () => {
    findFirst.mockResolvedValue({ ...ROW, verifiedAt: new Date() });

    await expect(service.check('o1')).resolves.toEqual({ verified: true });
    expect(resolveTxt).not.toHaveBeenCalled();
  });

  describe('wszystkie porażki zwracają IDENTYCZNY ogólny błąd', () => {
    it('zły token', async () => {
      resolveTxt.mockResolvedValue([['unfooly-verify=zly-token']]);

      expect(await failure()).toEqual(DOMAIN_VERIFICATION_FAILED);
    });

    it('brak rekordu (NXDOMAIN / ENODATA)', async () => {
      resolveTxt.mockRejectedValue(Object.assign(new Error('queryTxt ENODATA'), { code: 'ENODATA' }));

      expect(await failure()).toEqual(DOMAIN_VERIFICATION_FAILED);
    });

    it('timeout DNS', async () => {
      resolveTxt.mockRejectedValue(new Error('DNS timeout'));

      expect(await failure()).toEqual(DOMAIN_VERIFICATION_FAILED);
    });

    it('pusta odpowiedź DNS', async () => {
      resolveTxt.mockResolvedValue([]);

      expect(await failure()).toEqual(DOMAIN_VERIFICATION_FAILED);
    });

    it('brak wiersza domeny w organizacji', async () => {
      findFirst.mockResolvedValue(null);

      expect(await failure()).toEqual(DOMAIN_VERIFICATION_FAILED);
    });

    it('domena zweryfikowana już w INNEJ organizacji (P2002) - ten sam błąd, bez meta, status nie zmieniony', async () => {
      updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
            meta: { target: 'organization_domains_domain_verified_key', modelName: 'OrganizationDomain' },
          }),
        );

      const body = await failure();

      expect(body).toEqual(DOMAIN_VERIFICATION_FAILED);
      expect(JSON.stringify(body)).not.toMatch(/organization|innej|verified_key|unique/i);
      expect(orgUpdate).not.toHaveBeenCalled();
    });
  });

  it('cooldown: drugie sprawdzenie w ciągu 10 s => 429 i BEZ zapytania DNS', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });

    const promise = service.check('o1');

    await expect(promise).rejects.toBeInstanceOf(HttpException);
    await expect(promise).rejects.toMatchObject({ status: 429, response: DOMAIN_CHECK_TOO_FREQUENT });
    expect(resolveTxt).not.toHaveBeenCalled();
  });

  it('równoległe kliknięcie, które zdążyło pierwsze (verifiedAt już ustawione): sukces bez zmiany statusu drugi raz', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(service.check('o1')).resolves.toEqual({ verified: true });
    expect(orgUpdate).not.toHaveBeenCalled();
  });

  it('nieoczekiwany błąd bazy nie jest maskowany jako błąd weryfikacji (500)', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error('db down'));

    await expect(service.check('o1')).rejects.toThrow('db down');
  });
});
