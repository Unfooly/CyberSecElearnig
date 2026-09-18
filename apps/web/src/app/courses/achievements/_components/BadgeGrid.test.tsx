import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BadgeGrid from './BadgeGrid';
import type { Badge } from '@/lib/gamification-types';

const badges: Badge[] = [
  {
    code: 'FIRST_STEP',
    title: 'Pierwszy Krok',
    description: 'Ukończono pierwszy kurs.',
    icon: 'first-step',
    xpReward: 50,
    isUnlocked: true,
    unlockedAt: '2026-01-15T00:00:00.000Z',
  },
  {
    code: 'PERFECT_SCORE',
    title: 'Sokole Oko',
    description: 'Ukończono kurs z wynikiem 100%.',
    icon: 'perfect-score',
    xpReward: 50,
    isUnlocked: false,
    unlockedAt: null,
  },
];

describe('BadgeGrid', () => {
  it('pokazuje datę odblokowania i nagrodę XP dla odblokowanej odznaki', () => {
    render(<BadgeGrid badges={badges} />);

    const unlockedTile = screen.getByText('Pierwszy Krok').closest('div[data-unlocked]');
    expect(unlockedTile).toHaveAttribute('data-unlocked', 'true');
    expect(unlockedTile).toHaveTextContent('+50 XP');
    expect(unlockedTile).toHaveTextContent('15 stycznia 2026');
  });

  it('pokazuje opis (jak odblokować) zamiast daty dla zablokowanej odznaki, i oznacza ją jako zablokowaną', () => {
    render(<BadgeGrid badges={badges} />);

    const lockedTile = screen.getByText('Sokole Oko').closest('div[data-unlocked]');
    expect(lockedTile).toHaveAttribute('data-unlocked', 'false');
    expect(lockedTile).toHaveTextContent('Ukończono kurs z wynikiem 100%.');
    expect(lockedTile).toHaveTextContent('Zablokowane');
  });

  it('stosuje grayscale wyłącznie do kafelków zablokowanych odznak', () => {
    render(<BadgeGrid badges={badges} />);

    const unlockedTile = screen.getByText('Pierwszy Krok').closest('div[data-unlocked]');
    const lockedTile = screen.getByText('Sokole Oko').closest('div[data-unlocked]');

    expect(unlockedTile?.className).not.toContain('grayscale');
    expect(lockedTile?.className).toContain('grayscale');
  });

  it('pokazuje komunikat, gdy nie ma żadnych odznak', () => {
    render(<BadgeGrid badges={[]} />);

    expect(screen.getByText(/brak odznak/i)).toBeInTheDocument();
  });
});
