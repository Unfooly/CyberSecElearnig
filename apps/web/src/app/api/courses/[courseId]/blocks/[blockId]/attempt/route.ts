import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Próba odpowiedzi w bloku TEXT_INPUT_GUIDED (POST /courses/:id/blocks/:blockId/attempt). Zmienia stan (zużywa próby, odsłania podpowiedzi
// i rozwiązanie), więc proxyAuthenticated wymaga żądania z naszej własnej strony (obrona przed CSRF także z sąsiedniej subdomeny). Ścieżka
// stała po stronie serwera (identyfikatory tylko po walidacji isSafeId: bez "..", "/", "?", "%"), ciało z allowlisty: { answer: string }.
// Tożsamość i organizacja pochodzą wyłącznie z ciasteczka (JWT). Statusy API (400, 404, 429 limit prób) przechodzą 1:1.
export async function POST(request: Request, { params }: { params: { courseId: string; blockId: string } }) {
  if (!isSafeId(params.courseId) || !isSafeId(params.blockId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { answer?: unknown } | null;
  if (!body || typeof body.answer !== 'string') {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }

  return proxyAuthenticated('POST', `/courses/${params.courseId}/blocks/${params.blockId}/attempt`, { answer: body.answer });
}
