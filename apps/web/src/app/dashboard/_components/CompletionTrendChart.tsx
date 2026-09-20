'use client';

import { LineChart } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendPoint } from '@/lib/dashboard-types';
import { formatMonthLabel } from '@/lib/datetime';

export default function CompletionTrendChart({ points }: { points: TrendPoint[] }) {
  const hasData = points.some((point) => point.completionRate !== null);
  const data = points.map((point) => ({ ...point, label: formatMonthLabel(point.month) }));

  return (
    <section className="rounded-card border border-border bg-surface p-5 shadow-card" aria-labelledby="trend-heading">
      <h2 id="trend-heading" className="mb-1 text-lg font-bold tracking-[-0.01em]">
        Postęp szkoleń obowiązkowych w czasie
      </h2>
      <p className="mb-4 text-xs text-muted">
        Odsetek ukończonych szkoleń obowiązkowych na koniec miesiąca (ostatnie 6 miesięcy).
      </p>

      {!hasData ? (
        <EmptyState icon={LineChart} title="Trend pojawi się po pierwszym przypisaniu szkolenia" description="Gdy przypiszesz pracownikom obowiązkowe kursy, zobaczysz tu postęp miesiąc po miesiącu." />
      ) : (
        <>
          <div className="h-64 w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E6E2" />
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
                  stroke="#6C5CE7"
                  strokeWidth={2}
                  fill="#EEEBFF"
                  dot={{ r: 4, fill: '#6C5CE7', strokeWidth: 0 }}
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
