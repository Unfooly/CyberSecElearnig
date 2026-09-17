import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CourseCard from './CourseCard';
import type { CourseAssignmentSummary } from '@/lib/courses-types';

const base: CourseAssignmentSummary = {
  assignmentId: 'a1',
  courseId: 'course-1',
  title: 'Rozpoznawanie phishingu',
  category: 'EMAIL_SECURITY',
  durationMinutes: 8,
  mandatory: false,
  status: 'NOT_STARTED',
  score: null,
  dueDate: null,
  completedAt: null,
  currentBlockIndex: 0,
  totalBlocks: 4,
};

describe('CourseCard', () => {
  it('renderuje tytuł, czas trwania i link do odtwarzacza z etykietą "Start" dla NOT_STARTED', () => {
    render(<CourseCard course={base} />);

    expect(screen.getByText('Rozpoznawanie phishingu')).toBeInTheDocument();
    expect(screen.getByText('8 min')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Start' });
    expect(link).toHaveAttribute('href', '/courses/course-1');
  });

  it('pokazuje pasek postępu i "Kontynuuj" dla IN_PROGRESS', () => {
    render(<CourseCard course={{ ...base, status: 'IN_PROGRESS', currentBlockIndex: 2 }} />);

    expect(screen.getByRole('link', { name: 'Kontynuuj' })).toBeInTheDocument();
    expect(screen.getByText('2 / 4 bloków')).toBeInTheDocument();
  });

  it('pokazuje "Kontynuuj" (nie "Start") dla OVERDUE, z paskiem postępu', () => {
    render(<CourseCard course={{ ...base, status: 'OVERDUE', currentBlockIndex: 1 }} />);

    expect(screen.getByRole('link', { name: 'Kontynuuj' })).toBeInTheDocument();
    expect(screen.getByText('1 / 4 bloków')).toBeInTheDocument();
  });

  it('pokazuje "Zobacz podsumowanie" (nie "Powtórz") i wynik dla COMPLETED', () => {
    render(
      <CourseCard
        course={{ ...base, status: 'COMPLETED', currentBlockIndex: 4, score: 75 }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Zobacz podsumowanie' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Powtórz' })).not.toBeInTheDocument();
    expect(screen.getByText('Wynik: 75%')).toBeInTheDocument();
  });

  it('pokazuje tag "Obowiązkowy" tylko dla mandatory=true', () => {
    const { rerender } = render(<CourseCard course={{ ...base, mandatory: true }} />);
    expect(screen.getByText('Obowiązkowy')).toBeInTheDocument();

    rerender(<CourseCard course={{ ...base, mandatory: false }} />);
    expect(screen.queryByText('Obowiązkowy')).not.toBeInTheDocument();
  });
});
