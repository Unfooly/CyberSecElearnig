import { InternalServerErrorException } from '@nestjs/common';
import { AssignmentStatus, Course, CourseAssignment, CourseVersion, Prisma } from '@prisma/client';
import { withLegacyIds } from '@cyberszkolo/content';
import { hashContent } from '@cyberszkolo/content/dist/node';
import { Block } from './scoring/evaluate';

export interface ResolvedVersion {
  id: string;
  version: number;
  schemaVersion: number;
  // Bloki z id (dla wersji 1 nadanymi deterministycznie: b<indeks>).
  blocks: Block[];
}

function toResolved(version: CourseVersion): ResolvedVersion {
  if (!Array.isArray(version.contentBlocks)) {
    // Błąd danych administracyjnych (treść kursu), nie błąd wejścia klienta - stąd 500, nie 400.
    throw new InternalServerErrorException('Kurs ma nieprawidłowo zapisaną treść');
  }
  const raw = version.contentBlocks as unknown[];
  const blocks = (version.schemaVersion === 1 ? withLegacyIds(raw) : raw) as Block[];
  return { id: version.id, version: version.version, schemaVersion: version.schemaVersion, blocks };
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
  if (!Array.isArray(course.contentBlocks)) {
    throw new InternalServerErrorException('Kurs ma nieprawidłowo zapisaną treść');
  }
  await tx.courseVersion.createMany({
    data: [
      {
        courseId: course.id,
        version: 1,
        schemaVersion: 1,
        contentHash: hashContent(course.contentBlocks),
        contentBlocks: course.contentBlocks as Prisma.InputJsonValue,
        blockCount: course.contentBlocks.length,
      },
    ],
    skipDuplicates: true,
  });
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
