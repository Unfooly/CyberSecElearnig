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
}
