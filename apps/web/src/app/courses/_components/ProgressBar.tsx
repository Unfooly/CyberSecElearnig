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
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {currentBlockIndex} / {totalBlocks} bloków
      </p>
    </div>
  );
}
