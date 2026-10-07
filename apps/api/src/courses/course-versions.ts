import { InternalServerErrorException } from '@nestjs/common';
import { AssignmentStatus, Course, CourseAssignment, CourseVersion, Prisma } from '@prisma/client';
import { ContentLocale, DEFAULT_CONTENT_LOCALE, courseContentLocale, isContentLocale, localizeContent, withLegacyIds } from '@cyberszkolo/content';
import { hashContent } from '@cyberszkolo/content/dist/node';
import { Block } from './scoring/evaluate';

export interface ResolvedVersion {
  id: string;
  version: number;
  schemaVersion: number;
  // Bloki z id (dla wersji 1 nadanymi deterministycznie: b<indeks>).
  blocks: Block[];
  // Tryb prosty (D-132): ocena każdego kliknięcia od razu (/check) - także dla QUIZ.
  simpleMode: boolean;
  // Język treści tej odpowiedzi (D-133) i czy to `pl` zamiast języka gracza (kurs bez jego języka - plakietka „Available in Polish only”).
  locale: ContentLocale;
  localeFallback: boolean;
  // Języki, w których wersja jest kompletna (przełącznik języka na starcie kursu).
  locales: ContentLocale[];
  // Tytuł modułu w języku treści (wersje sprzed D-133: brak - tytuł z `courses.title`).
  title?: string;
}

/**
 * Wersja rozwinięta do JEDNEGO języka (D-133): języka gracza, jeśli wersja go ma (`locales`), inaczej `pl` - nigdy mieszanka. Bez języka
 * gracza (gamifikacja, skrypty) - `pl`. Ocena, postęp, notatki i toClientBlock pracują na tej treści, więc całe żądanie jest w jednym języku.
 */
export function toResolved(version: CourseVersion, playerLocale: ContentLocale = DEFAULT_CONTENT_LOCALE): ResolvedVersion {
  if (!Array.isArray(version.contentBlocks)) {
    // Błąd danych administracyjnych (treść kursu), nie błąd wejścia klienta - stąd 500, nie 400.
    throw new InternalServerErrorException('Kurs ma nieprawidłowo zapisaną treść');
  }
  const raw = version.contentBlocks as unknown[];
  // schemaVersion 6: wersja przechowuje wszystkie języki; ocena, postęp i toClientBlock pracują na treści rozwiniętej do języka
  // tej odpowiedzi. Starsze wersje nie mają pól wielojęzycznych (v1 nie przeszła nawet walidacji zod) - zostają bez zmian i bez kopiowania.
  const locales = (version.locales ?? []).filter(isContentLocale);
  const available = locales.includes(DEFAULT_CONTENT_LOCALE) ? locales : [DEFAULT_CONTENT_LOCALE, ...locales];
  const { locale, fallback } = courseContentLocale(playerLocale, available);
  const withIds = version.schemaVersion === 1 ? withLegacyIds(raw) : raw;
  const blocks = (version.schemaVersion >= 6 ? localizeContent(withIds, locale) : withIds) as Block[];
  const title = version.title === null || version.title === undefined ? undefined : localizeContent(version.title, locale);
  return {
    ...(typeof title === 'string' ? { title } : {}),
    id: version.id,
    version: version.version,
    schemaVersion: version.schemaVersion,
    blocks,
    simpleMode: version.simpleMode === true,
    locale,
    localeFallback: fallback,
    locales: available,
  };
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
  // Język gracza (D-133: konto > przeglądarka > EN) - treść w nim, jeśli wersja go ma; inaczej `pl`.
  playerLocale: ContentLocale = DEFAULT_CONTENT_LOCALE,
): Promise<ResolvedVersion> {
  if (assignment.courseVersionId) {
    const pinned = await tx.courseVersion.findUnique({ where: { id: assignment.courseVersionId } });
    if (!pinned) throw new InternalServerErrorException('Przypięta wersja kursu nie istnieje');
    return toResolved(pinned, playerLocale);
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
    if (current?.courseVersion) return toResolved(current.courseVersion, playerLocale);
  }
  return toResolved(version, playerLocale);
}
