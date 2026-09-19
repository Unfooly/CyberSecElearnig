import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';

// /demo-requests ma limit 3 żądań na minutę na klienta (publiczny endpoint).
// Sprawdzamy, po czym liczony jest "klient" zależnie od TRUST_PROXY.
describe('Limity żądań a adres klienta / TRUST_PROXY (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Bez adresu sprzedaży /demo-requests odpowiada 503 - potrzebny, by testować limit.
    process.env.SALES_EMAIL = 'sprzedaz@throttle-e2e.test';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ send: jest.fn().mockResolvedValue(true) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  afterAll(async () => {
    delete process.env.SALES_EMAIL;
    await app.close();
  });

  const post = (headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post('/demo-requests')
      .set(headers)
      .send({ email: 'jan@firma.pl', employeeCount: 10 });

  it('TRUST_PROXY=false: nagłówki są ignorowane - limit liczy się po prawdziwym IP (zmiana CF-Connecting-IP go nie omija)', async () => {
    process.env.TRUST_PROXY = 'false';

    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await post({ 'CF-Connecting-IP': `203.0.113.${i + 1}`, 'X-Forwarded-For': `198.51.100.${i + 1}` })).status);
    }

    expect(statuses).toEqual([202, 202, 202, 429, 429]);
  });

  it('brak zmiennej TRUST_PROXY = jak false (domyślnie bezpiecznie)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await post({ 'CF-Connecting-IP': `203.0.113.${i + 1}` })).status);
    }

    expect(statuses).toEqual([202, 202, 202, 429]);
  });

  it('TRUST_PROXY=true: każdy klient (CF-Connecting-IP) ma własny licznik - jeden nie blokuje drugiego', async () => {
    process.env.TRUST_PROXY = 'true';

    for (let i = 0; i < 3; i += 1) {
      expect((await post({ 'CF-Connecting-IP': '203.0.113.1' })).status).toBe(202);
    }
    expect((await post({ 'CF-Connecting-IP': '203.0.113.1' })).status).toBe(429);

    // Inny klient za tym samym proxy nie jest dotknięty limitem pierwszego.
    expect((await post({ 'CF-Connecting-IP': '203.0.113.2' })).status).toBe(202);
    expect((await post({ 'X-Forwarded-For': '198.51.100.9, 10.0.0.1' })).status).toBe(202);
  });

  it('TRUST_PROXY=true: śmieciowy nagłówek nie daje osobnego licznika (fallback na adres gniazda)', async () => {
    process.env.TRUST_PROXY = 'true';

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await post({ 'CF-Connecting-IP': `zly-adres-${i}` })).status);
    }

    expect(statuses).toEqual([202, 202, 202, 429]);
  });
});
