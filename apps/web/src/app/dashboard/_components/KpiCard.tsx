interface KpiCardProps {
  label: string;
  value: string;
  // Dla metryk, których dziś po prostu nie ma (phishing) - inny styl niż
  // "brak completions", żeby nie wyglądało jak błąd czy 0%.
  muted?: boolean;
}

export default function KpiCard({ label, value, muted = false }: KpiCardProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={
          muted
            ? 'mt-2 text-sm italic text-slate-400'
            : 'mt-2 text-2xl font-semibold text-slate-900'
        }
      >
        {value}
      </p>
    </div>
  );
}
