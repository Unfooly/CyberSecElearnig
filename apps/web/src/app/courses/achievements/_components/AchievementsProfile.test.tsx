import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AchievementsProfile from './AchievementsProfile';
import type { Badge } from '@/lib/gamification-types';

const earned = (code: string, title: string, pinned: number | null = null): Badge => ({
  code,
  title,
  description: `${title} - opis.`,
  conditionText: 'Warunek.',
  icon: `ikona-${code}`,
  lockedIcon: `ikona-${code}-zablokowane`,
  rank: 'MILESTONE',
  hidden: false,
  scope: 'GLOBAL',
  xpReward: 50,
  isUnlocked: true,
  unlockedAt: '2026-09-28T10:00:00.000Z',
  pinned,
});
const locked: Badge = { ...earned('flawless-case', 'Flawless Case'), isUnlocked: false, unlockedAt: null };

const card = (code: string) => screen.getAllByTestId('achievement-card').find((el) => el.dataset.code === code)!;
const pinnedTitles = () => screen.queryAllByTestId('pinned-item').map((item) => item.textContent?.replace(/^\d+\.\s*/, '').split('Odepnij')[0].trim());
const ok = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

describe('AchievementsProfile (D-112, przypinanie)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('nagłówek: imię i przypięte miniatury w kolejności; sekcja „Przypięte (1 / 3)”', () => {
    render(<AchievementsProfile badges={[earned('a', 'Alfa', 1), earned('b', 'Beta')]} displayName="Ola W." />);
    const header = screen.getByTestId('profile-name');
    expect(header).toHaveTextContent('Ola W.');
    expect(within(header).getAllByTestId('pinned-badge').map((badge) => badge.getAttribute('title'))).toEqual(['Alfa']);
    expect(screen.getByRole('heading', { name: /Przypięte \(1 \/ 3\)/ })).toBeInTheDocument();
  });

  it('przycisk „Przypnij do profilu” jest tylko na rewersie ZDOBYTEJ karty; przypięcie zapisuje całą listę', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    render(<AchievementsProfile badges={[earned('a', 'Alfa', 1), earned('b', 'Beta'), locked]} displayName={null} />);

    expect(screen.queryByTestId('achievement-pin')).not.toBeInTheDocument();
    fireEvent.click(card('flawless-case'));
    expect(screen.queryByTestId('achievement-pin')).not.toBeInTheDocument();
    fireEvent.click(card('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Przypnij do profilu: Beta' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/gamification/pinned', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ codes: ['a', 'b'] }) }));
    await waitFor(() => expect(pinnedTitles()).toEqual(['Alfa', 'Beta']));
    expect(screen.getByRole('button', { name: 'Odepnij: Beta' })).toBeInTheDocument();
  });

  it('czwarta odznaka: komunikat „Możesz przypiąć maksymalnie 3 odznaki.” bez zapisu', () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AchievementsProfile
        badges={[earned('a', 'Alfa', 1), earned('b', 'Beta', 2), earned('c', 'Gamma', 3), earned('d', 'Delta')]}
        displayName={null}
      />,
    );
    fireEvent.click(card('d'));
    fireEvent.click(screen.getByRole('button', { name: 'Przypnij do profilu: Delta' }));
    expect(screen.getByTestId('pin-message')).toHaveTextContent('Możesz przypiąć maksymalnie 3 odznaki.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('kolejność strzałkami i odpinanie w sekcji „Przypięte”', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    render(<AchievementsProfile badges={[earned('a', 'Alfa', 1), earned('b', 'Beta', 2)]} displayName={null} />);

    expect(screen.getByRole('button', { name: 'Przesuń Alfa w lewo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Przesuń Alfa w prawo' }));
    await waitFor(() => expect(pinnedTitles()).toEqual(['Beta', 'Alfa']));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ codes: ['b', 'a'] });
    // Nowa pozycja ogłoszona czytnikom; strzałka „w prawo” na skraju nieaktywna - fokus na strzałce „w lewo” tej pozycji.
    expect(screen.getByTestId('pin-announcement')).toHaveTextContent('Alfa: pozycja 2 z 2.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Przesuń Alfa w lewo' })).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Odepnij Beta' }));
    await waitFor(() => expect(pinnedTitles()).toEqual(['Alfa']));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ codes: ['a'] });
  });

  it('przeciąganie zmienia kolejność', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    render(<AchievementsProfile badges={[earned('a', 'Alfa', 1), earned('b', 'Beta', 2), earned('c', 'Gamma', 3)]} displayName={null} />);
    const items = screen.getAllByTestId('pinned-item');
    const dataTransfer = { effectAllowed: '' };
    fireEvent.dragStart(items[2], { dataTransfer });
    fireEvent.dragOver(items[0], { dataTransfer });
    fireEvent.drop(items[0], { dataTransfer });
    await waitFor(() => expect(pinnedTitles()).toEqual(['Gamma', 'Alfa', 'Beta']));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ codes: ['c', 'a', 'b'] });
  });

  it('błąd zapisu: poprzedni stan wraca, komunikat z serwera', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Możesz przypiąć tylko zdobyte osiągnięcia.' }) }));
    render(<AchievementsProfile badges={[earned('a', 'Alfa', 1), earned('b', 'Beta')]} displayName={null} />);
    fireEvent.click(card('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Przypnij do profilu: Beta' }));
    expect(await screen.findByTestId('pin-message')).toHaveTextContent('Możesz przypiąć tylko zdobyte osiągnięcia.');
    expect(pinnedTitles()).toEqual(['Alfa']);
  });
});
