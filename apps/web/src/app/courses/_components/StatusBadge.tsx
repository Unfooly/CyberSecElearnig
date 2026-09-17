import type { AssignmentStatus } from '@/lib/courses-types';

const STYLES: Record<AssignmentStatus, string> = {
  NOT_STARTED: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
};

const LABELS: Record<AssignmentStatus, string> = {
  NOT_STARTED: 'Nierozpoczęty',
  IN_PROGRESS: 'W toku',
  COMPLETED: 'Ukończony',
  OVERDUE: 'Zaległy',
};

export default function StatusBadge({ status }: { status: AssignmentStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
