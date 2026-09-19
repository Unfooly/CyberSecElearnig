import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SessionsService } from './sessions.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MAX_TOKENS_PER_GRACE_WINDOW,
  REFRESH_ROTATION_GRACE_MS,
  SESSION_REVOKED_KEY_MARGIN_SECONDS,
} from './token-config';

const USER = { id: 'u1', organizationId: 'o1', role: 'ORG_ADMIN', email: 'a@firma.pl', emailVerifiedAt: new Date() };

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt1',
    organizationId: 'o1',
    userId: 'u1',
    familyId: 'fam1',
    tokenHash: 'h',
    expiresAt: new Date(Date.now() + 3_600_000),
    usedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('SessionsService', () => {
  let lookup: jest.Mock;
  let authLookup: jest.Mock;
  let updateMany: jest.Mock;
  let create: jest.Mock;
  let count: jest.Mock;
  let queryRaw: jest.Mock;
  let sign: jest.Mock;
  let verify: jest.Mock;
  let redisSet: jest.Mock;
  let redisGet: jest.Mock;
  let isAvailable: jest.Mock;
  let reportFailure: jest.Mock;
  let reportSuccess: jest.Mock;
  let service: SessionsService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    lookup = jest.fn();
    authLookup = jest.fn().mockResolvedValue(USER);
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    create = jest.fn().mockResolvedValue({});
    count = jest.fn().mockResolvedValue(0);
    queryRaw = jest.fn().mockResolvedValue([]);
    sign = jest.fn().mockImplementation(async (payload: { fid?: string }) => (payload.fid ? `refresh-${Math.random()}` : `access-${Math.random()}`));
    verify = jest.fn().mockResolvedValue({ sub: 'u1', organizationId: 'o1', fid: 'fam1', jti: 'j' });
    redisSet = jest.fn().mockResolvedValue('OK');
    redisGet = jest.fn().mockResolvedValue(null);
    isAvailable = jest.fn().mockReturnValue(true);
    reportFailure = jest.fn();
    reportSuccess = jest.fn();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const tenantPrisma = {
      runRefreshTokenLookup: lookup,
      runAuthLookup: authLookup,
      runInOrgContext: (_org: string, fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: queryRaw,
          // Świeży odczyt w transakcji po zdobyciu blokady = kolejne wartości tego samego mocka co lookup.
          refreshToken: { updateMany, create, count, findUnique: () => lookup() },
          user: { update: jest.fn(), updateMany: jest.fn() },
        }),
    } as unknown as TenantPrismaService;
    const redis = {
      client: { set: redisSet, get: redisGet },
      key: (...parts: string[]) => ['t', ...parts].join(':'),
      isAvailable,
      reportFailure,
      reportSuccess,
    } as unknown as RedisService;
    service = new SessionsService(
      tenantPrisma,
      { signAsync: sign, verifyAsync: verify } as unknown as JwtService,
      { get: () => 'secret' } as unknown as ConfigService,
      redis,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  describe('wydawanie tokenów', () => {
    it('access token niesie iatMs, refresh token rodzinę (fid) i jti; zapisywany jest tylko HASH refresh tokenu', async () => {
      const pair = await service.startSession({ sub: 'u1', organizationId: 'o1', role: 'ORG_ADMIN' as never, email: 'a@firma.pl' });

      const accessClaims = sign.mock.calls.find(([p]) => !p.fid)![0];
      const refreshClaims = sign.mock.calls.find(([p]) => p.fid)![0];
      expect(accessClaims.iatMs).toEqual(expect.any(Number));
      expect(refreshClaims).toMatchObject({ fid: expect.any(String), jti: expect.any(String) });
      const stored = create.mock.calls[0][0].data;
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(pair.refreshToken);
      expect(stored.familyId).toBe(refreshClaims.fid);
    });

    it('czasy życia pochodzą z token-config (jedno źródło prawdy)', async () => {
      await service.startSession({ sub: 'u1', organizationId: 'o1', role: 'ORG_ADMIN' as never, email: 'a@firma.pl' });

      const accessOptions = sign.mock.calls.find(([p]) => !p.fid)![1];
      expect(accessOptions.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });
  });

  describe('rotate', () => {
    it('poprawny nieużyty token: zajmuje go atomowo (usedAt) i wydaje następny w TEJ SAMEJ rodzinie', async () => {
      lookup.mockResolvedValue(makeRecord());

      await service.rotate('rt-token');

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'rt1', organizationId: 'o1', usedAt: null, revokedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(create.mock.calls[0][0].data.familyId).toBe('fam1');
    });

    it.each([
      ['nieznany hash (np. token sprzed wprowadzenia rodzin)', () => lookup.mockResolvedValue(null)],
      ['token unieważniony', () => lookup.mockResolvedValue(makeRecord({ revokedAt: new Date() }))],
      ['token po terminie', () => lookup.mockResolvedValue(makeRecord({ expiresAt: new Date(Date.now() - 1) }))],
      ['użytkownik bez potwierdzonego e-maila', () => { lookup.mockResolvedValue(makeRecord()); authLookup.mockResolvedValue({ ...USER, emailVerifiedAt: null }); }],
      ['użytkownik z innej organizacji niż rekord (niespójność)', () => { lookup.mockResolvedValue(makeRecord()); authLookup.mockResolvedValue({ ...USER, organizationId: 'o2' }); }],
    ])('%s => 401 i żaden token nie jest wydany', async (_label, arrange) => {
      arrange();

      await expect(service.rotate('rt-token')).rejects.toMatchObject({ status: 401 });
      expect(create).not.toHaveBeenCalled();
    });

    it('nieprawidłowy podpis albo brak fid => 401 bez zapytania o bazę', async () => {
      verify.mockRejectedValueOnce(new Error('bad signature'));
      await expect(service.rotate('x')).rejects.toMatchObject({ status: 401 });

      verify.mockResolvedValueOnce({ sub: 'u1', organizationId: 'o1' });
      await expect(service.rotate('x')).rejects.toMatchObject({ status: 401 });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('token wymieniony przed chwilą (okno łaski): kolejny token w tej samej rodzinie, rodzina NIE jest unieważniana', async () => {
      lookup.mockResolvedValue(makeRecord({ usedAt: new Date(Date.now() - (REFRESH_ROTATION_GRACE_MS - 2000)) }));

      await service.rotate('rt-token');

      expect(create.mock.calls[0][0].data.familyId).toBe('fam1');
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('reuse po oknie łaski: cała rodzina unieważniona, 401, ostrzeżenie w logu (bez tokenu)', async () => {
      lookup.mockResolvedValue(makeRecord({ usedAt: new Date(Date.now() - (REFRESH_ROTATION_GRACE_MS + 2000)) }));

      await expect(service.rotate('rt-token')).rejects.toMatchObject({ status: 401 });

      expect(updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'o1', familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(create).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fam1'));
      expect(String(warnSpy.mock.calls[0][0])).not.toContain('rt-token');
    });

    it('przegrany wyścig o zajęcie tokenu (claim.count=0) + świeży rekord użyty przed chwilą => okno łaski', async () => {
      // Kolejność odczytów: wyszukanie po hashu, odczyt w transakcji po blokadzie, ponowny odczyt po przegranym claimie.
      lookup.mockResolvedValueOnce(makeRecord());
      lookup.mockResolvedValueOnce(makeRecord());
      lookup.mockResolvedValueOnce(makeRecord({ usedAt: new Date() }));
      updateMany.mockResolvedValueOnce({ count: 0 });

      await service.rotate('rt-token');

      expect(create).toHaveBeenCalledTimes(1);
    });

    it('przegrany wyścig, a sesja w międzyczasie unieważniona (revokedAt) => 401', async () => {
      lookup.mockResolvedValueOnce(makeRecord());
      lookup.mockResolvedValueOnce(makeRecord());
      lookup.mockResolvedValueOnce(makeRecord({ revokedAt: new Date() }));
      updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.rotate('rt-token')).rejects.toMatchObject({ status: 401 });
      expect(create).not.toHaveBeenCalled();
    });

    describe('serializacja z unieważnieniem wszystkich sesji (reset hasła / logout-all)', () => {
      it('najpierw blokada wiersza użytkownika (FOR SHARE), dopiero potem zajęcie tokenu i zapis nowego - w jednej transakcji', async () => {
        const order: string[] = [];
        queryRaw.mockImplementation(async () => { order.push('lock'); return []; });
        updateMany.mockImplementation(async () => { order.push('claim'); return { count: 1 }; });
        create.mockImplementation(async () => { order.push('create'); return {}; });
        lookup.mockResolvedValue(makeRecord());

        await service.rotate('rt-token');

        expect(order).toEqual(['lock', 'claim', 'create']);
      });

      it('token unieważniony PO odczycie wstępnym, ale przed zdobyciem blokady => 401, nic nie zajęte, nowa rodzina NIE powstaje', async () => {
        // Wstępny odczyt widzi żywy token; po blokadzie (równoległe unieważnienie już zatwierdzone) jest unieważniony.
        lookup.mockResolvedValueOnce(makeRecord());
        lookup.mockResolvedValueOnce(makeRecord({ revokedAt: new Date() }));

        await expect(service.rotate('rt-token')).rejects.toMatchObject({ status: 401 });

        expect(updateMany).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      });

      it('reuse zatwierdza unieważnienie rodziny (nie wycofuje go rzuceniem wyjątku w transakcji): 401 dopiero po transakcji', async () => {
        const events: string[] = [];
        updateMany.mockImplementation(async () => { events.push('revoke-family'); return { count: 2 }; });
        lookup.mockResolvedValue(makeRecord({ usedAt: new Date(Date.now() - (REFRESH_ROTATION_GRACE_MS + 2000)) }));

        await expect(service.rotate('rt-token')).rejects.toMatchObject({ status: 401 });

        expect(events).toEqual(['revoke-family']);
      });
    });

    describe('okno łaski jest ograniczone', () => {
      const usedJustNow = () => makeRecord({ usedAt: new Date(Date.now() - 1000) });

      it('poniżej limitu tokenów rodziny w oknie: rodzeństwo wydane', async () => {
        lookup.mockResolvedValue(usedJustNow());
        count.mockResolvedValue(MAX_TOKENS_PER_GRACE_WINDOW - 1);

        await service.rotate('rt-token');

        expect(create).toHaveBeenCalledTimes(1);
        expect(count).toHaveBeenCalledWith({
          where: { organizationId: 'o1', familyId: 'fam1', createdAt: { gte: expect.any(Date) } },
        });
      });

      it('limit osiągnięty (pętla odtworzeń tego samego tokenu): traktowane jak reuse - rodzina unieważniona, 401, bez nowego tokenu', async () => {
        lookup.mockResolvedValue(usedJustNow());
        count.mockResolvedValue(MAX_TOKENS_PER_GRACE_WINDOW);

        await expect(service.rotate('rt-token')).rejects.toMatchObject({ status: 401 });

        expect(create).not.toHaveBeenCalled();
        expect(updateMany).toHaveBeenCalledWith({
          where: { organizationId: 'o1', familyId: 'fam1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        });
      });
    });
  });

  describe('logout', () => {
    it('unieważnia rodzinę tokenu; nieznany/zły token jest cichym sukcesem (bez wyroczni)', async () => {
      lookup.mockResolvedValue(makeRecord());
      await service.logout('rt-token');
      expect(updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'o1', familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      updateMany.mockClear();
      lookup.mockResolvedValue(null);
      await expect(service.logout('nieznany')).resolves.toBeUndefined();
      verify.mockRejectedValueOnce(new Error('bad'));
      await expect(service.logout('zly-podpis')).resolves.toBeUndefined();
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  describe('unieważnienie wszystkich sesji i odbicie w Redisie', () => {
    it('klucz sessions-revoked:<userId> z TTL wynikającym z ACCESS_TOKEN_TTL_SECONDS (nie stała wpisana osobno)', async () => {
      const at = new Date('2027-01-01T00:00:00.000Z');

      await service.publishRevocation('u1', at);

      expect(redisSet).toHaveBeenCalledWith(
        't:sessions-revoked:u1',
        String(at.getTime()),
        'EX',
        ACCESS_TOKEN_TTL_SECONDS + SESSION_REVOKED_KEY_MARGIN_SECONDS,
      );
    });

    it('awaria Redisa przy zapisie: nie rzuca (operacja się udała w bazie), zgłasza incydent i loguje okno', async () => {
      redisSet.mockRejectedValue(new Error('timeout'));

      await expect(service.publishRevocation('u1', new Date())).resolves.toBeUndefined();

      expect(reportFailure).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/Redis.*access tokeny pozostaną ważne/));
    });

    it('Redis niedostępny (bezpiecznik/niegotowy): zapis pominięty z logiem, bez wołania Redisa', async () => {
      isAvailable.mockReturnValue(false);

      await service.publishRevocation('u1', new Date());

      expect(redisSet).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('isAccessTokenRevoked: token wydany PRZED unieważnieniem odrzucony, wydany PO - przepuszczony', async () => {
      redisGet.mockResolvedValue('1000');

      expect(await service.isAccessTokenRevoked('u1', 999)).toBe(true);
      expect(await service.isAccessTokenRevoked('u1', 1000)).toBe(false);
      expect(await service.isAccessTokenRevoked('u1', 5000)).toBe(false);
    });

    it('brak klucza => nieunieważniony; jeden GET z kluczem użytkownika', async () => {
      redisGet.mockResolvedValue(null);

      expect(await service.isAccessTokenRevoked('u1', 1)).toBe(false);
      expect(redisGet).toHaveBeenCalledWith('t:sessions-revoked:u1');
    });

    it('FAIL-OPEN: błąd Redisa albo bezpiecznik => false (nie dokłada opóźnienia), incydent zgłoszony do RedisService', async () => {
      redisGet.mockRejectedValue(new Error('timeout'));
      expect(await service.isAccessTokenRevoked('u1', 1)).toBe(false);
      expect(reportFailure).toHaveBeenCalledTimes(1);

      isAvailable.mockReturnValue(false);
      redisGet.mockClear();
      expect(await service.isAccessTokenRevoked('u1', 1)).toBe(false);
      expect(redisGet).not.toHaveBeenCalled();
    });

    it('bez Redisa w konfiguracji: false i brak wyjątków', async () => {
      const bare = new SessionsService({} as never, {} as never, { get: () => 's' } as never);

      expect(await bare.isAccessTokenRevoked('u1', 1)).toBe(false);
      await expect(bare.publishRevocation('u1', new Date())).resolves.toBeUndefined();
    });
  });
});
