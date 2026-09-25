import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseRewardModal from './CourseRewardModal';
import { OverlayStackProvider, useCloseTopOverlay } from './player/overlay-stack';
import type { CourseCompletionReward } from '@/lib/courses-types';

function CloseTopButton() {
  const closeTop = useCloseTopOverlay();
  return (
    <button type="button" onClick={() => closeTop()}>
      zamknij górną warstwę
    </button>
  );
}

describe('CourseRewardModal', () => {
  it('pokazuje TYLKO zdobyte XP, gdy nie było awansu ani nowych odznak', () => {
    const reward: CourseCompletionReward = { xpGained: 100, newLevel: 1, leveledUp: false, unlockedBadges: [] };
    render(<CourseRewardModal reward={reward} onClose={vi.fn()} />);

    expect(screen.getByText('Zdobyłeś +100 XP!')).toBeInTheDocument();
    expect(screen.queryByText(/awans/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nowe odznaki/i)).not.toBeInTheDocument();
  });

  it('pokazuje komunikat o awansie, gdy leveledUp=true', () => {
    const reward: CourseCompletionReward = { xpGained: 100, newLevel: 4, leveledUp: true, unlockedBadges: [] };
    render(<CourseRewardModal reward={reward} onClose={vi.fn()} />);

    expect(screen.getByText('Awans na poziom 4!')).toBeInTheDocument();
  });

  it('wylicza WSZYSTKIE nowe odznaki z nagrodą XP każdej z nich', () => {
    const reward: CourseCompletionReward = {
      xpGained: 250,
      newLevel: 3,
      leveledUp: true,
      unlockedBadges: [
        { code: 'FIRST_STEP', title: 'Pierwszy Krok', icon: 'a', xpReward: 50 },
        { code: 'PERFECT_SCORE', title: 'Sokole Oko', icon: 'b', xpReward: 50 },
      ],
    };
    render(<CourseRewardModal reward={reward} onClose={vi.fn()} />);

    expect(screen.getByText('Pierwszy Krok (+50 XP)')).toBeInTheDocument();
    expect(screen.getByText('Sokole Oko (+50 XP)')).toBeInTheDocument();
  });

  it('woła onClose po kliknięciu "Super!"', () => {
    const onClose = vi.fn();
    const reward: CourseCompletionReward = { xpGained: 100, newLevel: 1, leveledUp: false, unlockedBadges: [] };
    render(<CourseRewardModal reward={reward} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Super!' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('panel ma ograniczoną wysokość z przewijaniem (mobile: dużo odznak nie wychodzi poza ekran)', () => {
    const reward: CourseCompletionReward = { xpGained: 100, newLevel: 1, leveledUp: false, unlockedBadges: [] };
    render(<CourseRewardModal reward={reward} onClose={vi.fn()} />);

    const panel = screen.getByRole('dialog').firstElementChild as HTMLElement;
    expect(panel.className).toMatch(/max-h-\[92dvh\]/);
    expect(panel.className).toMatch(/overflow-y-auto/);
  });

  it('rejestruje się w overlay-stack ("reward") zamiast własnego nasłuchu Escape - closeTop() woła onClose (kod review PR #44: własny listener konkurowałby z kaskadą LIFO innych warstw wewnątrz PlayerStage)', () => {
    const onClose = vi.fn();
    const reward: CourseCompletionReward = { xpGained: 100, newLevel: 1, leveledUp: false, unlockedBadges: [] };
    render(
      <OverlayStackProvider>
        <CourseRewardModal reward={reward} onClose={onClose} />
        <CloseTopButton />
      </OverlayStackProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'zamknij górną warstwę' }));

    expect(onClose).toHaveBeenCalled();
  });
});
