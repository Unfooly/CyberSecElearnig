import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { createHash } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { RefreshTokenCleanupService } from '../src/auth/refresh-token-cleanup.service';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_ROTATION_GRACE_MS, SESSION_REVOKED_KEY_MARGIN_SECONDS } from '../src/auth/token-config';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, createVerifiedUser } from './helpers/auth';

// Sesje: rotacja refresh tokenów z wykrywaniem reuse, wylogowanie, "wyloguj wszędzie" (natychmiastowe
// unieważnienie access tokenów przez Redis), reset hasła, izolacja tenantów (RLS) i sprzątanie.
describe('Sesje: refresh, logout, logout-all, reset hasła (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let redis: RedisService;
  let jwt: JwtService;

  const suffix = Date.now();
  const domainSuffix = 'sessions-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label}.${domainSuffix}`;
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

  beforeAll(async () => {
    process.env.REDIS_KEY_PREFIX = `unfooly-test-sessions-${suffix}`;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    redis = app.get(RedisService);
    jwt = app.get(JwtService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    if (!(await redis.waitUntilReady())) {
      throw new Error('Ten pakiet e2e wymaga Redisa (REDIS_URL): unieważnianie access tokenów jest w Redisie.');
    }
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    const keys = await redis.client!.keys(redis.key('*'));
    if (keys.length > 0) {
      await redis.client!.del(...keys);
    }
    delete process.env.REDIS_KEY_PREFIX;
    await app.close();
  });

  async function newUser(label: string) {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const ids = await createVerifiedUser(app, tenantPrisma, credentials);
    return { ...credentials, ...ids };
  }

  async function login(user: { email: string; password: string }) {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
    return response.body as { accessToken: string; refreshToken: string };
  }

  const refresh = (token: string) => request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: token });
  const whoAmI = (accessToken: string) => request(app.getHttpServer()).get('/users/me/avatar').set('Authorization', `Bearer ${accessToken}`);
  const rowsOf = (organizationId: string) =>
    tenantPrisma.runInOrgContext(organizationId, (tx) => tx.refreshToken.findMany({ orderBy: { createdAt: 'asc' } }));
  const ageUsedAt = (organizationId: string, ms: number) =>
    tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.refreshToken.updateMany({ where: { usedAt: { not: null } }, data: { usedAt: new Date(Date.now() - ms) } }),
    );

  describe('login i przechowywanie', () => {
    it('login tworzy rekord z HASHEM refresh tokenu (nigdy jawnym) i nową rodziną', async () => {
      const user = await newUser('store');

      const tokens = await login(user);

      const rows = await rowsOf(user.organizationId);
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(sha256(tokens.refreshToken));
      expect(JSON.stringify(rows[0])).not.toContain(tokens.refreshToken);
      expect(rows[0].userId).toBe(user.userId);
      expect(rows[0].usedAt).toBeNull();
      expect(rows[0].revokedAt).toBeNull();
    });

    it('dwa loginy = dwie niezależne rodziny', async () => {
      const user = await newUser('families');
      await login(user);
      await login(user);

      const rows = await rowsOf(user.organizationId);

      expect(new Set(rows.map((row) => row.familyId)).size).toBe(2);
    });
  });

  describe('rotacja i wykrywanie reuse', () => {
    it('/auth/refresh wydaje nową parę w tej samej rodzinie, a stary token zostaje oznaczony jako użyty', async () => {
      const user = await newUser('rotate');
      const first = await login(user);

      const rotated = await refresh(first.refreshToken).expect(200);

      expect(rotated.body.refreshToken).not.toBe(first.refreshToken);
      const rows = await rowsOf(user.organizationId);
      expect(rows).toHaveLength(2);
      expect(rows[0].usedAt).not.toBeNull();
      expect(rows[1].usedAt).toBeNull();
      expect(rows[0].familyId).toBe(rows[1].familyId);
      await whoAmI(rotated.body.accessToken).expect(200);
      await refresh(rotated.body.refreshToken).expect(200);
    });

    it('reuse PO oknie łaski: 401 i unieważniona CAŁA rodzina (także najnowszy token), inna rodzina tego usera działa', async () => {
      const user = await newUser('reuse');
      const otherSession = await login(user);
      const first = await login(user);
      const rotated = await refresh(first.refreshToken).expect(200);
      await ageUsedAt(user.organizationId, REFRESH_ROTATION_GRACE_MS + 5000);

      await refresh(first.refreshToken).expect(401);

      await refresh(rotated.body.refreshToken).expect(401);
      await refresh(otherSession.refreshToken).expect(200);
    });

    it('reuse W oknie łaski (równoległe odświeżenie): oba tokeny działają, rodzina NIE jest unieważniona', async () => {
      const user = await newUser('grace');
      const first = await login(user);

      const a = await refresh(first.refreshToken).expect(200);
      const b = await refresh(first.refreshToken).expect(200);

      expect(a.body.refreshToken).not.toBe(b.body.refreshToken);
      await refresh(a.body.refreshToken).expect(200);
      await refresh(b.body.refreshToken).expect(200);
    });

    it('dwa RÓWNOLEGŁE odświeżenia tego samego tokenu: oba udane (atomowe zajęcie + okno łaski), zajęty jest jeden wiersz', async () => {
      const user = await newUser('parallel');
      const first = await login(user);

      const [a, b] = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);

      expect([a.status, b.status]).toEqual([200, 200]);
      const rows = await rowsOf(user.organizationId);
      expect(rows.filter((row) => row.usedAt !== null)).toHaveLength(1);
    });

    it('nadużycie okna łaski: pętla odtworzeń tego samego tokenu w oknie kończy się unieważnieniem rodziny (limit tokenów w oknie)', async () => {
      const user = await newUser('grace-abuse');
      const stolen = await login(user);
      const legit = await refresh(stolen.refreshToken).expect(200); // następca (1 token w oknie + oryginał = 2)

      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        statuses.push((await refresh(stolen.refreshToken)).status);
      }

      expect(statuses[0]).toBe(200); // pierwsze odtworzenie w oknie dostaje rodzeństwo
      expect(statuses).toContain(401); // dalsze - reuse
      await refresh(legit.body.refreshToken).expect(401); // rodzina unieważniona
    });

    it('WYŚCIG: odświeżanie równolegle z "wyloguj wszędzie" NIE zostawia żywej sesji (serializacja blokadą wiersza użytkownika)', async () => {
      for (let round = 0; round < 6; round += 1) {
        const user = await newUser(`race-${round}`);
        const tokens = await login(user);

        const [rotated] = await Promise.all([
          refresh(tokens.refreshToken),
          request(app.getHttpServer()).post('/auth/logout-all').set('Authorization', `Bearer ${tokens.accessToken}`),
        ]);

        const live = (await rowsOf(user.organizationId)).filter((row) => row.revokedAt === null);
        expect(live).toHaveLength(0);
        if (rotated.status === 200) {
          // Token wydany w wyścigu też nie może dać żywej sesji.
          await refresh(rotated.body.refreshToken).expect(401);
        }
      }
    });

    it('token bez rodziny (sprzed wdrożenia), z cudzym podpisem albo śmieć => 401', async () => {
      const user = await newUser('legacy');
      const legacy = await jwt.signAsync(
        { sub: user.userId, organizationId: user.organizationId, role: 'ORG_ADMIN', email: user.email },
        { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      const forged = await jwt.signAsync(
        { sub: user.userId, organizationId: user.organizationId, fid: 'f', jti: 'j' },
        { secret: 'inny-sekret', expiresIn: '7d' },
      );

      await refresh(legacy).expect(401);
      await refresh(forged).expect(401);
      await refresh('nie-jwt').expect(401);
    });

    it('access token nie działa jako refresh token (osobne sekrety)', async () => {
      const user = await newUser('mixed');
      const tokens = await login(user);

      await refresh(tokens.accessToken).expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('unieważnia rodzinę: refresh token przestaje działać, inna sesja tego samego usera nie jest ruszana', async () => {
      const user = await newUser('logout');
      const phone = await login(user);
      const laptop = await login(user);

      await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: laptop.refreshToken }).expect(200);

      await refresh(laptop.refreshToken).expect(401);
      await refresh(phone.refreshToken).expect(200);
      const rows = await rowsOf(user.organizationId);
      expect(rows.filter((row) => row.revokedAt !== null)).toHaveLength(1);
    });

    it('idempotentne i bez wyroczni: nieznany, zły i powtórzony token => zawsze 200', async () => {
      const user = await newUser('logout-idem');
      const tokens = await login(user);

      for (const token of [tokens.refreshToken, tokens.refreshToken, 'nie-jwt', tokens.accessToken]) {
        const response = await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: token });
        expect([response.status, response.body]).toEqual([200, { success: true }]);
      }
    });

    it('zwykły logout NIE unieważnia access tokenu (działa do wygaśnięcia, max 15 min) - świadome; do tego jest logout-all', async () => {
      const user = await newUser('logout-access');
      const tokens = await login(user);

      await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: tokens.refreshToken }).expect(200);

      await whoAmI(tokens.accessToken).expect(200);
    });
  });

  describe('POST /auth/logout-all', () => {
    it('stary access token dostaje 401 SESSION_REVOKED NATYCHMIAST, wszystkie refresh tokeny przestają działać, nowy login działa od razu', async () => {
      const user = await newUser('all');
      const first = await login(user);
      const second = await login(user);
      await whoAmI(first.accessToken).expect(200);

      await request(app.getHttpServer()).post('/auth/logout-all').set('Authorization', `Bearer ${first.accessToken}`).expect(200);

      const denied = await whoAmI(second.accessToken);
      expect([denied.status, denied.body.code]).toEqual([401, 'SESSION_REVOKED']);
      await whoAmI(first.accessToken).expect(401);
      await refresh(first.refreshToken).expect(401);
      await refresh(second.refreshToken).expect(401);
      const fresh = await login(user);
      await whoAmI(fresh.accessToken).expect(200);
      await refresh(fresh.refreshToken).expect(200);
    });

    it('unieważniony Bearer NIE blokuje tras publicznych (login, refresh, logout) - blokuje tylko trasy chronione i logout-all', async () => {
      const user = await newUser('all-public');
      const old = await login(user);
      await request(app.getHttpServer()).post('/auth/logout-all').set('Authorization', `Bearer ${old.accessToken}`).expect(200);

      // Klient dokleja stary Bearer do tras publicznych - mają działać zgodnie ze swoją logiką.
      const fresh = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Authorization', `Bearer ${old.accessToken}`)
        .send({ email: user.email, password: user.password })
        .expect(200);
      await request(app.getHttpServer()).post('/auth/refresh').set('Authorization', `Bearer ${old.accessToken}`).send({ refreshToken: fresh.body.refreshToken }).expect(200);
      await request(app.getHttpServer()).post('/auth/logout').set('Authorization', `Bearer ${old.accessToken}`).send({ refreshToken: fresh.body.refreshToken }).expect(200);

      // ...a trasy chronione i logout-all tego samego unieważnionego tokenu odrzucają.
      await whoAmI(old.accessToken).expect(401);
      const denied = await request(app.getHttpServer()).post('/auth/logout-all').set('Authorization', `Bearer ${old.accessToken}`);
      expect([denied.status, denied.body.code]).toEqual([401, 'SESSION_REVOKED']);
    });

    it('kolejność: kolumna users.sessionsRevokedAt w bazie (źródło prawdy) i klucz w Redisie z TTL z konfiguracji tokenu', async () => {
      const user = await newUser('all-order');
      const tokens = await login(user);

      await request(app.getHttpServer()).post('/auth/logout-all').set('Authorization', `Bearer ${tokens.accessToken}`).expect(200);

      const dbUser = await tenantPrisma.runAuthLookup({ id: user.userId });
      expect(dbUser!.sessionsRevokedAt).toBeInstanceOf(Date);
      const key = redis.key('sessions-revoked', user.userId);
      expect(await redis.client!.get(key)).toBe(String(dbUser!.sessionsRevokedAt!.getTime()));
      const ttl = await redis.client!.ttl(key);
      expect(ttl).toBeGreaterThan(ACCESS_TOKEN_TTL_SECONDS - 5);
      expect(ttl).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_SECONDS + SESSION_REVOKED_KEY_MARGIN_SECONDS);
    });

    it('po wygaśnięciu klucza w Redisie token starszy niż sessionsRevokedAt nadal wygasa naturalnie (TTL klucza >= życie tokenu)', async () => {
      const user = await newUser('all-expiry');
      const tokens = await login(user);
      // Access token wydany PRZED unieważnieniem, ale już po terminie ważności (symulacja: minęło ponad 15 min).
      const nowSec = Math.floor(Date.now() / 1000);
      const expiredOld = await jwt.signAsync(
        {
          sub: user.userId,
          organizationId: user.organizationId,
          role: 'ORG_ADMIN',
          email: user.email,
          iat: nowSec - ACCESS_TOKEN_TTL_SECONDS - 60,
          exp: nowSec - 60,
          iatMs: (nowSec - ACCESS_TOKEN_TTL_SECONDS - 60) * 1000,
        },
        { secret: process.env.JWT_SECRET },
      );
      await request(app.getHttpServer()).post('/auth/logout-all').set('Authorization', `Bearer ${tokens.accessToken}`).expect(200);

      // Symulacja wygaśnięcia klucza po jego TTL:
      await redis.client!.del(redis.key('sessions-revoked', user.userId));

      // Token sprzed unieważnienia, który jest już po terminie, dalej jest odrzucany (naturalnie, przez exp).
      await whoAmI(expiredOld).expect(401);
      // A klucz żyje dłużej niż jakikolwiek jeszcze ważny access token: tokeny wydane przed
      // unieważnieniem wygasają najpóźniej po ACCESS_TOKEN_TTL_SECONDS, czyli zanim klucz zniknie.
      expect(ACCESS_TOKEN_TTL_SECONDS + SESSION_REVOKED_KEY_MARGIN_SECONDS).toBeGreaterThan(ACCESS_TOKEN_TTL_SECONDS);
    });

    it('bez tokenu 401; unieważnia tylko SWOJE sesje - użytkownik innej organizacji nietknięty', async () => {
      const a = await newUser('iso-a');
      const b = await newUser('iso-b');
      const tokensA = await login(a);
      const tokensB = await login(b);

      await request(app.getHttpServer()).post('/auth/logout-all').expect(401);
      await request(app.getHttpServer()).post('/auth/logout-all').set('Authorization', `Bearer ${tokensA.accessToken}`).expect(200);

      await whoAmI(tokensA.accessToken).expect(401);
      await whoAmI(tokensB.accessToken).expect(200);
      await refresh(tokensB.refreshToken).expect(200);
      expect((await tenantPrisma.runAuthLookup({ id: b.userId }))!.sessionsRevokedAt).toBeNull();
    });

    it('Redis padł przy zapisie: operacja i tak się udaje (baza), refresh tokeny unieważnione, access token działa do wygaśnięcia (okno)', async () => {
      const user = await newUser('all-redis-down');
      const tokens = await login(user);
      const spy = jest.spyOn(redis.client!, 'set').mockRejectedValue(new Error('Command timed out'));

      try {
        await request(app.getHttpServer()).post('/auth/logout-all').set('Authorization', `Bearer ${tokens.accessToken}`).expect(200);
      } finally {
        spy.mockRestore();
        redis.reportSuccess(); // koniec symulowanego incydentu (bezpiecznik zamknięty dla kolejnych testów)
      }

      expect((await tenantPrisma.runAuthLookup({ id: user.userId }))!.sessionsRevokedAt).not.toBeNull();
      await refresh(tokens.refreshToken).expect(401);
      await whoAmI(tokens.accessToken).expect(200);
    });
  });

  describe('reset hasła', () => {
    async function resetTokenFor(user: { organizationId: string; userId: string }) {
      const url = await app.get(AuthService).issuePasswordResetUrl(user.organizationId, user.userId);
      return new URL(url).searchParams.get('token') as string;
    }

    it('unieważnia wszystkie sesje: stary access token (natychmiast), refresh tokeny; nowe hasło loguje', async () => {
      const user = await newUser('reset');
      const tokens = await login(user);
      const otherDevice = await login(user);
      await whoAmI(tokens.accessToken).expect(200);

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: await resetTokenFor(user), newPassword: 'Nowe-Haslo-987!' })
        .expect(200);

      await whoAmI(tokens.accessToken).expect(401);
      await whoAmI(otherDevice.accessToken).expect(401);
      await refresh(tokens.refreshToken).expect(401);
      await refresh(otherDevice.refreshToken).expect(401);
      const fresh = await login({ email: user.email, password: 'Nowe-Haslo-987!' });
      await whoAmI(fresh.accessToken).expect(200);
      expect((await tenantPrisma.runAuthLookup({ id: user.userId }))!.sessionsRevokedAt).not.toBeNull();
    });

    it('nieudany reset (zły token) NIE ruszy sesji', async () => {
      const user = await newUser('reset-bad');
      const tokens = await login(user);

      await request(app.getHttpServer()).post('/auth/reset-password').send({ token: 'zly-token', newPassword: 'Nowe-Haslo-987!' }).expect(400);

      await whoAmI(tokens.accessToken).expect(200);
      await refresh(tokens.refreshToken).expect(200);
    });
  });

  describe('izolacja tenantów (RLS, Zasada nr 1)', () => {
    it('bez kontekstu organizacji tabela refresh_tokens jest pusta (fail-closed); z kontekstem A widać tylko wiersze A', async () => {
      const a = await newUser('rls-a');
      const b = await newUser('rls-b');
      await login(a);
      await login(b);

      const noContext = await prisma.refreshToken.findMany();
      const seenByA = await rowsOf(a.organizationId);

      expect(noContext).toHaveLength(0);
      expect(seenByA.every((row) => row.organizationId === a.organizationId)).toBe(true);
      expect(seenByA.length).toBeGreaterThan(0);
    });

    it('złożony FK: nie da się zapisać tokenu użytkownika z INNEJ organizacji (nawet w kontekście własnej)', async () => {
      const a = await newUser('fk-a');
      const b = await newUser('fk-b');

      await expect(
        tenantPrisma.runInOrgContext(a.organizationId, (tx) =>
          tx.refreshToken.create({
            data: {
              organizationId: a.organizationId,
              userId: b.userId,
              familyId: 'f',
              tokenHash: `hash-${suffix}-fk`,
              expiresAt: new Date(Date.now() + 60_000),
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it('RLS: w kontekście A nie da się wstawić wiersza z organizationId B (WITH CHECK)', async () => {
      const a = await newUser('check-a');
      const b = await newUser('check-b');

      await expect(
        tenantPrisma.runInOrgContext(a.organizationId, (tx) =>
          tx.refreshToken.create({
            data: {
              organizationId: b.organizationId,
              userId: b.userId,
              familyId: 'f',
              tokenHash: `hash-${suffix}-check`,
              expiresAt: new Date(Date.now() + 60_000),
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it('usunięcie użytkownika i organizacji kasuje jego tokeny (kaskada)', async () => {
      const user = await newUser('cascade');
      await login(user);

      await prisma.organization.delete({ where: { id: user.organizationId } });

      const remaining = await tenantPrisma.runCrossOrgQuery((tx) => tx.refreshToken.count({ where: { organizationId: user.organizationId } }));
      expect(remaining).toBe(0);
    });
  });

  describe('sprzątanie wygasłych tokenów (job)', () => {
    it('usuwa tokeny po terminie (+ doba retencji) we WSZYSTKICH organizacjach, ważne zostawia', async () => {
      const a = await newUser('clean-a');
      const b = await newUser('clean-b');
      await login(a);
      await login(b);
      const now = new Date('2030-01-01T00:00:00Z');
      const insert = (organizationId: string, userId: string, name: string, expiresAt: Date) =>
        tenantPrisma.runInOrgContext(organizationId, (tx) =>
          tx.refreshToken.create({
            data: { organizationId, userId, familyId: `fam-${name}`, tokenHash: `clean-${suffix}-${name}`, expiresAt },
          }),
        );
      await insert(a.organizationId, a.userId, 'a-old', new Date(now.getTime() - 3 * 86_400_000));
      await insert(b.organizationId, b.userId, 'b-old', new Date(now.getTime() - 2 * 86_400_000));
      await insert(a.organizationId, a.userId, 'a-recent', new Date(now.getTime() - 3_600_000));
      await insert(a.organizationId, a.userId, 'a-valid', new Date(now.getTime() + 3_600_000));

      const result = await app.get(RefreshTokenCleanupService).run(now);

      expect(result.deleted).toBeGreaterThanOrEqual(2);
      const names = async (org: string) =>
        (await rowsOf(org)).map((row) => row.tokenHash).filter((hash) => hash.startsWith(`clean-${suffix}`));
      expect((await names(a.organizationId)).sort()).toEqual([`clean-${suffix}-a-recent`, `clean-${suffix}-a-valid`]);
      expect(await names(b.organizationId)).toEqual([]);
    });
  });
});
