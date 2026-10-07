import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { bilingualModule, fullModule, simpleModule } from '@cyberszkolo/content/dist/fixtures';
import { hashContent, parseModule } from '@cyberszkolo/content/dist/node';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { importModule } from '../src/scripts/content-import';

// Zapis content-import na PRAWDZIWYM Postgresie (logika samego zapisu bez bazy - szpieg Prisma - jest w
// content-import.spec.ts, jednostkowe). `courses`/`course_versions` są GLOBALNE, bez organizationId i bez RLS (jak
// `badges`), więc nie dotyczy ich test izolacji tenantów A/B (CLAUDE.md, reguła 3) - to świadome pominięcie, nie luka.
describe('content-import: importModule (e2e, prawdziwy Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = `content-import-e2e-${Date.now()}`;
  const slug = (label: string) => `${suffix}-${label}`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // CourseVersion kasuje się kaskadowo z Course (schema.prisma: onDelete Cascade) - żadnych przypisań w tym teście.
    await prisma.course.deleteMany({ where: { slug: { startsWith: suffix } } });
    await app.close();
  });

  function moduleFixture(label: string, overrides: Record<string, unknown> = {}) {
    return parseModule({ ...fullModule(), slug: slug(label), ...overrides });
  }

  it('nowy kurs: tworzy Course i wersję 1 z treścią modułu', async () => {
    const content = moduleFixture('nowy');

    const result = await prisma.$transaction((tx) => importModule(tx, content));

    expect(result).toMatchObject({ slug: slug('nowy'), courseCreated: true, versionCreated: true, version: 1 });
    const course = await prisma.course.findUniqueOrThrow({ where: { id: result.courseId } });
    expect(course).toMatchObject({ slug: slug('nowy'), title: content.title, category: content.category, mandatory: content.mandatory });
    const versions = await prisma.courseVersion.findMany({ where: { courseId: result.courseId } });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, schemaVersion: 5, contentHash: hashContent(content.blocks), blockCount: content.blocks.length });
  });

  it('miniatura modułu (D-084) trafia do Course.thumbnail; moduł bez miniatury czyści ją (null)', async () => {
    const withThumbnail = moduleFixture('miniatura', { thumbnail: 'assets/x/miniatura.1a2b3c4d.svg' });
    const result = await prisma.$transaction((tx) => importModule(tx, withThumbnail));
    expect((await prisma.course.findUniqueOrThrow({ where: { id: result.courseId } })).thumbnail).toBe('assets/x/miniatura.1a2b3c4d.svg');

    await prisma.$transaction((tx) => importModule(tx, moduleFixture('miniatura')));
    expect((await prisma.course.findUniqueOrThrow({ where: { id: result.courseId } })).thumbnail).toBeNull();
  });

  it('ponowny import identycznej treści jest idempotentny: bez nowej wersji', async () => {
    const content = moduleFixture('idempotentny');
    const first = await prisma.$transaction((tx) => importModule(tx, content));

    const second = await prisma.$transaction((tx) => importModule(tx, content));

    expect(second).toMatchObject({ courseId: first.courseId, courseCreated: false, versionCreated: false });
    const versions = await prisma.courseVersion.count({ where: { courseId: first.courseId } });
    expect(versions).toBe(1);
  });

  it('zmieniona treść tworzy nową wersję i odświeża kopię w Course', async () => {
    const content = moduleFixture('zmiana');
    const first = await prisma.$transaction((tx) => importModule(tx, content));

    // contentHash (i decyzja o nowej wersji) liczy się WYŁĄCZNIE z `blocks` (jak CourseVersion.contentHash gdzie indziej
    // w kodzie) - samo `durationMinutes` (metadane Course, nie treść wersji) nie tworzy nowej wersji, więc zmieniamy oba.
    const changed = moduleFixture('zmiana', {
      durationMinutes: content.durationMinutes + 5,
      blocks: content.blocks.map((block, index) => (index === 0 ? { ...block, text: `${(block as { text: string }).text} (zmienione)` } : block)),
    });
    const second = await prisma.$transaction((tx) => importModule(tx, changed));

    expect(second).toMatchObject({ courseId: first.courseId, courseCreated: false, versionCreated: true, version: 2 });
    const versions = await prisma.courseVersion.findMany({ where: { courseId: first.courseId }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const course = await prisma.course.findUniqueOrThrow({ where: { id: first.courseId } });
    expect(course.durationMinutes).toBe(content.durationMinutes + 5);
  });

  it('tryb prosty (D-132): wersja z simpleMode; włączenie go przy tej samej treści tworzy nową wersję', async () => {
    const plain = parseModule({ ...simpleModule(), slug: slug('prosty'), simpleMode: undefined });
    const first = await prisma.$transaction((tx) => importModule(tx, plain));
    const simple = parseModule({ ...simpleModule(), slug: slug('prosty') });
    const second = await prisma.$transaction((tx) => importModule(tx, simple));

    expect(second).toMatchObject({ courseId: first.courseId, versionCreated: true, version: 2 });
    const versions = await prisma.courseVersion.findMany({ where: { courseId: first.courseId }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => v.simpleMode)).toEqual([false, true]);
    expect(versions[0].contentHash).toBe(hashContent(plain.blocks));
    expect((await prisma.$transaction((tx) => importModule(tx, simple))).versionCreated).toBe(false);
  });

  it('języki kursu (D-133): wersja z `locales` i tytułem; bez pola - [pl] i skrót jak dotąd; dodanie języka tworzy nową wersję', async () => {
    // Moduł kompletny w PL i EN (D-134: z `locales: ['pl','en']` każde pole musi mieć EN); bez pola `locales` = [pl], jak moduły 1-2.
    const withoutLocales: Record<string, unknown> = { ...bilingualModule(), slug: slug('jezyki') };
    delete withoutLocales.locales;
    const plOnly = parseModule(withoutLocales);
    const first = await prisma.$transaction((tx) => importModule(tx, plOnly));
    const bilingual = parseModule({ ...bilingualModule(), slug: slug('jezyki'), title: { pl: 'Sprawa', en: 'Case' }, locales: ['pl', 'en'] });
    const second = await prisma.$transaction((tx) => importModule(tx, bilingual));

    expect(second).toMatchObject({ courseId: first.courseId, versionCreated: true, version: 2 });
    const versions = await prisma.courseVersion.findMany({ where: { courseId: first.courseId }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => v.locales)).toEqual([['pl'], ['pl', 'en']]);
    expect(versions[0].contentHash).toBe(hashContent(plOnly.blocks));
    expect(versions[1].title).toEqual({ pl: 'Sprawa', en: 'Case' });

    // Ta sama treść, języki w innej kolejności - bez nowej wersji; poprawiony sam tytuł trafia do istniejącej wersji.
    const retitled = parseModule({ ...bilingualModule(), slug: slug('jezyki'), title: { pl: 'Sprawa X', en: 'Case X' }, locales: ['en', 'pl'] });
    expect((await prisma.$transaction((tx) => importModule(tx, retitled))).versionCreated).toBe(false);
    const latest = await prisma.courseVersion.findFirstOrThrow({ where: { courseId: first.courseId }, orderBy: { version: 'desc' } });
    expect(latest).toMatchObject({ version: 2, locales: ['pl', 'en'], title: { pl: 'Sprawa X', en: 'Case X' } });
  });

  it('kurs utworzony wprost (sprzed importu, bez żadnej wersji) dostaje wersję 1 = kopia jego STAREJ treści, potem wersję 2 z importu', async () => {
    const legacyBlocks = [{ type: 'VIDEO', url: 'legacy.mp4' }];
    const legacy = await prisma.course.create({
      data: { slug: slug('legacy'), title: 'Kurs sprzed importu', category: 'EMAIL_SECURITY', durationMinutes: 3, contentBlocks: legacyBlocks as never },
    });

    const content = moduleFixture('legacy');
    const result = await prisma.$transaction((tx) => importModule(tx, content));

    expect(result).toMatchObject({ courseId: legacy.id, courseCreated: false, versionCreated: true, version: 2 });
    const versions = await prisma.courseVersion.findMany({ where: { courseId: legacy.id }, orderBy: { version: 'asc' } });
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, schemaVersion: 1, contentBlocks: legacyBlocks });
    expect(versions[1]).toMatchObject({ version: 2, schemaVersion: 5 });
    // Przypisanie rozpoczęte PRZED importem (nieprzypięte) miałoby wciąż resolveVersion -> wersja 1 = ta sama treść, na
    // której zaczęło (course-versions.ts): stąd wymóg, żeby wersja 1 była kopią STAREJ treści, nie nowo zaimportowanej.
    expect((versions[0].contentBlocks as unknown[])[0]).toMatchObject({ url: 'legacy.mp4' });
  });
});
