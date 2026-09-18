export type ProgressTone = 'accent' | 'success' | 'warning';

const FILL: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
};

// Pasek 6 px w procentach (0-100). Nie mylić z courses/_components/ProgressBar
// (liczy bloki kursu, nie procenty).
export default function ProgressBar({
  value,
  tone = 'accent',
  label,
}: {
  value: number;
  tone?: ProgressTone;
  label?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full border border-border bg-paper"
    >
      <div className={`h-full rounded-full ${FILL[tone]}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
