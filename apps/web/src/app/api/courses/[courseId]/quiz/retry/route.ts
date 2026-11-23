import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// „Powtórz quiz” (D-207): zmienia stan (czyści odpowiedzi quizu, cofa pozycję), więc idzie przez proxyAuthenticated (kontrola same-origin,
// token z ciasteczka httpOnly) - jak restart. Ścieżka stała po stronie serwera (courseId tylko po walidacji isSafeId), bez ciała żądania.
export async function POST(request: Request, { params }: { params: { courseId: string } }) {
  if (!isSafeId(params.courseId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }

  return proxyAuthenticated('POST', `/courses/${params.courseId}/quiz/retry`);
}
