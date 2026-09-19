import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { MAX_ORGANIZATION_TEMPLATES } from '../src/phishing/phishing-templates.service';
import { hasTrackingLink, sanitizeLessonHtml, sanitizeTemplateBody } from '../src/phishing/template-sanitizer';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DEFAULT_TEST_PASSWORD, registerVerified } from './helpers/auth';

const GLOBAL_KEYS = ['dyrektor-przelew', 'faktura', 'hr-urlopy', 'it-aktualizacja', 'kurier', 'reset-hasla'];

describe('Szablony symulacji phishingowych (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  const suffix = Date.now();
  const domainSuffix = 'phishing-templates-e2e.test';
  const email = (label: string) => `${label}-${suffix}@${label}.${domainSuffix}`;

  beforeAll(async () => {
    process.env.PHISHING_EMAIL_DOMAIN = 'symulacje.example.test';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    jest.spyOn(app.get(EmailService), 'send').mockResolvedValue(true);
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as unknown as { storage?: Map<string, unknown> };
    storage.storage?.clear();
  });

  afterAll(async () => {
    delete process.env.PHISHING_EMAIL_DOMAIN;
    await prisma.organization.deleteMany({ where: { name: { endsWith: domainSuffix } } });
    await app.close();
  });

  async function newAdmin(label: string) {
    const credentials = { email: email(label), password: DEFAULT_TEST_PASSWORD };
    const { body } = await registerVerified(app, tenantPrisma, credentials);
    const user = await tenantPrisma.runAuthLookup({ email: credentials.email });
    return { token: body.accessToken as string, organizationId: user!.organizationId, userId: user!.id, email: credentials.email };
  }

  async function newUserWithRole(organizationId: string, label: string, role: 'EMPLOYEE' | 'DEPARTMENT_MANAGER') {
    const userEmail = email(label);
    await tenantPrisma.runInOrgContext(organizationId, async (tx) =>
      tx.user.create({
        data: {
          organizationId,
          email: userEmail,
          passwordHash: await bcrypt.hash(DEFAULT_TEST_PASSWORD, 4),
          role,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      }),
    );
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: userEmail, password: DEFAULT_TEST_PASSWORD }).expect(200);
    return login.body.accessToken as string;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(app.getHttpServer()).get(path).set(auth(token));
  const post = (token: string, path: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set(auth(token)).send(body as object);
  const patch = (token: string, path: string, body: unknown) => request(app.getHttpServer()).patch(path).set(auth(token)).send(body as object);
  const remove = (token: string, path: string) => request(app.getHttpServer()).delete(path).set(auth(token));

  async function cloneOf(token: string, key = 'kurier', name?: string) {
    const list = await get(token, '/phishing/templates').expect(200);
    const source = list.body.find((t: { key: string }) => t.key === key);
    const response = await post(token, `/phishing/templates/${source.id}/clone`, name ? { name } : {}).expect(201);
    return response.body as { id: string; name: string; sourceTemplateId: string; scope: string; bodyHtml: string };
  }

  describe('szablony globalne (startowe)', () => {
    it('jest dokładnie 6 szablonów startowych o znanych kluczach', async () => {
      const globals = await prisma.phishingTemplate.findMany({ where: { organizationId: null } });

      expect(globals.map((t) => t.key).sort()).toEqual(GLOBAL_KEYS);
    });

    it('każdy ma link {{trackingLink}} i treść, którą sanitizer zostawia BEZ ZMIAN (seed przechodzi przez tę samą sanityzację co edycje)', async () => {
      const globals = await prisma.phishingTemplate.findMany({ where: { organizationId: null } });

      for (const template of globals) {
        expect(hasTrackingLink(template.bodyHtml)).toBe(true);
        // Jedyna różnica serializacji to <br> vs <br /> - poza tym treść przechodzi bez zmian.
        const unify = (html: string) => html.replace(/<br \/>/g, '<br>');
        expect(unify(sanitizeTemplateBody(template.bodyHtml))).toBe(unify(template.bodyHtml));
        expect(unify(sanitizeLessonHtml(template.lessonHtml))).toBe(unify(template.lessonHtml));
        expect(template.bodyHtml).not.toMatch(/https?:|<img|<script/i);
        expect(template.senderLocalPart).toMatch(/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/);
      }
    });
  });

  describe('dostęp i role', () => {
    it('bez tokenu 401; EMPLOYEE i DEPARTMENT_MANAGER dostają 403 na każdej trasie modułu', async () => {
      const admin = await newAdmin('roles');
      const employee = await newUserWithRole(admin.organizationId, 'roles-emp', 'EMPLOYEE');
      const manager = await newUserWithRole(admin.organizationId, 'roles-mgr', 'DEPARTMENT_MANAGER');
      const own = await cloneOf(admin.token);

      await request(app.getHttpServer()).get('/phishing/templates').expect(401);
      for (const token of [employee, manager]) {
        await get(token, '/phishing/templates').expect(403);
        await get(token, `/phishing/templates/${own.id}`).expect(403);
        await post(token, `/phishing/templates/${own.id}/clone`).expect(403);
        await patch(token, `/phishing/templates/${own.id}`, { name: 'x' }).expect(403);
        await remove(token, `/phishing/templates/${own.id}`).expect(403);
        await post(token, '/phishing/templates/preview', { bodyHtml: '<p>x</p>' }).expect(403);
        await get(token, '/phishing/templates/edits').expect(403);
      }
    });
  });

  describe('lista i klonowanie', () => {
    it('lista: globalne (pierwsze) + własne organizacji; szablony innej organizacji są niewidoczne', async () => {
      const a = await newAdmin('list-a');
      const b = await newAdmin('list-b');
      const cloneA = await cloneOf(a.token, 'faktura', 'Faktura A (tajna)');

      const listA = await get(a.token, '/phishing/templates').expect(200);
      const listB = await get(b.token, '/phishing/templates').expect(200);

      expect(listA.body.filter((t: { scope: string }) => t.scope === 'GLOBAL')).toHaveLength(6);
      expect(listA.body.map((t: { id: string }) => t.id)).toContain(cloneA.id);
      expect(listA.body.slice(0, 6).every((t: { scope: string }) => t.scope === 'GLOBAL')).toBe(true);
      expect(listB.body.map((t: { id: string }) => t.id)).not.toContain(cloneA.id);
      expect(JSON.stringify(listB.body)).not.toContain('Faktura A (tajna)');
      await get(b.token, `/phishing/templates/${cloneA.id}`).expect(404);
    });

    it('klon: własny wiersz z sourceTemplateId, adres nadawcy z PHISHING_EMAIL_DOMAIN, audyt CLONED z e-mailem aktora', async () => {
      const admin = await newAdmin('clone');

      const clone = await cloneOf(admin.token, 'kurier');

      const detail = await get(admin.token, `/phishing/templates/${clone.id}`).expect(200);
      expect(detail.body).toMatchObject({
        scope: 'ORGANIZATION',
        key: null,
        name: 'Przesyłka kurierska - niedoręczona paczka (kopia)',
        senderLocalPart: 'powiadomienia',
        senderAddress: 'powiadomienia@symulacje.example.test',
      });
      expect(clone.sourceTemplateId).toBe('phishtpl_kurier');
      const edits = await get(admin.token, '/phishing/templates/edits').expect(200);
      expect(edits.body).toEqual([
        expect.objectContaining({ templateId: clone.id, action: 'CLONED', actorEmail: admin.email, changedFields: [] }),
      ]);
    });

    it('można sklonować także własny szablon; limit własnych szablonów => 409', async () => {
      const admin = await newAdmin('limit');
      const first = await cloneOf(admin.token);
      await post(admin.token, `/phishing/templates/${first.id}/clone`, { name: 'Druga kopia' }).expect(201);
      await tenantPrisma.runInOrgContext(admin.organizationId, (tx) =>
        tx.phishingTemplate.createMany({
          data: Array.from({ length: MAX_ORGANIZATION_TEMPLATES }, (_v, i) => ({
            organizationId: admin.organizationId,
            name: `Wypełniacz ${i}`,
            subject: 'Temat testowy',
            bodyHtml: '<a href="{{trackingLink}}">x</a>',
            lessonHtml: '<p>Lekcja testowa</p>',
            senderName: 'Test',
            senderLocalPart: 'test',
          })),
        }),
      );

      const blocked = await post(admin.token, `/phishing/templates/${first.id}/clone`, { name: 'Ponad limit' });

      expect([blocked.status, blocked.body.code]).toEqual([409, 'TEMPLATE_LIMIT_REACHED']);
    });
  });

  describe('edycja', () => {
    it('treść jest SANITYZOWANA przy zapisie: skrypty i obce linki znikają, jedyny link to {{trackingLink}}', async () => {
      const admin = await newAdmin('sanitize');
      const clone = await cloneOf(admin.token);

      const response = await patch(admin.token, `/phishing/templates/${clone.id}`, {
        bodyHtml:
          '<p>Witaj</p><script>alert(1)</script><img src="https://evil.example.com/p.gif"><a href="https://evil.example.com">obcy</a><a href="{{trackingLink}}" onclick="x()">dobry</a>',
        lessonHtml: '<p>Lekcja</p><a href="{{trackingLink}}">link</a><iframe src="x"></iframe>',
      }).expect(200);

      expect(response.body.bodyHtml).toBe('<p>Witaj</p><span>obcy</span><a href="{{trackingLink}}">dobry</a>');
      expect(response.body.lessonHtml).toBe('<p>Lekcja</p><span>link</span>');
    });

    it('treść bez linku {{trackingLink}} (np. sam obcy link) => 400 TEMPLATE_MISSING_TRACKING_LINK, nic nie zapisane', async () => {
      const admin = await newAdmin('nolink');
      const clone = await cloneOf(admin.token);

      const response = await patch(admin.token, `/phishing/templates/${clone.id}`, { bodyHtml: '<p>Kliknij <a href="https://evil.example.com">tutaj</a> teraz</p>' });

      expect([response.status, response.body.code]).toEqual([400, 'TEMPLATE_MISSING_TRACKING_LINK']);
      expect((await get(admin.token, `/phishing/templates/${clone.id}`)).body.bodyHtml).toBe(clone.bodyHtml);
    });

    it('audyt: zmiana zapisuje kto (e-mail), kiedy i JAKIE pola (nazwy bez wartości); ta sama treść nie tworzy wpisu', async () => {
      const admin = await newAdmin('audit');
      const clone = await cloneOf(admin.token);

      await patch(admin.token, `/phishing/templates/${clone.id}`, { subject: 'Nowy temat wiadomości', senderName: 'Nowy Nadawca' }).expect(200);
      await patch(admin.token, `/phishing/templates/${clone.id}`, { subject: 'Nowy temat wiadomości' }).expect(200);

      const edits = await get(admin.token, `/phishing/templates/edits?templateId=${clone.id}`).expect(200);
      const updates = edits.body.filter((e: { action: string }) => e.action === 'UPDATED');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ actorEmail: admin.email, changedFields: expect.arrayContaining(['subject', 'senderName']) });
      expect(JSON.stringify(updates[0])).not.toContain('Nowy temat wiadomości');
      expect(new Date(updates[0].createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it.each([
      ['część lokalna z wielkimi literami', { senderLocalPart: 'HR' }],
      ['część lokalna ze znakiem @ (próba podania własnej domeny)', { senderLocalPart: 'hr@evil.example.com' }],
      ['część lokalna z podwójną kropką', { senderLocalPart: 'a..b' }],
      ['część lokalna za długa', { senderLocalPart: 'a'.repeat(65) }],
      ['temat z nową linią (wstrzyknięcie nagłówka)', { subject: 'Temat\r\nBcc: ofiara@example.com' }],
      ['nazwa nadawcy z nawiasami kątowymi', { senderName: 'Ktoś <ceo@evil.example.com>' }],
      ['pole domeny nadawcy (nieedytowalna)', { senderDomain: 'evil.example.com' }],
      ['próba zmiany organizacji', { organizationId: 'inna' }],
      ['próba zmiany klucza globalnego', { key: 'kurier' }],
      ['treść za krótka', { bodyHtml: 'x' }],
    ])('walidacja: %s => 400', async (_label, body) => {
      const admin = await newAdmin(`valid-${Math.random().toString(36).slice(2, 8)}`);
      const clone = await cloneOf(admin.token);

      await patch(admin.token, `/phishing/templates/${clone.id}`, body).expect(400);
    });

    it('szablon globalny: edycja i usunięcie => 403 GLOBAL_TEMPLATE_READONLY; cudzy szablon => 404', async () => {
      const a = await newAdmin('ro-a');
      const b = await newAdmin('ro-b');
      const cloneA = await cloneOf(a.token);

      const editGlobal = await patch(a.token, '/phishing/templates/phishtpl_kurier', { name: 'Zmieniony' });
      const deleteGlobal = await remove(a.token, '/phishing/templates/phishtpl_kurier');

      expect([editGlobal.status, editGlobal.body.code]).toEqual([403, 'GLOBAL_TEMPLATE_READONLY']);
      expect([deleteGlobal.status, deleteGlobal.body.code]).toEqual([403, 'GLOBAL_TEMPLATE_READONLY']);
      await patch(b.token, `/phishing/templates/${cloneA.id}`, { name: 'Przejęty' }).expect(404);
      await remove(b.token, `/phishing/templates/${cloneA.id}`).expect(404);
      await post(b.token, `/phishing/templates/${cloneA.id}/clone`).expect(404);
      const stillThere = await prisma.phishingTemplate.findUniqueOrThrow({ where: { key: 'kurier' } });
      expect(stillThere.name).toBe('Przesyłka kurierska - niedoręczona paczka');
    });

    it('nieprawidłowy identyfikator w ścieżce i w filtrze templateId => 400', async () => {
      const admin = await newAdmin('badid');

      await get(admin.token, `/phishing/templates/${'a'.repeat(70)}`).expect(400);
      await get(admin.token, '/phishing/templates/a%20b').expect(400);
      await get(admin.token, '/phishing/templates/edits?templateId=../users').expect(400);
      await get(admin.token, '/phishing/templates/edits').expect(200);
    });

    it('klon jest sanityzowany także wtedy, gdy źródłowa treść (np. własny szablon z bazy) zawiera niedozwolone znaczniki', async () => {
      const admin = await newAdmin('clone-sanitize');
      const dirty = await tenantPrisma.runInOrgContext(admin.organizationId, (tx) =>
        tx.phishingTemplate.create({
          data: {
            organizationId: admin.organizationId,
            name: 'Brudny',
            subject: 'Temat testowy',
            bodyHtml: '<p>x</p><script>alert(1)</script><a href="https://evil.example.com">y</a><a href="{{trackingLink}}">z</a>',
            lessonHtml: '<p>l</p><img src="x">',
            senderName: 'T',
            senderLocalPart: 'test',
          },
        }),
      );

      const clone = await post(admin.token, `/phishing/templates/${dirty.id}/clone`).expect(201);

      expect(clone.body.bodyHtml).toBe('<p>x</p><span>y</span><a href="{{trackingLink}}">z</a>');
      expect(clone.body.lessonHtml).toBe('<p>l</p>');
    });

    it('treść z tekstem udającym link (href="{{trackingLink}}" jako zwykły tekst) => 400 TEMPLATE_MISSING_TRACKING_LINK', async () => {
      const admin = await newAdmin('fakelink');
      const clone = await cloneOf(admin.token);

      const response = await patch(admin.token, `/phishing/templates/${clone.id}`, { bodyHtml: '<p>href="{{trackingLink}}" i nic więcej</p>' });

      expect([response.status, response.body.code]).toEqual([400, 'TEMPLATE_MISSING_TRACKING_LINK']);
    });
  });

  describe('usuwanie', () => {
    it('własny szablon: 204; audyt DELETED zostaje z nazwą i e-mailem aktora, a templateId jest zerowany', async () => {
      const admin = await newAdmin('delete');
      const clone = await cloneOf(admin.token, 'hr-urlopy', 'Do usunięcia');

      await remove(admin.token, `/phishing/templates/${clone.id}`).expect(204);

      await get(admin.token, `/phishing/templates/${clone.id}`).expect(404);
      const edits = await get(admin.token, '/phishing/templates/edits').expect(200);
      const deleted = edits.body.find((e: { action: string }) => e.action === 'DELETED');
      expect(deleted).toMatchObject({ templateId: null, templateName: 'Do usunięcia', actorEmail: admin.email });
      // Wcześniejszy wpis CLONED przeżył usunięcie szablonu, ale już bez powiązania z nim.
      expect(edits.body.find((e: { action: string }) => e.action === 'CLONED')).toMatchObject({ templateId: null, templateName: 'Do usunięcia' });
    });
  });

  describe('podgląd sanityzacji', () => {
    it('zwraca to, co zostanie po zapisie, i informację o linku; nic nie zapisuje', async () => {
      const admin = await newAdmin('preview');

      const response = await post(admin.token, '/phishing/templates/preview', {
        bodyHtml: '<p>x</p><script>1</script><a href="https://evil.example.com">x</a>',
        lessonHtml: '<p>Lekcja</p><img src="x">',
      }).expect(200);

      expect(response.body).toEqual({ bodyHtml: '<p>x</p><span>x</span>', lessonHtml: '<p>Lekcja</p>', hasTrackingLink: false });
    });
  });

  describe('RLS na poziomie bazy (rola aplikacji, kontekst organizacji)', () => {
    it('DELETE i UPDATE szablonu GLOBALNEGO w kontekście organizacji dotykają 0 wierszy', async () => {
      const admin = await newAdmin('rls-global');

      const result = await tenantPrisma.runInOrgContext(admin.organizationId, async (tx) => ({
        deleted: await tx.phishingTemplate.deleteMany({ where: { organizationId: null } }),
        updated: await tx.phishingTemplate.updateMany({ where: { organizationId: null }, data: { name: 'Zhakowany' } }),
        updatedByKey: await tx.phishingTemplate.updateMany({ where: { key: 'kurier' }, data: { subject: 'Zhakowany' } }),
      }));

      expect(result.deleted.count).toBe(0);
      expect(result.updated.count).toBe(0);
      expect(result.updatedByKey.count).toBe(0);
      const globals = await prisma.phishingTemplate.findMany({ where: { organizationId: null } });
      expect(globals).toHaveLength(6);
      expect(globals.some((t) => t.name === 'Zhakowany' || t.subject === 'Zhakowany')).toBe(false);
    });

    it('nie da się wstawić szablonu globalnego (organizationId NULL) ani cudzej organizacji, także w kontekście własnej', async () => {
      const a = await newAdmin('rls-ins-a');
      const b = await newAdmin('rls-ins-b');
      const base = { name: 'X szablon', subject: 'Temat testowy', bodyHtml: '<a href="{{trackingLink}}">x</a>', lessonHtml: '<p>Lekcja</p>', senderName: 'T', senderLocalPart: 'test' };

      await expect(tenantPrisma.runInOrgContext(a.organizationId, (tx) => tx.phishingTemplate.create({ data: { ...base, key: `hack-${suffix}` } }))).rejects.toThrow();
      await expect(tenantPrisma.runInOrgContext(a.organizationId, (tx) => tx.phishingTemplate.create({ data: { ...base, organizationId: b.organizationId } }))).rejects.toThrow();
    });

    it('izolacja: organizacja A nie widzi, nie zmienia i nie usuwa szablonów B; bez kontekstu widać tylko globalne', async () => {
      const a = await newAdmin('rls-iso-a');
      const b = await newAdmin('rls-iso-b');
      const cloneB = await cloneOf(b.token, 'faktura', 'Szablon B');

      const seenByA = await tenantPrisma.runInOrgContext(a.organizationId, async (tx) => ({
        list: await tx.phishingTemplate.findMany({ where: { id: cloneB.id } }),
        updated: await tx.phishingTemplate.updateMany({ where: { id: cloneB.id }, data: { name: 'Przejęty' } }),
        deleted: await tx.phishingTemplate.deleteMany({ where: { id: cloneB.id } }),
        edits: await tx.phishingTemplateEdit.findMany({ where: { templateId: cloneB.id } }),
      }));
      const noContext = await prisma.phishingTemplate.findMany();

      expect(seenByA.list).toHaveLength(0);
      expect(seenByA.updated.count + seenByA.deleted.count).toBe(0);
      expect(seenByA.edits).toHaveLength(0);
      expect(noContext.every((t) => t.organizationId === null)).toBe(true);
      expect((await get(b.token, `/phishing/templates/${cloneB.id}`)).body.name).toBe('Szablon B');
    });

    it('audyt jest append-only dla roli aplikacji: UPDATE i DELETE wierszy audytu są odrzucone (brak uprawnień)', async () => {
      const admin = await newAdmin('append-only');
      await cloneOf(admin.token);

      await expect(
        tenantPrisma.runInOrgContext(admin.organizationId, (tx) => tx.phishingTemplateEdit.updateMany({ where: {}, data: { actorEmail: 'x@x.test' } })),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        tenantPrisma.runInOrgContext(admin.organizationId, (tx) => tx.phishingTemplateEdit.deleteMany({ where: {} })),
      ).rejects.toThrow(/permission denied/i);
      expect(await tenantPrisma.runInOrgContext(admin.organizationId, (tx) => tx.phishingTemplateEdit.count())).toBe(1);
    });

    it('audyt: złożone FK pilnuje tej samej organizacji dla szablonu i aktora', async () => {
      const a = await newAdmin('fk-a');
      const b = await newAdmin('fk-b');
      const cloneB = await cloneOf(b.token);
      const editBase = { organizationId: a.organizationId, templateName: 'x', action: 'UPDATED' as const, changedFields: [], actorEmail: a.email };

      await expect(
        tenantPrisma.runInOrgContext(a.organizationId, (tx) => tx.phishingTemplateEdit.create({ data: { ...editBase, templateId: cloneB.id } })),
      ).rejects.toThrow();
      await expect(
        tenantPrisma.runInOrgContext(a.organizationId, (tx) => tx.phishingTemplateEdit.create({ data: { ...editBase, actorUserId: b.userId } })),
      ).rejects.toThrow();
    });

    it('usunięcie pracownika zeruje aktora w audycie, ale wpis i e-mail (kopia) zostają; usunięcie organizacji kasuje wszystko', async () => {
      const admin = await newAdmin('actor-delete');
      const second = await newAdmin('actor-delete-2');
      const clone = await cloneOf(admin.token);
      // Dodatkowy użytkownik jako aktor wpisu.
      const actor = await tenantPrisma.runInOrgContext(admin.organizationId, (tx) =>
        tx.user.create({ data: { organizationId: admin.organizationId, email: email('actor-x'), passwordHash: 'x', role: 'ORG_ADMIN', status: 'ACTIVE' } }),
      );
      await tenantPrisma.runInOrgContext(admin.organizationId, (tx) =>
        tx.phishingTemplateEdit.create({
          data: { organizationId: admin.organizationId, templateId: clone.id, templateName: 'x', action: 'UPDATED', changedFields: ['subject'], actorUserId: actor.id, actorEmail: actor.email },
        }),
      );

      await tenantPrisma.runInOrgContext(admin.organizationId, (tx) => tx.user.delete({ where: { id: actor.id } }));

      const edit = await tenantPrisma.runInOrgContext(admin.organizationId, (tx) => tx.phishingTemplateEdit.findFirstOrThrow({ where: { actorEmail: actor.email } }));
      expect(edit).toMatchObject({ actorUserId: null, actorEmail: actor.email, templateId: clone.id });
      await prisma.organization.delete({ where: { id: admin.organizationId } });
      const remaining = await tenantPrisma.runCrossOrgQuery(async (tx) => ({
        templates: await tx.phishingTemplate.count({ where: { organizationId: admin.organizationId } }),
        edits: await tx.phishingTemplateEdit.count({ where: { organizationId: admin.organizationId } }),
      }));
      expect(remaining).toEqual({ templates: 0, edits: 0 });
      void second;
    });
  });
});
