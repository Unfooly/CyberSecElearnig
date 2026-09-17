export interface DepartmentRow {
  departmentId: string | null;
  departmentName: string;
  completionRate: number | null;
  mandatoryTotal: number;
  mandatoryCompleted: number;
}

export default function DepartmentsTable({ rows }: { rows: DepartmentRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Dział
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Ukończenie
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Ukończone / Wszystkie obowiązkowe
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                Brak danych do wyświetlenia.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.departmentId ?? 'no-department'} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-900">{row.departmentName}</td>
                <td className="px-4 py-3">
                  {row.completionRate !== null ? `${row.completionRate}%` : 'Brak danych'}
                </td>
                <td className="px-4 py-3">
                  {row.mandatoryCompleted} / {row.mandatoryTotal}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
