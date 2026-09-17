import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseLibrary from './CourseLibrary';
import type { CourseAssignmentSummary } from '@/lib/courses-types';

function course(overrides: Partial<CourseAssignmentSummary>): CourseAssignmentSummary {
  return {
    assignmentId: overrides.title ?? 'a',
    courseId: overrides.title ?? 'c',
    title: 'Kurs',
    category: 'GENERAL_AWARENESS',
    durationMinutes: 5,
    mandatory: false,
    status: 'NOT_STARTED',
    score: null,
    dueDate: null,
    completedAt: null,
    currentBlockIndex: 0,
    totalBlocks: 3,
    ...overrides,
  };
}

// Tytuły celowo różne od etykiet StatusBadge ("Zaległy" itp.), żeby nie
// kolidowały w zapytaniach getByText.
const courses = [
  course({ assignmentId: 'a1', title: 'Kurs A (obowiązkowy)', mandatory: true }),
  course({ assignmentId: 'a2', title: 'Kurs B (opcjonalny, w toku)', mandatory: false, status: 'IN_PROGRESS' }),
  course({ assignmentId: 'a3', title: 'Kurs C (obowiązkowy, zaległy)', mandatory: true, status: 'OVERDUE' }),
];

describe('CourseLibrary - filtrowanie klienckie po zakładkach', () => {
  it('zakładka "Wszystkie" pokazuje wszystkie kursy z jednego przekazanego zestawu danych', () => {
    render(<CourseLibrary courses={courses} />);

    expect(screen.getByText('Kurs A (obowiązkowy)')).toBeInTheDocument();
    expect(screen.getByText('Kurs B (opcjonalny, w toku)')).toBeInTheDocument();
    expect(screen.getByText('Kurs C (obowiązkowy, zaległy)')).toBeInTheDocument();
  });

  it('zakładka "Obowiązkowe" pokazuje tylko mandatory=true', () => {
    render(<CourseLibrary courses={courses} />);

    fireEvent.click(screen.getByRole('tab', { name: /Obowiązkowe/ }));

    expect(screen.getByText('Kurs A (obowiązkowy)')).toBeInTheDocument();
    expect(screen.getByText('Kurs C (obowiązkowy, zaległy)')).toBeInTheDocument();
    expect(screen.queryByText('Kurs B (opcjonalny, w toku)')).not.toBeInTheDocument();
  });

  it('zakładka "Zaległe" pokazuje tylko status=OVERDUE', () => {
    render(<CourseLibrary courses={courses} />);

    fireEvent.click(screen.getByRole('tab', { name: /Zaległe/ }));

    expect(screen.getByText('Kurs C (obowiązkowy, zaległy)')).toBeInTheDocument();
    expect(screen.queryByText('Kurs A (obowiązkowy)')).not.toBeInTheDocument();
    expect(screen.queryByText('Kurs B (opcjonalny, w toku)')).not.toBeInTheDocument();
  });

  it('nie woła żadnego dodatkowego zapytania przy przełączaniu zakładek (filtrowanie czysto klienckie)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(<CourseLibrary courses={courses} />);
    fireEvent.click(screen.getByRole('tab', { name: /Obowiązkowe/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Zaległe/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Wszystkie/ }));

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('pokazuje komunikat o braku kursów, gdy filtr nie zwraca wyników', () => {
    render(<CourseLibrary courses={[course({ mandatory: false, status: 'NOT_STARTED' })]} />);

    fireEvent.click(screen.getByRole('tab', { name: /Zaległe/ }));

    expect(screen.getByText('Brak kursów w tej kategorii.')).toBeInTheDocument();
  });

  it('liczniki w nazwach zakładek odzwierciedlają liczbę pasujących kursów', () => {
    render(<CourseLibrary courses={courses} />);

    expect(screen.getByRole('tab', { name: 'Wszystkie (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Obowiązkowe (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Zaległe (1)' })).toBeInTheDocument();
  });
});
