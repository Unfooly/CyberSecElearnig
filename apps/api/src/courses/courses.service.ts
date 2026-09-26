import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssignmentStatus, Course, CourseAssignment, Prisma } from '@prisma/client';
import { normalizeObjectives, toClientBlock } from '@cyberszkolo/content';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { SubmitBlockProgressDto } from './dto/submit-block-progress.dto';
import { CourseAssignmentSummaryDto } from './dto/course-assignment-summary.dto';
import { CourseCatalogItemDto } from './dto/course-catalog-item.dto';
import { CourseDetailDto } from './dto/course-detail.dto';
import { CourseProgressResponseDto } from './dto/course-progress-response.dto';
import { clientProgress, evidenceSummary, resolveNote, shuffleContext } from './client-view';
import { resolveVersion } from './course-versions';
import { ProgressV2, computeScore, entryOf, readProgress, toJson } from './progress';
import { AttemptResponse, evaluateAttempt, evaluateSubmit, pickReaction } from './scoring/evaluate';

type AssignmentWithCourse = CourseAssignment & { course: Course };

@Injectable()
export class CoursesService {
  private readonly shuffleSecret: string;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly gamificationService: GamificationService,
    configService: ConfigService,
  ) {
    // Ten sam sekret co JWT (etykieta w HMAC oddziela zastosowania) - patrz shuffleContext.
    this.shuffleSecret = configService.getOrThrow<string>('JWT_SECRET');
  }

  /**
   * organizationId i userId pochodzą WYŁĄCZNIE z tokena JWT wywołującego
   * (zob. CoursesController) — endpointy świadomie nie przyjmują ich od
   * klienta.
   */
  async listMyCourses(organizationId: string, userId: string): Promise<CourseAssignmentSummaryDto[]> {
    const assignments = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.courseAssignment.findMany({
        // Tylko AKTYWNE (D-069): przypisanie zarchiwizowane restartem to historia, nie pozycja "moich kursów".
        where: { organizationId, userId, archivedAt: null },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              category: true,
              durationMinutes: true,
              contentBlocks: true,
            },
          },
          courseVersion: { select: { blockCount: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );

    return assignments.map((assignment) => ({
      assignmentId: assignment.id,
      courseId: assignment.course.id,
      title: assignment.course.title,
      category: assignment.course.category,
      durationMinutes: assignment.course.durationMinutes,
      // PER PRZYPISANIE (D-065), nie course.mandatory: ten sam kurs bywa jednocześnie samoobsługowy (zawsze false) i
      // ręcznie przypisany (mandatory admina) dla różnych pracowników.
      mandatory: assignment.mandatory,
      status: assignment.status,
      score: assignment.score,
      dueDate: assignment.dueDate,
      completedAt: assignment.completedAt,
      currentBlockIndex: assignment.currentBlockIndex,
      // Liczba bloków przypiętej wersji (na której pracuje pracownik); dla nieprzypiętych - treść kursu.
      totalBlocks: assignment.courseVersion?.blockCount ?? this.countBlocks(assignment.course.contentBlocks),
    }));
  }

  /**
   * Katalog: kursy globalne (Course - bez organizationId/RLS, jak `badges`), na które TEN pracownik nie ma jeszcze
   * przypisania - do samodzielnego rozpoczęcia (selfAssign). Bez treści bloków (tylko metadane do karty) - D-065.
   */
  async listCatalog(organizationId: string, userId: string): Promise<CourseCatalogItemDto[]> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // Tylko AKTYWNE (D-069): kurs, którego jedyne przypisanie jest zarchiwizowane, nie może się zdarzyć (restart
      // tworzy nowe od razu), ale filtr jest tu jawny z tego samego powodu co listMyCourses.
      const assigned = await tx.courseAssignment.findMany({
        where: { organizationId, userId, archivedAt: null },
        select: { courseId: true },
      });
      const assignedIds = assigned.map((a) => a.courseId);
      const courses = await tx.course.findMany({
        where: assignedIds.length > 0 ? { id: { notIn: assignedIds } } : undefined,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          title: true,
          subtitle: true,
          level: true,
          objectives: true,
          category: true,
          durationMinutes: true,
          contentBlocks: true,
          versions: { orderBy: { version: 'desc' }, take: 1, select: { blockCount: true } },
        },
      });

      return courses.map((course) => ({
        courseId: course.id,
        title: course.title,
        subtitle: course.subtitle,
        level: course.level,
        // Import zapisuje tu same teksty; normalizeObjectives na wypadek wiersza z obiektami (schemaVersion 5) spoza importu.
        objectives: normalizeObjectives(course.objectives).map((objective) => objective.text),
        category: course.category,
        durationMinutes: course.durationMinutes,
        totalBlocks: course.versions[0]?.blockCount ?? this.countBlocks(course.contentBlocks),
      }));
    });
  }

  /**
   * Samodzielne rozpoczęcie kursu z katalogu: tworzy CourseAssignment TYLKO dla wywołującego, w JEGO organizacji
   * (zwykły zapis pod RLS - żadnego wyjątku od Zasady nr 1). ZAWSZE nieobowiązkowe (mandatory: false), niezależnie od
   * Course.mandatory - to pole jest domyślną wartością wyłącznie dla PRZYSZŁEGO ręcznego przypisania przez ORG_ADMIN
   * (D-065). Idempotentne: powtórne wywołanie zwraca istniejące AKTYWNE przypisanie (częściowy unikalny indeks na
   * (organizationId, userId, courseId) WHERE archivedAt IS NULL - D-069, patrz schema.prisma).
   */
  async selfAssign(organizationId: string, userId: string, courseId: string): Promise<{ assignmentId: string }> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true } });
      if (!course) {
        throw new NotFoundException('Kurs nie istnieje.');
      }
      await tx.courseAssignment.createMany({
        data: [{ organizationId, userId, courseId, mandatory: false }],
        skipDuplicates: true,
      });
      const assignment = await tx.courseAssignment.findFirst({
        where: { organizationId, userId, courseId, archivedAt: null },
        select: { id: true },
      });
      if (!assignment) {
        throw new InternalServerErrorException('Nie udało się utworzyć przypisania.');
      }
      return { assignmentId: assignment.id };
    });
  }

  /**
   * "Rozpocznij od nowa" (D-069): tylko dla WŁASNEGO, AKTYWNEGO i UKOŃCZONEGO przypisania wywołującego. Stare
   * przypisanie dostaje `archivedAt` i zostaje w bazie bez zmian (historia/raporty/XP/odznaki - GamificationService w
   * ogóle nie jest tu wołany), powstaje nowe aktywne przypisanie tego samego kursu z `mandatory`/`dueDate`
   * przepisanymi ze starego i przypiętą NAJNOWSZĄ wersją treści (nie tą, na której pracownik skończył poprzednio).
   *
   * Idempotencja/wyścig: `lockOwnAssignment` (FOR UPDATE) serializuje równoległe wywołania na wierszu AKTYWNEGO
   * przypisania. Drugie wywołanie "od razu po pierwszym" (restart bez ponownego ukończenia) widzi już NOWE aktywne
   * przypisanie (status NOT_STARTED, nie COMPLETED) i dostaje ten sam 409 co próba zrestartowania nieukończonego
   * kursu - to jest oczekiwana idempotencja, nie osobna ścieżka kodu.
   */
  async restart(organizationId: string, userId: string, courseId: string): Promise<{ assignmentId: string }> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      await this.lockOwnAssignment(tx, organizationId, userId, courseId);
      const assignment = await this.findOwnAssignment(tx, organizationId, userId, courseId);

      if (assignment.status !== AssignmentStatus.COMPLETED) {
        throw new ConflictException('Kurs nie jest ukończony - nie można rozpocząć go od nowa.');
      }

      // Warunek archivedAt: null - drugie równoległe wywołanie (gdyby jednak minęło blokadę FOR UPDATE) nie
      // zarchiwizuje tego samego wiersza dwa razy ani nie utworzy dwóch nowych aktywnych przypisań.
      const archived = await tx.courseAssignment.updateMany({
        where: { id: assignment.id, organizationId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (archived.count === 0) {
        throw new ConflictException('Kurs nie jest ukończony - nie można rozpocząć go od nowa.');
      }

      const latestVersion = await tx.courseVersion.findFirst({
        where: { courseId },
        orderBy: { version: 'desc' },
        select: { id: true },
      });

      const created = await tx.courseAssignment.create({
        data: {
          organizationId,
          userId,
          courseId,
          mandatory: assignment.mandatory,
          dueDate: assignment.dueDate,
          courseVersionId: latestVersion?.id ?? null,
        },
        select: { id: true },
      });
      return { assignmentId: created.id };
    });
  }

  async startOrContinue(
    organizationId: string,
    userId: string,
    courseId: string,
  ): Promise<CourseDetailDto> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const assignment = await this.findOwnAssignment(tx, organizationId, userId, courseId);
      const version = await resolveVersion(tx, assignment);

      // NOT_STARTED -> IN_PROGRESS tylko warunkowo: równoległy zapis mógł już przesunąć/ukończyć kurs, a bezwarunkowy update
      // nadpisałby COMPLETED z powrotem na IN_PROGRESS (kurs 1-blokowy byłby wtedy zablokowany). Po próbie czytamy wiersz
      // jeszcze raz, więc odpowiedź zawsze odzwierciedla rzeczywisty stan.
      let current = assignment;
      if (assignment.status === AssignmentStatus.NOT_STARTED) {
        await tx.courseAssignment.updateMany({
          where: { id: assignment.id, organizationId, status: AssignmentStatus.NOT_STARTED },
          data: { status: AssignmentStatus.IN_PROGRESS },
        });
        const fresh = await tx.courseAssignment.findFirst({ where: { id: assignment.id, organizationId } });
        if (fresh) current = { ...assignment, ...fresh };
      }

      // Jedyna droga treści do klienta: biała lista pól per typ bloku (packages/content, toClientBlock). Klucz odpowiedzi,
      // podpowiedzi i rozwiązania nie wychodzą; kolejność elementów ORDERING/EMAIL_ANALYSIS jest tasowana sekretem serwera.
      const context = shuffleContext(this.shuffleSecret, assignment.id, version.id);
      const contentBlocks = version.blocks.map((block) => toClientBlock(block, context));

      return {
        assignmentId: current.id,
        courseId: assignment.course.id,
        title: assignment.course.title,
        status: current.status,
        currentBlockIndex: current.currentBlockIndex,
        contentBlocks: contentBlocks as unknown as Prisma.JsonValue,
        // Cele/zadania wersji, na której pracuje TO przypisanie (D-081) - nie Course.objectives (ten jest z ostatniego importu).
        objectives: version.objectives,
        progress: clientProgress(readProgress(current.progress), version.blocks, context.opaqueId) as unknown as Prisma.JsonValue,
      };
    });
  }

  async submitBlockProgress(
    organizationId: string,
    userId: string,
    courseId: string,
    dto: SubmitBlockProgressDto,
  ): Promise<CourseProgressResponseDto> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      await this.lockOwnAssignment(tx, organizationId, userId, courseId);
      const assignment = await this.findOwnAssignment(tx, organizationId, userId, courseId);

      if (assignment.status === AssignmentStatus.COMPLETED) {
        throw new BadRequestException('Kurs jest już ukończony');
      }

      const version = await resolveVersion(tx, assignment);
      const blocks = version.blocks;

      if (dto.blockIndex >= blocks.length) {
        throw new BadRequestException('Nieprawidłowy indeks bloku treści');
      }

      // Bloki muszą być ukończone po kolei — inaczej user mógłby przeskoczyć
      // od razu do ostatniego bloku i "ukończyć" obowiązkowe szkolenie z
      // pominięciem ocenianych bloków (patrz code review tego modułu).
      // currentBlockIndex rośnie zawsze o dokładnie jeden, nigdy nie przeskakuje.
      if (dto.blockIndex !== assignment.currentBlockIndex) {
        throw new BadRequestException('Bloki trzeba ukończyć po kolei');
      }

      const block = blocks[dto.blockIndex];
      const progress = readProgress(assignment.progress);
      const { opaqueId } = shuffleContext(this.shuffleSecret, assignment.id, version.id);
      const result = evaluateSubmit(block, dto.answer, entryOf(progress, block.id), new Date(), opaqueId);
      const reaction = pickReaction(block, result.entry);

      progress.blocks[block.id] = result.entry;
      for (const key of result.notesAdded) {
        if (!progress.notes.includes(key)) progress.notes.push(key);
      }

      const currentBlockIndex = assignment.currentBlockIndex + 1;
      const isComplete = currentBlockIndex >= blocks.length;
      const score = computeScore(progress);
      const status = isComplete ? AssignmentStatus.COMPLETED : AssignmentStatus.IN_PROGRESS;
      const completedAt = isComplete ? new Date() : null;

      // Optymistyczna blokada: WHERE zawiera currentBlockIndex odczytany na
      // początku tej funkcji (`assignment.currentBlockIndex`, SPRZED
      // inkrementacji) - jeśli dwa równoległe żądania odczytały ten sam stan
      // i oba próbują zapisać ten sam blok (duplikat/retry/dwie karty
      // przeglądarki), drugie z nich trafi na już zmieniony wiersz i
      // dopasuje 0 wierszy, zamiast cicho podwoić przyznane XP w
      // awardCourseCompletion niżej (wykryte w security review tej sesji -
      // ten sam mechanizm ataku/wyścigu co TOCTOU naprawiony wcześniej przy
      // resecie hasła, tylko węższy zakres). Dodatkowo lockOwnAssignment
      // (FOR UPDATE) serializuje zapisy postępu i prób tego przypisania.
      const claim = await tx.courseAssignment.updateMany({
        where: { id: assignment.id, currentBlockIndex: assignment.currentBlockIndex },
        data: { progress: toJson(progress), currentBlockIndex, score, status, completedAt },
      });

      if (claim.count === 0) {
        throw new ConflictException(
          'Ten postęp został już zapisany (np. w innej karcie przeglądarki). Odśwież stronę.',
        );
      }

      // W TEJ SAMEJ transakcji co powyższy zapis - XP/level/odznaki muszą
      // być spójne z faktem ukończenia kursu, nie osobnym krokiem po fakcie
      // (patrz GamificationService.awardCourseCompletion i plan architektury
      // tego modułu: świadomie bez event emittera, właśnie z tego powodu).
      const gamification = isComplete
        ? await this.gamificationService.awardCourseCompletion(tx, organizationId, userId, { score })
        : null;

      return {
        assignmentId: assignment.id,
        status,
        currentBlockIndex,
        score,
        completedAt,
        lastResult: {
          blockIndex: dto.blockIndex,
          blockId: block.id,
          type: result.entry.type,
          correct: result.entry.correct,
          ...(result.entry.points !== undefined ? { points: result.entry.points } : {}),
          ...(result.detail ? { detail: result.detail } : {}),
          // Reakcja maskotki na WYNIK (schemaVersion 4, pole secret): dopiero tutaj, po ocenie, nigdy w /start.
          ...(reaction ? { reaction } : {}),
        },
        // Dowody po tym zapisie (liczby liczy serwer; total znany od startu dla wszystkich bloków, D-055 pkt 2).
        evidence: evidenceSummary(progress, blocks),
        // Notatki dopisane TYM zapisem (treść z modułu; dla kryteriów maila ujawniana dopiero po odpowiedzi), żeby notatnik pokazał je od razu.
        notes: result.notesAdded
          .map((key) => resolveNote(blocks, key))
          .filter((note): note is NonNullable<typeof note> => note !== null)
          .map(({ blockId, text, kind }) => ({ blockId, text, ...(kind ? { kind } : {}) })),
        gamification: gamification
          ? {
              xpGained: gamification.xpGained,
              newLevel: gamification.newLevel,
              previousLevel: gamification.previousLevel,
              leveledUp: gamification.leveledUp,
              unlockedBadges: gamification.unlockedBadges.map((badge) => ({
                code: badge.code,
                title: badge.title,
                icon: badge.icon,
                xpReward: badge.xpReward,
              })),
              levelProgressBeforePercent: gamification.levelProgressBeforePercent,
              levelProgressAfterPercent: gamification.levelProgressAfterPercent,
            }
          : null,
      };
    });
  }

  /**
   * Dokument HTML bloku EMBEDDED_HTML (osobno od treści modułu: `html` jest polem sekretnym i nie idzie w /start). Dostęp tylko dla
   * właściciela przypisania (RLS + organizationId + userId), do bloku bieżącego albo wcześniejszego (blok przyszły nie jest osiągalny),
   * wyłącznie dla bloków tego typu. Każdy brak dostępu to ten sam 404 (bez ujawniania, czy blok istnieje). Treść jest niezaufana: BFF
   * serwuje ją jako dokument w sandboxie z restrykcyjnym CSP (apps/web, trasa embed).
   */
  async getEmbeddedHtml(organizationId: string, userId: string, courseId: string, blockId: string): Promise<{ html: string }> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const assignment = await this.findOwnAssignment(tx, organizationId, userId, courseId);
      const version = await resolveVersion(tx, assignment);
      const index = version.blocks.findIndex((candidate) => candidate.id === blockId);
      const block = index >= 0 ? version.blocks[index] : undefined;
      if (!block || block.type !== 'EMBEDDED_HTML' || typeof block.html !== 'string' || index > assignment.currentBlockIndex) {
        throw new NotFoundException('Nie ma takiego bloku w tym kursie');
      }
      return { html: block.html };
    });
  }

  /**
   * Próba odpowiedzi w bloku TEXT_INPUT_GUIDED. Poprawność, punkty (maleją z liczbą prób), podpowiedzi i rozwiązanie
   * wyznacza WYŁĄCZNIE serwer; podpowiedź wychodzi dopiero po błędnej próbie, rozwiązanie dopiero po wyczerpaniu prób.
   * Blok rozstrzyga się tu (done), ale kurs przesuwa dopiero zwykły zapis postępu ("Dalej").
   */
  async attemptBlock(
    organizationId: string,
    userId: string,
    courseId: string,
    blockId: string,
    answer: string,
  ): Promise<AttemptResponse> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      // FOR UPDATE: równoległe próby tego samego przypisania idą po kolei, więc licznik prób i limit maxAttempts nie dają
      // się obejść wysłaniem wielu żądań naraz.
      await this.lockOwnAssignment(tx, organizationId, userId, courseId);
      const assignment = await this.findOwnAssignment(tx, organizationId, userId, courseId);

      if (assignment.status === AssignmentStatus.COMPLETED) {
        throw new BadRequestException('Kurs jest już ukończony');
      }

      const version = await resolveVersion(tx, assignment);
      const index = version.blocks.findIndex((candidate) => candidate.id === blockId);
      if (index < 0) {
        throw new NotFoundException('Nie ma takiego bloku w tym kursie');
      }
      if (index !== assignment.currentBlockIndex) {
        throw new BadRequestException('Bloki trzeba ukończyć po kolei');
      }
      const block = version.blocks[index];
      if (block.type !== 'TEXT_INPUT_GUIDED') {
        throw new BadRequestException('Ten blok nie przyjmuje odpowiedzi tekstowych');
      }

      const progress: ProgressV2 = readProgress(assignment.progress);
      const { entry, response } = evaluateAttempt(block, answer, entryOf(progress, block.id), new Date());
      progress.blocks[block.id] = entry;

      await tx.courseAssignment.update({
        where: { id: assignment.id },
        data: {
          progress: toJson(progress),
          ...(assignment.status === AssignmentStatus.NOT_STARTED ? { status: AssignmentStatus.IN_PROGRESS } : {}),
        },
      });

      // Reakcja maskotki na WYNIK (schemaVersion 4, pole secret): pickReaction czyta entry.correct, ustawione tylko gdy
      // `done` (poprawna odpowiedź albo wyczerpane próby) - żadnej reakcji na próbę z pozostałymi podejściami.
      const reaction = pickReaction(block, entry);
      return { ...response, ...(reaction ? { reaction } : {}) };
    });
  }

  /**
   * Wersja countBlocks, która nie rzuca — używana przy listowaniu
   * WIELU kursów naraz (listMyCourses), gdzie jeden kurs z uszkodzoną
   * treścią nie powinien wywalać całej listy pozostałych. 0 jest bezpiecznym
   * fallbackiem (frontend i tak nie pokaże paska postępu dla totalBlocks=0).
   */
  private countBlocks(contentBlocks: Prisma.JsonValue): number {
    return Array.isArray(contentBlocks) ? contentBlocks.length : 0;
  }

  // Blokada wiersza AKTYWNEGO przypisania do końca transakcji (RLS obowiązuje: widać tylko własną organizację).
  // Tylko archivedAt IS NULL (D-069) - jak niżej w findOwnAssignment, historia (przypisania zarchiwizowane
  // restartem) nie jest tym, co /start, /progress, /attempt ani restart mają widzieć czy blokować.
  private async lockOwnAssignment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    courseId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "course_assignments" WHERE "organizationId" = ${organizationId} AND "userId" = ${userId} AND "courseId" = ${courseId} AND "archivedAt" IS NULL FOR UPDATE`;
  }

  private async findOwnAssignment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    courseId: string,
  ): Promise<AssignmentWithCourse> {
    // Tylko AKTYWNE (D-069): przypisanie zarchiwizowane restartem nie jest dostępne pod /start, /progress, /attempt
    // ani jako cel kolejnego restartu - "swój kurs" zawsze oznacza to jedno, aktualne przypisanie.
    const assignment = await tx.courseAssignment.findFirst({
      where: { organizationId, userId, courseId, archivedAt: null },
      include: { course: true },
    });

    if (!assignment) {
      throw new NotFoundException('Kurs nie jest przypisany temu użytkownikowi');
    }

    return assignment;
  }
}
