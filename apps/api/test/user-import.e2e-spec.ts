import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { MAX_IMPORT_ROWS } from '../src/users/import/csv-import';
import { PREVIEW_ERRORS_LIMIT, PREVIEW_TTL_MS } from '../src/users/import/user-import.service';
import { UserImportRetentionService } from '../src/users/import/user-import-retention.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

const BOM = String.fromCharCode(0xfeff);
type Role = 'EMPLOYEE' | 'DEPARTMENT_MANAGER' | 'ORG_ADMIN';

interface Org {
  organizationId: string;
  adminId: string;
  adminToken: string;
  adminEmail: string;
}

// Import pracowników z CSV, krok 1 (commit 4/5): podgląd z walidacją per wiersz, limit miejsc, izolacja, wygasanie.
describe('Import pracowników z CSV: podgląd (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let retention: UserImportRetentionService;
  let owner: PrismaClient;
  let sendSpy: jest.SpyInstance;

  const suffix = Date.now();
  const domainSuffix = 'user-import-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label.split('-')[0]}.${domainSuffix}`;
  let orgA: Org;
  let orgB: Org;
  let employeeToken: string;
  let managerToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0); // patrz phishing-campaigns.e2e-spec.ts: równoległe żądania wymagają nasłuchującego serwera
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    retention = app.get(UserImportRetentionService);
    sendSpy = jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    orgA = await newOrg('a');
    orgB = await newOrg('b');
    employeeToken = await addUser(orgA, 'emp-a', 'EMPLOYEE');
    managerToken = await addUser(orgA, 'mgr-a', 'DEPARTMENT_MANAGER');
  }, 90_000);

  afterAll(async () => {
    await owner?.$disconnect();
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  const clearThrottle = () => (app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> }).storage?.clear();
  beforeEach(async () => {
    clearThrottle();
    sendSpy.mockClear();
    await setSeats(orgA, 100);
    await setSeats(orgB, 100);
  });

  afterEach(async () => {
    await owner.userImportBatch.deleteMany({ where: { organizationId: { in: [orgA.organizationId, orgB.organizationId] } } });
    // Konta dodane w testach (poza stałymi: admin i użytkownicy fixture) są sprzątane, żeby licznik miejsc był przewidywalny.
    await owner.user.deleteMany({ where: { organizationId: { in: [orgA.organizationId, orgB.organizationId] }, email: { contains: '-added-' } } });
  });

  // ---- fixtures ----------------------------------------------------------------------------------------------------

  async function newOrg(label: string): Promise<Org> {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials);
    const admin = await tenantPrisma.runAuthLookup({ email: credentials.email });
    return { organizationId: admin!.organizationId, adminId: admin!.id, adminToken: body.accessToken, adminEmail: credentials.email };
  }

  async function addUser(org: Org, label: string, role: Role, extra: Record<string, unknown> = {}): Promise<string> {
    await tenantPrisma.runInOrgContext(org.organizationId, async (tx) =>
      tx.user.create({
        data: { organizationId: org.organizationId, email: email(label), passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4), role, status: 'ACTIVE', emailVerifiedAt: new Date(), ...extra },
      }),
    );
    clearThrottle();
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: email(label), password: DEFAULT_TEST_PASSWORD }).expect(200);
    return login.body.accessToken as string;
  }

  const setSeats = (org: Org, seatsLimit: number) => prisma.organization.update({ where: { id: org.organizationId }, data: { seatsLimit } });
  const userCount = (org: Org) => tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.user.count({ where: { organizationId: org.organizationId } }));
  const batchCount = (org: Org) => tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.userImportBatch.count({ where: { organizationId: org.organizationId } }));
  const rowCount = (org: Org) => tenantPrisma.runInOrgContext(org.organizationId, (tx) => tx.userImportRow.count({ where: { organizationId: org.organizationId } }));

  const upload = (token: string, content: string | Buffer, filename = 'pracownicy.csv', field = 'file') =>
    request(app.getHttpServer()).post('/users/import/preview').set('Authorization', `Bearer ${token}`).attach(field, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'), { filename, contentType: 'text/csv' });
  const get = (token: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const csv = (...lines: string[]) => lines.join('\n');
  const HEADER = 'email,firstName,lastName,departmentName';

  // ---- podgląd: dane poprawne --------------------------------------------------------------------------------------

  describe('podgląd poprawnego pliku', () => {
    it('zwraca podsumowanie, próbkę i stan miejsc; NIE tworzy kont ani nie wysyła maili', async () => {
      const before = await userCount(orgA);

      const response = await upload(orgA.adminToken, csv(HEADER, 'jan@firma.pl,Jan,Kowalski,Sprzedaż', 'ewa@firma.pl,Ewa,Nowak,', 'ala@firma.pl,Ala,Kot,IT')).expect(201);

      expect(response.body).toMatchObject({
        fileName: 'pracownicy.csv',
        delimiter: ',',
        totalRows: 3,
        validCount: 3,
        existingCount: 0,
        errorCount: 0,
        skippedEmpty: 0,
        ignoredColumns: [],
        errors: [],
        errorsTruncated: false,
      });
      expect(response.body.seats).toEqual({ limit: 100, used: before, available: 100 - before, required: 3, missing: 0, ok: true });
      expect(response.body.sample.map((row: { email: string }) => row.email)).toEqual(['jan@firma.pl', 'ewa@firma.pl', 'ala@firma.pl']);
      expect(await userCount(orgA)).toBe(before); // podgląd niczego nie zapisuje w users
      expect(sendSpy).not.toHaveBeenCalled(); // i nie wysyła zaproszeń
      expect(await batchCount(orgA)).toBe(1);
      expect(await rowCount(orgA)).toBe(3);
    });

    it('polskie nagłówki, średniki, BOM i CRLF (eksport Excela "CSV UTF-8")', async () => {
      const content = `${BOM}E-mail;Imię;Nazwisko;Dział;Telefon\r\nanna@firma.pl;Anna;Żółć;Księgowość;123\r\njan@firma.pl;Jan;Łęcki;;456\r\n`;

      const response = await upload(orgA.adminToken, content).expect(201);

      expect(response.body).toMatchObject({ delimiter: ';', totalRows: 2, validCount: 2, ignoredColumns: ['Telefon'] });
      expect(response.body.sample[0]).toMatchObject({ line: 2, email: 'anna@firma.pl', firstName: 'Anna', lastName: 'Żółć', departmentName: 'Księgowość' });
    });

    it('puste wiersze są pomijane po cichu (licznik skippedEmpty), numeracja linii zgodna z arkuszem', async () => {
      const response = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,', '', ',,,', 'b@firma.pl,Jan,Kowalski,')).expect(201);

      expect(response.body).toMatchObject({ totalRows: 2, skippedEmpty: 2 });
      expect(response.body.sample.map((row: { line: number }) => row.line)).toEqual([2, 5]);
    });

    it('nowy podgląd ZASTĘPUJE poprzedni (jedna aktywna partia na organizację); stary identyfikator to 404', async () => {
      const first = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);
      const second = await upload(orgA.adminToken, csv(HEADER, 'b@firma.pl,Jan,Kowalski,', 'c@firma.pl,Ewa,Nowak,')).expect(201);

      expect(await batchCount(orgA)).toBe(1);
      expect(await rowCount(orgA)).toBe(2); // wiersze starej partii usunięte kaskadą
      await get(orgA.adminToken, `/users/import/${first.body.id}`).expect(404);
      await get(orgA.adminToken, `/users/import/${second.body.id}`).expect(200);
    });

    it('równoległe podglądy tej samej organizacji: zostaje dokładnie jedna partia', async () => {
      const responses = await Promise.allSettled(Array.from({ length: 3 }, (_v, i) => upload(orgA.adminToken, csv(HEADER, `p${i}@firma.pl,Anna,Nowak,`))));

      expect(responses.every((r) => r.status === 'fulfilled' && r.value.status === 201)).toBe(true);
      expect(await batchCount(orgA)).toBe(1);
      expect(await rowCount(orgA)).toBe(1);
    });

    it('rekordowy plik (5000 wierszy) przechodzi i zapisuje wszystkie wiersze', async () => {
      await setSeats(orgA, 10_000);
      const lines = [HEADER, ...Array.from({ length: MAX_IMPORT_ROWS }, (_v, i) => `u${i}@firma.pl,Anna,Nowak,Dział ${i % 7}`)];

      const response = await upload(orgA.adminToken, csv(...lines)).expect(201);

      expect(response.body).toMatchObject({ totalRows: 5000, validCount: 5000 });
      expect(await rowCount(orgA)).toBe(5000);
    }, 60_000);
  });

  // ---- walidacja per wiersz ----------------------------------------------------------------------------------------

  describe('walidacja per wiersz (błąd jednego wiersza nie zatrzymuje reszty)', () => {
    it('zwraca listę błędów z numerem wiersza i powodem; poprawne wiersze zostają w partii', async () => {
      const response = await upload(
        orgA.adminToken,
        csv(HEADER, 'dobry@firma.pl,Anna,Nowak,IT', 'zly-email,Jan,Kowalski,IT', 'brak@imienia.pl,,Kowalski,', 'cyfry@firma.pl,J4n,Kowalski,', 'formula@firma.pl,Jan,Kowalski,"=HYPERLINK(""http://x"")"', 'dobry2@firma.pl,Ewa,Nowak,'),
      ).expect(201);

      expect(response.body).toMatchObject({ totalRows: 6, validCount: 2, errorCount: 4 });
      expect(response.body.errors).toEqual([
        { line: 3, email: 'zly-email', reason: 'Nieprawidłowy format e-maila' },
        { line: 4, email: 'brak@imienia.pl', reason: 'Brak imienia lub nazwiska' },
        { line: 5, email: 'cyfry@firma.pl', reason: 'Niedozwolone znaki w imieniu lub nazwisku' },
        { line: 6, email: 'formula@firma.pl', reason: expect.stringContaining('nazwie działu') },
      ]);
      const rows = await get(orgA.adminToken, `/users/import/${response.body.id}/rows?status=ERROR`).expect(200);
      expect(rows.body.total).toBe(4);
    });

    it('duplikat e-maila w pliku: pierwszy wiersz zostaje, kolejne mają błąd ze wskazaniem pierwszego', async () => {
      const response = await upload(orgA.adminToken, csv(HEADER, 'jan@firma.pl,Jan,Kowalski,', 'JAN@firma.pl,Jan,Inny,')).expect(201);

      expect(response.body).toMatchObject({ validCount: 1, errorCount: 1 });
      expect(response.body.errors[0]).toMatchObject({ line: 3, reason: 'Zduplikowany e-mail w tym pliku (pierwszy raz w wierszu 2)' });
    });

    it('lista błędów w odpowiedzi jest ograniczona (200), resztę da się pobrać stronicowaniem wierszy', async () => {
      const bad = Array.from({ length: PREVIEW_ERRORS_LIMIT + 50 }, (_v, i) => `zly${i},Jan,Kowalski,`);

      const response = await upload(orgA.adminToken, csv(HEADER, 'ok@firma.pl,Anna,Nowak,', ...bad)).expect(201);

      expect(response.body.errorCount).toBe(250);
      expect(response.body.errors).toHaveLength(PREVIEW_ERRORS_LIMIT);
      expect(response.body.errorsTruncated).toBe(true);
      const page = await get(orgA.adminToken, `/users/import/${response.body.id}/rows?status=ERROR&page=3&pageSize=100`).expect(200);
      expect(page.body).toMatchObject({ total: 250, page: 3, pageSize: 100 });
      expect(page.body.items).toHaveLength(50);
    });
  });

  // ---- istniejące konta i izolacja adresów -------------------------------------------------------------------------

  describe('adresy z kontem w organizacji', () => {
    it('istniejące konto TEJ organizacji (także w innej wielkości liter) jest oznaczone EXISTING: pomijane, nic nie nadpisujemy, nie zużywa miejsca', async () => {
      await addUser(orgA, 'stary-added-1', 'EMPLOYEE', { firstName: 'Stare', lastName: 'Imię' });
      const before = await userCount(orgA);

      const response = await upload(orgA.adminToken, csv(HEADER, `${email('stary-added-1').toUpperCase()},Nowe,Nazwisko,Dział`, 'nowy@firma.pl,Jan,Kowalski,')).expect(201);

      expect(response.body).toMatchObject({ totalRows: 2, validCount: 1, existingCount: 1, errorCount: 0 });
      expect(response.body.seats).toMatchObject({ required: 1 });
      const rows = await get(orgA.adminToken, `/users/import/${response.body.id}/rows?status=EXISTING`).expect(200);
      expect(rows.body.items).toEqual([expect.objectContaining({ line: 2, status: 'EXISTING', reason: expect.stringContaining('już istnieje') })]);
      const user = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.findFirstOrThrow({ where: { email: email('stary-added-1') } }));
      expect(user).toMatchObject({ firstName: 'Stare', lastName: 'Imię' }); // bez nadpisania
      expect(await userCount(orgA)).toBe(before);
    });

    it('konto z e-mailem zapisanym w bazie w MIESZANEJ wielkości liter też jest rozpoznane jako istniejące (porównanie bez względu na wielkość liter)', async () => {
      const mixed = `Mieszany-Added-1-${suffix}@Firma-Mix.${domainSuffix}`;
      await tenantPrisma.runInOrgContext(orgA.organizationId, async (tx) =>
        tx.user.create({ data: { organizationId: orgA.organizationId, email: mixed, passwordHash: 'x', role: 'EMPLOYEE', status: 'INVITED' } }),
      );

      const response = await upload(orgA.adminToken, csv(HEADER, `${mixed.toLowerCase()},Jan,Kowalski,`)).expect(201);

      expect(response.body).toMatchObject({ validCount: 0, existingCount: 1 });
    });

    it('adres z kontem w INNEJ organizacji NIE jest rozpoznawany (brak enumeracji kont między organizacjami): wiersz jest poprawny', async () => {
      const response = await upload(orgA.adminToken, csv(HEADER, `${orgB.adminEmail},Jan,Kowalski,`)).expect(201);

      expect(response.body).toMatchObject({ validCount: 1, existingCount: 0, errorCount: 0 });
      expect(JSON.stringify(response.body)).not.toMatch(/istnieje|already|unavailable/i);
    });
  });

  // ---- limit miejsc ------------------------------------------------------------------------------------------------

  describe('limit licencji (seatsLimit)', () => {
    it('podgląd pokazuje, ile miejsc brakuje, ZANIM cokolwiek zostanie zapisane; wiersze EXISTING i błędne nie zużywają miejsc', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used + 2); // wolne 2 miejsca
      const lines = [HEADER, 'a@firma.pl,Anna,Nowak,', 'b@firma.pl,Jan,Kowalski,', 'c@firma.pl,Ewa,Nowak,', 'zly,Jan,Kowalski,', `${orgA.adminEmail},Admin,Istniejacy,`];

      const response = await upload(orgA.adminToken, csv(...lines)).expect(201);

      expect(response.body).toMatchObject({ validCount: 3, existingCount: 1, errorCount: 1 });
      expect(response.body.seats).toEqual({ limit: used + 2, used, available: 2, required: 3, missing: 1, ok: false });
    });

    it('granica: dokładnie tyle nowych kont, ile wolnych miejsc, mieści się (ok = true)', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used + 2);

      const response = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,', 'b@firma.pl,Jan,Kowalski,')).expect(201);

      expect(response.body.seats).toMatchObject({ available: 2, required: 2, missing: 0, ok: true });
    });

    it('limit wyczerpany albo przekroczony (użytkowników więcej niż limit): available = 0, nigdy ujemne', async () => {
      await setSeats(orgA, 1);

      const response = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);

      expect(response.body.seats.available).toBe(0);
      expect(response.body.seats).toMatchObject({ required: 1, missing: 1, ok: false });
    });

    it('GET partii pokazuje ŚWIEŻY stan miejsc (liczba kont zmieniła się po podglądzie)', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used + 1);
      const preview = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);
      expect(preview.body.seats.ok).toBe(true);

      await addUser(orgA, 'zajete-added-1', 'EMPLOYEE'); // ktoś zajął ostatnie miejsce
      const summary = await get(orgA.adminToken, `/users/import/${preview.body.id}`).expect(200);

      expect(summary.body.seats).toMatchObject({ used: used + 1, available: 0, required: 1, missing: 1, ok: false });
    });
  });

  // ---- błędy pliku -------------------------------------------------------------------------------------------------

  describe('błędy pliku (cały plik odrzucony z komunikatem, nic nie zapisane)', () => {
    const expectInvalid = async (response: request.Test, pattern: RegExp) => {
      const result = await response.expect(400);
      expect(result.body.code).toBe('IMPORT_FILE_INVALID');
      expect(result.body.message).toMatch(pattern);
      expect(await batchCount(orgA)).toBe(0);
    };

    it('Windows-1250 zamiast UTF-8 (polski Excel "CSV"): komunikat z instrukcją', async () => {
      await expectInvalid(upload(orgA.adminToken, Buffer.from([0x41, 0x2c, 0xaf, 0xf3, 0xb3, 0xe6])), /UTF-8.*Windows-1250/);
    });

    it('UTF-16, XLSX (ZIP) i dane binarne', async () => {
      await expectInvalid(upload(orgA.adminToken, Buffer.from([0xff, 0xfe, 0x65, 0x00])), /UTF-16/);
      await expectInvalid(upload(orgA.adminToken, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])), /XLSX/);
      await expectInvalid(upload(orgA.adminToken, Buffer.from('a,b\u0000c')), /binarne/);
    });

    it('plik pusty, bez wymaganych kolumn i z zepsutymi cudzysłowami', async () => {
      await expectInvalid(upload(orgA.adminToken, Buffer.from('\n')), /pusty|Brakuje/);
      await expectInvalid(upload(orgA.adminToken, csv('email,firstName', 'a@firma.pl,Anna')), /Brakuje wymaganych kolumn: nazwisko/);
      await expectInvalid(upload(orgA.adminToken, csv(HEADER, '"a@firma.pl,Anna,Nowak,')), /cudzysłów/);
    });

    it('limit 5000 wierszy: 5001 odrzuca cały plik z komunikatem o limicie', async () => {
      const lines = [HEADER, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_v, i) => `u${i}@firma.pl,Anna,Nowak,`)];

      await expectInvalid(upload(orgA.adminToken, csv(...lines)), /limit: 5000/);
    });

    it('plik większy niż 1 MB: 413 (limit egzekwuje Multer, zanim treść trafi do parsera)', async () => {
      const big = Buffer.alloc(1024 * 1024 + 10, 0x61);

      await upload(orgA.adminToken, big).expect(413);
      expect(await batchCount(orgA)).toBe(0);
    });

    it('dodatkowe pola tekstowe i nadmiar części multipart są odrzucane (ochrona pamięci): 400, nic nie zapisane', async () => {
      const withField = request(app.getHttpServer())
        .post('/users/import/preview')
        .set('Authorization', `Bearer ${orgA.adminToken}`)
        .field('inne', 'x')
        .attach('file', Buffer.from(csv(HEADER, 'a@firma.pl,Anna,Nowak,')), { filename: 'x.csv', contentType: 'text/csv' });
      clearThrottle();
      const twoFiles = request(app.getHttpServer())
        .post('/users/import/preview')
        .set('Authorization', `Bearer ${orgA.adminToken}`)
        .attach('file', Buffer.from(csv(HEADER, 'a@firma.pl,Anna,Nowak,')), { filename: 'x.csv', contentType: 'text/csv' })
        .attach('file', Buffer.from(csv(HEADER, 'b@firma.pl,Anna,Nowak,')), { filename: 'y.csv', contentType: 'text/csv' });

      await withField.expect((response) => expect([400, 413]).toContain(response.status));
      clearThrottle();
      await twoFiles.expect((response) => expect([400, 413]).toContain(response.status));
      expect(await batchCount(orgA)).toBe(0);
    });

    it('brak pliku albo złe pole formularza: 400', async () => {
      await request(app.getHttpServer()).post('/users/import/preview').set('Authorization', `Bearer ${orgA.adminToken}`).expect(400);
      await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,'), 'x.csv', 'inny').expect(400);
    });
  });

  // ---- odczyt, wiersze, anulowanie ---------------------------------------------------------------------------------

  describe('odczyt partii, wiersze i anulowanie', () => {
    it('GET :id zwraca podsumowanie; wiersze z filtrem statusu i stronicowaniem; nieprawidłowe parametry to 400', async () => {
      const preview = await upload(orgA.adminToken, csv(HEADER, ...Array.from({ length: 7 }, (_v, i) => `u${i}@firma.pl,Anna,Nowak,`), 'zly,Jan,Kowalski,')).expect(201);

      const summary = await get(orgA.adminToken, `/users/import/${preview.body.id}`).expect(200);
      const page = await get(orgA.adminToken, `/users/import/${preview.body.id}/rows?status=VALID&page=2&pageSize=3`).expect(200);

      expect(summary.body).toMatchObject({ id: preview.body.id, totalRows: 8, validCount: 7, errorCount: 1 });
      expect(page.body).toMatchObject({ total: 7, page: 2, pageSize: 3 });
      expect(page.body.items.map((row: { line: number }) => row.line)).toEqual([5, 6, 7]);
      await get(orgA.adminToken, `/users/import/${preview.body.id}/rows?status=INNY`).expect(400);
      await get(orgA.adminToken, `/users/import/${preview.body.id}/rows?pageSize=101`).expect(400);
      await get(orgA.adminToken, `/users/import/${preview.body.id}/rows?page=0`).expect(400);
      await get(orgA.adminToken, '/users/import/a%2Fb').expect(400);
      await get(orgA.adminToken, '/users/import/nieistniejace').expect(404);
    });

    it('anulowanie: DELETE 204 usuwa partię i jej wiersze; potem 404 (także drugie anulowanie)', async () => {
      const preview = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);

      await request(app.getHttpServer()).delete(`/users/import/${preview.body.id}`).set('Authorization', `Bearer ${orgA.adminToken}`).expect(204);

      expect(await batchCount(orgA)).toBe(0);
      expect(await rowCount(orgA)).toBe(0);
      await get(orgA.adminToken, `/users/import/${preview.body.id}`).expect(404);
      await request(app.getHttpServer()).delete(`/users/import/${preview.body.id}`).set('Authorization', `Bearer ${orgA.adminToken}`).expect(404);
    });
  });

  // ---- wygasanie i sprzątanie --------------------------------------------------------------------------------------

  describe('wygasanie podglądu (24 h) i sprzątanie', () => {
    it('podgląd ma ważność 24 h; wygasły jest "nieistniejący" (404) jeszcze przed sprzątaniem', async () => {
      const preview = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);
      expect(new Date(preview.body.expiresAt).getTime() - new Date(preview.body.createdAt).getTime()).toBe(PREVIEW_TTL_MS);

      await owner.userImportBatch.update({ where: { id: preview.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

      await get(orgA.adminToken, `/users/import/${preview.body.id}`).expect(404);
      await get(orgA.adminToken, `/users/import/${preview.body.id}/rows`).expect(404);
    });

    it('job sprzątania kasuje TYLKO wygasłe partie (razem z wierszami), we wszystkich organizacjach, i jest idempotentny', async () => {
      const a = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);
      const b = await upload(orgB.adminToken, csv(HEADER, 'b@firma.pl,Jan,Kowalski,')).expect(201);
      await owner.userImportBatch.update({ where: { id: a.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

      const first = await retention.run(new Date());
      const second = await retention.run(new Date());

      expect(first.failed).toBe(0);
      expect(first.deleted).toBeGreaterThanOrEqual(1);
      expect(second.deleted).toBe(0);
      expect(await batchCount(orgA)).toBe(0);
      expect(await rowCount(orgA)).toBe(0);
      expect(await batchCount(orgB)).toBe(1); // świeży podgląd B nietknięty
      await get(orgB.adminToken, `/users/import/${b.body.id}`).expect(200);
    });
  });

  // ---- role i uprawnienia ------------------------------------------------------------------------------------------

  describe('uprawnienia', () => {
    it('401 bez tokenu; pracownik i kierownik działu dostają 403 na każdym endpoincie importu', async () => {
      const preview = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);
      await request(app.getHttpServer()).post('/users/import/preview').expect(401);
      await request(app.getHttpServer()).get(`/users/import/${preview.body.id}`).expect(401);

      for (const token of [employeeToken, managerToken]) {
        clearThrottle(); // limit 3/min na podgląd nie jest tu przedmiotem testu
        await upload(token, csv(HEADER, 'x@firma.pl,Anna,Nowak,')).expect(403);
        await get(token, `/users/import/${preview.body.id}`).expect(403);
        await get(token, `/users/import/${preview.body.id}/rows`).expect(403);
        await request(app.getHttpServer()).delete(`/users/import/${preview.body.id}`).set('Authorization', `Bearer ${token}`).expect(403);
      }
      expect(await batchCount(orgA)).toBe(1); // nic nie zostało zastąpione ani usunięte
    });

    it('rola i status czytane z BAZY: zdegradowany albo dezaktywowany admin traci dostęp od razu, mimo ważnego tokenu', async () => {
      const extraToken = await addUser(orgA, 'extra-added-admin', 'ORG_ADMIN');
      await upload(extraToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);
      const extra = await tenantPrisma.runAuthLookup({ email: email('extra-added-admin') });

      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: extra!.id }, data: { role: 'EMPLOYEE' } }));
      clearThrottle();
      await upload(extraToken, csv(HEADER, 'b@firma.pl,Anna,Nowak,')).expect(403);
      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.update({ where: { id: extra!.id }, data: { role: 'ORG_ADMIN', status: 'INVITED' } }));
      clearThrottle();
      await upload(extraToken, csv(HEADER, 'b@firma.pl,Anna,Nowak,')).expect(403);
    });

    it('organizacja niezweryfikowana (PENDING) dostaje 403 (fail-closed)', async () => {
      const pending = await registerVerified(app, tenantPrisma, { email: email('pending'), password: DEFAULT_TEST_PASSWORD }, { activateOrganization: false });

      await upload(pending.body.accessToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(403);
    });

    it('limit żądań: czwarty podgląd w minucie dostaje 429', async () => {
      for (let i = 0; i < 3; i += 1) {
        await upload(orgA.adminToken, csv(HEADER, `r${i}@firma.pl,Anna,Nowak,`)).expect(201);
      }

      await upload(orgA.adminToken, csv(HEADER, 'r9@firma.pl,Anna,Nowak,')).expect(429);
    });
  });

  // ---- izolacja organizacji ----------------------------------------------------------------------------------------

  describe('izolacja organizacji (Zasada nr 1)', () => {
    it('admin B nie widzi, nie czyta wierszy i nie anuluje podglądu A (404); podgląd A pozostaje nietknięty', async () => {
      const a = await upload(orgA.adminToken, csv(HEADER, 'tajny@firma.pl,Anna,Nowak,')).expect(201);
      await upload(orgB.adminToken, csv(HEADER, 'b@firma.pl,Jan,Kowalski,')).expect(201);

      await get(orgB.adminToken, `/users/import/${a.body.id}`).expect(404);
      await get(orgB.adminToken, `/users/import/${a.body.id}/rows`).expect(404);
      await request(app.getHttpServer()).delete(`/users/import/${a.body.id}`).set('Authorization', `Bearer ${orgB.adminToken}`).expect(404);

      expect((await get(orgA.adminToken, `/users/import/${a.body.id}/rows`).expect(200)).body.items).toHaveLength(1);
      expect(await batchCount(orgB)).toBe(1); // podgląd B nie został zastąpiony ani usunięty przez działania A
    });

    it('podgląd A nie zastępuje podglądu B (jedna partia PER ORGANIZACJA)', async () => {
      await upload(orgB.adminToken, csv(HEADER, 'b@firma.pl,Jan,Kowalski,')).expect(201);

      await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);

      expect(await batchCount(orgB)).toBe(1);
      expect(await batchCount(orgA)).toBe(1);
    });

    it('RLS: partie i wiersze jednej organizacji są niewidoczne w kontekście drugiej (także bez filtra organizationId)', async () => {
      await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);

      const seenByB = await tenantPrisma.runInOrgContext(orgB.organizationId, async (tx) => ({
        batches: await tx.userImportBatch.findMany({ select: { id: true } }),
        rows: await tx.userImportRow.findMany({ select: { id: true } }),
      }));

      expect(seenByB).toEqual({ batches: [], rows: [] });
    });

    it('złożone FK i RLS: nie da się dopisać wiersza do partii innej organizacji ani wstawić partii w cudzej organizacji', async () => {
      const a = await upload(orgA.adminToken, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);

      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) =>
          tx.userImportRow.create({ data: { organizationId: orgB.organizationId, batchId: a.body.id, line: 99, email: 'x@firma.pl', firstName: 'X', lastName: 'Y', status: 'VALID' } }),
        ),
      ).rejects.toThrow();
      await expect(
        tenantPrisma.runInOrgContext(orgB.organizationId, (tx) =>
          tx.userImportBatch.create({ data: { organizationId: orgA.organizationId, createdByEmail: 'x@firma.pl', delimiter: ',', totalRows: 0, validCount: 0, existingCount: 0, errorCount: 0, skippedEmpty: 0, ignoredColumns: [], expiresAt: new Date() } }),
        ),
      ).rejects.toThrow();
    });
  });

  // ---- gwarancje bazy ----------------------------------------------------------------------------------------------

  describe('gwarancje bazy danych', () => {
    it('CHECK: liczniki partii muszą się zgadzać i nie przekroczą 5000; wiersz z błędem wymaga powodu', async () => {
      const create = (data: Record<string, unknown>) =>
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
          tx.userImportBatch.create({
            data: { organizationId: orgA.organizationId, createdByEmail: 'x@firma.pl', delimiter: ',', ignoredColumns: [], expiresAt: new Date(), skippedEmpty: 0, ...data } as never,
          }),
        );

      await expect(create({ totalRows: 3, validCount: 1, existingCount: 1, errorCount: 0 })).rejects.toThrow(); // 1+1+0 != 3
      await expect(create({ totalRows: 5001, validCount: 5001, existingCount: 0, errorCount: 0 })).rejects.toThrow(); // ponad limit
      await expect(create({ totalRows: -1, validCount: 0, existingCount: 0, errorCount: -1 })).rejects.toThrow();
      const ok = await create({ totalRows: 2, validCount: 1, existingCount: 0, errorCount: 1 });
      await expect(
        tenantPrisma.runInOrgContext(orgA.organizationId, (tx) =>
          tx.userImportRow.create({ data: { organizationId: orgA.organizationId, batchId: ok.id, line: 2, email: 'x@firma.pl', firstName: 'X', lastName: 'Y', status: 'ERROR', reason: null } }),
        ),
      ).rejects.toThrow();
    });

    it('usunięcie konta autora zeruje createdByUserId, a partia i kopia e-maila zostają', async () => {
      const token = await addUser(orgA, 'autor-added-admin', 'ORG_ADMIN');
      const preview = await upload(token, csv(HEADER, 'a@firma.pl,Anna,Nowak,')).expect(201);
      const author = await tenantPrisma.runAuthLookup({ email: email('autor-added-admin') });

      await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.user.delete({ where: { id: author!.id } }));

      const batch = await tenantPrisma.runInOrgContext(orgA.organizationId, (tx) => tx.userImportBatch.findFirstOrThrow({ where: { id: preview.body.id } }));
      expect(batch).toMatchObject({ createdByUserId: null, createdByEmail: email('autor-added-admin') });
    });
  });

  // ---- limit licencji przy pojedynczym zaproszeniu i starym imporcie -----------------------------------------------

  describe('limit licencji: pojedyncze zaproszenie i import jednoetapowy', () => {
    const invite = (token: string, address: string) =>
      request(app.getHttpServer()).post('/users/invite').set('Authorization', `Bearer ${token}`).send({ email: address, firstName: 'Jan', lastName: 'Kowalski', role: 'EMPLOYEE' });

    it('zaproszenie ponad limit: 409 SEAT_LIMIT z liczbą pozostałych miejsc i odsyłaczem do ustawień; konto nie powstaje, mail nie wychodzi', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used); // wyczerpany
      sendSpy.mockClear();

      const response = await invite(orgA.adminToken, email('odrzucony-added-1')).expect(409);

      expect(response.body).toMatchObject({ code: 'SEAT_LIMIT', seatsLimit: used, seatsUsed: used, seatsAvailable: 0, seatsRequired: 1, seatsMissing: 1, settingsPath: '/dashboard/settings' });
      expect(response.body.message).toMatch(new RegExp(`Wykorzystano ${used} z ${used} licencji, zostało miejsc: 0.*ustawieniach organizacji \\(/dashboard/settings\\)`));
      expect(await userCount(orgA)).toBe(used);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('ostatnie wolne miejsce da się zająć, następne zaproszenie jest odrzucone; komunikat pokazuje ile zostało', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used + 2);

      await invite(orgA.adminToken, email('pierwszy-added-1')).expect(201);
      const second = await invite(orgA.adminToken, email('drugi-added-1')).expect(201);
      const third = await invite(orgA.adminToken, email('trzeci-added-1')).expect(409);

      expect(second.body.email).toBe(email('drugi-added-1'));
      expect(third.body).toMatchObject({ code: 'SEAT_LIMIT', seatsAvailable: 0 });
    });

    it('RÓWNOLEGŁE zaproszenia przy jednym wolnym miejscu: dokładnie jedno konto powstaje', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used + 1);

      const responses = await Promise.allSettled(Array.from({ length: 5 }, (_v, i) => invite(orgA.adminToken, email(`rownolegle-added-${i}`))));

      const statuses = responses.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(4);
      expect(await userCount(orgA)).toBe(used + 1);
    });

    it('limit dotyczy organizacji: wyczerpany limit A nie blokuje B', async () => {
      await setSeats(orgA, await userCount(orgA));

      await invite(orgA.adminToken, email('blokada-added-1')).expect(409);
      await invite(orgB.adminToken, email('wolne-added-1')).expect(201);
    });

    it('stary import jednoetapowy respektuje limit: wiersze ponad limit trafiają do błędów "Brak wolnych licencji", pozostałe powstają', async () => {
      const used = await userCount(orgA);
      await setSeats(orgA, used + 1);

      const response = await request(app.getHttpServer())
        .post('/users/import-csv')
        .set('Authorization', `Bearer ${orgA.adminToken}`)
        .attach('file', Buffer.from(csv('email,firstName,lastName', `${email('imp-added-1')},Anna,Nowak`, `${email('imp-added-2')},Jan,Kowalski`)), { filename: 'x.csv', contentType: 'text/csv' })
        .expect(201);

      expect(response.body).toMatchObject({ successCount: 1, failedCount: 1 });
      expect(response.body.errors[0].reason).toBe('Brak wolnych licencji (limit planu)');
      expect(await userCount(orgA)).toBe(used + 1);
    });
  });
});
