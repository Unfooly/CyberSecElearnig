import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { ContentModule, ContentValidationError } from '@cyberszkolo/content';
import { hashContent, moduleWarnings, parseModule } from '@cyberszkolo/content/dist/node';
import { buildLegacyVersionData } from '../courses/course-versions';

// Import treści (packages/content/modules/<slug>/module.json) do katalogu kursów. Wołany jako samodzielny skrypt (nie
// endpoint HTTP - D-051 pkt 11), w produkcji jako usługa `docker-compose.prod.yml` uruchamiana PO `migrate`, ale
// NIEZALEŻNIE od `api` (jej awaria nie blokuje startu API: import to treść, nie schemat - patrz docs/deploy-test.md).
//
// Rola Prisma: TA SAMA co `prisma/seed-badges.ts` - goły `PrismaClient()` (rola z DATABASE_URL, migracyjna, NIE
// DATABASE_URL_APP): `courses`/`course_versions` to tabele GLOBALNE bez RLS (jak `badges`), więc nie ma tu problemu z
// Zasadą nr 1. Ten skrypt świadomie dotyka WYŁĄCZNIE tych dwóch tabel (content-import.spec.ts pilnuje tego szpiegiem).

/** Wynik importu jednego modułu, do logowania w main(). */
export interface ImportResult {
  slug: string;
  courseId: string;
  courseCreated: boolean;
  // Numer wersji, którą PRÓBOWAŁ zapisać ten import (nextVersion) - gdy versionCreated=false, żaden wiersz o tym
  // numerze NIE powstał (skipDuplicates pominął zapis: treść identyczna z jakąś WCZEŚNIEJSZĄ wersją, niekoniecznie
  // ostatnią). W tej gałęzi main() nie loguje `version` - nie traktuj go jako "bieżąca wersja kursu po imporcie".
  version: number;
  versionCreated: boolean;
}

/**
 * Wczytuje i WALIDUJE WSZYSTKIE moduły z katalogu PRZED jakimkolwiek zapisem (żeby błąd w jednym pliku nie zostawiał
 * połowicznego importu reszty). Katalog bez `module.json` (np. wspólne assety poza modułem) jest pomijany po cichu.
 * Błędy walidacji ze WSZYSTKICH plików są zbierane razem, nie tylko pierwszy - autor treści widzi od razu całą listę.
 * Dwa katalogi z TYM SAMYM `slug` to też błąd walidacji (a nie "drugi moduł cicho przejmuje kurs pierwszego" przy
 * zapisie): `slug` jest kluczem upsertu w `importModule`, więc kolizja musi się ujawnić TUTAJ, przed jakimkolwiek zapisem.
 */
export async function loadModules(dir: string): Promise<ContentModule[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const modules: ContentModule[] = [];
  const errors: string[] = [];
  const slugOwners = new Map<string, string>();
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name, 'module.json');
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      // ENOENT (brak module.json - katalog na inne assety) pomijamy po cichu; każdy INNY błąd odczytu (np. EACCES w
      // kontenerze) to prawdziwy problem, nie "zwykły katalog bez modułu" - ma się ujawnić razem z resztą błędów.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`${entry.name}: nie można odczytać module.json (${(error as Error).message})`);
      continue;
    }
    try {
      const contentModule = parseModule(JSON.parse(raw));
      const owner = slugOwners.get(contentModule.slug);
      if (owner) {
        errors.push(`${entry.name}: slug "${contentModule.slug}" jest już użyty przez moduł w katalogu "${owner}"`);
        continue;
      }
      slugOwners.set(contentModule.slug, entry.name);
      modules.push(contentModule);
    } catch (error) {
      const message = error instanceof ContentValidationError ? error.issues.join('; ') : (error as Error).message;
      errors.push(`${entry.name}: ${message}`);
    }
  }
  if (errors.length > 0) throw new ContentValidationError(errors);
  return modules;
}

/**
 * Zapisuje JEDEN moduł w JEDNEJ transakcji (`tx`): upsert kursu po `slug` + nowa wersja treści (idempotentnie -
 * identyczna treść, unikalność `(courseId, contentHash)`, nie tworzy nowej wersji). Dla kursu, który już istnieje, ale
 * nie ma jeszcze ŻADNEJ wersji (utworzony wprost, sprzed importu - D-051 pkt 11), NAJPIERW zapisuje jego DOTYCHCZASOWĄ
 * treść jako wersję 1 (`schemaVersion` 1) - inaczej rozpoczęte, nieprzypięte przypisania „przeskoczyłyby” na nowo
 * zaimportowaną treść (resolveVersion w course-versions.ts wybiera najnowszą wersję dla nierozpoczętych przypisań).
 */
export async function importModule(tx: Prisma.TransactionClient, contentModule: ContentModule): Promise<ImportResult> {
  const existing = await tx.course.findUnique({ where: { slug: contentModule.slug } });

  if (existing) {
    const versionCount = await tx.courseVersion.count({ where: { courseId: existing.id } });
    if (versionCount === 0) {
      // Rzuca głośno, gdy existing.contentBlocks nie jest tablicą (błąd danych administracyjnych) - ten skrypt jest
      // operatorski, uruchamiany raz z logami, więc ma się głośno wywalić, a nie po cichu zapisać zgadywany wiersz.
      await tx.courseVersion.createMany({ data: [buildLegacyVersionData(existing.id, existing.contentBlocks)], skipDuplicates: true });
    }
  }

  const courseData = {
    title: contentModule.title,
    subtitle: contentModule.subtitle ?? null,
    category: contentModule.category,
    level: contentModule.level ?? null,
    durationMinutes: contentModule.durationMinutes,
    mandatory: contentModule.mandatory,
    objectives: (contentModule.objectives as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    contentBlocks: contentModule.blocks as unknown as Prisma.InputJsonValue,
  };
  const courseId = existing
    ? (await tx.course.update({ where: { id: existing.id }, data: courseData, select: { id: true } })).id
    : (await tx.course.create({ data: { slug: contentModule.slug, ...courseData }, select: { id: true } })).id;

  const maxVersion = await tx.courseVersion.aggregate({ where: { courseId }, _max: { version: true } });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;
  const contentHash = hashContent(contentModule.blocks);
  const created = await tx.courseVersion.createMany({
    data: [
      {
        courseId,
        version: nextVersion,
        schemaVersion: contentModule.schemaVersion,
        contentHash,
        contentBlocks: contentModule.blocks as unknown as Prisma.InputJsonValue,
        blockCount: contentModule.blocks.length,
      },
    ],
    skipDuplicates: true,
  });

  return { slug: contentModule.slug, courseId, courseCreated: !existing, versionCreated: created.count > 0, version: nextVersion };
}

async function main(): Promise<void> {
  // Domyślnie ścieżka w obrazie produkcyjnym (apps/api/dist/scripts -> /app -> packages/content/modules, patrz
  // Dockerfile: kopiowane są WYŁĄCZNIE pliki module.json, bez surowych assetów). Argument z wiersza poleceń nadpisuje
  // (lokalne uruchomienie z katalogu źródłowego, np. przy pracy nad nowym modułem - PR 4 commit 3).
  const dir = process.argv[2] ?? path.resolve(__dirname, '../../../../packages/content/modules');
  const prisma = new PrismaClient();
  try {
    const modules = await loadModules(dir);
    if (modules.length === 0) {
      console.log(`[content-import] Brak modułów do zaimportowania w ${dir}`);
      return;
    }
    // Walidacja (loadModules) już przeszła dla WSZYSTKICH modułów, zanim tu dotarliśmy - żaden zapis jeszcze się nie
    // wykonał. Od tego miejsca każdy moduł zapisujemy NIEZALEŻNIE (własna transakcja): błąd zapisu jednego (np.
    // przejściowy błąd bazy) nie ma blokować importu reszty, poprawnych modułów - zbieramy błędy i kończymy błędem
    // dopiero na końcu (produkcja: patrz docs/deploy-test.md, `docker compose logs content-import`).
    let hadError = false;
    for (const contentModule of modules) {
      for (const warning of moduleWarnings(contentModule)) {
        console.warn(`[content-import] ${contentModule.slug}: OSTRZEŻENIE: ${warning}`);
      }
      try {
        const result = await prisma.$transaction((tx) => importModule(tx, contentModule));
        console.log(
          result.versionCreated
            ? `[content-import] OK: ${contentModule.slug} -> ${result.courseCreated ? 'nowy kurs, ' : ''}wersja ${result.version}`
            : `[content-import] OK: ${contentModule.slug} -> bez zmian (treść identyczna z bieżącą wersją)`,
        );
      } catch (error) {
        hadError = true;
        console.error(`[content-import] BŁĄD przy module "${contentModule.slug}":`, error);
      }
    }
    if (hadError) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[content-import] Błąd:', error instanceof ContentValidationError ? `\n - ${error.issues.join('\n - ')}` : error);
    process.exit(1);
  });
}
