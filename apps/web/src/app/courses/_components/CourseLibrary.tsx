'use client';

import { useState } from 'react';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import { Library } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { SelectField } from '@/components/ui/Fields';
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

export default function CourseLibrary({ courses, contentBase }: { courses: CourseAssignmentSummary[]; contentBase?: string }) {
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
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold tracking-[-0.01em]">Biblioteka</h2>
        <label className="flex items-center gap-2 text-sm font-semibold text-muted">
          Kategoria
          <SelectField value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 [&_select]:h-9">
            <option value="all">Wszystkie kategorie</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </option>
            ))}
          </SelectField>
        </label>
      </div>

      <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3.5 py-2.5 font-semibold ${
              tab === t.key ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Brak kursów w tej kategorii"
          description="Zmień zakładkę albo kategorię, żeby zobaczyć pozostałe szkolenia."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((course) => (
            <CourseCard key={course.assignmentId} course={course} contentBase={contentBase} />
          ))}
        </div>
      )}
    </div>
  );
}
