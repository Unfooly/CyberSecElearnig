import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DepartmentsTable from './DepartmentsTable';

describe('DepartmentsTable', () => {
  it('pokazuje EmptyState (nie "Brak danych"), gdy lista działów jest pusta', () => {
    render(<DepartmentsTable rows={[]} />);

    expect(screen.getByRole('heading', { name: 'Brak działów do porównania' })).toBeInTheDocument();
    expect(screen.queryByText('Brak danych do wyświetlenia.')).not.toBeInTheDocument();
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
    expect(screen.getByText('W toku')).toBeInTheDocument();

    expect(screen.getByText('Brak działu')).toBeInTheDocument();
    expect(screen.getByText('Brak danych')).toBeInTheDocument();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
  });

  it('status zależy od ukończenia: Komplet przy 100%, Do nadrobienia poniżej 50%', () => {
    render(
      <DepartmentsTable
        rows={[
          { departmentId: 'a', departmentName: 'A', completionRate: 100, mandatoryTotal: 2, mandatoryCompleted: 2 },
          { departmentId: 'b', departmentName: 'B', completionRate: 20, mandatoryTotal: 5, mandatoryCompleted: 1 },
        ]}
      />,
    );

    expect(screen.getByText('Komplet')).toBeInTheDocument();
    expect(screen.getByText('Do nadrobienia')).toBeInTheDocument();
  });

  it('nagłówki tabeli mają scope="col" dla dostępności', () => {
    render(
      <DepartmentsTable
        rows={[{ departmentId: 'a', departmentName: 'A', completionRate: 100, mandatoryTotal: 2, mandatoryCompleted: 2 }]}
      />,
    );

    screen.getAllByRole('columnheader').forEach((header) => {
      expect(header).toHaveAttribute('scope', 'col');
    });
  });
});
