import { Mail } from 'lucide-react';
import Pill, { type PillTone } from '@/components/ui/Pill';
import ProgressBar, { type ProgressTone } from '@/components/ui/ProgressBar';
import KpiCard from '@/app/dashboard/_components/KpiCard';

// Podgląd dashboardu w hero: prawdziwe komponenty aplikacji (KpiCard,
// ProgressBar, Pill) w trybie "demo" - statyczne dane, zero zapytań do API.
const DEMO_DEPARTMENTS: { name: string; rate: number; tone: ProgressTone; pill: { tone: PillTone; label: string } }[] = [
  { name: 'IT', rate: 100, tone: 'success', pill: { tone: 'ok', label: 'Komplet' } },
  { name: 'Finanse', rate: 88, tone: 'accent', pill: { tone: 'acc', label: 'W toku' } },
  { name: 'Sprzedaż', rate: 64, tone: 'warning', pill: { tone: 'warn', label: '5 zaległych' } },
  { name: 'Zarząd', rate: 50, tone: 'warning', pill: { tone: 'warn', label: '2 zaległe' } },
];

export default function DashboardPreview() {
  return (
    <div className="relative rounded-[20px] border border-border bg-surface shadow-[0_2px_4px_rgba(19,19,19,.04),0_40px_80px_-40px_rgba(19,19,19,.35)] lg:mr-6">
      <div className="flex h-11 items-center gap-1.5 rounded-t-[19px] border-b border-border bg-[#FBFBF9] px-4" aria-hidden="true">
        <i className="block h-2.5 w-2.5 rounded-full bg-border" />
        <i className="block h-2.5 w-2.5 rounded-full bg-border" />
        <i className="block h-2.5 w-2.5 rounded-full bg-border" />
        <span className="ml-2.5 truncate text-xs font-semibold text-muted">app.unfooly.com — Dashboard</span>
      </div>

      <div className="flex flex-col gap-3.5 rounded-b-[19px] bg-paper p-4 sm:p-5" role="img" aria-label="Przykładowy dashboard Unfooly z ukończeniem szkoleń według działów">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard compact label="Ukończenie szkoleń" value="78" unit="%" progress={{ value: 78 }} />
          <KpiCard compact label="Aktywni użytkownicy" value="46" unit="/ 52" progress={{ value: 88, tone: 'success' }} />
          <KpiCard compact label="Zaległe szkolenia" value="9" hint="w 4 działach" hintTone="warn" />
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="grid grid-cols-[84px_minmax(0,1fr)_40px] gap-3 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted sm:grid-cols-[100px_minmax(0,1fr)_44px_92px]">
            <span>Dział</span>
            <span>Ukończenie</span>
            <span />
            <span className="hidden sm:block">Status</span>
          </div>
          {DEMO_DEPARTMENTS.map((row) => (
            <div
              key={row.name}
              className="grid grid-cols-[84px_minmax(0,1fr)_40px] items-center gap-3 border-t border-border px-4 py-2.5 text-[13px] font-semibold sm:grid-cols-[100px_minmax(0,1fr)_44px_92px]"
            >
              <span>{row.name}</span>
              <ProgressBar value={row.rate} tone={row.tone} label={`Ukończenie: ${row.name}`} />
              <span>{row.rate}%</span>
              <span className="hidden sm:block">
                <Pill tone={row.pill.tone}>{row.pill.label}</Pill>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-4 mb-4 flex items-center gap-3 rounded-[14px] border border-border bg-surface p-3.5 shadow-[0_2px_4px_rgba(19,19,19,.04),0_40px_80px_-40px_rgba(19,19,19,.35)] lg:absolute lg:-right-10 lg:bottom-7 lg:mx-0 lg:mb-0 lg:w-[300px]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success" aria-hidden="true">
          <Mail size={22} strokeWidth={2} />
        </span>
        <div>
          <b className="block text-sm">Anna zgłosiła podejrzany e-mail</b>
          <span className="text-xs text-muted">Symulacja „Faktura do zapłaty” · 2 min temu</span>
        </div>
      </div>
    </div>
  );
}
