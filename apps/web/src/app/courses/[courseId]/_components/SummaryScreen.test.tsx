import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SummaryScreen from './SummaryScreen';

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

  it('renderuje link powrotu do /courses', () => {
    render(<SummaryScreen title="Kurs" score={100} />);

    expect(screen.getByRole('link', { name: /biblioteki kursów/i })).toHaveAttribute(
      'href',
      '/courses',
    );
  });
});
