import { InternalServerErrorException } from '@nestjs/common';
import { AssignmentStatus, Course, CourseAssignment, CourseVersion, Prisma } from '@prisma/client';
import { ModuleObjective, normalizeObjectives, withLegacyIds } from '@cyberszkolo/content';
import { hashContent } from '@cyberszkolo/content/dist/node';
import { Block } from './scoring/evaluate';

export interface ResolvedVersion {
  id: string;
  version: number;
  schemaVersion: number;
  // Bloki z id (dla wersji 1 nadanymi deterministycznie: b<indeks>).
  blocks: Block[];
  // Cele TEJ wersji w jednej postaci (D-081); completeWhen okrojone do bloków, które w tej wersji istnieją.
  objectives: ModuleObjective[];
}

function toResolved(version: CourseVersion): ResolvedVersion {
  if (!Array.isArray(version.contentBlocks)) {
    // Błąd danych administracyjnych (treść kursu), nie błąd wejścia klienta - stąd 500, nie 400.
    throw new InternalServerErrorException('Kurs ma nieprawidłowo zapisaną treść');
  }
  const raw = version.contentBlocks as unknown[];
  const blocks = (version.schemaVersion === 1 ? withLegacyIds(raw) : raw) as Block[];
  // Import waliduje completeWhen (parseModule), ale wiersz mógł powstać inną drogą (testy, skrypty) - klient dostaje
  // wyłącznie id bloków, które i tak zna z contentBlocks, nigdy dowolny tekst z bazy w roli id.
  const blockIds = new Set(blocks.map((block) => block.id));
  const objectives = normalizeObjectives(version.objectives).map(({ text, completeWhen }) => {
    const known = (completeWhen ?? []).filter((id) => blockIds.has(id));
    return known.length > 0 ? { text, completeWhen: known } : { text };
  });
  return { id: version.id, version: version.version, schemaVersion: version.schemaVersion, blocks, objectives };
}

/**
 * Wiersz wersji 1 (`schemaVersion` 1) będący DOKŁADNĄ kopią obecnej treści kursu - wspólny kształt dla dwóch wywołujących:
 * `ensureLegacyVersion` niżej (kurs utworzony wprost, leniwie przy pierwszym dostępie) i `content-import.ts::importModule`
 * (kurs, który już istnieje po `slug`, ale nie ma jeszcze żadnej wersji, TUŻ PRZED zaimportowaniem nowej treści - D-051
 * pkt 11). Rzuca głośno, gdy treść nie jest tablicą (błąd danych administracyjnych) - żaden wywołujący nie ma po cichu
 * zapisywać `blockCount: 0` ani innej zgadywanej wartości.
 */
export function buildLegacyVersionData(courseId: string, contentBlocks: unknown): Prisma.CourseVersionCreateManyInput {
  if (!Array.isArray(contentBlocks)) {
    throw new InternalServerErrorException('Kurs ma nieprawidłowo zapisaną treść');
  }
  return {
    courseId,
    version: 1,
    schemaVersion: 1,
    contentHash: hashContent(contentBlocks),
    contentBlocks: contentBlocks as Prisma.InputJsonValue,
    blockCount: contentBlocks.length,
  };
}

/**
 * Wersja 1 dla kursu utworzonego wprost (bez importu i bez wpisu z migracji): kopia Course.contentBlocks w formacie sprzed
 * silnika.
 *
 * UDOKUMENTOWANY WYJĄTEK: to zapis do GLOBALNEJ tabeli (course_versions, bez RLS - katalog treści, nie dane klienta) z kontekstu
 * żądania pracownika. Treść pochodzi wyłącznie z `courses` (nie od klienta), a operacja jest idempotentna i bezpieczna przy
 * równoległych żądaniach: unikalne (courseId, version) i (courseId, contentHash) + `skipDuplicates` (INSERT ... ON CONFLICT
 * DO NOTHING - konflikt to nie błąd, transakcja się nie przerywa), a wynik zawsze czytamy z bazy (findFirst), nie z własnego
 * zapisu. Import treści (PR 4) tworzy wersję 1 kursu bez wersji ZANIM doda kolejną, więc ta ścieżka zostaje tylko dla
 * kursów tworzonych bezpośrednio (testy, ewentualne skrypty).
 */
async function ensureLegacyVersion(tx: Prisma.TransactionClient, course: Course): Promise<CourseVersion> {
  await tx.courseVersion.createMany({ data: [buildLegacyVersionData(course.id, course.contentBlocks)], skipDuplicates: true });
  const version = await tx.courseVersion.findFirst({ where: { courseId: course.id }, orderBy: { version: 'asc' } });
  if (!version) throw new InternalServerErrorException('Nie udało się utworzyć wersji kursu');
  return version;
}

/**
 * Wersja treści, na której pracuje to przypisanie. Przypięta (courseVersionId) jest ostateczna. Nieprzypięta:
 *  - już rozpoczęta (stan sprzed wprowadzenia wersji) -> NAJNIŻSZA wersja (1 = treść, na której zaczynała),
 *  - jeszcze nie rozpoczęta -> NAJNOWSZA.
 * Wynik jest zapisywany w przypisaniu (pierwszy /start albo zapis postępu przypina), więc późniejszy import nowej wersji
 * nie zmienia treści pod pracownikiem będącym w trakcie.
 */
export async function resolveVersion(
  tx: Prisma.TransactionClient,
  assignment: CourseAssignment & { course: Course },
): Promise<ResolvedVersion> {
  if (assignment.courseVersionId) {
    const pinned = await tx.courseVersion.findUnique({ where: { id: assignment.courseVersionId } });
    if (!pinned) throw new InternalServerErrorException('Przypięta wersja kursu nie istnieje');
    return toResolved(pinned);
  }

  const started =
    assignment.status !== AssignmentStatus.NOT_STARTED || assignment.progress !== null || assignment.currentBlockIndex > 0;
  const existing = await tx.courseVersion.findFirst({
    where: { courseId: assignment.courseId },
    orderBy: { version: started ? 'asc' : 'desc' },
  });
  const version = existing ?? (await ensureLegacyVersion(tx, assignment.course));

  // Warunek courseVersionId: null - równoległe żądanie, które już przypięło wersję, nie zostanie nadpisane.
  const pinned = await tx.courseAssignment.updateMany({
    where: { id: assignment.id, organizationId: assignment.organizationId, courseVersionId: null },
    data: { courseVersionId: version.id },
  });
  if (pinned.count === 0) {
    // Ktoś zdążył przypiąć (inną) wersję między odczytem a zapisem: obowiązuje jego wybór.
    const current = await tx.courseAssignment.findFirst({
      where: { id: assignment.id, organizationId: assignment.organizationId },
      select: { courseVersion: true },
    });
    if (current?.courseVersion) return toResolved(current.courseVersion);
  }
  return toResolved(version);
}
