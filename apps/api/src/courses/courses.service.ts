import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssignmentStatus, Course, CourseAssignment, Prisma } from '@prisma/client';
import { toClientBlock } from '@cyberszkolo/content';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { SubmitBlockProgressDto } from './dto/submit-block-progress.dto';
import { CourseAssignmentSummaryDto } from './dto/course-assignment-summary.dto';
import { CourseDetailDto } from './dto/course-detail.dto';
import { CourseProgressResponseDto } from './dto/course-progress-response.dto';
import { clientProgress, evidenceSummary, shuffleContext } from './client-view';
import { resolveVersion } from './course-versions';
import { ProgressV2, computeScore, entryOf, readProgress, toJson } from './progress';
import { AttemptResponse, evaluateAttempt, evaluateSubmit } from './scoring/evaluate';

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
        where: { organizationId, userId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              category: true,
              durationMinutes: true,
              mandatory: true,
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
      mandatory: assignment.course.mandatory,
      status: assignment.status,
      score: assignment.score,
      dueDate: assignment.dueDate,
      completedAt: assignment.completedAt,
      currentBlockIndex: assignment.currentBlockIndex,
      // Liczba bloków przypiętej wersji (na której pracuje pracownik); dla nieprzypiętych - treść kursu.
      totalBlocks: assignment.courseVersion?.blockCount ?? this.countBlocks(assignment.course.contentBlocks),
    }));
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
        progress: clientProgress(readProgress(current.progress), version.blocks) as unknown as Prisma.JsonValue,
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
        },
        // Dowody po tym zapisie (liczby liczy serwer; total null dla maila do zatwierdzenia odpowiedzi).
        evidence: evidenceSummary(progress, blocks),
        gamification: gamification
          ? {
              xpGained: gamification.xpGained,
              newLevel: gamification.newLevel,
              leveledUp: gamification.leveledUp,
              unlockedBadges: gamification.unlockedBadges.map((badge) => ({
                code: badge.code,
                title: badge.title,
                icon: badge.icon,
                xpReward: badge.xpReward,
              })),
            }
          : null,
      };
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

      return response;
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

  // Blokada wiersza przypisania do końca transakcji (RLS obowiązuje: widać tylko własną organizację).
  private async lockOwnAssignment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    courseId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "course_assignments" WHERE "organizationId" = ${organizationId} AND "userId" = ${userId} AND "courseId" = ${courseId} FOR UPDATE`;
  }

  private async findOwnAssignment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    courseId: string,
  ): Promise<AssignmentWithCourse> {
    const assignment = await tx.courseAssignment.findFirst({
      where: { organizationId, userId, courseId },
      include: { course: true },
    });

    if (!assignment) {
      throw new NotFoundException('Kurs nie jest przypisany temu użytkownikowi');
    }

    return assignment;
  }
}
