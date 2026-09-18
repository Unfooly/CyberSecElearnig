'use client';

import { useRef } from 'react';
import type { CourseAssignmentSummary } from '@/lib/courses-types';
import CourseCard from './CourseCard';

// Prostszy niż "prawdziwa" karuzela z paginacją zsynchronizowaną ze scrollem
// (kropki na mockupie) - świadomie pominięte: strzałki realnie przewijają
// kontener (scrollBy), zamiast udawać stan, którego i tak nie da się tanio
// utrzymać w zgodzie z faktyczną pozycją scrolla bez dodatkowej złożoności.
export default function CourseCarousel({ courses }: { courses: CourseAssignmentSummary[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollByCards(direction: 1 | -1) {
    scrollRef.current?.scrollBy({ left: direction * 280, behavior: 'smooth' });
  }

  if (courses.length === 0) {
    return <p className="text-sm text-slate-500">Brak przypisanych kursów.</p>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => scrollByCards(-1)}
        aria-label="Poprzednie kursy"
        className="absolute -left-3 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 sm:flex"
      >
        ‹
      </button>

      <div ref={scrollRef} className="flex gap-4 overflow-x-auto scroll-smooth pb-2">
        {courses.map((course) => (
          <div key={course.assignmentId} className="w-64 shrink-0">
            <CourseCard course={course} />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => scrollByCards(1)}
        aria-label="Następne kursy"
        className="absolute -right-3 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 sm:flex"
      >
        ›
      </button>
    </div>
  );
}
