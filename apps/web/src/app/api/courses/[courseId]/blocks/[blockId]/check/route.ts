import { NextResponse } from 'next/server';
import { proxyAuthenticated } from '@/lib/bff';
import { isSafeId } from '@/lib/safe-id';

// Ocena jednego kliknięcia (tryb prosty i SWIPE_SORT, D-132: POST /courses/:id/blocks/:blockId/check). Zmienia stan (próba w postępie), więc
// proxyAuthenticated wymaga żądania z naszej własnej strony (CSRF). Ścieżka stała po stronie serwera (identyfikatory po isSafeId), ciało z
// allowlisty: { option } (indeks odpowiedzi 0-7) albo { card, verdict } (nieprzejrzyste id karty i werdykt). Ocenę liczy wyłącznie API.
// Tożsamość i organizacja wyłącznie z ciasteczka (JWT). Statusy API (400, 404, 429) przechodzą 1:1.
export async function POST(request: Request, { params }: { params: { courseId: string; blockId: string } }) {
  if (!isSafeId(params.courseId) || !isSafeId(params.blockId)) {
    return NextResponse.json({ message: 'Nieprawidłowy identyfikator.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { option?: unknown; options?: unknown; card?: unknown; verdict?: unknown } | null;
  const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7;
  const isOption = isIndex(body?.option);
  // Wielokrotny wybór (D-158): 1-8 indeksów 0-7; powtórzenia i zakres bloku sprawdza API.
  const isOptions = Array.isArray(body?.options) && body.options.length >= 1 && body.options.length <= 8 && body.options.every(isIndex);
  const isCard = typeof body?.card === 'string' && isSafeId(body.card) && (body.verdict === 'suspicious' || body.verdict === 'ok');
  if (!body || Number(isOption) + Number(isOptions) + Number(isCard) !== 1) {
    return NextResponse.json({ message: 'Nieprawidłowe żądanie.' }, { status: 400 });
  }

  return proxyAuthenticated(
    'POST',
    `/courses/${params.courseId}/blocks/${params.blockId}/check`,
    isOption ? { option: body.option } : isOptions ? { options: body.options } : { card: body.card, verdict: body.verdict },
  );
}
