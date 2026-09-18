'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendPoint } from '@/lib/dashboard-types';
import { formatMonthLabel } from '@/lib/format';

export default function CompletionTrendChart({ points }: { points: TrendPoint[] }) {
  const hasData = points.some((point) => point.completionRate !== null);
  const data = points.map((point) => ({ ...point, label: formatMonthLabel(point.month) }));

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm" aria-labelledby="trend-heading">
      <h2 id="trend-heading" className="mb-1 text-base font-semibold text-slate-900">
        Postęp szkoleń obowiązkowych w czasie
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        Odsetek ukończonych szkoleń obowiązkowych na koniec miesiąca (ostatnie 6 miesięcy).
      </p>

      {!hasData ? (
        <p className="py-10 text-center text-sm text-slate-400">Brak danych do wyświetlenia.</p>
      ) : (
        <>
          <div className="h-64 w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} width={44} />
                <Tooltip
                  formatter={(value) => [
                    value === null || value === undefined ? 'Brak danych' : `${value}%`,
                    'Ukończenie',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="completionRate"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#trendFill)"
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Postęp szkoleń obowiązkowych w czasie</caption>
            <thead>
              <tr>
                <th scope="col">Miesiąc</th>
                <th scope="col">Ukończenie</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.month}>
                  <th scope="row">{point.label}</th>
                  <td>{point.completionRate !== null ? `${point.completionRate}%` : 'Brak danych'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
