import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('otwiera AvatarPickerModal po kliknięciu avatara', () => {
    render(<UserGamificationCard overview={overview} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /zmień avatar/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('po zapisaniu nowego avatara w modalu woła API i zamyka modal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'owl' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<UserGamificationCard overview={overview} />);

    fireEvent.click(screen.getByRole('button', { name: /zmień avatar/i }));
    fireEvent.click(screen.getByRole('button', { name: 'owl' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me/avatar',
        expect.objectContaining({ body: JSON.stringify({ avatarUrl: 'owl' }) }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
