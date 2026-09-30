import type { CourseAssignmentSummary } from './courses-types';

/**
 * „Następna sprawa” na ekranie zamknięcia (D-130): pierwszy NIEUKOŃCZONY przypisany kurs inny niż bieżący, w kolejności listy „Moje kursy”
 * (API - od najstarszego przypisania). Wszystko ukończone - null („Następna sprawa · wkrótce”).
 */
export function nextUnfinishedCourse(courses: readonly CourseAssignmentSummary[], currentCourseId: string): { courseId: string; title: string } | null {
  const next = courses.find((course) => course.courseId !== currentCourseId && course.status !== 'COMPLETED');
  return next ? { courseId: next.courseId, title: next.title } : null;
}
