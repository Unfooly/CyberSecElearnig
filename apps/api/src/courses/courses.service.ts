import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Course, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SubmitBlockProgressDto } from './dto/submit-block-progress.dto';
import { CourseAssignmentSummaryDto } from './dto/course-assignment-summary.dto';
import { CourseDetailDto } from './dto/course-detail.dto';
import { CourseProgressResponseDto } from './dto/course-progress-response.dto';
import { ContentBlockType } from './content-block.types';

const SCOREABLE_BLOCK_TYPES: ContentBlockType[] = ['QUIZ', 'BRANCHING_SCENARIO'];

interface ContentBlockOption {
  correct?: boolean;
  // Format użyty w przykładzie BRANCHING_SCENARIO w
  // docs/content-backlog-elearning.md.
  outcome?: 'correct' | 'wrong';
  [key: string]: unknown;
}

interface ContentBlock {
  type: ContentBlockType;
  options?: ContentBlockOption[];
  [key: string]: unknown;
}

interface ProgressEntry {
  type: ContentBlockType;
  answer?: number;
  correct?: boolean;
  answeredAt: string;
}

function isOptionCorrect(option: ContentBlockOption): boolean {
  return option.correct === true || option.outcome === 'correct';
}

/**
 * Usuwa klucz odpowiedzi (correct/outcome) z opcji bloków QUIZ/
 * BRANCHING_SCENARIO przed wysłaniem treści do klienta — inaczej cały sens
 * liczenia oceny wyłącznie po stronie serwera jest zniweczony, bo poprawna
 * odpowiedź byłaby widoczna w odpowiedzi /start, zanim user w ogóle
 * odpowie (patrz security review tego modułu).
 */
function omitAnswerKey(option: ContentBlockOption): ContentBlockOption {
  const sanitized = { ...option };
  delete sanitized.correct;
  delete sanitized.outcome;
  return sanitized;
}

@Injectable()
export class CoursesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

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
      totalBlocks: this.countBlocks(assignment.course.contentBlocks),
    }));
  }

  async startOrContinue(
    organizationId: string,
    userId: string,
    courseId: string,
  ): Promise<CourseDetailDto> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const assignment = await this.findOwnAssignment(tx, organizationId, userId, courseId);

      const current =
        assignment.status === AssignmentStatus.NOT_STARTED
          ? await tx.courseAssignment.update({
              where: { id: assignment.id },
              data: { status: AssignmentStatus.IN_PROGRESS },
            })
          : assignment;

      const contentBlocks = this.parseContentBlocks(assignment.course).map((block) =>
        SCOREABLE_BLOCK_TYPES.includes(block.type) && Array.isArray(block.options)
          ? { ...block, options: block.options.map(omitAnswerKey) }
          : block,
      );

      return {
        assignmentId: current.id,
        courseId: assignment.course.id,
        title: assignment.course.title,
        status: current.status,
        currentBlockIndex: current.currentBlockIndex,
        contentBlocks: contentBlocks as unknown as Prisma.JsonValue,
        progress: current.progress,
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
      const assignment = await this.findOwnAssignment(tx, organizationId, userId, courseId);

      if (assignment.status === AssignmentStatus.COMPLETED) {
        throw new BadRequestException('Kurs jest już ukończony');
      }

      const contentBlocks = this.parseContentBlocks(assignment.course);

      if (dto.blockIndex >= contentBlocks.length) {
        throw new BadRequestException('Nieprawidłowy indeks bloku treści');
      }

      // Bloki muszą być ukończone po kolei — inaczej user mógłby przeskoczyć
      // od razu do ostatniego bloku i "ukończyć" obowiązkowe szkolenie z
      // pominięciem ocenianych bloków QUIZ/BRANCHING_SCENARIO (patrz code
      // review tego modułu). currentBlockIndex rośnie zawsze o dokładnie
      // jeden, nigdy nie przeskakuje.
      if (dto.blockIndex !== assignment.currentBlockIndex) {
        throw new BadRequestException('Bloki trzeba ukończyć po kolei');
      }

      const block = contentBlocks[dto.blockIndex];
      const entry = this.evaluateBlock(block, dto.answer);

      const existingProgress = (assignment.progress as Record<string, ProgressEntry> | null) ?? {};
      const progress = { ...existingProgress, [dto.blockIndex]: entry };

      const currentBlockIndex = assignment.currentBlockIndex + 1;
      const isComplete = currentBlockIndex >= contentBlocks.length;
      const score = this.computeScore(progress);

      const updated = await tx.courseAssignment.update({
        where: { id: assignment.id },
        data: {
          progress,
          currentBlockIndex,
          score,
          status: isComplete ? AssignmentStatus.COMPLETED : AssignmentStatus.IN_PROGRESS,
          completedAt: isComplete ? new Date() : null,
        },
      });

      return {
        assignmentId: updated.id,
        status: updated.status,
        currentBlockIndex: updated.currentBlockIndex,
        score: updated.score,
        completedAt: updated.completedAt,
        lastResult: { blockIndex: dto.blockIndex, type: entry.type, correct: entry.correct },
      };
    });
  }

  /**
   * Wyznacza correct WYŁĄCZNIE po stronie serwera, porównując przesłany
   * `answer` (indeks wybranej opcji) z contentBlocks zapisanym w bazie dla
   * tego kursu. Klient nigdy nie przesyła ani nie wpływa na ocenę
   * bezpośrednio — DTO (SubmitBlockProgressDto) nie ma nawet pola "correct".
   */
  private evaluateBlock(block: ContentBlock, answer: number | undefined): ProgressEntry {
    const answeredAt = new Date().toISOString();

    if (!SCOREABLE_BLOCK_TYPES.includes(block.type)) {
      // VIDEO / DRAG_AND_DROP - samo oznaczenie wykonania, bez oceny.
      return { type: block.type, answeredAt };
    }

    const option = answer !== undefined ? block.options?.[answer] : undefined;
    if (answer === undefined || !option) {
      throw new BadRequestException('Brak lub nieprawidłowa odpowiedź dla tego bloku');
    }

    return { type: block.type, answer, correct: isOptionCorrect(option), answeredAt };
  }

  private computeScore(progress: Record<string, ProgressEntry>): number | null {
    const scored = Object.values(progress).filter((entry) => entry.correct !== undefined);
    if (scored.length === 0) {
      return null;
    }
    const correctCount = scored.filter((entry) => entry.correct).length;
    return Math.round((correctCount / scored.length) * 100);
  }

  /**
   * Wersja parseContentBlocks, która nie rzuca — używana przy listowaniu
   * WIELU kursów naraz (listMyCourses), gdzie jeden kurs z uszkodzoną
   * treścią nie powinien wywalać całej listy pozostałych. 0 jest bezpiecznym
   * fallbackiem (frontend i tak nie pokaże paska postępu dla totalBlocks=0).
   */
  private countBlocks(contentBlocks: Prisma.JsonValue): number {
    return Array.isArray(contentBlocks) ? contentBlocks.length : 0;
  }

  private parseContentBlocks(course: Course): ContentBlock[] {
    const contentBlocks = course.contentBlocks;
    if (!Array.isArray(contentBlocks)) {
      // Błąd danych administracyjnych (treść kursu), nie błąd wejścia
      // klienta - stąd 500, nie 400.
      throw new InternalServerErrorException('Kurs ma nieprawidłowo zapisaną treść');
    }
    return contentBlocks as unknown as ContentBlock[];
  }

  private async findOwnAssignment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    courseId: string,
  ) {
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
