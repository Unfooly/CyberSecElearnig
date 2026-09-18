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
    type: ContentBlockType;
    correct?: boolean;
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
