import { Trophy } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { initialsFrom } from '@/components/ui/InitialsAvatar';
import Pill from '@/components/ui/Pill';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import type { Leaderboard, LeaderboardEntry } from '@/lib/gamification-types';
import AvatarDisplay from './AvatarDisplay';
import PinnedBadges from './PinnedBadges';

// Ranking organizacji (D-112): pierwsza dziesiątka + pozycja zalogowanego (osobny wiersz, gdy jest poza dziesiątką). Imię i
// inicjał nazwiska, poziom, XP, do 3 przypiętych osiągnięć przy nazwisku. Dane z API są już ograniczone do organizacji z JWT.
export default function LeaderboardTable({
  leaderboard,
  currentUserId,
}: {
  leaderboard: Leaderboard;
  // Id zalogowanego użytkownika, wyliczone SERVER-SIDE z tokena JWT (patrz
  // courses/page.tsx) - wyłącznie do podświetlenia "to Ty" w tabeli, nigdy
  // do filtrowania danych (to już zrobił backend po organizationId z JWT).
  currentUserId: string;
}) {
  const { top, me } = leaderboard;
  if (top.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="Ranking jest jeszcze pusty"
        description="Ukończ pierwszy kurs, żeby zdobyć XP i pojawić się w rankingu organizacji."
      />
    );
  }
  const meOutsideTop = me && !top.some((entry) => entry.userId === me.userId) ? me : null;

  const row = (entry: LeaderboardEntry) => {
    const isCurrentUser = entry.userId === currentUserId;
    // Podświetlenie wiersza "Ty" (accent-soft) idzie na komórkach, bo
    // tło <tr> przykrywają tła komórek.
    const highlight = isCurrentUser ? 'bg-accent-soft group-hover:bg-accent-soft' : '';
    return (
      <Tr key={entry.userId}>
        <Td className={`font-bold text-muted ${highlight}`}>{entry.rank}</Td>
        <Td className={highlight}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-semibold" data-testid="leaderboard-name">
            <AvatarDisplay avatarUrl={entry.avatarUrl} size="sm" initials={initialsFrom(entry.firstName, entry.lastInitial, '')} userId={entry.userId} />
            <span>
              {entry.firstName} {entry.lastInitial ? `${entry.lastInitial}.` : ''}
            </span>
            <PinnedBadges pinned={entry.pinned} />
            {isCurrentUser && <Pill tone="acc">Ty</Pill>}
          </div>
        </Td>
        <Td className={highlight}>{entry.level}</Td>
        <Td className={`text-right ${highlight}`}>
          <b>{entry.xp}</b>
        </Td>
      </Tr>
    );
  };

  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-14">#</Th>
          <Th>Imię</Th>
          <Th>Poziom</Th>
          <Th className="text-right">XP</Th>
        </tr>
      </thead>
      <tbody>
        {top.map(row)}
        {meOutsideTop && (
          <>
            <tr aria-hidden="true">
              <td colSpan={4} className="px-5 py-1 text-center text-xs font-bold text-muted">
                ⋯
              </td>
            </tr>
            {row(meOutsideTop)}
          </>
        )}
      </tbody>
    </Table>
  );
}
