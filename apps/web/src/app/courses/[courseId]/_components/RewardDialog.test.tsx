import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import RewardDialog from './RewardDialog';
import ModuleEndScreen, { REWARD_DIALOG_DELAY_MS, type ModuleEndScreenProps } from './ModuleEndScreen';
import type { CourseCompletionReward } from '@/lib/courses-types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Okienko nagrody (D-199): odznaka z grafiką i rangą albo awans; zamykanie „Super!”, ✕, tłem i Esc (poza ramką odtwarzacza - własny Esc).
// Ekran końca: okienko przy świeżym ukończeniu z nowym osiągnięciem albo awansem, po „wbiciu” pieczątki; bez nich - brak okienka.

const badge = { code: 'flawless-case', title: 'Sprawa bez skazy', icon: 'pl/osiagniecie-sprawa-bez-skazy', rank: 'RARE' as const };

describe('RewardDialog', () => {
  it('odznaka: nagłówek, grafika z obwódką rangi, nazwa i ranga; fokus na „Super!”', () => {
    render(<RewardDialog badges={[badge]} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Nowe osiągnięcie!' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByTestId('reward-dialog-badge')).toHaveTextContent('Sprawa bez skazy');
    expect(dialog).toHaveTextContent('Rzadkie');
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/achievements/pl/osiagniecie-sprawa-bez-skazy.webp');
    expect(within(dialog).getByRole('button', { name: 'Super!' })).toHaveFocus();
    expect(screen.queryByTestId('reward-dialog-level')).not.toBeInTheDocument();
  });

  it('sam awans: nagłówek „Awans!” i nowy poziom, bez listy odznak; dwie odznaki - „Nowe osiągnięcia!”', () => {
    const { unmount } = render(<RewardDialog badges={[]} level={4} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Awans!' })).toBeInTheDocument();
    expect(screen.getByTestId('reward-dialog-level')).toHaveTextContent('Awans na poziom 4');
    expect(screen.queryByTestId('reward-dialog-badge')).not.toBeInTheDocument();
    unmount();
    render(<RewardDialog badges={[badge, { ...badge, code: 'inna', title: 'Inna', rank: null }]} level={2} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Nowe osiągnięcia!' })).toBeInTheDocument();
    expect(screen.getAllByTestId('reward-dialog-badge')).toHaveLength(2);
  });

  it('zamykanie: „Super!”, ✕, klik w tło, Esc (poza ramką); klik w samo okno nie zamyka', () => {
    const onClose = vi.fn();
    render(<RewardDialog badges={[badge]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Super!' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
    fireEvent.click(screen.getByTestId('reward-dialog-backdrop'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('Tab nie wychodzi z okna (aria-modal): z ostatniego przycisku na pierwszy i odwrotnie', () => {
    render(<RewardDialog badges={[badge]} onClose={() => {}} />);
    const ok = screen.getByRole('button', { name: 'Super!' });
    const close = screen.getByRole('button', { name: 'Zamknij' });
    fireEvent.keyDown(ok, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(ok).toHaveFocus();
  });
});

describe('ModuleEndScreen: okienko nagrody (D-199)', () => {
  afterEach(() => vi.useRealTimers());

  const reward = (over: Partial<CourseCompletionReward> = {}): CourseCompletionReward => ({
    xpGained: 150,
    newLevel: 3,
    previousLevel: 2,
    leveledUp: true,
    levelProgressBeforePercent: 80,
    levelProgressAfterPercent: 100,
    levelProgressNewPercent: 20,
    unlockedBadges: [{ ...badge, xpReward: 50 }],
    ...over,
  });
  const props = (over: Partial<ModuleEndScreenProps> = {}): ModuleEndScreenProps => ({
    moduleTitle: 'Zabawa w phishing',
    info: { category: 'PHISHING_SOCIAL_ENGINEERING', durationMinutes: 12, subtitle: null, caseNumber: 1, cover: null } as ModuleEndScreenProps['info'],
    contentBase: '',
    lang: 'pl',
    score: 100,
    rules: [],
    onRestart: () => {},
    ...over,
  });

  it('świeże ukończenie z osiągnięciem i awansem: okienko po „wbiciu” pieczątki; zamknięcie zostawia ekran końca', () => {
    vi.useFakeTimers();
    render(<ModuleEndScreen {...props({ reward: reward(), fresh: true })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(REWARD_DIALOG_DELAY_MS));
    const dialog = screen.getByRole('dialog', { name: 'Nowe osiągnięcie!' });
    expect(dialog).toHaveTextContent('Sprawa bez skazy');
    expect(dialog).toHaveTextContent('Awans na poziom 3');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Super!' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-end')).toBeInTheDocument();
  });

  it('reduced-motion: okienko od razu, bez czekania na pieczątkę', () => {
    vi.useFakeTimers();
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      render(<ModuleEndScreen {...props({ reward: reward(), fresh: true })} />);
      act(() => vi.advanceTimersByTime(0));
      expect(screen.getByRole('dialog', { name: 'Nowe osiągnięcie!' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('bez okienka: powrót do ukończonego kursu (nie świeże), ponowne ukończenie bez osiągnięć i awansu, brak nagrody', () => {
    vi.useFakeTimers();
    const { unmount } = render(<ModuleEndScreen {...props({ reward: reward(), fresh: false })} />);
    act(() => vi.advanceTimersByTime(REWARD_DIALOG_DELAY_MS * 2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    const second = render(<ModuleEndScreen {...props({ reward: reward({ xpGained: 0, leveledUp: false, unlockedBadges: [] }), fresh: true })} />);
    act(() => vi.advanceTimersByTime(REWARD_DIALOG_DELAY_MS * 2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    second.unmount();
    render(<ModuleEndScreen {...props({ reward: null, fresh: true })} />);
    act(() => vi.advanceTimersByTime(REWARD_DIALOG_DELAY_MS * 2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
