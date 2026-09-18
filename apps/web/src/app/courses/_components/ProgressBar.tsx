import UiProgressBar from '@/components/ui/ProgressBar';

// Postęp kursu liczony w blokach (nie w procentach) - pasek to wspólny
// components/ui/ProgressBar, tu tylko przeliczenie i podpis "x / y bloków".
export default function ProgressBar({
  currentBlockIndex,
  totalBlocks,
}: {
  currentBlockIndex: number;
  totalBlocks: number;
}) {
  if (totalBlocks <= 0) {
    return null;
  }

  const percent = Math.min(100, Math.max(0, Math.round((currentBlockIndex / totalBlocks) * 100)));

  return (
    <div>
      <UiProgressBar value={percent} />
      <p className="mt-1 text-xs font-semibold text-muted">
        {currentBlockIndex} / {totalBlocks} bloków
      </p>
    </div>
  );
}
