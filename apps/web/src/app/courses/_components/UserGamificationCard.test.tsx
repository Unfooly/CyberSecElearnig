import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserGamificationCard from './UserGamificationCard';
import type { GamificationOverview } from '@/lib/gamification-types';

const overview: GamificationOverview = {
  avatarUrl: 'fox',
  xp: 150,
  level: 2,
  nextLevelXp: 400,
  currentLevelProgressPercent: 25,
  badges: [
    { code: 'FIRST_STEP', title: 'Pierwszy Krok', description: 'x', icon: 'a', xpReward: 50, unlockedAt: '2026-01-01T00:00:00.000Z' },
  ],
};

describe('UserGamificationCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pokazuje poziom, XP i link do odznak z ich liczbą', () => {
    render(<UserGamificationCard overview={overview} />);

    expect(screen.getByText('Poziom 2')).toBeInTheDocument();
    expect(screen.getByText('150 / 400 XP')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /zobacz odznaki \(1\)/i })).toHaveAttribute(
      'href',
      '/courses/achievements',
    );
  });

  it('renderuje pasek postępu z aria-valuenow zgodnym z currentLevelProgressPercent', () => {
    render(<UserGamificationCard overview={overview} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('pokazuje avatar użytkownika, ale BEZ możliwości zmiany (ta jest w ustawieniach konta)', () => {
    render(<UserGamificationCard overview={overview} />);

    expect(screen.getByRole('img', { name: 'Avatar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /zmień avatar/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/zmień avatar/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
