import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { RefObject } from 'react';
import SummaryScreen from './SummaryScreen';
import { EvidenceProvider } from './player/evidence';
import { NotesProvider } from './player/notes';
import type { ContentReaction, CourseCompletionReward } from '@/lib/courses-types';

// fix/course-finish-flow: SummaryScreen pokazuje się od razu po zapisie bloku, który kończy kurs (bez pośredniego
// ekranu "Blok ukończony."/"Zobacz podsumowanie" - CoursePlayer.test.tsx sprawdza TĘ część, przez PRAWDZIWY zapis).
// Ten plik sprawdza wyłącznie TREŚĆ ekranu: nagłówek (h2 - jedyny h1 strony to tytuł kursu w PlayerStage.tsx), wynik,
// kartę nagrody INLINE (zastępuje dawny modal CourseRewardModal.tsx - usunięty, testy jego zachowań są tu,
// przeniesione na RewardCard renderowany w tym komponencie), reakcję Fooli i listę dowodów. Ogłoszenie aria-live
// zdobytego XP żyje w PlayerStage.tsx (propem z CoursePlayer.tsx) - CoursePlayer.test.tsx/shell.test.tsx sprawdzają
// TĘ część.

function mockReducedMotion(matches: boolean) {
  return vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList);
}

const sampleReward: CourseCompletionReward = {
  xpGained: 150,
  newLevel: 2,
  previousLevel: 1,
  leveledUp: true,
  unlockedBadges: [{ code: 'FIRST_STEP', title: 'Pierwszy Krok', icon: 'first-step', xpReward: 50 }],
  levelProgressBeforePercent: 0,
  levelProgressAfterPercent: 100,
};

const sampleReaction: ContentReaction = { pose: 'cheer', text: 'Świetna robota!' };

describe('SummaryScreen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('nagłówek "Sprawa zamknięta" (h2) i tytuł kursu', () => {
    render(<SummaryScreen title="Rozpoznawanie phishingu" score={75} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Sprawa zamknięta' })).toBeInTheDocument();
    expect(screen.getByText('Rozpoznawanie phishingu')).toBeInTheDocument();
  });

  it('headingRef trafia na WIDOCZNY nagłówek "Sprawa zamknięta" (fokus po przejściu na ten ekran - CoursePlayer.tsx)', () => {
    const headingRef = { current: null } as RefObject<HTMLHeadingElement>;
    render(<SummaryScreen title="Kurs" score={100} headingRef={headingRef} />);

    expect(headingRef.current).toBe(screen.getByRole('heading', { level: 2, name: 'Sprawa zamknięta' }));
  });

  it('pokazuje wynik procentowy, gdy score nie jest null', () => {
    render(<SummaryScreen title="Kurs" score={75} />);

    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('pokazuje "brak ocenianych pytań", gdy score=null i scoreUnavailable=false', () => {
    render(<SummaryScreen title="Kurs wideo" score={null} />);

    expect(screen.getByText('Ten kurs nie zawierał ocenianych pytań.')).toBeInTheDocument();
  });

  it('pokazuje komunikat o błędzie pobrania wyniku, gdy scoreUnavailable=true, nie myli tego z brakiem pytań', () => {
    render(<SummaryScreen title="Kurs" score={null} scoreUnavailable />);

    expect(screen.getByText(/nie udało się pobrać wyniku/i)).toBeInTheDocument();
    expect(screen.queryByText('Ten kurs nie zawierał ocenianych pytań.')).not.toBeInTheDocument();
  });

  describe('karta nagrody (RewardCard, inline - zastępuje dawny modal CourseRewardModal.tsx)', () => {
    it('bez reward: nic się nie pokazuje (user wrócił do już dawno ukończonego kursu)', () => {
      render(<SummaryScreen title="Kurs" score={100} />);

      expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
      expect(screen.queryByRole('progressbar', { name: 'Postęp do następnego poziomu' })).not.toBeInTheDocument();
    });

    it('reward z XP/awansem/odznaką: karta INLINE (nie modal/dialog) pokazuje wszystko', () => {
      mockReducedMotion(true); // wartość końcowa od razu, bez animacji - test nie zależy od czasu
      render(<SummaryScreen title="Kurs" score={100} reward={sampleReward} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('+150 XP')).toBeInTheDocument();
      expect(screen.getByText('Awans na poziom 2!')).toBeInTheDocument();
      expect(screen.getByText(/Pierwszy Krok/)).toBeInTheDocument();
      const bar = screen.getByRole('progressbar', { name: 'Postęp do następnego poziomu' });
      expect(bar).toHaveAttribute('aria-valuenow', '100');
    });

    it('xpGained=0 (broniony, dziś nieosiągalny stan API - patrz komentarz w RewardCard.tsx): komunikat o powtórce zamiast animowanej karty', () => {
      render(<SummaryScreen title="Kurs" score={100} reward={{ ...sampleReward, xpGained: 0, leveledUp: false }} />);

      expect(screen.getByText(/Kurs ukończony ponownie/)).toBeInTheDocument();
      expect(screen.queryByText(/Awans na poziom/)).not.toBeInTheDocument();
    });

    it('bez awansu (leveledUp=false): brak komunikatu "Awans", pasek pokazuje procent w NIEZMIENIONEJ skali poziomu', () => {
      mockReducedMotion(true);
      render(
        <SummaryScreen
          title="Kurs"
          score={100}
          reward={{ ...sampleReward, leveledUp: false, levelProgressBeforePercent: 20, levelProgressAfterPercent: 40 }}
        />,
      );

      expect(screen.queryByText(/Awans na poziom/)).not.toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'Postęp do następnego poziomu' })).toHaveAttribute('aria-valuenow', '40');
    });

    it('reduced motion: licznik XP renderuje od razu wartość końcową, bez pętli animacji', () => {
      mockReducedMotion(true);
      render(<SummaryScreen title="Kurs" score={100} reward={sampleReward} />);

      expect(screen.getByText('+150 XP')).toBeInTheDocument();
    });

    it('bez reduced motion: licznik XP zaczyna od 0 (pierwszy render, przed pierwszą klatką animacji), nie od razu od wartości końcowej', () => {
      mockReducedMotion(false);
      render(<SummaryScreen title="Kurs" score={100} reward={sampleReward} />);

      expect(screen.getByText('+0 XP')).toBeInTheDocument();
    });

    it('bez reduced motion: licznik XP DOCHODZI do wartości końcowej po zakończeniu animacji (nie tylko startuje od 0 i tam zostaje)', () => {
      mockReducedMotion(false);
      // requestAnimationFrame/performance.now kontrolowane wprost (nie vi.useFakeTimers()+advanceTimersToNextFrame:
      // niedeterministyczne przy pętli wielu klatek liczącej upływ czasu z performance.now) - każde wywołanie RAF
      // woła callback SYNCHRONICZNIE z czasem o 100ms większym niż poprzednie, więc cała pętla tick() (RewardCard.tsx,
      // 900ms trwania) domyka się w jednym, deterministycznym przebiegu.
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: (time: number) => void) => {
          now += 100;
          callback(now);
          return 0;
        }),
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      render(<SummaryScreen title="Kurs" score={100} reward={sampleReward} />);

      expect(screen.getByText('+150 XP')).toBeInTheDocument();
    });

    it('pasek poziomu: renderuje się na levelProgressBeforePercent, po klatce animacji przechodzi na levelProgressAfterPercent (przejście CSS szerokości, nie skok)', () => {
      mockReducedMotion(true); // licznik XP nieistotny dla tego testu - bez animacji, żeby nie zależał od RAF licznika
      // requestAnimationFrame kontrolowane wprost (nie automatyczne/fake timery - w tym środowisku jsdom rAF
      // rozstrzyga się zanim zdąży zadziałać asercja "przed", więc test niczego by nie sprawdzał): przechwytujemy
      // callback i wołamy go RĘCZNIE, żeby zobaczyć stan "przed" osobno od stanu "po".
      let pendingFrame: ((time: number) => void) | null = null;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: (time: number) => void) => {
          pendingFrame = callback;
          return 0;
        }),
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      render(
        <SummaryScreen
          title="Kurs"
          score={100}
          reward={{ ...sampleReward, leveledUp: false, levelProgressBeforePercent: 20, levelProgressAfterPercent: 40 }}
        />,
      );

      const bar = screen.getByRole('progressbar', { name: 'Postęp do następnego poziomu' });
      const fill = bar.firstElementChild as HTMLElement;
      expect(fill.style.width).toBe('20%');

      act(() => {
        pendingFrame?.(0);
      });

      expect(fill.style.width).toBe('40%');
    });
  });

  describe('reakcja Fooli na wynik ostatniego bloku (MascotSays - zwykła treść, nie floating overlay)', () => {
    it('z reakcją: pokazuje się jako zwykła jednostka maskotka+dymek', () => {
      render(<SummaryScreen title="Kurs" score={100} reaction={sampleReaction} />);

      expect(screen.getByTestId('mascot-says')).toHaveTextContent('Świetna robota!');
    });

    it('bez reakcji: nic się nie pokazuje', () => {
      render(<SummaryScreen title="Kurs" score={100} />);

      expect(screen.queryByTestId('mascot-says')).not.toBeInTheDocument();
    });
  });

  describe('lista zebranych dowodów (CaseEvidenceSection.tsx, dzielona z blocks/SummaryBlock.tsx)', () => {
    it('moduł z dowodami: ta sama lista, którą user widział na bloku SUMMARY chwilę wcześniej', () => {
      render(
        <NotesProvider initial={[]} blockTitles={{ scena: 'Biuro' }}>
          <EvidenceProvider summary={{ collected: 3, total: 5, perBlock: [{ blockId: 'scena', collected: 3, total: 5 }] }}>
            <SummaryScreen title="Kurs" score={100} />
          </EvidenceProvider>
        </NotesProvider>,
      );

      expect(screen.getByTestId('case-evidence')).toHaveTextContent('Zebrane dowody: 3 z 5');
    });

    it('moduł bez dowodów: sekcja się nie pokazuje', () => {
      render(<SummaryScreen title="Kurs" score={100} />);

      expect(screen.queryByTestId('case-evidence')).not.toBeInTheDocument();
    });
  });

  it('restartError pokazuje komunikat błędu w treści (przycisk "Rozpocznij od nowa" jest w pasku PlayerStage, nie tutaj)', () => {
    render(<SummaryScreen title="Kurs" score={100} restartError />);

    expect(screen.getByText(/nie udało się rozpocząć kursu od nowa/i)).toBeInTheDocument();
  });

  it('bez restartError komunikat błędu się nie pokazuje', () => {
    render(<SummaryScreen title="Kurs" score={100} />);

    expect(screen.queryByText(/nie udało się rozpocząć kursu od nowa/i)).not.toBeInTheDocument();
  });
});
