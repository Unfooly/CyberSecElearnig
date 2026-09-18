import { Building2 } from 'lucide-react';
import Card, { CardHeader } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Pill, { type PillTone } from '@/components/ui/Pill';
import ProgressBar, { type ProgressTone } from '@/components/ui/ProgressBar';
import { Table, Td, Th, Tr } from '@/components/ui/Table';

export interface DepartmentRow {
  departmentId: string | null;
  departmentName: string;
  completionRate: number | null;
  mandatoryTotal: number;
  mandatoryCompleted: number;
}

function toneFor(rate: number): ProgressTone {
  if (rate === 100) return 'success';
  if (rate < 50) return 'warning';
  return 'accent';
}

function statusFor(row: DepartmentRow): { tone: PillTone; label: string } {
  if (row.completionRate === null) return { tone: 'off', label: 'Brak obowiązkowych' };
  if (row.completionRate === 100) return { tone: 'ok', label: 'Komplet' };
  if (row.completionRate < 50) return { tone: 'warn', label: 'Do nadrobienia' };
  return { tone: 'acc', label: 'W toku' };
}

export default function DepartmentsTable({ rows }: { rows: DepartmentRow[] }) {
  return (
    <Card>
      <CardHeader title="Ukończenie według działów" />
      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Brak działów do porównania"
          description="Dodaj pracowników do działów, a zobaczysz tu postęp szkoleń każdego z nich."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-[28%]">Dział</Th>
              <Th className="w-[44%]">Ukończenie</Th>
              <Th>Ukończone / Wszystkie obowiązkowe</Th>
              <Th className="text-right">Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = statusFor(row);
              return (
                <Tr key={row.departmentId ?? 'no-department'}>
                  <Td className="font-semibold">{row.departmentName}</Td>
                  <Td>
                    {row.completionRate !== null ? (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <ProgressBar value={row.completionRate} tone={toneFor(row.completionRate)} label={`Ukończenie: ${row.departmentName}`} />
                        </div>
                        <b className="w-10 text-right">{row.completionRate}%</b>
                      </div>
                    ) : (
                      <span className="text-muted">Brak danych</span>
                    )}
                  </Td>
                  <Td>
                    {row.mandatoryCompleted} / {row.mandatoryTotal}
                  </Td>
                  <Td className="text-right">
                    <Pill tone={status.tone} dot>
                      {status.label}
                    </Pill>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
