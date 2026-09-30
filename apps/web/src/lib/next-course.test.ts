import { describe, expect, it } from 'vitest';
import type { CourseAssignmentSummary } from './courses-types';
import { nextUnfinishedCourse } from './next-course';

const course = (courseId: string, status: CourseAssignmentSummary['status']): CourseAssignmentSummary => ({
  assignmentId: `a-${courseId}`,
  courseId,
  title: `Kurs ${courseId}`,
  category: 'EMAIL_SECURITY',
  durationMinutes: 10,
  mandatory: false,
  status,
  score: null,
  dueDate: null,
  completedAt: null,
  currentBlockIndex: 0,
  totalBlocks: 3,
});

describe('nextUnfinishedCourse', () => {
  it('pierwszy nieukończony kurs inny niż bieżący, w kolejności listy (także rozpoczęty)', () => {
    const list = [course('m1', 'COMPLETED'), course('m2', 'IN_PROGRESS'), course('m3', 'NOT_STARTED')];
    expect(nextUnfinishedCourse(list, 'm1')).toEqual({ courseId: 'm2', title: 'Kurs m2' });
    expect(nextUnfinishedCourse(list, 'm2')).toEqual({ courseId: 'm3', title: 'Kurs m3' });
  });

  it('bieżący kurs nie jest „następną sprawą”, nawet gdy jest nieukończony; wszystko ukończone - null', () => {
    expect(nextUnfinishedCourse([course('m1', 'IN_PROGRESS')], 'm1')).toBeNull();
    expect(nextUnfinishedCourse([course('m1', 'COMPLETED'), course('m2', 'COMPLETED')], 'm1')).toBeNull();
    expect(nextUnfinishedCourse([], 'm1')).toBeNull();
  });
});
