import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Podważenie kwestii przesłuchania (INTERROGATION, D-118: POST /courses/:id/blocks/:blockId/challenge). Zmienia stan (jedna próba na kwestię,
// notatka sprzeczności), więc proxyAuthenticated wymaga żądania z naszej własnej strony (CSRF). Ścieżka stała po stronie serwera
// (identyfikatory po isSafeId), ciało z allowlisty: { lineId, noteRef } - dwa identyfikatory (isSafeId; dokładny format - DTO w API).
// Tożsamość i organizacja wyłącznie z ciasteczka (JWT). Statusy API (400, 404, 429) przechodzą 1:1.
export async function POST(request: Request, { params }: { params: { courseId: string; blockId: string } }) {
  if (!isSafeId(params.courseId) || !isSafeId(params.blockId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { lineId?: unknown; noteRef?: unknown } | null;
  if (!body || typeof body.lineId !== 'string' || typeof body.noteRef !== 'string' || !isSafeId(body.lineId) || !isSafeId(body.noteRef)) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }

  return proxyAuthenticated('POST', `/courses/${params.courseId}/blocks/${params.blockId}/challenge`, {
    lineId: body.lineId,
    noteRef: body.noteRef,
  });
}
