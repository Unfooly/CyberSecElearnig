import { ButtonLink } from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Pill from '@/components/ui/Pill';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import { LOCAL_CONTENT_BASE, contentAssetUrl } from '@/lib/content-assets';
import CourseCategoryIcon, { type CourseIconTone } from './CourseCategoryIcon';
import CourseThumbnail from './CourseThumbnail';
import ProgressBar from './ProgressBar';
import StatusBadge from './StatusBadge';

function actionLabel(status: CourseAssignmentSummary['status']): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'Start';
    case 'IN_PROGRESS':
    case 'OVERDUE':
      return 'Kontynuuj';
    case 'COMPLETED':
      // Nie "Powtórz" - apps/api nie pozwala zapisywać postępu po COMPLETED
      // (świadoma poprawka z poprzedniego zadania), więc kliknięcie i tak
      // pokaże tylko podsumowanie, nigdy nowej próby.
      return 'Zobacz podsumowanie';
  }
}

function toneFor(status: CourseAssignmentSummary['status']): CourseIconTone {
  if (status === 'COMPLETED') return 'ok';
  if (status === 'OVERDUE') return 'warn';
  return 'acc';
}

export default function CourseCard({ course, contentBase = LOCAL_CONTENT_BASE }: { course: CourseAssignmentSummary; contentBase?: string }) {
  const showProgress = course.status === 'IN_PROGRESS' || course.status === 'OVERDUE';

  return (
    <Card className="flex h-full flex-col gap-3 p-[18px]">
      {/* Miniatura modułu (D-084) zamiast ikony kategorii; kurs bez miniatury - dotychczasowy wygląd. */}
      {contentAssetUrl(contentBase, course.thumbnail, 'image') ? (
        <CourseThumbnail contentBase={contentBase} thumbnail={course.thumbnail} title={course.title} />
      ) : (
        <CourseCategoryIcon category={course.category} tone={toneFor(course.status)} />
      )}

      <h3 className="line-clamp-2 text-[15px] font-bold leading-snug">{course.title}</h3>

      <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold text-muted">
        <span>{course.durationMinutes} min</span>
        <span aria-hidden="true">·</span>
        <StatusBadge status={course.status} />
        {course.mandatory && <Pill tone="warn">Obowiązkowy</Pill>}
      </div>

      {showProgress && <ProgressBar currentBlockIndex={course.currentBlockIndex} totalBlocks={course.totalBlocks} />}

      {course.status === 'COMPLETED' && course.score !== null && (
        <p className="text-xs font-semibold text-muted">Wynik: {course.score}%</p>
      )}

      <ButtonLink
        href={`/courses/${course.courseId}`}
        variant={course.status === 'COMPLETED' ? 'secondary' : 'primary'}
        size="sm"
        className="mt-auto"
      >
        {actionLabel(course.status)}
      </ButtonLink>
    </Card>
  );
}
