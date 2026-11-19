import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AchievementGrid, { SECRET_TEXT } from './AchievementGrid';
import { achievementImage, type Badge } from '@/lib/gamification-types';

const base = { lockedIcon: null, hidden: false, scope: 'GLOBAL' as const, xpReward: 50, pinned: null };
const badges: Badge[] = [
  {
    ...base,
    code: 'first-case-closed',
    title: 'First Case Closed',
    description: 'Twoja pierwsza zamknięta sprawa.',
    conditionText: 'Ukończ dowolne szkolenie.',
    icon: 'osiagniecie-pierwsza-sprawa',
    lockedIcon: 'osiagniecie-pierwsza-sprawa-zablokowane',
    rank: 'MILESTONE',
    isUnlocked: true,
    unlockedAt: '2026-09-28T10:00:00.000Z',
  },
  {
    ...base,
    code: 'flawless-case',
    title: 'Flawless Case',
    description: 'Zamknąłeś sprawę bez jednego przeoczonego śladu.',
    conditionText: 'Zdobądź 100% za zadania w jednym podejściu.',
    icon: 'osiagniecie-perfekcyjne-sledztwo',
    lockedIcon: 'osiagniecie-perfekcyjne-sledztwo-zablokowane',
    rank: 'LEGENDARY',
    scope: 'MODULE',
    isUnlocked: false,
    unlockedAt: null,
  },
  {
    ...base,
    code: 'secret-3',
    title: null,
    description: null,
    conditionText: null,
    icon: 'osiagniecie-tajne-zablokowane',
    lockedIcon: 'osiagniecie-tajne-zablokowane',
    rank: 'SECRET',
    hidden: true,
    scope: null,
    xpReward: 0,
    isUnlocked: false,
    unlockedAt: null,
  },
];

const card = (code: string) => screen.getAllByTestId('achievement-card').find((el) => el.dataset.code === code)!;

describe('AchievementGrid (D-111, karty z obrotem)', () => {
  it('awers (D-174): grafika WebP z obwódką w kolorze rangi, ranga po polsku (UI), nazwa; tajne niezdobyte jako „???”', () => {
    render(<AchievementGrid badges={badges} />);

    const first = card('first-case-closed');
    const firstImage = within(first).getByTestId('achievement-image');
    expect(firstImage).toHaveAttribute('src', '/achievements/osiagniecie-pierwsza-sprawa.webp');
    expect(firstImage).toHaveClass('ring-rank-milestone');
    expect(firstImage).not.toHaveClass('grayscale');
    expect(within(first).queryByTestId('achievement-lock')).toBeNull();
    expect(within(first).getByTestId('achievement-front')).toHaveTextContent('Kamień milowyFirst Case Closed');
    const secret = card('secret-3');
    expect(within(secret).getByTestId('achievement-front')).toHaveTextContent('Tajne???');
    expect(secret).toHaveAccessibleName(/^Tajne osiągnięcie \(Tajne\), niezdobyte/);
  });

  it('zablokowana (D-174): ta sama grafika co zdobyta, w szarości i z kłódką; tajna niezdobyta - neutralna grafika z API, bez szarości, z kłódką', () => {
    render(<AchievementGrid badges={badges} />);

    const locked = within(card('flawless-case')).getByTestId('achievement-image');
    expect(locked).toHaveAttribute('src', '/achievements/osiagniecie-perfekcyjne-sledztwo.webp');
    expect(locked).toHaveClass('grayscale', 'ring-rank-legendary');
    expect(within(card('flawless-case')).getByTestId('achievement-lock')).toBeInTheDocument();

    const secret = within(card('secret-3')).getByTestId('achievement-image');
    expect(secret).toHaveAttribute('src', '/achievements/osiagniecie-tajne-zablokowane.webp');
    expect(secret).not.toHaveClass('grayscale');
    expect(within(card('secret-3')).getByTestId('achievement-lock')).toBeInTheDocument();
  });

  // Poprawki m3, pkt c: grafika w katalogu języka szkoleń (API podaje „pl/…”); inne ścieżki nadal bez grafiki.
  it('achievementImage: nazwa z katalogiem języka pl/en, inne katalogi i znaki odrzucone', () => {
    expect(achievementImage('pl/osiagniecie-pierwsza-sprawa')).toBe('/achievements/pl/osiagniecie-pierwsza-sprawa.webp');
    expect(achievementImage('en/osiagniecie-tajne-zablokowane')).toBe('/achievements/en/osiagniecie-tajne-zablokowane.webp');
    expect(achievementImage('de/osiagniecie-x')).toBeNull();
    expect(achievementImage('../secret')).toBeNull();
    expect(achievementImage('pl/../x')).toBeNull();
  });

  it('klik obraca kartę (aria-pressed), ponowny klik wraca; naraz odwrócona jest jedna karta', () => {
    render(<AchievementGrid badges={badges} />);

    fireEvent.click(card('first-case-closed'));
    expect(card('first-case-closed')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(card('flawless-case'));
    expect(card('flawless-case')).toHaveAttribute('aria-pressed', 'true');
    expect(card('first-case-closed')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(card('flawless-case'));
    expect(card('flawless-case')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('achievement-live')).toBeEmptyDOMElement();
  });

  it('rewers: zdobyte - data „Zdobyto: DD.MM.RRRR”; niezdobyte - warunek; tajne niezdobyte - tekst tajnego (bez nazwy)', () => {
    render(<AchievementGrid badges={badges} />);

    expect(within(card('first-case-closed')).getByTestId('achievement-back')).toHaveTextContent(
      'Kamień milowyFirst Case ClosedTwoja pierwsza zamknięta sprawa.Zdobyto: 28.09.2026',
    );
    expect(within(card('flawless-case')).getByTestId('achievement-back')).toHaveTextContent('Zdobądź 100% za zadania w jednym podejściu.');
    const secretBack = within(card('secret-3')).getByTestId('achievement-back');
    expect(secretBack).toHaveTextContent(`Tajne${SECRET_TEXT}`);
  });

  it('rewers odwróconej karty trafia do regionu aria-live; tło rewersu w kolorze rangi', () => {
    render(<AchievementGrid badges={badges} />);

    fireEvent.click(card('secret-3'));
    expect(screen.getByTestId('achievement-live')).toHaveTextContent(`Tajne. ${SECRET_TEXT}`);
    expect(within(card('secret-3')).getByTestId('achievement-back')).toHaveClass('bg-rank-secret');

    fireEvent.click(card('first-case-closed'));
    expect(screen.getByTestId('achievement-live')).toHaveTextContent(
      'Kamień milowy. First Case Closed. Twoja pierwsza zamknięta sprawa. Zdobyto: 28.09.2026.',
    );
  });

  it('tekst rewersu min. 15 px, a dłuższy przewija się w karcie', () => {
    render(<AchievementGrid badges={badges} />);
    const back = within(card('flawless-case')).getByTestId('achievement-back-scroll');
    expect(back).toHaveClass('overflow-y-auto');
    expect(back.querySelectorAll('.text-\\[15px\\]').length).toBeGreaterThanOrEqual(2);
  });

  it('nazwa pliku grafiki spoza białej listy (np. ścieżka) - bez obrazka', () => {
    render(<AchievementGrid badges={[{ ...badges[0], icon: '../../evil' }]} />);
    expect(card('first-case-closed').querySelector('img')).toBeNull();
  });
});
