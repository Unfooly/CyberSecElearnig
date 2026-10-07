import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Prisma } from '@prisma/client';
import { ContentValidationError } from '@cyberszkolo/content';
import { fullModule } from '@cyberszkolo/content/dist/fixtures';
import { parseModule } from '@cyberszkolo/content/dist/node';
import { importModule, loadModules } from './content-import';

// Zapis do prawdziwej bazy (upsert kursu, tworzenie CourseVersion) jest sprawdzany na realnym Postgresie w
// content-import.e2e-spec.ts (CI, patrz CLAUDE.md reguła 9 - B-085). Tu: (1) czysta logika wczytywania/walidacji
// (bez bazy, działa lokalnie) i (2) kontrola ZAKRESU importModule przez szpiega Prisma - dowód, że skrypt dotyka
// WYŁĄCZNIE course/courseVersion (żadnej innej tabeli), niezależnie od tego, co robi prawdziwy Postgres.

function validModule(overrides: Partial<ReturnType<typeof fullModule>> = {}) {
  return parseModule({ ...fullModule(), ...overrides });
}

interface SpyOverrides {
  course?: Partial<Record<'findUnique' | 'create' | 'update', jest.Mock>>;
  courseVersion?: Partial<Record<'count' | 'createMany' | 'aggregate' | 'updateMany', jest.Mock>>;
}

/** "tx" ograniczony do course/courseVersion: dostęp do JAKIEGOKOLWIEK innego modelu rzuca od razu. */
function spyTx(overrides: SpyOverrides = {}) {
  const course = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'course-1' }),
    update: jest.fn().mockResolvedValue({ id: 'course-1' }),
    ...overrides.course,
  };
  const courseVersion = {
    count: jest.fn().mockResolvedValue(0),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    ...overrides.courseVersion,
  };
  const target: Record<string, unknown> = { course, courseVersion };
  const tx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      throw new Error(`content-import: nieoczekiwany dostęp do modelu Prisma "${String(prop)}" (dozwolone: course, courseVersion)`);
    },
  }) as unknown as Prisma.TransactionClient;
  return { tx, course, courseVersion };
}

describe('content-import: importModule (szpieg Prisma - wyłącznie course/courseVersion)', () => {
  it('nowy kurs: tworzy Course i wersję 1, nie sprawdza wersji legacy (brak istniejącego kursu)', async () => {
    const { tx, course, courseVersion } = spyTx();
    const result = await importModule(tx, validModule({ slug: 'nowy-kurs' }));

    expect(course.findUnique).toHaveBeenCalledWith({ where: { slug: 'nowy-kurs' } });
    expect(course.create).toHaveBeenCalledTimes(1);
    expect(course.update).not.toHaveBeenCalled();
    expect(courseVersion.count).not.toHaveBeenCalled();
    expect(courseVersion.createMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ slug: 'nowy-kurs', courseId: 'course-1', courseCreated: true, versionCreated: true, version: 1 });
  });

  it('dostęp do modelu spoza course/courseVersion rzuca (kontrola zakresu skryptu)', () => {
    const { tx } = spyTx();
    expect(() => (tx as unknown as { user: unknown }).user).toThrow(/nieoczekiwany dostęp/);
  });

  it('istniejący kurs BEZ wersji dostaje najpierw wersję 1 (kopia STAREJ treści), potem nową wersję', async () => {
    const legacyBlocks = [{ id: 'b0', type: 'VIDEO', url: 'video.mp4' }];
    const { tx, course, courseVersion } = spyTx({
      course: { findUnique: jest.fn().mockResolvedValue({ id: 'course-1', contentBlocks: legacyBlocks }) },
      courseVersion: { aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }) },
    });

    const result = await importModule(tx, validModule({ slug: 'istniejacy' }));

    expect(courseVersion.count).toHaveBeenCalledWith({ where: { courseId: 'course-1' } });
    expect(courseVersion.createMany).toHaveBeenCalledTimes(2);
    const [legacyCall, newCall] = courseVersion.createMany.mock.calls;
    expect(legacyCall[0].data[0]).toMatchObject({ courseId: 'course-1', version: 1, schemaVersion: 1, contentBlocks: legacyBlocks });
    expect(newCall[0].data[0]).toMatchObject({ courseId: 'course-1', version: 2, schemaVersion: 5 });
    expect(course.update).toHaveBeenCalledTimes(1);
    expect(course.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ courseCreated: false, versionCreated: true, version: 2 });
  });

  it('kurs, który już ma wersje: NIE tworzy wersji legacy (versionCount > 0)', async () => {
    const { tx, courseVersion } = spyTx({
      course: { findUnique: jest.fn().mockResolvedValue({ id: 'course-1', contentBlocks: [] }) },
      courseVersion: { count: jest.fn().mockResolvedValue(1), aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }) },
    });
    await importModule(tx, validModule({ slug: 'z-wersja' }));
    expect(courseVersion.createMany).toHaveBeenCalledTimes(1);
  });

  it('identyczna treść: createMany pomija duplikat (unikalność contentHash), versionCreated=false', async () => {
    const { tx, courseVersion } = spyTx({
      course: { findUnique: jest.fn().mockResolvedValue({ id: 'course-1', contentBlocks: [] }) },
      courseVersion: {
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _max: { version: 3 } }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const result = await importModule(tx, validModule({ slug: 'bez-zmian' }));
    expect(result.versionCreated).toBe(false);
    // D-133: tytuł (tylko do wyświetlania, poza skrótem) odświeżony w istniejącej wersji o tym samym skrócie.
    expect(courseVersion.updateMany).toHaveBeenCalledWith({ where: { courseId: 'course-1', contentHash: expect.any(String) }, data: { title: expect.anything() } });
  });
});

describe('content-import: loadModules (bez bazy)', () => {
  async function tmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'content-import-test-'));
  }

  it('wczytuje i waliduje moduł z podkatalogu; katalog bez module.json jest pomijany po cichu', async () => {
    const dir = await tmpDir();
    await fs.mkdir(path.join(dir, 'kurs-a'));
    await fs.writeFile(path.join(dir, 'kurs-a', 'module.json'), JSON.stringify({ ...fullModule(), slug: 'kurs-a' }));
    await fs.mkdir(path.join(dir, 'wspolne-assety')); // np. avatary wspólne dla kilku modułów - bez module.json

    const modules = await loadModules(dir);

    expect(modules).toHaveLength(1);
    expect(modules[0].slug).toBe('kurs-a');
  });

  it('pusty katalog daje pustą listę (bez błędu)', async () => {
    expect(await loadModules(await tmpDir())).toEqual([]);
  });

  it('błąd w JEDNYM pliku (JSON albo schemat) nie zwraca ŻADNEGO modułu i zbiera błędy ze WSZYSTKICH złych plików naraz', async () => {
    const dir = await tmpDir();
    await fs.mkdir(path.join(dir, 'dobry'));
    await fs.writeFile(path.join(dir, 'dobry', 'module.json'), JSON.stringify({ ...fullModule(), slug: 'dobry' }));
    await fs.mkdir(path.join(dir, 'zly-json'));
    await fs.writeFile(path.join(dir, 'zly-json', 'module.json'), '{ nie jest to poprawny JSON');
    await fs.mkdir(path.join(dir, 'zly-schemat'));
    await fs.writeFile(path.join(dir, 'zly-schemat', 'module.json'), JSON.stringify({ schemaVersion: 4 }));

    let caught: unknown;
    try {
      await loadModules(dir);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContentValidationError);
    const message = (caught as ContentValidationError).issues.join('\n');
    expect(message).toMatch(/zly-json/);
    expect(message).toMatch(/zly-schemat/);
    expect(message).not.toMatch(/dobry/);
  });

  it('dwa katalogi z TYM SAMYM slug: błąd walidacji (nie ciche "przejęcie" kursu przy zapisie)', async () => {
    const dir = await tmpDir();
    await fs.mkdir(path.join(dir, 'pierwszy'));
    await fs.writeFile(path.join(dir, 'pierwszy', 'module.json'), JSON.stringify({ ...fullModule(), slug: 'ten-sam-slug' }));
    await fs.mkdir(path.join(dir, 'drugi'));
    await fs.writeFile(path.join(dir, 'drugi', 'module.json'), JSON.stringify({ ...fullModule(), slug: 'ten-sam-slug', title: 'Inny tytuł' }));

    let caught: unknown;
    try {
      await loadModules(dir);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContentValidationError);
    const message = (caught as ContentValidationError).issues.join('\n');
    // Katalogi są przetwarzane alfabetycznie ("drugi" przed "pierwszy"): pierwszy PRZETWORZONY zostaje właścicielem sluga.
    expect(message).toMatch(/pierwszy.*ten-sam-slug.*drugi/);
  });
});
