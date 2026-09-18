import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WelcomeBanner from './WelcomeBanner';
import type { CourseAssignmentSummary } from '@/lib/courses-types';

function courseWithStatus(status: CourseAssignmentSummary['status'], id: string): CourseAssignmentSummary {
  return {
    assignmentId: id,
    courseId: id,
    title: 'Kurs',
    category: 'GENERAL_AWARENESS',
    durationMinutes: 5,
    mandatory: false,
    status,
    score: null,
    dueDate: null,
    completedAt: null,
    currentBlockIndex: 0,
    totalBlocks: 1,
  };
}

describe('WelcomeBanner', () => {
  it('pokazuje gratulacje, gdy wszystkie kursy są ukończone', () => {
    render(<WelcomeBanner courses={[courseWithStatus('COMPLETED', 'a1')]} userEmail="jan@example.test" />);

    expect(screen.getByText(/ukończyłeś\/aś wszystkie przypisane kursy/i)).toBeInTheDocument();
  });

  it('pokazuje liczbę kursów do zrobienia, gdy są NOT_STARTED/IN_PROGRESS/OVERDUE', () => {
    render(
      <WelcomeBanner
        courses={[courseWithStatus('COMPLETED', 'a1'), courseWithStatus('NOT_STARTED', 'a2'), courseWithStatus('OVERDUE', 'a3')]}
        userEmail="jan@example.test"
      />,
    );

    expect(screen.getByText(/masz 2 kursy do ukończenia/i)).toBeInTheDocument();
  });

  it('wyciąga imię z lokalnej części e-maila i pokazuje w powitaniu', () => {
    render(<WelcomeBanner courses={[]} userEmail="jan.kowalski@example.test" />);

    expect(screen.getByText('Witaj, Jan!')).toBeInTheDocument();
  });

  it('nie wywala się i pokazuje generyczne powitanie, gdy userEmail jest null', () => {
    render(<WelcomeBanner courses={[]} userEmail={null} />);

    expect(screen.getByText('Witaj!')).toBeInTheDocument();
  });

  it('używa poprawnej polskiej odmiany dla liczby kursów (1, 2-4, 5+)', () => {
    const { rerender } = render(
      <WelcomeBanner courses={[courseWithStatus('NOT_STARTED', 'a1')]} userEmail={null} />,
    );
    expect(screen.getByText(/1 kurs do ukończenia/i)).toBeInTheDocument();

    rerender(
      <WelcomeBanner
        courses={[1, 2, 3, 4, 5].map((n) => courseWithStatus('NOT_STARTED', `a${n}`))}
        userEmail={null}
      />,
    );
    expect(screen.getByText(/5 kursów do ukończenia/i)).toBeInTheDocument();
  });
});
