import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DepartmentsTable from './DepartmentsTable';

describe('DepartmentsTable', () => {
  it('pokazuje komunikat o braku danych, gdy lista działów jest pusta', () => {
    render(<DepartmentsTable rows={[]} />);

    expect(screen.getByText('Brak danych do wyświetlenia.')).toBeInTheDocument();
  });

  it('renderuje wiersz per dział, w tym "Brak danych" zamiast 0% dla completionRate=null', () => {
    render(
      <DepartmentsTable
        rows={[
          { departmentId: 'd1', departmentName: 'IT', completionRate: 75, mandatoryTotal: 4, mandatoryCompleted: 3 },
          {
            departmentId: null,
            departmentName: 'Brak działu',
            completionRate: null,
            mandatoryTotal: 0,
            mandatoryCompleted: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText('IT')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('3 / 4')).toBeInTheDocument();

    expect(screen.getByText('Brak działu')).toBeInTheDocument();
    expect(screen.getByText('Brak danych')).toBeInTheDocument();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
  });

  it('nagłówki tabeli mają scope="col" dla dostępności', () => {
    render(<DepartmentsTable rows={[]} />);

    screen.getAllByRole('columnheader').forEach((header) => {
      expect(header).toHaveAttribute('scope', 'col');
    });
  });
});
