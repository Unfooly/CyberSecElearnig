import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KpiCard from './KpiCard';

describe('KpiCard', () => {
  it('renderuje etykietę, wartość i jednostkę', () => {
    render(<KpiCard label="Aktywni użytkownicy" value="3" unit="/ 4" />);

    expect(screen.getByText('Aktywni użytkownicy')).toBeInTheDocument();
    expect(screen.getByText('/ 4')).toBeInTheDocument();
    expect(screen.getByText('3', { exact: false })).toBeInTheDocument();
  });

  it('pokazuje pasek postępu, gdy podano progress', () => {
    render(<KpiCard label="Ukończenie" value="78" unit="%" progress={{ value: 78 }} />);

    expect(screen.getByRole('progressbar', { name: 'Ukończenie' })).toHaveAttribute('aria-valuenow', '78');
  });

  it('placeholder ma przerywany border, pill "Moduł wkrótce" i nie ma paska', () => {
    const { container } = render(<KpiCard label="Klikalność phishingowa" value="Pojawi się po pierwszej kampanii" placeholder />);

    expect(screen.getByText('Moduł wkrótce')).toBeInTheDocument();
    expect(screen.getByText('Pojawi się po pierwszej kampanii')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('border-dashed');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('pokazuje podpis pod wartością', () => {
    render(<KpiCard label="Zaległe szkolenia" value="9" hint="w 4 działach" hintTone="warn" />);

    expect(screen.getByText('w 4 działach')).toHaveClass('text-warning');
  });
});
