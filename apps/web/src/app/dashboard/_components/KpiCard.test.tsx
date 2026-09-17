import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KpiCard from './KpiCard';

describe('KpiCard', () => {
  it('renderuje etykietę i wartość', () => {
    render(<KpiCard label="Aktywni użytkownicy" value="3 / 4" />);

    expect(screen.getByText('Aktywni użytkownicy')).toBeInTheDocument();
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
  });

  it('stosuje stonowany styl (muted) dla placeholderów metryk phishingowych', () => {
    render(<KpiCard label="Klikalność phishingowa" value="Brak danych" muted />);

    expect(screen.getByText('Brak danych')).toHaveClass('italic');
  });

  it('bez "muted" wartość jest wyróżniona, nie stonowana', () => {
    render(<KpiCard label="Zaległe szkolenia" value="2" />);

    expect(screen.getByText('2')).not.toHaveClass('italic');
  });
});
