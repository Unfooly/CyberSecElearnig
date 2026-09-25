import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SummaryScreen from './SummaryScreen';
import type { CourseCompletionReward } from '@/lib/courses-types';

// feat/player-stage: SummaryScreen straciło własne przyciski ("Rozpocznij od nowa"/"Wróć do biblioteki") - są
// teraz dolnym paskiem PlayerStage (CoursePlayer.tsx), w miejscu Wstecz/Dalej. Testy tamtych zachowań (restart,
// potwierdzenie, błąd, stan "w trakcie") przeniesione do CoursePlayer.test.tsx, opisane w PR. Ten plik sprawdza już
// tylko TREŚĆ podsumowania (wynik/nagroda/komunikat błędu restartu).

const sampleReward: CourseCompletionReward = {
  xpGained: 150,
  newLevel: 2,
  leveledUp: true,
  unlockedBadges: [{ code: 'FIRST_STEP', title: 'Pierwszy Krok', icon: 'first-step', xpReward: 50 }],
};

describe('SummaryScreen', () => {
  it('pokazuje wynik procentowy, gdy score nie jest null', () => {
    render(<SummaryScreen title="Rozpoznawanie phishingu" score={75} />);

    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Rozpoznawanie phishingu')).toBeInTheDocument();
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

  it('nie pokazuje modala nagrody, gdy reward nie jest przekazane (user wrócił do starego kursu)', () => {
    render(<SummaryScreen title="Kurs" score={100} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pokazuje modal nagrody z XP, awansem i nową odznaką przy świeżym ukończeniu', () => {
    render(<SummaryScreen title="Kurs" score={100} reward={sampleReward} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Zdobyłeś +150 XP!');
    expect(dialog).toHaveTextContent('Awans na poziom 2!');
    expect(dialog).toHaveTextContent('Pierwszy Krok');
  });

  it('zamyka modal nagrody po kliknięciu "Super!", bez ukrywania reszty podsumowania', () => {
    render(<SummaryScreen title="Kurs" score={100} reward={sampleReward} />);

    fireEvent.click(screen.getByRole('button', { name: 'Super!' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Kurs ukończony')).toBeInTheDocument();
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
