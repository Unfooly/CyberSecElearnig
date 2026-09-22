import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Samoobsługowe rozpoczęcie kursu z katalogu (D-065): zmienia stan (tworzy CourseAssignment), więc idzie przez
// proxyAuthenticated (kontrola same-origin, token z ciasteczka httpOnly). Ścieżka stała po stronie serwera
// (courseId tylko po walidacji isSafeId), bez ciała żądania - klient nie wybiera niczego poza samym kursem.
export async function POST(request: Request, { params }: { params: { courseId: string } }) {
  if (!isSafeId(params.courseId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }

  return proxyAuthenticated('POST', `/courses/${params.courseId}/self-assign`);
}
