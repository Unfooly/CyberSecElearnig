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
    // Widoczny (pisany) tekst wniosków; pełne teksty są w liście od początku jako niewidoczne kopie - rezerwują miejsce (PR A pkt 3).
    const typed = () => screen.getAllByTestId('closing-lesson-typed').map((line) => line.textContent);
    expect(typed()).toEqual(['1. Spraw', '']);
    expect(screen.getByTestId('closing-lessons').querySelectorAll('[data-lesson-full].invisible')).toHaveLength(2);

    for (let i = 0; i < 60; i += 1) advance(250);
    expect(typed()).toEqual(['1. Sprawdzaj domenę.', '2. Kod SMS zatwierdza.']);
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

  it('D-130: jest następny nieukończony kurs - „Następna sprawa” to link do niego (z tytułem), bez zamkniętej teczki', () => {
    renderScreen({ fresh: false, reward: null, nextCourse: { courseId: 'kurs-2', title: 'Głos z helpdesku' } });
    const link = screen.getByRole('link', { name: 'Następna sprawa: Głos z helpdesku' });
    expect(link).toHaveAttribute('href', '/courses/kurs-2');
    expect(screen.queryByRole('button', { name: /Następna sprawa/ })).not.toBeInTheDocument();
  });

  it('D-130: na etapie podpisu pole podpisu ma widoczną etykietę „Podpisz raport”', () => {
    renderScreen();
    advance(1300);
    for (let i = 0; i < 60; i += 1) advance(250);
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'sign');
    expect(screen.getByTestId('closing-sign-label')).toHaveTextContent('Podpisz raport');
    expect(screen.getByRole('button', { name: 'Podpisz raport' })).toContainElement(screen.getByTestId('closing-sign-label'));
  });

  it('D-152: pionowy raport wyższy niż 9:16 - proporcje z grafiki, ramka przewijana w pionie, przy pieczęci zjazd w dół; 9:16 bez zmian', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 600, x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 600, toJSON: () => ({}) } as DOMRect);
    const loadImage = (width: number, height: number) => {
      const image = screen.getByTestId('case-closed-scene').querySelector('img')!;
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
      fireEvent.load(image);
    };
    const portrait = { ...closing, portrait: { image: 'scenes/raport-pion.svg', slots: closing.slots } } as CaseClosing;

    const frame = () => screen.getByTestId('case-closed-frame');
    // jsdom nie liczy układu - rozmiary przewijania ramki podane wprost (wystające elementy: scrollHeight > clientHeight także przy 9:16).
    const ceremony = () => {
      Object.defineProperty(frame(), 'scrollHeight', { configurable: true, value: 1200 });
      Object.defineProperty(frame(), 'clientHeight', { configurable: true, value: 600 });
      const scrollTo = vi.fn();
      frame().scrollTo = scrollTo;
      advance(1300);
      for (let i = 0; i < 60; i += 1) advance(250);
      fireEvent.click(screen.getByRole('button', { name: 'Podpisz raport' }));
      advance(600);
      return scrollTo;
    };

    const { unmount } = renderScreen({ closing: portrait });
    expect(screen.getByTestId('case-closed-scene').style.aspectRatio).toBe('9 / 16');
    loadImage(900, 1600);
    expect(frame()).not.toHaveAttribute('data-scroll');
    expect(screen.getByTestId('case-closed-scene').style.aspectRatio).toBe('9 / 16');
    expect(ceremony()).not.toHaveBeenCalled();
    unmount();

    renderScreen({ closing: portrait });
    loadImage(900, 1900);
    expect(frame()).toHaveAttribute('data-scroll', 'y');
    expect(screen.getByTestId('case-closed-scene').style.aspectRatio).toBe(String(900 / 1900));
    const scrollTo = ceremony();
    // offsetTop/offsetHeight w jsdom = 0 - zjazd do wyżej położonego z pieczęci i liściku minus margines 16 px; bez przesuwania w poziomie.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: -16, behavior: 'smooth' });
  });

  it('B-127: w pionie toast nagrody dopiero PO ceremonii (nie w trakcie), z animacją wejścia; znika po 2,5 s', () => {
    // Kontener telefonu w pionie (proporcje < 0.8) i wariant pionowy w treści.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 600, x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 600, toJSON: () => ({}) } as DOMRect);
    renderScreen({ closing: { ...closing, portrait: { image: 'scenes/raport-pion.svg', slots: closing.slots } } as CaseClosing });
    expect(screen.getByTestId('case-closed-frame')).toHaveAttribute('data-orientation', 'portrait');

    advance(1300);
    for (let i = 0; i < 60; i += 1) advance(250);
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'sign');
    expect(screen.queryByTestId('reward-toast')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Podpisz raport' }));
    advance(600);
    advance(450);
    expect(screen.queryByTestId('reward-toast')).not.toBeInTheDocument();
    advance(600);
    expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'done');
    const toast = screen.getByTestId('reward-toast');
    expect(toast).toHaveTextContent('Awans na poziom 2!');
    expect(toast.className).toMatch(/motion-safe:animate-rise-in/);
    advance(2500);
    expect(screen.queryByTestId('reward-toast')).not.toBeInTheDocument();
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

  it('B-153: po awansie „Poziom {nowy}” i pasek od 0 do postępu w nowym poziomie; bez awansu - stary poziom jak dotąd', () => {
    const { unmount } = renderScreen({ reward: { ...reward, levelProgressBeforePercent: 90, levelProgressAfterPercent: 100, levelProgressNewPercent: 17 } });
    expect(screen.getByRole('progressbar', { name: 'Poziom 2' })).toHaveAttribute('aria-valuenow', '17');
    expect(screen.queryByRole('progressbar', { name: 'Poziom 1' })).not.toBeInTheDocument();
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-100%)' });
    advance(300);
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-83%)' });
    unmount();

    renderScreen({ reward: { ...reward, previousLevel: 3, newLevel: 3, leveledUp: false, levelProgressBeforePercent: 20, levelProgressAfterPercent: 40, levelProgressNewPercent: 40 } });
    expect(screen.getByRole('progressbar', { name: 'Poziom 3' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-80%)' });
    advance(300);
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-60%)' });
  });

  it('B-153: odpowiedź bez levelProgressNewPercent (starsze API) - pasek jak dotąd, w skali starego poziomu', () => {
    renderScreen({ reward: { ...reward, levelProgressBeforePercent: 90, levelProgressAfterPercent: 100 } });
    expect(screen.getByRole('progressbar', { name: 'Poziom 1' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-10%)' });
  });

  it('B-153: po awansie z reduced-motion - nowy poziom od razu w stanie końcowym', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('prefers-reduced-motion: reduce') })) as typeof window.matchMedia;
    try {
      renderScreen({ reward: { ...reward, levelProgressBeforePercent: 90, levelProgressAfterPercent: 100, levelProgressNewPercent: 17 } });
      expect(screen.getByRole('progressbar', { name: 'Poziom 2' })).toBeInTheDocument();
      expect(screen.getByTestId('level-progress-fill')).toHaveStyle({ transform: 'translateX(-83%)' });
    } finally {
      window.matchMedia = original;
    }
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
    expect(screen.getAllByTestId('closing-lesson-typed').map((line) => line.textContent)).toEqual(['1. Sprawdzaj domenę.', '2. Kod SMS zatwierdza.']);
    expect(screen.getByTestId('closing-xp')).toHaveTextContent('—');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  // Wnioski w slocie (PR A pkt 3): jsdom nie liczy layoutu, więc szerokości podstawiamy - test pilnuje WYBORU układu, a rzeczywiste
  // mieszczenie się w slocie sprawdza layout-check (m6) w prawdziwej przeglądarce.
  function mockLessonWidths(textWidth: number, slotWidth: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'closing-lessons' ? slotWidth : 0;
    });
    // Na HTMLElement.prototype: inny test tego pliku zostawia tam własną wersję, która przesłania Element.prototype.
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-lesson-full')) return { width: textWidth, height: 20, left: 0, top: 0, right: textWidth, bottom: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      return original.call(this);
    });
  }

  it('wnioski mieszczące się w jednym wierszu: układ „ruled” (wiersz = liniatura raportu, bez zawijania)', () => {
    mockLessonWidths(200, 400);
    renderScreen({ fresh: false, reward: null });
    const list = screen.getByTestId('closing-lessons');
    expect(list).toHaveAttribute('data-layout', 'ruled');
    expect(list.querySelector('li')?.className).toMatch(/whitespace-nowrap/);
  });

  it('wniosek szerszy niż slot: układ „wrapped” - zawijanie w slocie zamiast ucinania', () => {
    mockLessonWidths(900, 400);
    renderScreen({ fresh: false, reward: null });
    const list = screen.getByTestId('closing-lessons');
    expect(list).toHaveAttribute('data-layout', 'wrapped');
    expect(list.querySelector('li')?.className).not.toMatch(/whitespace-nowrap/);
    expect(list.style.lineHeight).toBe('1.25');
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

  it('D-152 + prefers-reduced-motion: wysoki pionowy raport od razu przewinięty do pieczęci i liściku, bez animacji; powrót - od góry', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('prefers-reduced-motion: reduce') })) as typeof window.matchMedia;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 600, x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 600, toJSON: () => ({}) } as DOMRect);
    const portrait = { ...closing, portrait: { image: 'scenes/raport-pion.svg', slots: closing.slots } } as CaseClosing;
    // jsdom nie liczy układu: ramka przewijalna podana wprost, potem wczytanie grafiki 900x1900 (proporcje znane dopiero wtedy).
    const open = (fresh: boolean) => {
      const view = renderScreen({ closing: portrait, fresh });
      const frame = screen.getByTestId('case-closed-frame');
      Object.defineProperty(frame, 'scrollHeight', { configurable: true, value: 1200 });
      Object.defineProperty(frame, 'clientHeight', { configurable: true, value: 600 });
      const scrollTo = vi.fn();
      frame.scrollTo = scrollTo;
      // Wysokość raportu 1000 px: cel = 1000 × min(pieczęć 67,7%, liścik 36,6%) - 16 = 350.
      Object.defineProperty(screen.getByTestId('case-closed-scene'), 'offsetHeight', { configurable: true, value: 1000 });
      const image = screen.getByTestId('case-closed-scene').querySelector('img')!;
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 900 });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1900 });
      fireEvent.load(image);
      return { view, scrollTo };
    };
    try {
      const fresh = open(true);
      expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'done');
      expect(fresh.scrollTo).toHaveBeenCalledTimes(1);
      expect(fresh.scrollTo).toHaveBeenCalledWith({ top: 350, behavior: 'instant' });
      fresh.view.unmount();

      expect(open(false).scrollTo).not.toHaveBeenCalled();
    } finally {
      window.matchMedia = original;
    }
  });

  it('D-152 + reduced-motion włączone w trakcie: wysoki raport od razu przy pieczęci (raz); po zwykłej ceremonii - bez drugiego przewinięcia', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    __setGestureSeenForTests(true);
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 600, x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 600, toJSON: () => ({}) } as DOMRect);
    // Ustawienie „ogranicz ruch” przełączane w trakcie (nasłuch zmian jak w usePrefersReducedMotion).
    const original = window.matchMedia;
    let reduce = false;
    const listeners = new Set<() => void>();
    window.matchMedia = ((query: string) => ({
      ...original(query),
      get matches() {
        return query.includes('prefers-reduced-motion: reduce') && reduce;
      },
      addEventListener: (_: string, listener: () => void) => void listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => void listeners.delete(listener),
    })) as unknown as typeof window.matchMedia;
    const toggle = (value: boolean) =>
      act(() => {
        reduce = value;
        listeners.forEach((listener) => listener());
      });
    const advance = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    const portrait = { ...closing, portrait: { image: 'scenes/raport-pion.svg', slots: closing.slots } } as CaseClosing;
    const open = () => {
      const view = renderScreen({ closing: portrait });
      const frame = screen.getByTestId('case-closed-frame');
      Object.defineProperty(frame, 'scrollHeight', { configurable: true, value: 1200 });
      Object.defineProperty(frame, 'clientHeight', { configurable: true, value: 600 });
      const scrollTo = vi.fn();
      frame.scrollTo = scrollTo;
      Object.defineProperty(screen.getByTestId('case-closed-scene'), 'offsetHeight', { configurable: true, value: 1000 });
      const image = screen.getByTestId('case-closed-scene').querySelector('img')!;
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 900 });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1900 });
      fireEvent.load(image);
      return { view, scrollTo };
    };
    try {
      // W trakcie ceremonii (etap wniosków): włączenie - stan końcowy i od razu przy pieczęci, bez animacji; ponowne przełączenie nic nie robi.
      const during = open();
      advance(1300);
      expect(during.scrollTo).not.toHaveBeenCalled();
      toggle(true);
      expect(screen.getByTestId('case-closed')).toHaveAttribute('data-stage', 'done');
      expect(during.scrollTo).toHaveBeenCalledWith({ top: 350, behavior: 'instant' });
      toggle(false);
      toggle(true);
      expect(during.scrollTo).toHaveBeenCalledTimes(1);
      during.view.unmount();

      // Zwykła ceremonia (zjazd płynny po podpisie), potem włączenie - bez drugiego przewinięcia.
      toggle(false);
      const after = open();
      advance(1300);
      for (let i = 0; i < 60; i += 1) advance(250);
      fireEvent.click(screen.getByRole('button', { name: 'Podpisz raport' }));
      advance(600);
      expect(after.scrollTo).toHaveBeenCalledWith({ top: 350, behavior: 'smooth' });
      advance(2000);
      toggle(true);
      expect(after.scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = original;
      vi.useRealTimers();
      vi.restoreAllMocks();
      __setGestureSeenForTests(false);
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
