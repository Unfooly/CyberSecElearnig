'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RISK_COLORS, RISK_LABELS, colorForRate, type RiskLevel } from '@/lib/risk-colors';
import type { DepartmentRow } from './DepartmentsTable';

const LEGEND: RiskLevel[] = ['high', 'medium', 'low'];

export default function DepartmentRiskChart({ rows }: { rows: DepartmentRow[] }) {
  // Dział bez obowiązkowych przypisań (null) nie ma sensownego słupka - jest
  // wymieniony w tekstowym odpowiedniku jako "Brak danych".
  const chartRows = rows
    .filter((row) => row.completionRate !== null)
    .map((row) => ({ name: row.departmentName, rate: row.completionRate as number }));

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm" aria-labelledby="risk-heading">
      <h2 id="risk-heading" className="mb-1 text-base font-semibold text-slate-900">
        Ryzyko w działach
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        Ukończenie szkoleń obowiązkowych per dział - im niższy słupek, tym wyższe ryzyko.
      </p>

      {chartRows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">Brak danych do wyświetlenia.</p>
      ) : (
        <>
          <div className="h-64 w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} width={44} />
                <Tooltip formatter={(value) => [`${value}%`, 'Ukończenie']} />
                <Bar dataKey="rate" isAnimationActive={false} radius={[4, 4, 0, 0]}>
                  {chartRows.map((row) => (
                    <Cell key={row.name} fill={colorForRate(row.rate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
            {LEGEND.map((level) => (
              <li key={level} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RISK_COLORS[level] }} />
                {RISK_LABELS[level]}
              </li>
            ))}
          </ul>
        </>
      )}

      {rows.length > 0 && (
        <table className="sr-only">
          <caption>Ukończenie szkoleń obowiązkowych per dział</caption>
          <thead>
            <tr>
              <th scope="col">Dział</th>
              <th scope="col">Ukończenie</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.departmentId ?? 'no-department'}>
                <th scope="row">{row.departmentName}</th>
                <td>{row.completionRate !== null ? `${row.completionRate}%` : 'Brak danych'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
