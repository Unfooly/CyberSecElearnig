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

// Ta sama lista co CourseCategory w apps/api/prisma/schema.prisma - front
// nie ma dziś endpointu zwracającego dostępne kategorie, więc trzymane tu.
const CATEGORY_LABELS: Record<string, string> = {
  PHISHING_SOCIAL_ENGINEERING: 'Phishing i inżynieria społeczna',
  EMAIL_SECURITY: 'Bezpieczeństwo e-mail',
  IT_HYGIENE: 'Higiena IT',
  INCIDENT_RESPONSE: 'Reagowanie na incydenty',
  MALWARE: 'Złośliwe oprogramowanie',
  GENERAL_AWARENESS: 'Świadomość ogólna',
};

function matchesTab(course: CourseAssignmentSummary, tab: Tab): boolean {
  if (tab === 'mandatory') return course.mandatory;
  if (tab === 'overdue') return course.status === 'OVERDUE';
  return true;
}

export default function CourseLibrary({ courses }: { courses: CourseAssignmentSummary[] }) {
  // Zakładki i kategoria filtrują po stronie klienta jeden już pobrany
  // zestaw danych - brak dodatkowych zapytań przy przełączaniu. Biblioteka
  // pokazuje WYŁĄCZNIE kursy już przypisane userowi (apps/api nie ma dziś
  // endpointu do przeglądania pełnego katalogu nieprzypisanych kursów) -
  // filtr kategorii zawęża tę samą listę, nie odkrywa nowych kursów.
  const [tab, setTab] = useState<Tab>('all');
  const [category, setCategory] = useState<string>('all');
  const categories = Array.from(new Set(courses.map((c) => c.category)));
  const filtered = courses.filter(
    (course) => matchesTab(course, tab) && (category === 'all' || course.category === category),
  );

  const counts: Record<Tab, number> = {
    all: courses.length,
    mandatory: courses.filter((c) => matchesTab(c, 'mandatory')).length,
    overdue: courses.filter((c) => matchesTab(c, 'overdue')).length,
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Biblioteka</h1>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          Kategoria
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="all">Wszystkie kategorie</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div role="tablist" className="mb-6 flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? 'border-b-2 border-emerald-600 text-slate-900'
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
