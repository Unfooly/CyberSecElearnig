import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseCarousel from './CourseCarousel';
import type { CourseAssignmentSummary } from '@/lib/courses-types';

const course: CourseAssignmentSummary = {
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

describe('CourseCarousel', () => {
  it('renderuje kartę dla każdego kursu', () => {
    render(<CourseCarousel courses={[course, { ...course, assignmentId: 'a2', courseId: 'course-2', title: 'Drugi kurs' }]} />);

    expect(screen.getByText('Rozpoznawanie phishingu')).toBeInTheDocument();
    expect(screen.getByText('Drugi kurs')).toBeInTheDocument();
  });

  it('pokazuje komunikat o braku kursów zamiast pustej karuzeli', () => {
    render(<CourseCarousel courses={[]} />);

    expect(screen.getByText(/brak przypisanych kursów/i)).toBeInTheDocument();
  });

  it('strzałki wołają scrollBy na kontenerze, nie rzucają błędu', () => {
    render(<CourseCarousel courses={[course]} />);
    // jsdom nie implementuje realnego layoutu/scrolla - test sprawdza tylko,
    // że kliknięcie nie wywala komponentu (scrollBy jest no-opem w jsdom).
    Element.prototype.scrollBy = vi.fn();

    fireEvent.click(screen.getByRole('button', { name: 'Poprzednie kursy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Następne kursy' }));

    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(2);
  });
});
