'use client';

import { useState } from 'react';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import CourseCard from './CourseCard';

type Tab = 'all' | 'mandatory' | 'overdue';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'mandatory', label: 'Obowiązkowe' },
  { key: 'overdue', label: 'Zaległe' },
];

function matchesTab(course: CourseAssignmentSummary, tab: Tab): boolean {
  if (tab === 'mandatory') return course.mandatory;
  if (tab === 'overdue') return course.status === 'OVERDUE';
  return true;
}

export default function CourseLibrary({ courses }: { courses: CourseAssignmentSummary[] }) {
  // Zakładki filtrują po stronie klienta jeden już pobrany zestaw danych -
  // brak dodatkowych zapytań przy przełączaniu.
  const [tab, setTab] = useState<Tab>('all');
  const filtered = courses.filter((course) => matchesTab(course, tab));

  const counts: Record<Tab, number> = {
    all: courses.length,
    mandatory: courses.filter((c) => matchesTab(c, 'mandatory')).length,
    overdue: courses.filter((c) => matchesTab(c, 'overdue')).length,
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Biblioteka kursów</h1>

      <div role="tablist" className="mb-6 flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-slate-400">Brak kursów w tej kategorii.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((course) => (
            <CourseCard key={course.assignmentId} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}
