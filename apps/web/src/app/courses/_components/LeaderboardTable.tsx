import { Trophy } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { initialsFrom } from '@/components/ui/InitialsAvatar';
import Pill from '@/components/ui/Pill';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
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
    return (
      <EmptyState
        icon={Trophy}
        title="Ranking jest jeszcze pusty"
        description="Ukończ pierwszy kurs, żeby zdobyć XP i pojawić się w rankingu organizacji."
      />
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-14">#</Th>
          <Th>Imię i nazwisko</Th>
          <Th>Dział</Th>
          <Th>Poziom</Th>
          <Th className="text-right">XP</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const isCurrentUser = entry.userId === currentUserId;
          // Podświetlenie wiersza "Ty" (accent-soft) idzie na komórkach, bo
          // tło <tr> przykrywają tła komórek.
          const highlight = isCurrentUser ? 'bg-accent-soft group-hover:bg-accent-soft' : '';
          return (
            <Tr key={entry.userId}>
              <Td className={`font-bold text-muted ${highlight}`}>{entry.rank}</Td>
              <Td className={highlight}>
                <div className="flex items-center gap-2.5 font-semibold">
                  <AvatarDisplay
                    avatarUrl={entry.avatarUrl}
                    size="sm"
                    initials={initialsFrom(entry.firstName, entry.lastName, '')}
                    userId={entry.userId}
                  />
                  <span>
                    {entry.firstName} {entry.lastName}
                  </span>
                  {isCurrentUser && <Pill tone="acc">Ty</Pill>}
                </div>
              </Td>
              <Td className={`${entry.departmentName ? '' : 'text-muted'} ${highlight}`}>{entry.departmentName ?? '—'}</Td>
              <Td className={highlight}>{entry.level}</Td>
              <Td className={`text-right ${highlight}`}>
                <b>{entry.xp}</b>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
