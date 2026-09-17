import Link from 'next/link';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import StatusBadge from './StatusBadge';
import ProgressBar from './ProgressBar';

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

export default function CourseCard({ course }: { course: CourseAssignmentSummary }) {
  const showProgress = course.status === 'IN_PROGRESS' || course.status === 'OVERDUE';

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900">{course.title}</h3>
        <StatusBadge status={course.status} />
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>{course.durationMinutes} min</span>
        {course.mandatory && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Obowiązkowy</span>
        )}
      </div>

      {showProgress && (
        <ProgressBar currentBlockIndex={course.currentBlockIndex} totalBlocks={course.totalBlocks} />
      )}

      {course.status === 'COMPLETED' && course.score !== null && (
        <p className="text-xs text-slate-500">Wynik: {course.score}%</p>
      )}

      <Link
        href={`/courses/${course.courseId}`}
        className="mt-auto rounded bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
      >
        {actionLabel(course.status)}
      </Link>
    </div>
  );
}
