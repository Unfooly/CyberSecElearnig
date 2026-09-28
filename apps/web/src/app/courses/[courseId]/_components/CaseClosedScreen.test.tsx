import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CaseClosedScreen, { caseMinutes } from './CaseClosedScreen';
import { SfxProvider, __setGestureSeenForTests } from '@/lib/sfx';
import type { CaseClosing, CourseCompletionReward } from '@/lib/courses-types';

vi.mock('next/link', async () => {
  const { forwardRef } = await import('react');
  const Link = forwardRef<HTMLAnchorElement, { href: string; children: React.ReactNode }>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={href} {...rest}>
      {children}
    </a>
  ));
  Link.displayName = 'Link';
  return { default: Link };
});

// Zamknięcie sprawy (D-089): ceremonia przy świeżym ukończeniu, stan końcowy od razu przy powrocie i reduced-motion.
const closing: CaseClosing = {
  image: 'scenes/raport.svg',
  stamp: 'scenes/pieczec.svg',
  note: 'scenes/liscik.svg',
  slots: {
    evidence: { x: 8.8, y: 34.8, w: 11.7, h: 6.8 },
    time: { x: 21.5, y: 34.8, w: 11.7, h: 6.8 },
    xp: { x: 34.2, y: 34.8, w: 11.7, h: 6.8 },
    lessons: { x: 8.8, y: 50.7, w: 37.1, h: 29.3 },
    signature: { x: 23.2, y: 81.8, w: 22.7, h: 6.1 },
    stamp: { x: 56.2, y: 67.7, w: 33, h: 21 },
    note: { x: 78.5, y: 36.6, w: 14.1, h: 23.2 },
  },
};
const reward: CourseCompletionReward = {
  xpGained: 350,
  totalXp: 350,
  previousLevel: 1,
  newLevel: 2,
  leveledUp: true,
  levelProgressBeforePercent: 0,
  levelProgressAfterPercent: 20,
  unlockedBadges: [],
} as unknown as CourseCompletionReward;

function renderScreen(props: Partial<Parameters<typeof CaseClosedScreen>[0]> = {}, sound = true) {
  return render(
    <SfxProvider enabled={sound}>
      <CaseClosedScreen
        title="Wyłudzone hasło"
        score={100}
        reward={reward}
        closing={closing}
        lessons={['Sprawdzaj domenę.', 'Kod SMS zatwierdza.']}
        evidence={{ collected: 20, total: 22, perBlock: [] }}
        startedAt="2026-09-27T10:00:00.000Z"
        completedAt="2026-09-27T10:14:10.000Z"
        signer="Jan P."
        contentBase="/content"
        fresh
        {...props}
      />
      {/* „Wróć do biblioteki” jest przyciskiem dolnego paska (D-106) - tu atrapa paska ramki, cel fokusu po podpisie. */}
      <div data-testid="player-bottombar">
        <a className="pbar-next" href="/courses">
          Wróć do biblioteki
        </a>
      </div>
    </SfxProvider>,
  );
}

describe('caseMinutes', () => {
  it('minuty od startu do ukończenia (co najmniej 1), null bez któregoś momentu albo przy odwrotnej kolejności', () => {
    expect(caseMinutes('2026-01-01T10:00:00Z', '2026-01-01T10:14:10Z')).toBe(14);
    expect(caseMinutes('2026-01-01T10:00:00Z', '2026-01-01T10:00:05Z')).toBe(1);
    expect(caseMinutes(null, '2026-01-01T10:00:00Z')).toBeNull();
    expect(caseMinutes('2026-01-01T10:00:00Z', undefined)).toBeNull();
    expect(caseMinutes('2026-01-01T11:00:00Z', '2026-01-01T10:00:00Z')).toBeNull();
  });
});

describe('CaseClosedScreen: ceremonia', () => {
  let played: string[];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    played = [];
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      played.push(this.src.replace(/^.*\/sfx\//, ''));
      return Promise.resolve();
    });
    __setGestureSeenForTests(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    __setGestureSeenForTests(false);
  });
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('paper -> liczby -> wnioski linijka po linijce -> pulsujący podpis (fokus) -> klik: podpis, pieczęć + stamp.mp3, liścik -> stan końcowy', () => {
    renderScreen();
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'intro');
    expect(played).toEqual(['paper.mp3']);
    expect(screen.queryByTestId('closing-stamp')).not.toBeInTheDocument();

    advance(1300);
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'lessons');
    expect(screen.getByTestId('closing-evidence')).toHaveTextContent('20/22');
    expect(screen.getByTestId('closing-time')).toHaveTextContent('14 min');
    expect(screen.getByTestId('closing-xp')).toHaveTextContent('+350');
    for (let i = 0; i < 5; i += 1) advance(28); // znak po znaku (każdy znak to osobny timer po renderze)
    expect(screen.getByTestId('closing-lessons')).toHaveTextContent('1. Spraw');
    expect(screen.getByTestId('closing-lessons')).not.toHaveTextContent('Kod SMS');

    for (let i = 0; i < 60; i += 1) advance(250);
    expect(screen.getByTestId('closing-lessons')).toHaveTextContent('2. Kod SMS zatwierdza.');
    const signature = screen.getByRole('button', { name: 'Podpisz raport' });
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'sign');
    expect(signature).toBeEnabled();
    expect(signature).toHaveFocus();
    expect(signature.className).toMatch(/closing-sign-pulse/);

    fireEvent.click(signature);
    fireEvent.click(signature); // podwójny klik - jedna ceremonia
    // Przycisk znika, zostaje sam podpis; fokus przechodzi na "Wróć do biblioteki" w dolnym pasku (nie spada na body).
    expect(screen.queryByRole('button', { name: 'Podpisz raport' })).not.toBeInTheDocument();
    expect(screen.getByTestId('closing-signature')).toHaveTextContent('Jan P.');
    expect(screen.getByRole('link', { name: 'Wróć do biblioteki' })).toHaveFocus();
    advance(600);
    expect(screen.getByTestId('closing-stamp')).toBeInTheDocument();
    expect(played).toEqual(['paper.mp3', 'stamp.mp3']);
    // Wejście teczki tylko na etapie intro - drgnięcie przy pieczęci nie może go odpalić drugi raz po zdjęciu klasy.
    expect(screen.getByTestId('case-closed-scene').className).not.toMatch(/closing-folder-in/);
    advance(450);
    expect(screen.getByTestId('closing-note')).toBeInTheDocument();
    expect(screen.getByTestId('case-closed-scene').className).not.toMatch(/closing-(folder-in|shake)/);
    advance(600);
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'done');
    expect(played).toEqual(['paper.mp3', 'stamp.mp3']);
    // Ekran zamknięcia nie ma własnego „Wróć do biblioteki” (D-106) - jedyny link to atrapa paska.
    expect(screen.getByTestId('case-closed')).not.toContainElement(screen.getByRole('link', { name: 'Wróć do biblioteki' }));
    expect(screen.getByRole('button', { name: /Następna sprawa/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('liczby nabijają się (wartość pośrednia między 0 a celem)', () => {
    renderScreen();
    expect(screen.getByTestId('closing-xp')).toHaveTextContent('+0');
    advance(750); // 300 ms opóźnienia + połowa z 900 ms
    const xp = Number(screen.getByTestId('closing-xp').textContent?.replace('+', ''));
    expect(xp).toBeGreaterThan(0);
    expect(xp).toBeLessThan(350);
  });

  it('odmontowanie w trakcie ceremonii (po podpisie): bez stamp.mp3 i bez błędów po odmontowaniu', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderScreen();
    for (let i = 0; i < 70; i += 1) advance(250);
    fireEvent.click(screen.getByRole('button', { name: 'Podpisz raport' }));
    unmount();
    advance(3000);
    expect(played).toEqual(['paper.mp3']);
    expect(errors).not.toHaveBeenCalled();
  });

  it('moduł bez `closing` przy świeżym ukończeniu: bez ceremonii i bez dźwięku (prosty ekran)', () => {
    renderScreen({ closing: undefined });
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'done');
    advance(2000);
    expect(played).toEqual([]);
  });

  it('koniec modułu (D-090, B-116): konfetti (≤ 30 cząstek) przy pieczęci znika po 1,2 s; pasek poziomu rośnie od stanu sprzed nagrody; odznaki z pop', () => {
    renderScreen({ reward: { ...reward, levelProgressBeforePercent: 40, levelProgressAfterPercent: 90, unlockedBadges: [{ code: 'first', title: 'Pierwsza sprawa', icon: 'x', xpReward: 50 }] } });
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-60%)' });
    expect(screen.getByText('Pierwsza sprawa')).toHaveClass('motion-safe:animate-badge-pop');
    advance(300);
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-10%)' });

    for (let i = 0; i < 70; i += 1) advance(250);
    expect(screen.queryByTestId('closing-confetti')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Podpisz raport' }));
    advance(600);
    const confetti = screen.getByTestId('closing-confetti');
    expect(confetti).toHaveAttribute('aria-hidden', 'true');
    const pieces = confetti.querySelectorAll('.closing-confetti-piece').length;
    expect(pieces).toBeGreaterThan(0);
    expect(pieces).toBeLessThanOrEqual(30);
    expect(confetti).toHaveClass('overflow-hidden', 'inset-0'); // przycinane do raportu
    advance(1200);
    expect(screen.queryByTestId('closing-confetti')).not.toBeInTheDocument();
  });

  it('pasek poziomu: wartości spoza 0-100 przycięte (także aria-valuenow), awans = pełny pasek, bez zmiany (ponowne ukończenie) - bez ruchu', () => {
    const { unmount } = renderScreen({ fresh: false, reward: { ...reward, levelProgressBeforePercent: -20, levelProgressAfterPercent: 140 } });
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(0%)' });
    expect(screen.getByRole('progressbar', { name: 'Poziom 1' })).toHaveAttribute('aria-valuenow', '100');
    unmount();
    renderScreen({ reward: { ...reward, levelProgressBeforePercent: 30, levelProgressAfterPercent: 30 } });
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-70%)' });
    advance(300);
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-70%)' });
  });

  it('Lektor wyłączony: ceremonia bez dźwięków', () => {
    renderScreen({}, false);
    advance(1300);
    expect(played).toEqual([]);
  });
});

describe('CaseClosedScreen: stan końcowy od razu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('powrót do ukończonego kursu (bez świeżego ukończenia): podpis, pieczęć i liścik od razu, wszystkie wnioski, bez XP; obrazy z #static', () => {
    renderScreen({ fresh: false, reward: null });
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'done');
    // Po podpisie nie ma przycisku "Podpisz raport" (czytnik nie słyszy mylącego, nieaktywnego przycisku) - sam podpis.
    expect(screen.queryByRole('button', { name: 'Podpisz raport' })).not.toBeInTheDocument();
    expect(screen.getByTestId('closing-signature')).toHaveTextContent('Jan P.');
    expect(screen.getByTestId('closing-stamp')).toHaveAttribute('src', expect.stringMatching(/pieczec\.svg#static$/));
    expect(screen.getByTestId('closing-note')).toBeInTheDocument();
    expect(screen.getByTestId('closing-lessons')).toHaveTextContent('2. Kod SMS zatwierdza.');
    expect(screen.getByTestId('closing-xp')).toHaveTextContent('—');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('prefers-reduced-motion przy świeżym ukończeniu: stan końcowy od razu, XP i liczby bez nabijania', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('prefers-reduced-motion: reduce') })) as typeof window.matchMedia;
    try {
      renderScreen({ reward: { ...reward, levelProgressBeforePercent: 40, levelProgressAfterPercent: 90, unlockedBadges: [{ code: 'first', title: 'Pierwsza sprawa', icon: 'x', xpReward: 50 }] } });
      expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'done');
      expect(screen.getByTestId('closing-xp')).toHaveTextContent('+350');
      // Bez ruchu: pasek poziomu od razu w stanie końcowym, odznaka bez pop, bez konfetti.
      expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-10%)' });
      expect(screen.getByText('Pierwsza sprawa').className).not.toMatch(/badge-pop/);
      expect(screen.queryByTestId('closing-confetti')).not.toBeInTheDocument();
      expect(screen.getByTestId('closing-evidence')).toHaveTextContent('20/22');
    } finally {
      window.matchMedia = original;
    }
  });

  it('ponowne ukończenie po restarcie (xpGained 0): XP "—" zamiast "+0"', () => {
    renderScreen({ fresh: false, reward: { ...reward, xpGained: 0 } });
    expect(screen.getByTestId('closing-xp')).toHaveTextContent('—');
  });

  it('czas nieznany (przypisanie sprzed startedAt): "—"; opis raportu dla czytnika z kompletem danych', () => {
    renderScreen({ fresh: false, startedAt: null });
    expect(screen.getByTestId('closing-time')).toHaveTextContent('—');
    expect(screen.getByText(/Dowody: 20 z 22\. .*Wnioski śledczego: Sprawdzaj domenę\. Kod SMS zatwierdza\. Podpis prowadzącego: Jan P\./)).toHaveClass('sr-only');
  });

  it('moduł bez `closing`: prosty ekran - nagłówek, XP, awans, dowody, wynik', () => {
    renderScreen({ closing: undefined, fresh: false });
    expect(screen.getByRole('heading', { level: 2, name: 'Sprawa zamknięta' })).toBeInTheDocument();
    expect(screen.getByText('+350 XP')).toBeInTheDocument();
    expect(screen.getByText('Awans na poziom 2!')).toBeInTheDocument();
    expect(screen.getByText('Zebrane dowody: 20 z 22')).toBeInTheDocument();
    expect(screen.queryByTestId('case-closed-scene')).not.toBeInTheDocument();
  });
});
