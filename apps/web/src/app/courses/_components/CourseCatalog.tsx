'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import type { CourseCatalogItem } from '@/lib/courses-types';
import CourseCategoryIcon from './CourseCategoryIcon';

// Katalog: kursy globalne, na które NIE mamy jeszcze przypisania (D-065) - "Rozpocznij" tworzy WŁASNE, zawsze
// nieobowiązkowe przypisanie (POST /courses/:id/self-assign), potem wchodzi prosto do odtwarzacza (który i tak woła
// /start - patrz courses/[courseId]/page.tsx). Puste (wszystko już przypisane) = sekcja się nie renderuje.
export default function CourseCatalog({ courses }: { courses: CourseCatalogItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  if (courses.length === 0) return null;

  async function start(courseId: string) {
    setPendingId(courseId);
    setErrorId(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/self-assign`, { method: 'POST' });
      if (!response.ok) {
        setErrorId(courseId);
        setPendingId(null);
        return;
      }
      router.push(`/courses/${courseId}`);
    } catch {
      setErrorId(courseId);
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <Compass aria-hidden="true" className="h-5 w-5 text-muted" />
        <h2 className="text-lg font-bold tracking-[-0.01em]">Katalog</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Szkolenia dostępne do samodzielnego rozpoczęcia - nieobowiązkowe, dopóki nie przypisze ich administrator.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {courses.map((course) => (
          <Card key={course.courseId} className="flex h-full flex-col gap-3 p-[18px]">
            <CourseCategoryIcon category={course.category} />
            <div>
              <h3 className="line-clamp-2 text-[15px] font-bold leading-snug">{course.title}</h3>
              {course.subtitle && <p className="mt-1 line-clamp-2 text-xs text-muted">{course.subtitle}</p>}
            </div>
            <p className="text-xs font-semibold text-muted">{course.durationMinutes} min</p>
            {errorId === course.courseId && (
              <p className="text-xs font-semibold text-danger">Nie udało się rozpocząć kursu. Spróbuj ponownie.</p>
            )}
            <Button
              variant="primary"
              size="sm"
              className="mt-auto"
              disabled={pendingId === course.courseId}
              onClick={() => start(course.courseId)}
            >
              {pendingId === course.courseId ? 'Rozpoczynanie…' : 'Rozpocznij'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
