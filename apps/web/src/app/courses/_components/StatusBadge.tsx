import Pill, { type PillTone } from '@/components/ui/Pill';
import type { AssignmentStatus } from '@/lib/courses-types';

const TONES: Record<AssignmentStatus, PillTone> = {
  NOT_STARTED: 'off',
  IN_PROGRESS: 'acc',
  COMPLETED: 'ok',
  OVERDUE: 'warn',
};

const LABELS: Record<AssignmentStatus, string> = {
  NOT_STARTED: 'Nierozpoczęty',
  IN_PROGRESS: 'W toku',
  COMPLETED: 'Ukończony',
  OVERDUE: 'Zaległy',
};

export default function StatusBadge({ status }: { status: AssignmentStatus }) {
  return <Pill tone={TONES[status]}>{LABELS[status]}</Pill>;
}
