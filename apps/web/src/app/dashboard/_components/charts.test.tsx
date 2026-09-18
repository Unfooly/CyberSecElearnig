import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CompletionTrendChart from './CompletionTrendChart';
import DepartmentRiskChart from './DepartmentRiskChart';

// jsdom nie ma wymiarów layoutu, więc ResponsiveContainer nic nie rysuje -
// asercje idą po tekstowym odpowiedniku (sr-only) wykresów.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return { ...actual, ResponsiveContainer: () => null };
});

describe('CompletionTrendChart', () => {
  it('pokazuje wartości miesięczne w tekstowym odpowiedniku', () => {
    render(
      <CompletionTrendChart
        points={[
          { month: '2026-08', completionRate: null, mandatoryTotal: 0, mandatoryCompleted: 0 },
          { month: '2026-09', completionRate: 43, mandatoryTotal: 7, mandatoryCompleted: 3 },
        ]}
      />,
    );
    expect(screen.getByText('43%')).toBeInTheDocument();
    expect(screen.getByText('Brak danych')).toBeInTheDocument();
  });

  it('pokazuje komunikat, gdy żaden miesiąc nie ma danych', () => {
    render(<CompletionTrendChart points={[{ month: '2026-09', completionRate: null, mandatoryTotal: 0, mandatoryCompleted: 0 }]} />);
    expect(screen.getByText('Brak danych do wyświetlenia.')).toBeInTheDocument();
  });
});

describe('DepartmentRiskChart', () => {
  it('wymienia działy z wartościami, także te bez danych', () => {
    render(
      <DepartmentRiskChart
        rows={[
          { departmentId: 'd1', departmentName: 'IT', completionRate: 30, mandatoryTotal: 10, mandatoryCompleted: 3 },
          { departmentId: 'd2', departmentName: 'HR', completionRate: null, mandatoryTotal: 0, mandatoryCompleted: 0 },
        ]}
      />,
    );
    expect(screen.getByText('IT')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('HR')).toBeInTheDocument();
    expect(screen.getByText('Brak danych')).toBeInTheDocument();
    expect(screen.getByText(/Wysokie ryzyko/)).toBeInTheDocument();
  });

  it('pokazuje komunikat, gdy brak działów z danymi', () => {
    render(<DepartmentRiskChart rows={[]} />);
    expect(screen.getByText('Brak danych do wyświetlenia.')).toBeInTheDocument();
  });
});
