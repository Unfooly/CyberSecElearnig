import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LearningPath from './LearningPath';
import type { CourseAssignmentSummary } from '@/lib/courses-types';

const course = (over: Partial<CourseAssignmentSummary>): CourseAssignmentSummary => ({
  assignmentId: 'a1',
  courseId: 'c1',
  title: 'Phishing: jak rozpoznać fałszywy e-mail',
  category: 'PHISHING_SOCIAL_ENGINEERING',
  durationMinutes: 12,
  mandatory: false,
  status: 'NOT_STARTED',
  currentBlockIndex: 0,
  totalBlocks: 5,
  score: null,
  dueDate: null,
  completedAt: null,
  ...over,
});

describe('LearningPath', () => {
  it('pokazuje EmptyState, gdy nie ma przypisanych kursów', () => {
    render(<LearningPath courses={[]} />);

    expect(screen.getByRole('heading', { name: 'Brak przypisanych kursów' })).toBeInTheDocument();
  });

  it('renderuje kroki w kolejności z API z numerami i linkami do kursów', () => {
    render(
      <LearningPath
        courses={[
          course({ assignmentId: 'a1', courseId: 'c1', title: 'Pierwszy', status: 'COMPLETED', score: 90 }),
          course({ assignmentId: 'a2', courseId: 'c2', title: 'Drugi', status: 'IN_PROGRESS', currentBlockIndex: 2, mandatory: true }),
          course({ assignmentId: 'a3', courseId: 'c3', title: 'Trzeci' }),
        ]}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Pierwszy');
    expect(items[0]).toHaveTextContent('Wynik: 90%');
    expect(items[1]).toHaveTextContent('Obowiązkowy');
    expect(screen.getByRole('link', { name: 'Kontynuuj: Drugi' })).toHaveAttribute('href', '/courses/c2');
    expect(screen.getByRole('link', { name: 'Start: Trzeci' })).toHaveAttribute('href', '/courses/c3');
    expect(screen.getByRole('link', { name: 'Zobacz podsumowanie: Pierwszy' })).toHaveAttribute('href', '/courses/c1');
  });

  it('pasek postępu tylko dla kursów w toku / zaległych', () => {
    render(
      <LearningPath
        courses={[
          course({ assignmentId: 'a1', title: 'A', status: 'IN_PROGRESS', currentBlockIndex: 1 }),
          course({ assignmentId: 'a2', title: 'B', status: 'NOT_STARTED' }),
        ]}
      />,
    );

    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });
});
