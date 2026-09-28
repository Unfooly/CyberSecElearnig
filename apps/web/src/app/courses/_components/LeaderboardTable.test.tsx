import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import LeaderboardTable from './LeaderboardTable';
import type { Leaderboard, LeaderboardEntry } from '@/lib/gamification-types';

const flawless = { code: 'flawless-case', title: 'Flawless Case', icon: 'osiagniecie-perfekcyjne-sledztwo', rank: 'LEGENDARY' as const };
const first = { code: 'first-case-closed', title: 'First Case Closed', icon: 'osiagniecie-pierwsza-sprawa', rank: 'MILESTONE' as const };
const entries: LeaderboardEntry[] = [
  { rank: 1, userId: 'user-1', firstName: 'Jan', lastInitial: 'K', avatarUrl: 'fox', level: 5, xp: 900, pinned: [flawless, first] },
  { rank: 2, userId: 'user-2', firstName: 'Anna', lastInitial: 'N', avatarUrl: null, level: 3, xp: 400, pinned: [] },
];
const board = (overrides: Partial<Leaderboard> = {}): Leaderboard => ({ enabled: true, top: entries, me: entries[1], ...overrides });

describe('LeaderboardTable (D-112)', () => {
  it('wiersz: miejsce, imię i inicjał nazwiska, poziom, XP; bez działu i pełnego nazwiska', () => {
    render(<LeaderboardTable leaderboard={board()} currentUserId="user-2" />);

    expect(screen.getByText('Jan K.')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.getByText('Anna N.')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Dział' })).not.toBeInTheDocument();
  });

  it('przypięte osiągnięcia przy nazwisku: miniatury 24 px z nazwą w podpowiedzi; stuknięcie pokazuje nazwę', () => {
    render(<LeaderboardTable leaderboard={board()} currentUserId="user-2" />);

    const row = screen.getByText('Jan K.').closest('tr')!;
    const badges = within(row).getAllByTestId('pinned-badge');
    expect(badges.map((badge) => badge.getAttribute('title'))).toEqual(['Flawless Case', 'First Case Closed']);
    expect(badges[0].querySelector('img')).toHaveAttribute('src', '/achievements/osiagniecie-perfekcyjne-sledztwo.svg');
    expect(badges[0].querySelector('img')).toHaveAttribute('width', '24');
    fireEvent.click(badges[0]);
    expect(within(row).getByRole('tooltip')).toHaveTextContent('Flawless Case');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(row).queryByRole('tooltip')).not.toBeInTheDocument();
    expect(within(screen.getByText('Anna N.').closest('tr')!).queryByTestId('pinned-badges')).not.toBeInTheDocument();
  });

  it('wyróżnia wiersz zalogowanego użytkownika pillem "Ty"', () => {
    render(<LeaderboardTable leaderboard={board()} currentUserId="user-2" />);
    expect(screen.getByText('Ty').closest('tr')).toHaveTextContent('Anna N.');
  });

  it('zalogowany poza pierwszą dziesiątką: osobny wiersz z jego pozycją pod dziesiątką', () => {
    const me: LeaderboardEntry = { rank: 15, userId: 'user-me', firstName: 'Ola', lastInitial: 'W', avatarUrl: null, level: 1, xp: 20, pinned: [] };
    render(<LeaderboardTable leaderboard={board({ me })} currentUserId="user-me" />);
    const rows = screen.getAllByRole('row');
    expect(rows[rows.length - 1]).toHaveTextContent('15');
    expect(rows[rows.length - 1]).toHaveTextContent('Ola W.');
    expect(rows[rows.length - 1]).toHaveTextContent('Ty');
  });

  it('pokazuje komunikat o pustym rankingu zamiast pustej tabeli', () => {
    render(<LeaderboardTable leaderboard={board({ top: [], me: null })} currentUserId="user-1" />);

    expect(screen.getByText(/ranking jest jeszcze pusty/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
