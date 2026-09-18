import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';

describe('POST /demo-requests (e2e, endpoint publiczny)', () => {
  let app: INestApplication;
  const send = jest.fn().mockResolvedValue(true);

  beforeAll(async () => {
    process.env.SALES_EMAIL = 'sprzedaz@demo-e2e.local';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ send })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  function resetThrottle() {
    // Limit żądań jest in-memory - czyścimy, żeby testy nie blokowały się nawzajem.
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  }

  beforeEach(() => {
    send.mockClear();
    resetThrottle();
  });

  afterAll(async () => {
    delete process.env.SALES_EMAIL;
    await app.close();
  });

  it('przyjmuje poprawne zgłoszenie bez tokenu i wysyła je do sprzedaży (202)', async () => {
    const response = await request(app.getHttpServer())
      .post('/demo-requests')
      .send({ email: 'Jan@Firma.pl', employeeCount: 120 })
      .expect(202);

    expect(response.body.message).toMatch(/Dziękujemy/);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sprzedaz@demo-e2e.local', templateData: { email: 'jan@firma.pl', employeeCount: 120 } }),
    );
  });

  it('odrzuca zły e-mail, liczbę spoza zakresu i nieznane pola (400)', async () => {
    const server = app.getHttpServer();
    const invalidBodies = [
      { email: 'nie-email', employeeCount: 10 },
      { email: 'a@firma.pl', employeeCount: 0 },
      { email: 'a@firma.pl', employeeCount: '12' },
      { email: 'a@firma.pl', employeeCount: 5, role: 'ORG_ADMIN' },
    ];
    for (const body of invalidBodies) {
      resetThrottle();
      await request(server).post('/demo-requests').send(body).expect(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('pole pułapki "website" => 202, ale bez wysyłki', async () => {
    await request(app.getHttpServer())
      .post('/demo-requests')
      .send({ email: 'bot@firma.pl', employeeCount: 5, website: 'http://spam.test' })
      .expect(202);
    expect(send).not.toHaveBeenCalled();
  });

  it('czwarte żądanie w ciągu minuty jest ograniczane (429)', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i += 1) {
      await request(server).post('/demo-requests').send({ email: `a${i}@firma.pl`, employeeCount: 5 }).expect(202);
    }
    await request(server).post('/demo-requests').send({ email: 'a9@firma.pl', employeeCount: 5 }).expect(429);
  });
});
