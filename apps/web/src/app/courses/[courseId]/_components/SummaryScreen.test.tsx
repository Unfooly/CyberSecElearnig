import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SummaryScreen from './SummaryScreen';
import type { CourseCompletionReward } from '@/lib/courses-types';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const sampleReward: CourseCompletionReward = {
  xpGained: 150,
  newLevel: 2,
  leveledUp: true,
  unlockedBadges: [{ code: 'FIRST_STEP', title: 'Pierwszy Krok', icon: 'first-step', xpReward: 50 }],
};

describe('SummaryScreen', () => {
  it('pokazuje wynik procentowy, gdy score nie jest null', () => {
    render(<SummaryScreen courseId="c1" title="Rozpoznawanie phishingu" score={75} />);

    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Rozpoznawanie phishingu')).toBeInTheDocument();
  });

  it('pokazuje "brak ocenianych pytań", gdy score=null i scoreUnavailable=false', () => {
    render(<SummaryScreen courseId="c1" title="Kurs wideo" score={null} />);

    expect(screen.getByText('Ten kurs nie zawierał ocenianych pytań.')).toBeInTheDocument();
  });

  it('pokazuje komunikat o błędzie pobrania wyniku, gdy scoreUnavailable=true, nie myli tego z brakiem pytań', () => {
    render(<SummaryScreen courseId="c1" title="Kurs" score={null} scoreUnavailable />);

    expect(screen.getByText(/nie udało się pobrać wyniku/i)).toBeInTheDocument();
    expect(screen.queryByText('Ten kurs nie zawierał ocenianych pytań.')).not.toBeInTheDocument();
  });

  it('renderuje link powrotu do /courses', () => {
    render(<SummaryScreen courseId="c1" title="Kurs" score={100} />);

    expect(screen.getByRole('link', { name: /biblioteki kursów/i })).toHaveAttribute(
      'href',
      '/courses',
    );
  });

  it('nie pokazuje modala nagrody, gdy reward nie jest przekazane (user wrócił do starego kursu)', () => {
    render(<SummaryScreen courseId="c1" title="Kurs" score={100} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pokazuje modal nagrody z XP, awansem i nową odznaką przy świeżym ukończeniu', () => {
    render(<SummaryScreen courseId="c1" title="Kurs" score={100} reward={sampleReward} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Zdobyłeś +150 XP!');
    expect(dialog).toHaveTextContent('Awans na poziom 2!');
    expect(dialog).toHaveTextContent('Pierwszy Krok');
  });

  it('zamyka modal nagrody po kliknięciu "Super!", bez ukrywania reszty podsumowania', () => {
    render(<SummaryScreen courseId="c1" title="Kurs" score={100} reward={sampleReward} />);

    fireEvent.click(screen.getByRole('button', { name: 'Super!' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Kurs ukończony')).toBeInTheDocument();
  });

  describe('"Rozpocznij od nowa" (D-069)', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      refreshMock.mockReset();
      vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('bez potwierdzenia (confirm=false): nie woła API, nie odświeża', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      render(<SummaryScreen courseId="c1" title="Kurs" score={100} />);

      fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij od nowa' }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('po potwierdzeniu: POST na .../restart, potem router.refresh() (ta sama trasa, nie nawigacja)', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ assignmentId: 'a2' }) });
      render(<SummaryScreen courseId="c1" title="Kurs" score={100} />);

      fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij od nowa' }));

      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/restart', { method: 'POST' });
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });

    it('błąd restartu (np. 409): pokazuje komunikat, NIE odświeża, przycisk wraca do "Rozpocznij od nowa"', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'Błąd' }) });
      render(<SummaryScreen courseId="c1" title="Kurs" score={100} />);

      fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij od nowa' }));

      await waitFor(() => expect(screen.getByText(/nie udało się rozpocząć kursu od nowa/i)).toBeInTheDocument());
      expect(refreshMock).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Rozpocznij od nowa' })).not.toBeDisabled();
    });

    it('przycisk jest zablokowany w trakcie żądania ("Uruchamianie od nowa…")', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let resolveFetch: (value: unknown) => void = () => {};
      fetchMock.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
      render(<SummaryScreen courseId="c1" title="Kurs" score={100} />);

      fireEvent.click(screen.getByRole('button', { name: 'Rozpocznij od nowa' }));

      expect(screen.getByRole('button', { name: 'Uruchamianie od nowa…' })).toBeDisabled();
      resolveFetch({ ok: true, json: async () => ({ assignmentId: 'a2' }) });
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });
  });
});
