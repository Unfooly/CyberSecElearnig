import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Zapis postępu w kursie (zmienia stan: proxyAuthenticated wymaga żądania z naszej własnej strony, token bierze z ciasteczka). Ścieżka jest
// stała po stronie serwera (courseId tylko po walidacji isSafeId), a ciało budujemy z allowlisty: { blockIndex, answer? }. `answer` to
// wybór gracza (indeks opcji albo obiekt z listą id) - jego kształt waliduje i ocenia serwer API; klient nie może przekazać oceny ani punktów,
// bo takich pól tu nie ma.
export async function POST(request: Request, { params }: { params: { courseId: string } }) {
  if (!isSafeId(params.courseId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { blockIndex?: unknown; answer?: unknown } | null;
  if (!body || typeof body !== 'object' || !Number.isInteger(body.blockIndex) || (body.blockIndex as number) < 0) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }

  return proxyAuthenticated('POST', `/courses/${params.courseId}/progress`, {
    blockIndex: body.blockIndex,
    ...(body.answer !== undefined ? { answer: body.answer } : {}),
  });
}
