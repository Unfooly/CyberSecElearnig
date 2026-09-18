import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LeaderboardTable from './LeaderboardTable';
import type { LeaderboardEntry } from '@/lib/gamification-types';

const entries: LeaderboardEntry[] = [
  { rank: 1, userId: 'user-1', firstName: 'Jan', lastName: 'Kowalski', avatarUrl: 'fox', level: 5, xp: 900, departmentName: 'IT' },
  { rank: 2, userId: 'user-2', firstName: 'Anna', lastName: 'Nowak', avatarUrl: null, level: 3, xp: 400, departmentName: null },
];

describe('LeaderboardTable', () => {
  it('renderuje wiersz dla każdego wpisu z pozycją, imieniem/nazwiskiem, działem, poziomem i XP', () => {
    render(<LeaderboardTable entries={entries} currentUserId="user-2" />);

    expect(screen.getByText('Jan Kowalski')).toBeInTheDocument();
    expect(screen.getByText('IT')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.getByText('Anna Nowak')).toBeInTheDocument();
    // Brak działu -> myślnik, nie pusty string ani "null".
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('wyróżnia wiersz zalogowanego użytkownika pillem "Ty"', () => {
    render(<LeaderboardTable entries={entries} currentUserId="user-2" />);

    const label = screen.getByText('Ty');
    expect(label).toBeInTheDocument();
    expect(label.closest('tr')).toHaveTextContent('Anna Nowak');
  });

  it('nie pokazuje pilla "Ty" u nikogo, gdy currentUserId nie pasuje do żadnego wpisu', () => {
    render(<LeaderboardTable entries={entries} currentUserId="user-inny" />);

    expect(screen.queryByText('Ty')).not.toBeInTheDocument();
  });

  it('pokazuje komunikat o pustym rankingu zamiast pustej tabeli', () => {
    render(<LeaderboardTable entries={[]} currentUserId="user-1" />);

    expect(screen.getByText(/ranking jest jeszcze pusty/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
