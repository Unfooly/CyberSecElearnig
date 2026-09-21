import { AssignmentStatus } from '@prisma/client';
import { ContentBlockType } from '../content-block.types';

export class CourseProgressResponseDto {
  assignmentId!: string;
  status!: AssignmentStatus;
  currentBlockIndex!: number;
  score!: number | null;
  completedAt!: Date | null;
  lastResult!: {
    blockIndex: number;
    blockId: string;
    // Typ z zapisanej wersji kursu (string: klient obsługuje też typy, których ten kod jeszcze nie zna).
    type: ContentBlockType | string;
    correct?: boolean;
    // 0..1; obecne dla bloków ocenianych.
    points?: number;
    // Wynik po ukończeniu bloku (np. rozstrzygnięcie kryteriów maila, poprawna kolejność).
    detail?: Record<string, unknown>;
  };
  // Dowody śledztwa po tym zapisie (client-view.ts, evidenceSummary): liczby i id bloków, bez id elementów.
  evidence!: {
    collected: number;
    total: number | null;
    perBlock: { blockId: string; collected: number; total: number | null }[];
  };
  // Obecne WYŁĄCZNIE gdy ta odpowiedź ukończyła kurs (isComplete w
  // CoursesService) - front (CourseRewardModal) pokazuje modal nagrody
  // tylko wtedy, nie przy każdym zapisie postępu.
  gamification!: {
    xpGained: number;
    newLevel: number;
    leveledUp: boolean;
    unlockedBadges: { code: string; title: string; icon: string; xpReward: number }[];
  } | null;
}
