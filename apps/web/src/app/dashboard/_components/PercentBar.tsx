import { colorForRate } from '@/lib/risk-colors';

// Pasek postępu w procentach (ProgressBar z modułu kursów liczy bloki, nie %).
export default function PercentBar({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-slate-400">Brak przypisań</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 w-28 overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: colorForRate(value) }} />
      </div>
      <span className="w-10 text-slate-700">{value}%</span>
    </div>
  );
}
