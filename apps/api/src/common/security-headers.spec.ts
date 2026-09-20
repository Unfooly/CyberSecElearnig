import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { configureBodyParsing } from './body-parsing';
import { configureSecurityHeaders } from './security-headers';

@Controller('probe')
class ProbeController {
  @Get()
  get() {
    return { ok: true };
  }

  @Post()
  post() {
    return { ok: true };
  }
}

describe('configureSecurityHeaders (Helmet, bez CSP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication();
    configureSecurityHeaders(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('odpowiedź ma domyślne nagłówki bezpieczeństwa Helmet', async () => {
    const response = await request(app.getHttpServer()).get('/probe').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('nie ujawnia frameworka (brak X-Powered-By)', async () => {
    const response = await request(app.getHttpServer()).get('/probe').expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('BEZ Content-Security-Policy: CSP ustawia web (Next.js), nie API', async () => {
    const response = await request(app.getHttpServer()).get('/probe').expect(200);

    expect(response.headers['content-security-policy']).toBeUndefined();
    expect(response.headers['content-security-policy-report-only']).toBeUndefined();
  });

  it('nagłówki mają także odpowiedzi błędów (404) i żądań zmieniających stan (POST)', async () => {
    const notFound = await request(app.getHttpServer()).get('/nie-ma-takiej-trasy').expect(404);
    const post = await request(app.getHttpServer()).post('/probe').expect(201);

    for (const response of [notFound, post]) {
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('odpowiedzi błędów PARSERA ciała (nieprawidłowy JSON, za duże ciało) też mają nagłówki, gdy Helmet stoi przed parserem (kolejność z main.ts)', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    const parserApp = moduleRef.createNestApplication({ bodyParser: false });
    configureSecurityHeaders(parserApp);
    configureBodyParsing(parserApp);
    await parserApp.init();
    try {
      const invalid = await request(parserApp.getHttpServer()).post('/probe').set('Content-Type', 'application/json').send('{"zły json"').expect(400);
      const tooLarge = await request(parserApp.getHttpServer()).post('/probe').send({ a: 'x'.repeat(200_000) }).expect(413);

      for (const response of [invalid, tooLarge]) {
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['strict-transport-security']).toBeDefined();
        expect(response.headers['x-powered-by']).toBeUndefined();
        expect(response.body).toEqual(expect.objectContaining({ message: 'Nieprawidłowe żądanie.' }));
      }
    } finally {
      await parserApp.close();
    }
  });

  it('main.ts podpina nagłówki jako PIERWSZY middleware (przed parsowaniem ciała), żeby miały je też błędy parsera', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');

    const headers = main.indexOf('configureSecurityHeaders(app)');
    const parsing = main.indexOf('configureBodyParsing(app)');
    expect(headers).toBeGreaterThan(-1);
    expect(parsing).toBeGreaterThan(-1);
    expect(headers).toBeLessThan(parsing);
  });
});
