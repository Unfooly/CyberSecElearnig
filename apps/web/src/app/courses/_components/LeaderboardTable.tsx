import type { LeaderboardEntry } from '@/lib/gamification-types';
import AvatarDisplay from './AvatarDisplay';

export default function LeaderboardTable({
  entries,
  currentUserId,
}: {
  entries: LeaderboardEntry[];
  // Id zalogowanego użytkownika, wyliczone SERVER-SIDE z tokena JWT (patrz
  // courses/page.tsx) - wyłącznie do podświetlenia "to Ty" w tabeli, nigdy
  // do filtrowania danych (to już zrobił backend po organizationId z JWT).
  currentUserId: string;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">Ranking jest jeszcze pusty.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">#</th>
          <th className="py-2 pr-2 font-medium" />
          <th className="py-2 pr-2 font-medium">Imię i nazwisko</th>
          <th className="py-2 pr-2 font-medium">Dział</th>
          <th className="py-2 pr-2 font-medium">Poziom</th>
          <th className="py-2 pr-2 text-right font-medium">XP</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const isCurrentUser = entry.userId === currentUserId;
          return (
            <tr
              key={entry.userId}
              className={`border-b border-slate-100 last:border-0 ${isCurrentUser ? 'bg-blue-50' : ''}`}
            >
              <td className="py-2 pr-2 font-medium text-slate-500">{entry.rank}</td>
              <td className="py-2 pr-2">
                <AvatarDisplay avatarUrl={entry.avatarUrl} size="sm" />
              </td>
              <td className="py-2 pr-2 font-medium text-slate-900">
                {entry.firstName} {entry.lastName}
                {isCurrentUser && <span className="ml-2 text-xs font-normal text-blue-700">(Ty)</span>}
              </td>
              <td className="py-2 pr-2 text-slate-500">{entry.departmentName ?? '—'}</td>
              <td className="py-2 pr-2 text-slate-500">{entry.level}</td>
              <td className="py-2 pr-2 text-right font-medium text-slate-900">{entry.xp}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
